const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const Datastore = require('nedb-promises');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');

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
        
        // Geçmiş mesajları yükle (Sadece ortak chat için şimdilik)
        messagesDB.find({ type: 'common' }).sort({ timestamp: 1 }).then(messages => {
            socket.emit('loadCommonMessages', messages);
        });
    });

    // Ortak Chat Mesajı
    socket.on('commonMessage', async (msg) => {
        if (!currentUser) return;
        let messageData = {
            from: currentUser,
            type: msg.type || 'text',
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
            timestamp: Date.now()
        };

        if (msg.type === 'image' || msg.type === 'audio') {
            messageData.content = msg.content;
            messageData.type = msg.type;
        } else {
            messageData.text = msg.text;
            messageData.type = 'text';
        }

        await messagesDB.insert(messageData);
        
        // Alıcıya ve gönderene gönder
        const recipientSocketId = [...activeUsers.entries()].find(([id, name]) => name === msg.to)?.[0];
        if (recipientSocketId) {
            io.to(recipientSocketId).emit('privateMessage', messageData);
        }
        socket.emit('privateMessage', messageData);
    });

    // Özel Mesaj Geçmişini Yükle
    socket.on('loadPrivateMessages', async (otherUser) => {
        if (!currentUser) return;
        const messages = await messagesDB.find({
            type: 'private',
            $or: [
                { from: currentUser, to: otherUser },
                { from: otherUser, to: currentUser }
            ]
        }).sort({ timestamp: 1 });
        socket.emit('loadPrivateMessages', { otherUser, messages });
    });

    socket.on('disconnect', () => {
        activeUsers.delete(socket.id);
        io.emit('updateUserList', Array.from(new Set(activeUsers.values())));
    });
});

server.listen(PORT, () => {
    console.log(`Sunucu http://localhost:${PORT} adresinde çalışıyor`);
});
