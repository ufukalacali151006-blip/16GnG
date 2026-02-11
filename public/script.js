const socket = io();
let currentUser = null;
let selectedUser = null;

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
    }
});

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
    document.getElementById('private-header').textContent = `Özel Mesajlar: ${user}`;
    document.getElementById('private-input').disabled = false;
    document.getElementById('private-btn').disabled = false;
    
    // UI Update
    document.querySelectorAll('#user-list li').forEach(li => {
        li.classList.toggle('active', li.textContent === user);
    });
    
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
    
    if (containerId === 'common-messages' && !isSent) {
        div.innerHTML = `<span class="sender">${msg.from}</span>${msg.text}`;
    } else {
        div.textContent = msg.text;
    }
    
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

// Enter key support
document.getElementById('common-input')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendCommon();
});
document.getElementById('private-input')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendPrivate();
});
