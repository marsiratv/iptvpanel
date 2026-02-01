const token = localStorage.getItem('token');
const isAdmin = localStorage.getItem('isAdmin') === 'true';

if (!token) {
    window.location.href = '/login.html';
}

document.addEventListener('DOMContentLoaded', init);

async function init() {
    await loadStats();
    await loadPlaylists();
    
    // Event listeners
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            e.target.classList.add('active');
            document.getElementById(e.target.dataset.tab).classList.add('active');
        });
    });
    
    document.getElementById('logout').addEventListener('click', () => {
        localStorage.clear();
        window.location.href = '/login.html';
    });
    
    // Forms
    document.getElementById('playlistForm')?.addEventListener('submit', addPlaylist);
}

async function apiCall(url, options = {}) {
    const res = await fetch(url, {
        ...options,
        headers: {
            ...options.headers,
            'Authorization': token,
            'Content-Type': 'application/json'
        }
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
}

async function loadStats() {
    const stats = await apiCall('/api/stats');
    document.getElementById('totalPlaylists').textContent = stats.total_playlists || 0;
    document.getElementById('totalCredits').textContent = stats.total_credits || 0;
}

async function loadPlaylists() {
    const playlists = await apiCall('/api/playlists');
    const tbody = document.getElementById('playlistTable');
    tbody.innerHTML = '';
    
    playlists.forEach(p => {
        const row = tbody.insertRow();
        row.innerHTML = `
            <td>${p.name}</td>
            <td>${p.url || p.m3u_file || 'No URL'}</td>
            <td><span class="status ${p.status}">${p.status}</span></td>
            <td>${p.credit_count}</td>
        `;
    });
}

async function addPlaylist(e) {
    e.preventDefault();
    const name = document.getElementById('playlistName').value;
    const url = document.getElementById('playlistUrl').value;
    const file = document.getElementById('m3uFile').files[0];
    
    const formData = new FormData();
    formData.append('name', name);
    if (url) formData.append('url', url);
    if (file) formData.append('m3u', file);
    
    try {
        await fetch('/api/playlists/upload', {
            method: 'POST',
            headers: { 'Authorization': token },
            body: formData
        });
        alert('Playlist added!');
        loadPlaylists();
        e.target.reset();
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

async function loadUserCredits() {
    const username = document.getElementById('creditUsername').value;
    if (!username) return alert('Masukkan username');
    
    try {
        const credits = await apiCall(`/api/user/${username}/credits`);
        const container = document.getElementById('userCredits');
        container.innerHTML = `
            <h3>Credits ${username}</h3>
            <div class="table-container">
                <table>
                    <thead><tr><th>Playlist</th><th>Expire</th><th>URL</th><th>Action</th></tr></thead>
                    <tbody>
                        ${credits.map(c => `
                            <tr>
                                <td>${c.name}</td>
                                <td>${new Date(c.expire_date).toLocaleDateString()}</td>
                                <td><a href="/api/user/${username}/playlist.m3u" download>Download M3U</a></td>
                                <td><button onclick="generateLink(${c.playlist_id}, '${username}')">Generate Link</button></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    } catch (err) {
        alert('User not found');
    }
}

function generateLink(playlistId, username) {
    const link = `http://localhost:3000/api/user/${username}/playlist.m3u`;
    navigator.clipboard.writeText(link);
    alert('Link copied to clipboard!');
}
