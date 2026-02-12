const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Datastore = require('nedb-promises');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');
const https = require('https');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 5656;

// Veritabanları
const usersDB = Datastore.create({ filename: './data/users.db', autoload: true });
const messagesDB = Datastore.create({ filename: './data/messages.db', autoload: true });

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
    secret: 'gizli-anahtar',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false } // Geliştirme aşamasında false
}));

// Aktif kullanıcıları takip et
const activeUsers = new Map(); // socketId -> username

// Auth Rotaları
app.post('/api/register', async (req, res) => {
    try {
        const { username, password } = req.body;
        const existingUser = await usersDB.findOne({ username });
        if (existingUser) return res.status(400).json({ error: 'Kullanıcı zaten mevcut' });

        const hashedPassword = await bcrypt.hash(password, 10);
        await usersDB.insert({ username, password: hashedPassword });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Sunucu hatası' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await usersDB.findOne({ username });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ error: 'Geçersiz kullanıcı adı veya şifre' });
        }
        req.session.username = username;
        res.json({ success: true, username });
    } catch (err) {
        res.status(500).json({ error: 'Sunucu hatası' });
    }
});

app.get('/api/me', (req, res) => {
    if (req.session.username) {
        res.json({ username: req.session.username });
    } else {
        res.status(401).json({ error: 'Giriş yapılmadı' });
    }
});

app.get('/api/search', (req, res) => {
    const query = req.query.q;
    if (!query) return res.status(400).json({ error: 'Sorgu bulunamadı' });

    // DuckDuckGo Instant Answer API (Ücretsiz ve Anahtar Gerekmez)
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;

    https.get(url, (apiRes) => {
        let data = '';
        apiRes.on('data', (chunk) => data += chunk);
        apiRes.on('end', () => {
            try {
                const result = JSON.parse(data);
                const results = [];

                if (result.AbstractText) {
                    results.push({
                        title: result.Heading || query,
                        snippet: result.AbstractText,
                        url: result.AbstractURL
                    });
                }

                // Her durumda bir arama linki sunalım
                results.push({
                    title: `"${query}" için İnternet Araması`,
                    snippet: 'Daha fazla sonuç için tıklayın.',
                    url: `https://www.google.com/search?q=${encodeURIComponent(query)}`
                });

                res.json(results);
            } catch (e) {
                res.status(500).json({ error: 'Arama başarısız oldu' });
            }
        });
    }).on('error', (err) => {
        res.status(500).json({ error: 'Arama hatası' });
    });
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

// Socket.io Mantığı
io.on('connection', (socket) => {
    let currentUser = null;

    socket.on('authenticate', (username) => {
        currentUser = username;
        activeUsers.set(socket.id, username);
        
        // Aktif kullanıcı listesini güncelle
        io.emit('updateUserList', Array.from(new Set(activeUsers.values())));
        
        // Geçmiş mesajları yükle (Ortak chat)
        messagesDB.find({ 
            $or: [
                { room: 'common' },
                { type: 'common' } // Eski mesajlar için uyumluluk
            ]
        }).sort({ timestamp: 1 }).then(messages => {
            socket.emit('loadCommonMessages', messages);
        });
    });

    // Ortak Chat Mesajı
    socket.on('commonMessage', async (msg) => {
        if (!currentUser) return;
        let messageData = {
            from: currentUser,
            room: 'common',
            timestamp: Date.now()
        };

        if (msg.type === 'image' || msg.type === 'audio') {
            messageData.content = msg.content;
            messageData.type = msg.type;
        } else {
            messageData.text = typeof msg === 'string' ? msg : msg.text;
            messageData.type = 'text';
        }

        await messagesDB.insert(messageData);
        io.emit('commonMessage', messageData);
    });

    // Özel Mesaj
    socket.on('privateMessage', async (msg) => {
        if (!currentUser) return;
        let messageData = {
            from: currentUser,
            to: msg.to,
            room: 'private',
            timestamp: Date.now(),
            seen: false
        };

        if (msg.type === 'image' || msg.type === 'audio') {
            messageData.content = msg.content;
            messageData.type = msg.type;
        } else {
            messageData.text = msg.text;
            messageData.type = 'text';
        }

        const insertedMsg = await messagesDB.insert(messageData);
        
        // Alıcıya ve gönderene gönder
        const recipientSocketId = [...activeUsers.entries()].find(([id, name]) => name === msg.to)?.[0];
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('privateMessage', insertedMsg);
        }
        socket.emit('privateMessage', insertedMsg);
    });

    // Mesaj Görüldü İşaretle
    socket.on('markAsSeen', async (otherUser) => {
        if (!currentUser) return;
        await messagesDB.update(
            { from: otherUser, to: currentUser, seen: false },
            { $set: { seen: true } },
            { multi: true }
        );
        
        // Gönderene görüldü bilgisini ilet
        const senderSocketId = [...activeUsers.entries()].find(([id, name]) => name === otherUser)?.[0];
        if (senderSocketId) {
            io.to(senderSocketId).emit('messagesSeen', currentUser);
        }
    });

    // Özel Mesaj Geçmişini Yükle
    socket.on('loadPrivateMessages', async (otherUser) => {
        if (!currentUser) return;
        const messages = await messagesDB.find({
            $and: [
                { 
                    $or: [
                        { room: 'private' },
                        { type: 'private' } // Eski mesajlar için uyumluluk
                    ]
                },
                {
                    $or: [
                        { from: currentUser, to: otherUser },
                        { from: otherUser, to: currentUser }
                    ]
                }
            ]
        }).sort({ timestamp: 1 });
        socket.emit('loadPrivateMessages', { otherUser, messages });
    });

    // WebRTC Signaling (Sesli Arama)
    socket.on('callUser', (data) => {
        const targetSocketId = [...activeUsers.entries()].find(([id, name]) => name === data.userToCall)?.[0];
        if (targetSocketId) {
            io.to(targetSocketId).emit('incomingCall', {
                from: currentUser,
                signal: data.signalData
            });
        }
    });

    socket.on('answerCall', (data) => {
        const targetSocketId = [...activeUsers.entries()].find(([id, name]) => name === data.to)?.[0];
        if (targetSocketId) {
            io.to(targetSocketId).emit('callAccepted', data.signal);
        }
    });

    socket.on('iceCandidate', (data) => {
        const targetSocketId = [...activeUsers.entries()].find(([id, name]) => name === data.to)?.[0];
        if (targetSocketId) {
            io.to(targetSocketId).emit('iceCandidate', {
                candidate: data.candidate,
                from: currentUser
            });
        }
    });

    socket.on('iceCandidate', (data) => {
        const targetSocketId = [...activeUsers.entries()].find(([id, name]) => name === data.to)?.[0];
        if (targetSocketId) {
            io.to(targetSocketId).emit('iceCandidate', {
                candidate: data.candidate,
                from: currentUser
            });
        }
    });

    socket.on('endCall', (data) => {
        const targetSocketId = [...activeUsers.entries()].find(([id, name]) => name === data.to)?.[0];
        if (targetSocketId) {
            io.to(targetSocketId).emit('callEnded');
        }
    });

    socket.on('disconnect', () => {
        activeUsers.delete(socket.id);
        io.emit('updateUserList', Array.from(new Set(activeUsers.values())));
    });
});

server.listen(PORT, () => {
    console.log(`Sunucu http://localhost:${PORT} adresinde çalışıyor`);
});
