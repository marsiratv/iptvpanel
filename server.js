const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const multer = require('multer');
const path = require('path');
const bcrypt = require('bcrypt');
const cors = require('cors');
const fs = require('fs');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Database
const db = new sqlite3.Database('database.db');
initDB();

// Multer untuk upload M3U
const storage = multer.diskStorage({
    destination: 'uploads/',
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage });

// Init Database
function initDB() {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT,
            is_admin INTEGER DEFAULT 0
        )`);
        
        db.run(`CREATE TABLE IF NOT EXISTS playlists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT,
            url TEXT,
            m3u_file TEXT,
            status TEXT DEFAULT 'active',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
        
        db.run(`CREATE TABLE IF NOT EXISTS credits (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            playlist_id INTEGER,
            username TEXT,
            expire_date TEXT,
            status TEXT DEFAULT 'active',
            FOREIGN KEY (playlist_id) REFERENCES playlists (id)
        )`);

        // Admin default
        bcrypt.hash('admin123', 10, (err, hash) => {
            db.run(`INSERT OR IGNORE INTO users (username, password, is_admin) 
                   VALUES ('admin', ?, 1)`, hash);
        });
    });
}

// Auth middleware
function requireAuth(req, res, next) {
    const token = req.headers.authorization;
    if (!token) return res.status(401).json({error: 'No token'});
    
    db.get('SELECT * FROM users WHERE id = ?', [token], (err, user) => {
        if (err || !user) return res.status(401).json({error: 'Invalid token'});
        req.user = user;
        next();
    });
}

// Routes
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    
    db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
        if (!user || !bcrypt.compareSync(password, user.password)) {
            return res.status(401).json({error: 'Invalid credentials'});
        }
        
        res.json({ token: user.id.toString(), is_admin: !!user.is_admin });
    });
});

app.get('/api/playlists', requireAuth, (req, res) => {
    db.all(`
        SELECT p.*, COUNT(c.id) as credit_count 
        FROM playlists p 
        LEFT JOIN credits c ON p.id = c.playlist_id 
        GROUP BY p.id
    `, (err, rows) => {
        if (err) return res.status(500).json({error: err.message});
        res.json(rows);
    });
});

app.post('/api/playlists', requireAuth, (req, res) => {
    if (!req.user.is_admin) return res.status(403).json({error: 'Admin only'});
    
    const { name, url } = req.body;
    db.run(
        'INSERT INTO playlists (name, url) VALUES (?, ?)',
        [name, url],
        function(err) {
            if (err) return res.status(500).json({error: err.message});
            res.json({ id: this.lastID });
        }
    );
});

app.post('/api/playlists/upload', requireAuth, upload.single('m3u'), (req, res) => {
    if (!req.user.is_admin) return res.status(403).json({error: 'Admin only'});
    
    const name = req.body.name;
    const m3uFile = req.file.filename;
    
    db.run(
        'INSERT INTO playlists (name, m3u_file) VALUES (?, ?)',
        [name, m3uFile],
        function(err) {
            if (err) return res.status(500).json({error: err.message});
            res.json({ id: this.lastID });
        }
    );
});

app.post('/api/credits', requireAuth, (req, res) => {
    if (!req.user.is_admin) return res.status(403).json({error: 'Admin only'});
    
    const { playlist_id, username, expire_days } = req.body;
    const expire_date = new Date(Date.now() + expire_days * 24 * 60 * 60 * 1000).toISOString();
    
    db.run(
        'INSERT INTO credits (playlist_id, username, expire_date) VALUES (?, ?, ?)',
        [playlist_id, username, expire_date],
        function(err) {
            if (err) return res.status(500).json({error: err.message});
            res.json({ id: this.lastID });
        }
    );
});

app.get('/api/user/:username/credits', requireAuth, (req, res) => {
    const { username } = req.params;
    
    db.all(`
        SELECT c.*, p.name, p.url, p.m3u_file 
        FROM credits c 
        JOIN playlists p ON c.playlist_id = p.id 
        WHERE c.username = ? AND c.status = 'active' AND c.expire_date > datetime('now')
    `, [username], (err, rows) => {
        res.json(rows);
    });
});

app.get('/api/stats', requireAuth, (req, res) => {
    db.get(`
        SELECT 
            (SELECT COUNT(*) FROM playlists) as total_playlists,
            (SELECT COUNT(*) FROM credits WHERE status = 'active') as total_credits,
            (SELECT COUNT(*) FROM users) as total_users
    `, (err, stats) => {
        res.json(stats || {});
    });
});

// Generate M3U untuk user
app.get('/api/user/:username/playlist.m3u', (req, res) => {
    const { username } = req.params;
    
    db.all(`
        SELECT p.url, p.m3u_file, p.name 
        FROM credits c 
        JOIN playlists p ON c.playlist_id = p.id 
        WHERE c.username = ? AND c.status = 'active' AND c.expire_date > datetime('now')
    `, [username], (err, playlists) => {
        if (err || !playlists.length) {
            return res.status(404).send('No active playlists');
        }
        
        let m3uContent = '#EXTM3U\n';
        playlists.forEach(p => {
            if (p.m3u_file) {
                const fullPath = path.join(__dirname, 'uploads', p.m3u_file);
                if (fs.existsSync(fullPath)) {
                    const content = fs.readFileSync(fullPath, 'utf8');
                    m3uContent += content + '\n';
                }
            } else {
                m3uContent += `#EXTINF:-1,${p.name}\n${p.url}\n`;
            }
        });
        
        res.set('Content-Type', 'application/vnd.apple.mpegurl');
        res.send(m3uContent);
    });
});

app.listen(PORT, () => {
    console.log(`🚀 IPTV Panel running at http://localhost:${PORT}`);
});
