const socket = io();
let currentUser = null;
let selectedUser = null;
let mediaRecorder = null;
let audioChunks = [];
let unreadCounts = {}; // username -> count

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
    document.getElementById('private-header').textContent = `Özel Mesajlar: ${user}`;
    document.getElementById('private-input').disabled = false;
    document.getElementById('private-btn').disabled = false;
    document.getElementById('private-image-input').disabled = false;
    document.getElementById('private-record-btn').disabled = false;
    
    // UI Update
    document.querySelectorAll('#user-list li').forEach(li => {
        if (li.textContent === user) {
            li.classList.add('active');
            li.classList.remove('has-unread');
        } else {
            li.classList.remove('active');
        }
    });
    
    socket.emit('markAsSeen', user);
    socket.emit('loadPrivateMessages', user);
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
        contentHtml += msg.text || (typeof msg === 'string' ? msg : ''); 
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
