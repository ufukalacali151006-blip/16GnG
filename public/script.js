const socket = io();
let currentUser = null;
let selectedUser = null;
let mediaRecorder = null;
let audioChunks = [];
let unreadCounts = {}; // username -> count
let localStream;
let peerConnection;
let incomingSignal;
let currentCaller;

const iceServers = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// Auth Functions
function showRegister() {
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('register-form').style.display = 'block';
}

function showLogin() {
    document.getElementById('register-form').style.display = 'none';
    document.getElementById('login-form').style.display = 'block';
}

async function register() {
    const username = document.getElementById('reg-username').value;
    const password = document.getElementById('reg-password').value;
    
    const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    
    const data = await res.json();
    if (data.success) {
        alert('Kayıt başarılı! Giriş yapabilirsiniz.');
        showLogin();
    } else {
        alert(data.error);
    }
}

async function login() {
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    
    const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    
    const data = await res.json();
    if (data.success) {
        initApp(data.username);
    } else {
        alert(data.error);
    }
}

async function logout() {
    await fetch('/api/logout', { method: 'POST' });
    location.reload();
}

// App Logic
function initApp(username) {
    currentUser = username;
    document.getElementById('auth-container').style.display = 'none';
    document.getElementById('app-container').style.display = 'flex';
    document.getElementById('my-username').textContent = username;
    
    socket.emit('authenticate', username);
}

function toggleSidebar() {
    const sidebar = document.querySelector('.sidebar');
    sidebar.classList.toggle('hidden');
}

// Check session on load
fetch('/api/me').then(res => res.json()).then(data => {
    if (data.username) initApp(data.username);
});

// Socket Events
socket.on('updateUserList', (users) => {
    const list = document.getElementById('user-list');
    list.innerHTML = '';
    users.forEach(user => {
        if (user === currentUser) return;
        const li = document.createElement('li');
        li.textContent = user;
        if (selectedUser === user) li.classList.add('active');
        if (unreadCounts[user]) li.classList.add('has-unread');
        li.onclick = () => selectUser(user);
        list.appendChild(li);
    });
});

socket.on('commonMessage', (msg) => {
    appendMessage('common-messages', msg);
});

socket.on('loadCommonMessages', (messages) => {
    const container = document.getElementById('common-messages');
    container.innerHTML = '';
    messages.forEach(msg => appendMessage('common-messages', msg));
});

socket.on('privateMessage', (msg) => {
    if (selectedUser === msg.from || selectedUser === msg.to) {
        appendMessage('private-messages', msg);
        if (selectedUser === msg.from) {
            socket.emit('markAsSeen', msg.from);
        }
    } else {
        // Bildirim ver
        unreadCounts[msg.from] = (unreadCounts[msg.from] || 0) + 1;
        updateSidebar();
    }
});

socket.on('messagesSeen', (byUser) => {
    if (selectedUser === byUser) {
        document.querySelectorAll('.seen-tick').forEach(tick => {
            tick.classList.add('seen');
            tick.textContent = '✓✓';
        });
    }
});

function updateSidebar() {
    socket.emit('authenticate', currentUser); // Listeyi tetikle
}

socket.on('loadPrivateMessages', ({ otherUser, messages }) => {
    if (selectedUser === otherUser) {
        const container = document.getElementById('private-messages');
        container.innerHTML = '';
        messages.forEach(msg => appendMessage('private-messages', msg));
    }
});

// Helper Functions
function selectUser(user) {
    selectedUser = user;
    unreadCounts[user] = 0;
    document.getElementById('private-header').textContent = user;
    document.getElementById('private-input').disabled = false;
    document.getElementById('private-btn').disabled = false;
    document.getElementById('private-image-input').disabled = false;
    document.getElementById('private-record-btn').disabled = false;
    document.getElementById('private-search-btn').disabled = false;
    
    // UI Update
    document.querySelectorAll('#user-list li').forEach(li => {
        if (li.textContent === user) {
            li.classList.add('active');
            li.classList.remove('has-unread');
        } else {
            li.classList.remove('active');
        }
    });
    
    // Mobile: Hide sidebar when user selected
    if (window.innerWidth <= 768) {
        toggleSidebar();
    }
    
    socket.emit('markAsSeen', user);
    socket.emit('loadPrivateMessages', user);
    
    // Call controls
    document.getElementById('call-controls').style.display = 'block';
}

// WebRTC Functions
async function startCall() {
    if (!selectedUser) return;
    
    const overlay = document.getElementById('call-overlay');
    const status = document.getElementById('call-status');
    const name = document.getElementById('caller-name');
    const ringtone = document.getElementById('ringtone');
    
    overlay.style.display = 'flex';
    status.textContent = "Aranıyor...";
    name.textContent = selectedUser;
    document.getElementById('ongoing-call-actions').style.display = 'block';
    ringtone.play();

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        peerConnection = createPeerConnection(selectedUser);
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        socket.emit('callUser', {
            userToCall: selectedUser,
            signalData: offer
        });
    } catch (err) {
        console.error("Arama başlatılamadı:", err);
        endCall();
    }
}

function createPeerConnection(targetUser) {
    const pc = new RTCPeerConnection(iceServers);

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('iceCandidate', {
                to: targetUser,
                candidate: event.candidate
            });
        }
    };

    pc.ontrack = (event) => {
        const remoteAudio = document.getElementById('remote-audio');
        remoteAudio.srcObject = event.streams[0];
    };

    return pc;
}

socket.on('incomingCall', (data) => {
    currentCaller = data.from;
    incomingSignal = data.signal;

    const overlay = document.getElementById('call-overlay');
    const status = document.getElementById('call-status');
    const name = document.getElementById('caller-name');
    const actions = document.getElementById('incoming-call-actions');
    const ringtone = document.getElementById('ringtone');

    overlay.style.display = 'flex';
    status.textContent = "Gelen Arama...";
    name.textContent = currentCaller;
    actions.style.display = 'flex';
    ringtone.play();
});

async function acceptCall() {
    const ringtone = document.getElementById('ringtone');
    ringtone.pause();
    ringtone.currentTime = 0;

    document.getElementById('incoming-call-actions').style.display = 'none';
    document.getElementById('ongoing-call-actions').style.display = 'block';
    document.getElementById('call-status').textContent = "Görüşülüyor...";

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        peerConnection = createPeerConnection(currentCaller);
        localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

        await peerConnection.setRemoteDescription(new RTCSessionDescription(incomingSignal));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        socket.emit('answerCall', {
            signal: answer,
            to: currentCaller
        });
    } catch (err) {
        console.error("Arama kabul edilemedi:", err);
        endCall();
    }
}

function rejectCall() {
    socket.emit('endCall', { to: currentCaller });
    endCall();
}

socket.on('callAccepted', async (signal) => {
    const ringtone = document.getElementById('ringtone');
    ringtone.pause();
    ringtone.currentTime = 0;
    
    document.getElementById('call-status').textContent = "Görüşülüyor...";
    await peerConnection.setRemoteDescription(new RTCSessionDescription(signal));
});

socket.on('iceCandidate', async (data) => {
    if (peerConnection) {
        try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (e) {
            console.error("Error adding ice candidate", e);
        }
    }
});

socket.on('callEnded', () => {
    endCall();
});

function endCall() {
    const ringtone = document.getElementById('ringtone');
    ringtone.pause();
    ringtone.currentTime = 0;

    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
        localStream = null;
    }

    if (selectedUser || currentCaller) {
        socket.emit('endCall', { to: selectedUser || currentCaller });
    }

    document.getElementById('call-overlay').style.display = 'none';
    document.getElementById('incoming-call-actions').style.display = 'none';
    document.getElementById('ongoing-call-actions').style.display = 'none';
    
    currentCaller = null;
    incomingSignal = null;
}

// Search Logic
function openSearch() {
    document.getElementById('modal-overlay').style.display = 'block';
    document.getElementById('search-modal').style.display = 'block';
    document.getElementById('search-query').focus();
}

function closeSearch() {
    document.getElementById('modal-overlay').style.display = 'none';
    document.getElementById('search-modal').style.display = 'none';
    document.getElementById('search-results').innerHTML = '';
    document.getElementById('search-query').value = '';
}

async function performSearch() {
    const queryInput = document.getElementById('search-query');
    const query = queryInput.value;
    if (!query) return;

    const resultsDiv = document.getElementById('search-results');
    resultsDiv.innerHTML = '<p style="color: #fff;">Aranıyor...</p>';

    try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const results = await response.json();
        
        resultsDiv.innerHTML = '';
        results.forEach(res => {
            const item = document.createElement('div');
            item.className = 'search-item';
            item.innerHTML = `
                <h4>${res.title}</h4>
                <p>${res.snippet}</p>
            `;
            item.onclick = () => sendSearchResult(res);
            resultsDiv.appendChild(item);
        });
    } catch (e) {
        resultsDiv.innerHTML = '<p style="color: #ed4956;">Arama sırasında bir hata oluştu.</p>';
    }
}

// Voice Search Logic
function startVoiceSearch() {
    const recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
    const btn = document.getElementById('voice-search-btn');
    const input = document.getElementById('search-query');

    recognition.lang = 'tr-TR';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
        btn.classList.add('recording');
        input.placeholder = "Dinleniyor...";
    };

    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        input.value = transcript;
        input.placeholder = "Ne aramak istersiniz?";
        performSearch(); // Otomatik ara
    };

    recognition.onerror = (event) => {
        console.error('Speech recognition error', event.error);
        input.placeholder = "Hata oluştu, tekrar deneyin.";
    };

    recognition.onend = () => {
        btn.classList.remove('recording');
    };

    recognition.start();
}

function sendSearchResult(result) {
    const text = `${result.title}\n${result.snippet}\n${result.url}`;
    socket.emit('privateMessage', { to: selectedUser, text, type: 'text' });
    closeSearch();
}

function sendCommon() {
    const input = document.getElementById('common-input');
    const text = input.value.trim();
    if (text) {
        socket.emit('commonMessage', text);
        input.value = '';
    }
}

function sendPrivate() {
    const input = document.getElementById('private-input');
    const text = input.value.trim();
    if (text && selectedUser) {
        socket.emit('privateMessage', { to: selectedUser, text });
        input.value = '';
    }
}

function appendMessage(containerId, msg) {
    const container = document.getElementById(containerId);
    const div = document.createElement('div');
    const isSent = msg.from === currentUser;
    
    div.className = `message ${isSent ? 'sent' : 'received'}`;
    
    let contentHtml = '';
    if (containerId === 'common-messages' && !isSent) {
        contentHtml += `<span class="sender">${msg.from}</span>`;
    }

    if (msg.type === 'image') {
        contentHtml += `<img src="${msg.content}" alt="Görsel">`;
    } else if (msg.type === 'audio') {
        contentHtml += `<audio controls src="${msg.content}"></audio>`;
    } else {
        const text = msg.text || (typeof msg === 'string' ? msg : '');
        // Basit URL dönüştürücü
        const formattedText = text.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" style="color: #0095f6; text-decoration: none;">$1</a>').replace(/\n/g, '<br>');
        contentHtml += formattedText; 
    }

    if (containerId === 'private-messages' && isSent) {
        const tickClass = msg.seen ? 'seen-tick seen' : 'seen-tick';
        const tickText = msg.seen ? '✓✓' : '✓';
        contentHtml += `<span class="${tickClass}">${tickText}</span>`;
    }
    
    div.innerHTML = contentHtml;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

// Image and Audio Handling
async function handleImage(e, isPrivate = false) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
        const base64 = event.target.result;
        if (isPrivate) {
            socket.emit('privateMessage', { to: selectedUser, content: base64, type: 'image' });
        } else {
            socket.emit('commonMessage', { content: base64, type: 'image' });
        }
    };
    reader.readAsDataURL(file);
}

async function toggleRecord(isPrivate = false) {
    const btnId = isPrivate ? 'private-record-btn' : 'common-record-btn';
    const btn = document.getElementById(btnId);

    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        btn.classList.remove('recording');
        return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];

    mediaRecorder.ondataavailable = (e) => audioChunks.push(e.data);
    mediaRecorder.onstop = () => {
        const blob = new Blob(audioChunks, { type: 'audio/ogg; codecs=opus' });
        const reader = new FileReader();
        reader.onload = (event) => {
            const base64 = event.target.result;
            if (isPrivate) {
                socket.emit('privateMessage', { to: selectedUser, content: base64, type: 'audio' });
            } else {
                socket.emit('commonMessage', { content: base64, type: 'audio' });
            }
        };
        reader.readAsDataURL(blob);
        stream.getTracks().forEach(track => track.stop());
    };

    mediaRecorder.start();
    btn.classList.add('recording');
}

// Event Listeners for new inputs
document.getElementById('common-image-input').addEventListener('change', (e) => handleImage(e, false));
document.getElementById('private-image-input').addEventListener('change', (e) => handleImage(e, true));
document.getElementById('common-record-btn').addEventListener('click', () => toggleRecord(false));
document.getElementById('private-record-btn').addEventListener('click', () => toggleRecord(true));

// Enter key support
document.getElementById('common-input')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendCommon();
});
document.getElementById('private-input')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendPrivate();
});
