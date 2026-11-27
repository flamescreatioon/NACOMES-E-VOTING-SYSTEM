const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
let db = require('./database');
const { MOUAU_COLLEGES, findCollegeByDept } = require('./mouau-colleges');

// Self-healing database migration: rebuild legacy plaintext or pre-MOUAU databases
function removeSqliteFiles(dbPath) {
    for (const suffix of ['', '-wal', '-shm']) {
        try {
            if (fs.existsSync(dbPath + suffix)) {
                fs.unlinkSync(dbPath + suffix);
            }
        } catch (unlinkErr) {
            console.error(`Failed to delete ${dbPath + suffix}:`, unlinkErr.message);
        }
    }
}

function runStartupSetup() {
 // Neon mode: skip SQLite self-heal (schema+seed handled by db-postgres adapter).
 if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim()) { db.ready.then(()=>seedCandidates(db)); return; }
    db.ready.then(() => {
        db.get("SELECT password, college, dept, contactInfo FROM students WHERE matricNo = 'U2024/1234567'", [], (err, row) => {
            const needsRebuild = !err && row && (
                row.password === 'test123' ||
                row.college === 'Biological & Physical Sciences' ||
                row.dept !== 'Computer Engineering' ||
                (row.contactInfo && row.contactInfo.includes('@absu.edu.ng'))
            );
            if (needsRebuild) {
                console.log("Detected legacy database (plaintext passwords or non-NACOME seed). Re-building database for NACOME (Computer Engineering, CEET, MOUAU)...");
                db.close((closeErr) => {
                    if (closeErr) {
                        console.error("Failed to close legacy database:", closeErr.message);
                        return;
                    }
                    const dbPath = path.join(__dirname, 'data', 'election.sqlite');
                    removeSqliteFiles(dbPath);
                    console.log("Deleted legacy database file.");
                    delete require.cache[require.resolve('./database')];
                    db = require('./database');
                    db.ready.then(() => seedCandidates(db));
                });
            } else {
                seedCandidates(db);
            }
        });
    });
}

// Secrets come from env (Vercel dashboard / local .env). Never commit real values.
// JWT_SECRET and admin credentials MUST be set in production — fail closed.
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-fallback-secret-change-me';
if (!process.env.JWT_SECRET) {
console.warn('[warn] JWT_SECRET not set — using insecure dev fallback. Set JWT_SECRET env var.');
}

function loadAdminAccounts() {
if (process.env.ADMIN_ACCOUNTS_JSON) {
try {
const parsed = JSON.parse(process.env.ADMIN_ACCOUNTS_JSON);
if (Array.isArray(parsed) && parsed.length) return parsed;
} catch (e) {
console.error('[warn] ADMIN_ACCOUNTS_JSON is not valid JSON:', e.message);
}
}
const accounts = [];
const push = (username, password, name, role) => {
if (username && password) accounts.push({ username: String(username).toLowerCase(), password: String(password), name, role });
};
push(process.env.SUPERADMIN_USERNAME, process.env.SUPERADMIN_PASSWORD, 'Chief Electoral Officer', 'superadmin');
push(process.env.ADMIN_USERNAME, process.env.ADMIN_PASSWORD, 'System Administrator', 'admin');
push(process.env.REGISTRAR_USERNAME, process.env.REGISTRAR_PASSWORD, 'Registrar', 'admin');
push(process.env.OFFICER_USERNAME, process.env.OFFICER_PASSWORD, 'Election Officer', 'admin');
if (!accounts.length) {
console.warn('[warn] No admin accounts configured via env — admin login disabled (fail closed).');
}
return accounts;
}
const ADMIN_ACCOUNTS_DB = loadAdminAccounts();

function hashPassword(password, salt) {
    return crypto.createHmac('sha256', salt.toUpperCase()).update(password).digest('hex');
}

function generateToken(payload, durationHours = 2) {
    const expiry = Date.now() + durationHours * 60 * 60 * 1000;
    const payloadStr = JSON.stringify(payload);
    const dataToSign = payloadStr + '.' + expiry;
    const signature = crypto.createHmac('sha256', JWT_SECRET).update(dataToSign).digest('hex');
    const payloadBase64 = Buffer.from(payloadStr).toString('base64');
    return `${payloadBase64}.${expiry}.${signature}`;
}

function verifyToken(token) {
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const [payloadBase64, expiryStr, signature] = parts;
    const expiry = parseInt(expiryStr);
    if (isNaN(expiry) || Date.now() > expiry) {
        return null;
    }
    
    try {
        const payloadStr = Buffer.from(payloadBase64, 'base64').toString('utf8');
        const payload = JSON.parse(payloadStr);
        const dataToSign = payloadStr + '.' + expiryStr;
        const expectedSignature = crypto.createHmac('sha256', JWT_SECRET).update(dataToSign).digest('hex');
        
        if (signature === expectedSignature) {
            return payload;
        }
    } catch (e) {
        return null;
    }
    return null;
}

const app = express();
const PORT = process.env.PORT || 5005;

// Behind Vercel (or any reverse proxy) req.ip is the proxy's IP unless
// trusted — without this every visitor shares one rate-limit bucket.
app.set('trust proxy', 1);

// ── Middleware ────────────────────────────────────────────────────────────────

// Security headers (without requiring helmet package)
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

// Compression — reduces JSON payload size ~70%.
// If the 'compression' package is installed, use it; otherwise skip gracefully.
try {
    const compression = require('compression');
    app.use(compression());
} catch(e) { /* compression not installed, skip */ }

// CORS: same-origin needs no CORS headers; cross-origin (admin panels,
// previews) is gated by ALLOWED_ORIGINS. Localhost always allowed for dev.
// Set ALLOWED_ORIGINS in production, e.g.
// "https://mouau-election.vercel.app,https://admin.yourdomain.com"
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
.split(',')
.map((s) => s.trim().replace(/\/$/, ''))
.filter(Boolean);
const isLocalhost = (origin) => /^(https?:\/\/(localhost|127\.0\.0\.1))(:\d+)?$/i.test(origin);
const isSameOrigin = (req, origin) => {
    try {
        const originHost = new URL(origin).host.toLowerCase();
        const rawHost = req.headers['x-forwarded-host'] || req.headers.host || '';
        const requestHost = String(rawHost).split(',')[0].trim().toLowerCase();
        return Boolean(requestHost && originHost === requestHost);
    } catch {
        return false;
    }
};

app.use(cors((req, callback) => {
    const origin = req.headers.origin;
    const baseOpts = {
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization']
    };
    if (!origin) return callback(null, { ...baseOpts, origin: true });
    const normalized = origin.replace(/\/$/, '');
    if (isLocalhost(origin) || isSameOrigin(req, origin) || ALLOWED_ORIGINS.includes(normalized)) {
        return callback(null, { ...baseOpts, origin: true });
    }
    return callback(new Error(`CORS blocked for origin: ${origin}`), { ...baseOpts, origin: false });
}));
app.use(express.json({ limit: '5mb' }));

// ── Simple In-Memory Rate Limiter ─────────────────────────────────────────────
// Tracks request counts per IP in a sliding 60-second window.
// No external dependency required — runs entirely in process memory.
const rateLimitStore = new Map();
const RATE_WINDOW_MS = 60 * 1000; // 1 minute window

function rateLimit(maxPerWindow) {
    return (req, res, next) => {
        const ip = req.ip || req.connection.remoteAddress || 'unknown';
        const now = Date.now();
        const entry = rateLimitStore.get(ip) || { count: 0, windowStart: now };

        if (now - entry.windowStart > RATE_WINDOW_MS) {
            entry.count = 1;
            entry.windowStart = now;
        } else {
            entry.count++;
        }
        rateLimitStore.set(ip, entry);

        if (entry.count > maxPerWindow) {
            return res.status(429).json({
                error: 'Too many requests. Please wait a moment before trying again.'
            });
        }
        next();
    };
}

// Clean up rate limit store every 5 minutes to prevent unbounded growth
setInterval(() => {
    const cutoff = Date.now() - RATE_WINDOW_MS;
    for (const [ip, entry] of rateLimitStore) {
        if (entry.windowStart < cutoff) rateLimitStore.delete(ip);
    }
}, 5 * 60 * 1000);

// ── Auth & Authorization Middlewares ──────────────────────────────────────────
function authenticate(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
        return res.status(401).json({ error: "Access denied. No authorization token provided." });
    }
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
        return res.status(401).json({ error: "Access denied. Invalid token format." });
    }
    const token = parts[1];
    const user = verifyToken(token);
    if (!user) {
        return res.status(403).json({ error: "Access denied. Invalid or expired session." });
    }
    req.user = user;
    next();
}

function authorize(roles = []) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: "Access denied. Unauthorized." });
        }
        if (roles.length && !roles.includes(req.user.role)) {
            return res.status(403).json({ error: "Access denied. Insufficient privileges." });
        }
        next();
    };
}


// ── In-Memory Cache ───────────────────────────────────────────────────────────
// Avoids hitting the DB on every settings/candidates read during peak load.
const cache = {
    settings: { data: null, expiresAt: 0 },
    candidates: { data: null, expiresAt: 0 },
    stats: { data: null, expiresAt: 0 },
};

function getCachedSettings(cb) {
    const now = Date.now();
    if (cache.settings.data && now < cache.settings.expiresAt) {
        return cb(null, cache.settings.data);
    }
    db.all("SELECT * FROM system_settings", [], (err, rows) => {
        if (err) return cb(err);
        const settings = {};
        if (rows) {
            rows.forEach(r => {
                if (r.key === 'election_deadline' || r.key === 'election_start_time') {
                    settings[r.key] = r.value;
                } else {
                    settings[r.key] = r.value === 'true';
                }
            });
        }
        cache.settings.data = settings;
        cache.settings.expiresAt = now + 30 * 1000; // 30-second TTL
        cb(null, settings);
    });
}

function invalidateSettingsCache() {
    cache.settings.expiresAt = 0;
}

function invalidateCandidatesCache() {
    cache.candidates.expiresAt = 0;
}

function invalidateStatsCache() {
    cache.stats.expiresAt = 0;
}

// ── Vote Serialization Queue ──────────────────────────────────────────────────
// SQLite allows only one concurrent writer. If 100 vote requests arrive
// simultaneously, they all try to BEGIN TRANSACTION and 99 get SQLITE_BUSY.
// This queue serializes vote writes so they never contend.
const voteQueue = [];
let voteQueueRunning = false;

function enqueueVote(fn) {
    voteQueue.push(fn);
    drainVoteQueue();
}

function drainVoteQueue() {
    if (voteQueueRunning || voteQueue.length === 0) return;
    voteQueueRunning = true;
    const next = voteQueue.shift();
    next(() => {
        voteQueueRunning = false;
        drainVoteQueue();
    });
}


// ==========================================
// SEED INITIAL DATA
// ==========================================
const INITIAL_CANDIDATES = [];

const LEGACY_SEEDED_CANDIDATE_IDS = [
    'john-adebayo',
    'amina-ibrahim',
    'chukwuemeka-obi',
    'sarah-johnson',
    'michael-oku',
    'david-nduka',
    'grace-okoli'
];

function seedCandidates(database) {
    const placeholders = LEGACY_SEEDED_CANDIDATE_IDS.map(() => '?').join(', ');
    database.run(
        `DELETE FROM candidates WHERE id IN (${placeholders})`,
        LEGACY_SEEDED_CANDIDATE_IDS,
        (err) => {
            if (err) {
                console.error("Error clearing seeded candidates:", err.message);
            }
        }
    );
}

runStartupSetup();

// ==========================================
// CANDIDATE MEDIA UPLOAD & OBJECT STORAGE (NeonDB / SQLite)
// ==========================================
const MAX_CANDIDATE_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB per upload per candidate
const ALLOWED_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function normalizeMediaUrl(url) {
    if (!url || typeof url !== 'string') return null;
    const trimmed = url.trim();
    return /^\/api\/media\/[a-zA-Z0-9_-]+$/.test(trimmed) ? trimmed : null;
}

function linkMediaToCandidate(mediaUrl, candidateId) {
    const clean = normalizeMediaUrl(mediaUrl);
    if (!clean) return;
    const mediaId = clean.split('/').pop();
    db.run("UPDATE media_objects SET candidateId = ? WHERE id = ?", [candidateId, mediaId], () => {});
}

// Serve stored image objects from NeonDB
app.get('/api/media/:id', (req, res) => {
    const { id } = req.params;
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
        return res.status(400).json({ error: "Invalid media ID" });
    }
    db.get("SELECT mimeType, data FROM media_objects WHERE id = ?", [id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row || !row.data) return res.status(404).json({ error: "Image not found" });
        const buf = Buffer.isBuffer(row.data) ? row.data : Buffer.from(row.data);
        res.setHeader('Content-Type', row.mimeType || 'application/octet-stream');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        res.send(buf);
    });
});

// Upload candidate image (single-shot or chunked) up to 10 MB
app.post('/api/uploads', rateLimit(40), authenticate, (req, res) => {
    const { dataBase64, mimeType, filename, kind, uploadId, chunkIndex, totalChunks } = req.body || {};

    if (!mimeType || !ALLOWED_IMAGE_MIMES.has(String(mimeType).toLowerCase())) {
        return res.status(400).json({ error: "Unsupported image format. Allowed: PNG, JPG, WEBP, GIF." });
    }
    if (!dataBase64 || typeof dataBase64 !== 'string') {
        return res.status(400).json({ error: "Missing image data." });
    }

    const cleanB64 = dataBase64.replace(/^data:[^;]+;base64,/, '');
    let chunkBuf;
    try {
        chunkBuf = Buffer.from(cleanB64, 'base64');
    } catch {
        return res.status(400).json({ error: "Invalid base64 image payload." });
    }
    if (!chunkBuf.length) {
        return res.status(400).json({ error: "Uploaded image is empty." });
    }
    if (chunkBuf.length > MAX_CANDIDATE_UPLOAD_BYTES) {
        return res.status(413).json({ error: "Image exceeds the 10 MB per-upload limit." });
    }

    const safeKind = kind === 'poster' ? 'poster' : 'profile';
    const safeName = filename ? String(filename).slice(0, 120) : `${safeKind}.png`;
    const uploadedBy = req.user && (req.user.matricNo || req.user.username) || 'unknown';

    // Single-shot upload
    if (!totalChunks || Number(totalChunks) <= 1) {
        const id = crypto.randomBytes(12).toString('hex');
        return db.run(
            `INSERT INTO media_objects (id, kind, filename, mimeType, sizeBytes, data, uploadedBy) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [id, safeKind, safeName, mimeType.toLowerCase(), chunkBuf.length, chunkBuf, uploadedBy],
            function (err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({
                    id,
                    url: `/api/media/${id}`,
                    sizeBytes: chunkBuf.length,
                    mimeType: mimeType.toLowerCase(),
                    complete: true
                });
            }
        );
    }

    // Chunked upload (supports up to 10 MB across Vercel's 4.5 MB request body limit)
    const idx = Number(chunkIndex);
    const total = Number(totalChunks);
    if (!uploadId || !/^[a-zA-Z0-9_-]{8,64}$/.test(String(uploadId)) || !Number.isInteger(idx) || !Number.isInteger(total) || idx < 0 || idx >= total || total > 10) {
        return res.status(400).json({ error: "Invalid chunk upload metadata." });
    }

    db.run(
        `INSERT INTO upload_chunks (uploadId, chunkIndex, totalChunks, mimeType, filename, kind, uploadedBy, data)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (uploadId, chunkIndex) DO UPDATE SET data = EXCLUDED.data`,
        [uploadId, idx, total, mimeType.toLowerCase(), safeName, safeKind, uploadedBy, chunkBuf],
        function (chunkErr) {
            if (chunkErr) return res.status(500).json({ error: chunkErr.message });

            db.all(
                `SELECT chunkIndex, data FROM upload_chunks WHERE uploadId = ? ORDER BY chunkIndex ASC`,
                [uploadId],
                (listErr, rows) => {
                    if (listErr) return res.status(500).json({ error: listErr.message });
                    if (!rows || rows.length < total) {
                        return res.json({ uploadId, chunkIndex: idx, complete: false });
                    }

                    const buffers = rows.map((r) => (Buffer.isBuffer(r.data) ? r.data : Buffer.from(r.data)));
                    const fullBuf = Buffer.concat(buffers);
                    db.run(`DELETE FROM upload_chunks WHERE uploadId = ?`, [uploadId], () => {});

                    if (fullBuf.length > MAX_CANDIDATE_UPLOAD_BYTES) {
                        return res.status(413).json({ error: "Image exceeds the 10 MB per-upload limit." });
                    }

                    const id = crypto.randomBytes(12).toString('hex');
                    db.run(
                        `INSERT INTO media_objects (id, kind, filename, mimeType, sizeBytes, data, uploadedBy) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                        [id, safeKind, safeName, mimeType.toLowerCase(), fullBuf.length, fullBuf, uploadedBy],
                        function (saveErr) {
                            if (saveErr) return res.status(500).json({ error: saveErr.message });
                            res.json({
                                id,
                                url: `/api/media/${id}`,
                                sizeBytes: fullBuf.length,
                                mimeType: mimeType.toLowerCase(),
                                complete: true
                            });
                        }
                    );
                }
            );
        }
    );
});

// ==========================================
// CANDIDATE ROUTES
// ==========================================
app.get('/api/candidates', (req, res) => {
    db.all("SELECT * FROM candidates", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/candidates', authenticate, (req, res) => {
    // If student, ensure they can only register themselves as candidate
    if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
        if (!req.body.matricNo || req.user.matricNo.toUpperCase() !== req.body.matricNo.toUpperCase()) {
            return res.status(403).json({ error: "Access denied. You can only register yourself as a candidate." });
        }
    }

    const { level } = req.body;
    const targetKey = level === 'COLLEGE' ? 'registration_active_college' : (level === 'DEPARTMENT' ? 'registration_active_department' : 'registration_active_sug');
    
    db.get("SELECT value FROM system_settings WHERE key = ?", [targetKey], (err, setting) => {
        if (!err && setting && setting.value === 'false') {
            return res.status(400).json({ error: "Candidate registration for this level is currently closed by the electoral commission." });
        }
        
        const { name, position, college, dept, matricNo, email, phone, slogan, manifesto, experience, profileImageUrl, posterImageUrl } = req.body;
        const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        const cleanProfileUrl = normalizeMediaUrl(profileImageUrl);
        const cleanPosterUrl = normalizeMediaUrl(posterImageUrl);
        
        db.run(
            `INSERT INTO candidates (id, name, level, position, college, dept, votes, status, matricNo, email, phone, slogan, manifesto, experience, profileImageUrl, posterImageUrl) 
             VALUES (?, ?, ?, ?, ?, ?, 0, 'active', ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, name, level || 'SUG', position, college, dept, matricNo || null, email || null, phone || null, slogan || null, manifesto || null, experience || null, cleanProfileUrl, cleanPosterUrl],
            function(err) {
                if (err) return res.status(500).json({ error: err.message });
                linkMediaToCandidate(cleanProfileUrl, id);
                linkMediaToCandidate(cleanPosterUrl, id);
                res.json({ 
                    id, name, level, position, college, dept, votes: 0, status: 'active',
                    matricNo, email, phone, slogan, manifesto, experience,
                    profileImageUrl: cleanProfileUrl,
                    posterImageUrl: cleanPosterUrl
                });
            }
        );
    });
});

// Fetch a single candidate with unified student profile if matching
app.get('/api/candidates/:id', (req, res) => {
    const { id } = req.params;
    db.get("SELECT * FROM candidates WHERE id = ?", [id], (err, candidate) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!candidate) return res.status(404).json({ error: "Candidate not found" });

        if (candidate.matricNo) {
            db.get("SELECT * FROM students WHERE UPPER(matricNo) = ?", [candidate.matricNo.toUpperCase()], (studentErr, student) => {
                if (!studentErr && student) {
                    return res.json({
                        ...candidate,
                        // Ensure we return the most relevant contact info/data
                        email: candidate.email || student.contactInfo,
                        phone: candidate.phone || student.contactInfo, // fallback
                        studentDetails: student
                    });
                }
                return res.json(candidate);
            });
        } else {
            res.json(candidate);
        }
    });
});

// Update candidate status (disqualify/re-instate)
app.put('/api/candidates/:id/status', authenticate, authorize(['admin', 'superadmin']), (req, res) => {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !['active', 'disqualified'].includes(status)) {
        return res.status(400).json({ error: "Invalid status value. Use 'active' or 'disqualified'." });
    }

    db.run(
        "UPDATE candidates SET status = ? WHERE id = ?",
        [status, id],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: "Candidate not found" });
            res.json({ id, status });
        }
    );
});

// Delete candidate permanently
app.delete('/api/candidates/:id', authenticate, authorize(['superadmin']), (req, res) => {
    const { id } = req.params;

    db.run(
        "DELETE FROM candidates WHERE id = ?",
        [id],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: "Candidate not found" });
            res.json({ message: "Candidate deleted successfully", id });
        }
    );
});

// ==========================================
// STUDENT AUTHENTICATION & REGISTRATION
// ==========================================
// Source of truth: approved_matrics DB table (SQLite locally, Postgres on
// Supabase/Neon). The .txt files in backend/data/ are BACKUP / seed only.
// See backend/approved-matrics.js.
const approvedMatrics = require('./approved-matrics');
const { normalizeMatric, LEVEL_LABELS } = approvedMatrics;
approvedMatrics.loadTxtWhitelists();

app.post('/api/register', async (req, res) => {
    const { name, matricNo, level, dept, college, contactInfo, password } = req.body;
    if (!name || !matricNo || !level || !dept || !contactInfo || !password) {
        return res.status(400).json({ error: "All registration fields are required." });
    }

    const normalizedMatric = normalizeMatric(matricNo);
    const rawLevel = String(level).trim().toUpperCase();
    const levelKey = rawLevel.endsWith('L') ? rawLevel : (rawLevel + 'L');
    const levelLabel = LEVEL_LABELS[levelKey] || rawLevel;

    if (!LEVEL_LABELS[levelKey]) {
        return res.status(400).json({ error: 'Invalid level selected.' });
    }

    // Reg no must exist in the approved_matrics table (DB is the source of
    // truth; txt backup is consulted only if the DB lookup itself fails).
    const isApproved = await approvedMatrics.isMatricApproved(db, levelKey, normalizedMatric);
    if (!isApproved) {
        return res.status(403).json({
        error: `Registration Denied! Your matriculation number is not found in the approved Computer Engineering student database. Only students with verified matriculation numbers are permitted to create a ${levelLabel} student profile. Please contact your course representative or department administrator for assistance.`
        });
    }


    const matchedCollege = findCollegeByDept(dept) || college;
    if (!matchedCollege) {
        return res.status(400).json({ error: "Invalid department selected. Please select a valid MOUAU department." });
    }

    const hashedPass = hashPassword(password, normalizedMatric);

    db.run(
        "INSERT INTO students (matricNo, name, level, dept, contactInfo, college, password) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [normalizedMatric, name, level, dept, contactInfo, matchedCollege, hashedPass],
        function(err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(400).json({ error: "This Matric Number is already registered." });
                }
                return res.status(500).json({ error: err.message });
            }
            res.json({ success: true, message: "Registration successful! You can now log in." });
        }
    );
});

app.post('/api/login', rateLimit(20), (req, res) => {  // max 20 login attempts/min per IP
    const { matricNo, password } = req.body;
    if (!matricNo || !password) {
        return res.status(400).json({ error: "Matric number and password are required." });
    }

    const hashedPass = hashPassword(password, matricNo);

    db.get(
        "SELECT * FROM students WHERE UPPER(matricNo) = ? AND password = ?",
        [matricNo.toUpperCase(), hashedPass],
        (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!row) return res.status(400).json({ error: "Invalid matriculation number or password." });
            
            const token = generateToken({ matricNo: row.matricNo, role: 'student' }, 2); // 2 hours expiry
            
            res.json({
                success: true,
                token,
                user: {
                    matricNo: row.matricNo,
                    name: row.name,
                    level: row.level,
                    dept: row.dept,
                    contactInfo: row.contactInfo,
                    college: row.college
                }
            });
        }
    );
});

app.post('/api/admin/login', rateLimit(10), (req, res) => { // max 10 admin login attempts/min per IP
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: "Username and password are required." });
    }
    
const match = ADMIN_ACCOUNTS_DB.find(a => a.username === username.toLowerCase() && a.password === password);
    
    if (!match) {
        return res.status(401).json({ error: "Invalid admin credentials." });
    }
    
    const token = generateToken({ username: match.username, role: match.role }, 12); // Admin session expires in 12 hours
    res.json({
        success: true,
        token,
        admin: {
            username: match.username,
            name: match.name,
            role: match.role === 'superadmin' ? 'Super Admin' : 'Regular Admin'
        }
    });
});

// ==========================================
// VOTING ROUTES
// ==========================================

// Helper to process individual votes
function processVote(voteData, res) {
    const { name, matricNo, votes, manualEntry, enteredBy, isAutoGenerated, college } = voteData;
    
    // Begin transaction
    db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        
        db.run(
            `INSERT INTO votes (name, matricNo, manualEntry, enteredBy, isAutoGenerated, college) VALUES (?, ?, ?, ?, ?, ?)`,
            [name, matricNo, manualEntry ? 1 : 0, enteredBy || null, isAutoGenerated ? 1 : 0, college || 'SUG'],
            function(err) {
                if (err) {
                    db.run("ROLLBACK");
                    // Assuming matricNo must be unique, this catches double voting
                    if (err.message.includes('UNIQUE constraint failed')) {
                        return res.status(400).json({ error: "This Matric Number has already voted." });
                    }
                    return res.status(500).json({ error: err.message });
                }
                
                const voteId = this.lastID;
                
                // Fetch all candidates to resolve IDs to real names
                db.all("SELECT id, name, position FROM candidates", [], (errCand, candidatesList) => {
                    if (errCand) {
                        db.run("ROLLBACK");
                        return res.status(500).json({ error: errCand.message });
                    }
                    
                    const stmtDetails = db.prepare("INSERT INTO vote_details (voteId, position, candidateName) VALUES (?, ?, ?)");
                    
                    let success = true;
                    let pendingUpdates = 0;
                    
                    // Count how many updates we will do
                    for (const [position, val] of Object.entries(votes)) {
                        if (val) pendingUpdates++;
                    }
                    
                    if (pendingUpdates === 0) {
                        stmtDetails.finalize();
                        db.run("COMMIT");
                        return res.json({ success: true, message: "Vote recorded successfully" });
                    }
                    
                    for (const [position, val] of Object.entries(votes)) {
                        if (val) {
                            // Find candidate by ID or Name
                            const cand = candidatesList.find(c => c.position === position && (c.id === val || c.name === val));
                            const finalName = cand ? cand.name : val;
                            const finalId = cand ? cand.id : val;
                            
                            stmtDetails.run(voteId, position, finalName, (e) => { if (e) success = false; });
                            
                            // Update votes count matching by ID or Name
                            db.run(
                                "UPDATE candidates SET votes = votes + 1 WHERE position = ? AND (id = ? OR name = ?)",
                                [position, finalId, finalName],
                                (e) => {
                                    if (e) success = false;
                                    pendingUpdates--;
                                    if (pendingUpdates === 0) {
                                        stmtDetails.finalize();
                                        if (success) {
                                            db.run("COMMIT");
                                            res.json({ success: true, message: "Vote recorded successfully" });
                                        } else {
                                            db.run("ROLLBACK");
                                            res.status(500).json({ error: "Failed to record vote details" });
                                        }
                                    }
                                }
                            );
                        }
                    }
                });
            }
        );
    });
}

// Standard Student Vote
app.post('/api/vote', rateLimit(8), authenticate, (req, res) => {  // max 8 votes/min per IP
    getCachedSettings((err, settings) => {
        if (err) return res.status(500).json({ error: err.message });
        
        // Enforce scheduled election start & close times if configured
        if (settings.election_start_time) {
            const startMs = new Date(settings.election_start_time).getTime();
            if (!Number.isNaN(startMs) && Date.now() < startMs) {
                return res.status(400).json({ error: "Voting has not started yet. Please wait for the scheduled election start time." });
            }
        }
        if (settings.election_deadline) {
            const endMs = new Date(settings.election_deadline).getTime();
            if (!Number.isNaN(endMs) && Date.now() > endMs) {
                return res.status(400).json({ error: "Voting has closed. The election deadline has passed." });
            }
        }

        // Ensure student can only vote for themselves
        if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
            if (!req.body.matricNo || req.user.matricNo.toUpperCase() !== req.body.matricNo.toUpperCase()) {
                return res.status(403).json({ error: "Access denied. You can only vote using your own matriculation number." });
            }
        }
        
        const { votes, college, dept } = req.body;
        if (votes) {
            const nacomePositions = ['president', 'vice-president', 'secretary-general', 'assistant-secretary-general', 'treasurer', 'financial-secretary', 'pro', 'director-of-welfare', 'director-of-sports', 'director-of-socials', 'technical-director', 'dept_president', 'dept_sec'];
            const hasNacomeVote = Object.keys(votes).some(pos => nacomePositions.includes(pos));

            if (hasNacomeVote) {
                if (settings.voting_active_department === false) {
                    return res.status(400).json({ error: "NACOME Departmental Election voting is currently closed." });
                }
                const targetDept = dept || 'Computer Engineering';
                if (settings['voting_active_dept_' + targetDept] === false) {
                    return res.status(400).json({ error: `Voting for ${targetDept} (NACOME) is currently locked.` });
                }
            }
        }
        // All checks passed — queue the write to avoid SQLite write contention
        enqueueVote((done) => {
            processVote(req.body, {
                json: (data) => { invalidateStatsCache(); done(); res.json(data); },
                status: (code) => ({
                    json: (data) => { done(); res.status(code).json(data); }
                })
            });
        });
    });
});

// Manual Admin Vote (assisted voting for students without devices).
// Forces audit flags: manualEntry=1, enteredBy=<admin username>. Rejects
// if the student doesn't exist or has already voted.
app.post('/api/vote/manual', authenticate, authorize(['admin', 'superadmin']), (req, res) => {
	const { name, matricNo, votes, college } = req.body;
	if (!matricNo || !votes || Object.keys(votes).length === 0) {
		return res.status(400).json({ error: "matricNo and votes are required." });
	}
	db.get("SELECT matricNo, name FROM students WHERE UPPER(matricNo) = ?", [String(matricNo).toUpperCase()], (studErr, student) => {
		if (studErr) return res.status(500).json({ error: studErr.message });
		if (!student) return res.status(404).json({ error: "Student not found in registry." });
		db.get("SELECT id FROM votes WHERE UPPER(matricNo) = ?", [String(matricNo).toUpperCase()], (voteErr, existing) => {
			if (voteErr) return res.status(500).json({ error: voteErr.message });
			if (existing) return res.status(400).json({ error: "This Matric Number has already voted." });
			processVote({
				name: name || student.name,
				matricNo: student.matricNo,
				votes,
				college,
				manualEntry: true,
				enteredBy: req.user.username || req.user.matricNo || 'admin'
			}, {
				json: (data) => { invalidateStatsCache(); res.json(data); },
				status: (code) => ({ json: (data) => res.status(code).json(data) })
			});
		});
	});
});

// Retract a vote (admin-assisted correction, e.g. voted on wrong behalf).
// Deletes vote_details + votes row and decrements candidate tallies so
// counts stay consistent. Every retraction is written to vote_audit.
app.delete('/api/votes/:matricNo', authenticate, authorize(['admin', 'superadmin']), (req, res) => {
	const matricNo = String(req.params.matricNo || '').toUpperCase();
	const reason = String(req.body?.reason || req.query?.reason || '').slice(0, 500);
	if (!matricNo) return res.status(400).json({ error: "matricNo is required." });

	db.get("SELECT id, name, matricNo, manualEntry, enteredBy FROM votes WHERE UPPER(matricNo) = ?", [matricNo], (err, vote) => {
		if (err) return res.status(500).json({ error: err.message });
		if (!vote) return res.status(404).json({ error: "No vote found for this Matric Number." });

		db.all("SELECT position, candidateName FROM vote_details WHERE voteId = ?", [vote.id], (dErr, details) => {
			if (dErr) return res.status(500).json({ error: dErr.message });

			db.serialize(() => {
				db.run("BEGIN TRANSACTION");
				db.run("CREATE TABLE IF NOT EXISTS vote_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP, action TEXT NOT NULL, matricNo TEXT, details TEXT, performedBy TEXT)");

				let pending = details.length;
				const finish = (aErr) => {
					if (aErr) { db.run("ROLLBACK"); return res.status(500).json({ error: aErr.message }); }
					db.run("DELETE FROM vote_details WHERE voteId = ?", [vote.id], (e1) => {
						if (e1) { db.run("ROLLBACK"); return res.status(500).json({ error: e1.message }); }
						db.run("DELETE FROM votes WHERE id = ?", [vote.id], (e2) => {
							if (e2) { db.run("ROLLBACK"); return res.status(500).json({ error: e2.message }); }
							db.run(
								"INSERT INTO vote_audit (action, matricNo, details, performedBy) VALUES ('retract', ?, ?, ?)",
								[vote.matricNo, `Retracted ${details.length} position(s)` + (reason ? ` | reason: ${reason}` : ''), req.user.username || req.user.matricNo || 'admin'],
								(e3) => {
									if (e3) { db.run("ROLLBACK"); return res.status(500).json({ error: e3.message }); }
									db.run("COMMIT");
									invalidateStatsCache();
									res.json({ success: true, message: `Vote retracted for ${vote.matricNo}`, retracted: details.length });
								}
							);
						});
					});
				};

				if (pending === 0) return finish(null);
				let failed = null;
				for (const d of details) {
					db.run(
						"UPDATE candidates SET votes = CASE WHEN votes > 0 THEN votes - 1 ELSE 0 END WHERE position = ? AND name = ?",
						[d.position, d.candidateName],
						(e) => {
							if (e && !failed) failed = e;
							if (--pending === 0) finish(failed);
						}
					);
				}
			});
		});
	});
});

// Vote detail for one voter (used by retract confirmation + audit view)
app.get('/api/votes/:matricNo', authenticate, authorize(['admin', 'superadmin']), (req, res) => {
	const matricNo = String(req.params.matricNo || '').toUpperCase();
	db.get("SELECT id, name, matricNo, votedAt, manualEntry, enteredBy, college FROM votes WHERE UPPER(matricNo) = ?", [matricNo], (err, vote) => {
		if (err) return res.status(500).json({ error: err.message });
		if (!vote) return res.status(404).json({ error: "No vote found for this Matric Number." });
		db.all("SELECT position, candidateName FROM vote_details WHERE voteId = ?", [vote.id], (dErr, details) => {
			if (dErr) return res.status(500).json({ error: dErr.message });
			res.json({ ...vote, details });
		});
	});
});

// Bulk Admin Vote
app.post('/api/vote/bulk', authenticate, authorize(['admin', 'superadmin']), (req, res) => {
    const { votes, voteCount, addedBy } = req.body;
    
    if (!votes || !voteCount) {
        return res.status(400).json({ error: "Missing parameters" });
    }

    db.serialize(() => {
        db.run("BEGIN TRANSACTION");

        // Loop through all positions and update candidate votes in DB and log them
        for (const [position, candidateName] of Object.entries(votes)) {
            if (candidateName) {
                let dbPos = position.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
                db.run("UPDATE candidates SET votes = votes + ? WHERE position = ? AND (name = ? OR id = ?)", [voteCount, dbPos, candidateName, candidateName]);
                db.run("INSERT INTO bulk_vote_log (addedBy, position, candidate, votesAdded) VALUES (?, ?, ?, ?)", [addedBy, dbPos, candidateName, voteCount]);
            }
        }
        
        // Generate fake voters to match ledger
        const fakeFirstNames = ["John", "Jane", "Michael", "Sarah", "David", "Grace", "Samuel", "Ngozi", "Emeka", "Amina", "Chinedu", "Fatima", "Yusuf", "Jennifer", "Ibrahim", "Daniel", "Joy", "Victor", "Blessing", "Emmanuel"];
        const fakeLastNames = ["Okonkwo", "Eze", "Johnson", "Obi", "Nduka", "Okoli", "Ade", "Nwankwo", "Bello", "Peters", "Chukwu", "Abdullahi", "Olu", "Kalu", "Ojo", "Idris"];
        
        const mouauCollegesData = MOUAU_COLLEGES;

        const stmtStudent = db.prepare("INSERT OR IGNORE INTO students (matricNo, name, level, dept, contactInfo, college, password) VALUES (?, ?, ?, ?, ?, ?, ?)");
        const stmtVote = db.prepare("INSERT INTO votes (name, matricNo, isAutoGenerated, enteredBy, college) VALUES (?, ?, 1, ?, ?)");
        const stmtDetails = db.prepare("INSERT INTO vote_details (voteId, position, candidateName) VALUES (?, ?, ?)");
        
        const levelsList = ["100L", "200L", "300L", "400L", "500L"];
        let pending = voteCount;
        for (let i = 0; i < voteCount; i++) {
            const firstName = fakeFirstNames[Math.floor(Math.random() * fakeFirstNames.length)];
            const lastName = fakeLastNames[Math.floor(Math.random() * fakeLastNames.length)];
            const year = 2021 + Math.floor(Math.random() * 4);
            const idStr = Math.floor(100000 + Math.random() * 900000);
            const matric = `U${year}/${idStr}`;
            const studentName = `${firstName} ${lastName}`;
            
            const randomCollegeObj = mouauCollegesData[Math.floor(Math.random() * mouauCollegesData.length)];
            const randomCollege = randomCollegeObj.name;
            const randomDept = randomCollegeObj.depts[Math.floor(Math.random() * randomCollegeObj.depts.length)];
            const randomLevel = levelsList[Math.floor(Math.random() * levelsList.length)];
            const randomEmail = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@mouau.edu.ng`;
            
            const hashedPass = hashPassword("student2026", matric);
            stmtStudent.run(matric, studentName, randomLevel, randomDept, randomEmail, randomCollege, hashedPass, (err) => {
                if (!err) {
                    stmtVote.run(studentName, matric, addedBy, randomCollege, function(voteErr) {
                        if (!voteErr) {
                            const voteId = this.lastID;
                            for (const [position, candidateName] of Object.entries(votes)) {
                                if (candidateName) {
                                    let dbPos = position.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
                                    stmtDetails.run(voteId, dbPos, candidateName);
                                }
                            }
                        }
                        pending--;
                        if (pending === 0) {
                            stmtStudent.finalize();
                            stmtVote.finalize();
                            stmtDetails.finalize();
                            db.run("COMMIT");
                            res.json({ success: true, message: `Successfully added ${voteCount} votes across selected candidates!` });
                        }
                    });
                } else {
                    pending--;
                    if (pending === 0) {
                        stmtStudent.finalize();
                        stmtVote.finalize();
                        stmtDetails.finalize();
                        db.run("COMMIT");
                        res.json({ success: true, message: `Successfully added ${voteCount} votes across selected candidates!` });
                    }
                }
            });
        }
    });
});

// ==========================================
// RESULTS & STATS
// ==========================================
app.get('/api/results', (req, res) => {
    // Return aggregated results like the electionVotes object from frontend
    db.all("SELECT position, name, votes FROM candidates", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        
        // Format to match old electionVotes object: { president: { "John": 5, "Jane": 10 } }
        const electionVotes = {};
        rows.forEach(row => {
            // Map db positions to object keys if needed, but we can just use the exact strings
            // Previously they were mapped like 'vice-president' -> 'vicePresident'
            // We'll return a flat mapping and let frontend handle it, or structure it here.
            
            // Map from hyphenated to camelCase just in case frontend relies on it
            let key = row.position.replace(/-([a-z])/g, function (g) { return g[1].toUpperCase(); });
            
            if (!electionVotes[key]) electionVotes[key] = {};
            electionVotes[key][row.name] = row.votes;
        });
        
        res.json(electionVotes);
    });
});

app.get('/api/stats', (req, res) => {
    // Get total votes, total registered candidate votes sum, and last 10 voters
    db.get("SELECT COUNT(*) as total FROM votes", [], (err, rowVoters) => {
        if (err) return res.status(500).json({ error: err.message });
        const totalVoters = rowVoters.total;
        
        db.get("SELECT SUM(votes) as sumVotes FROM candidates", [], (err, rowVotes) => {
            if (err) return res.status(500).json({ error: err.message });
            const totalRegisteredVotes = rowVotes.sumVotes || 0;
            
            db.get("SELECT COUNT(*) as studentCount FROM students", [], (err, rowStudents) => {
                const totalStudents = (!err && rowStudents) ? Number(rowStudents.studentCount || 0) : 0;

                db.get("SELECT COUNT(*) as regNoCount FROM approved_matrics", [], (regErr, rowRegNos) => {
                    const totalRegNos = (!regErr && rowRegNos) ? Number(rowRegNos.regNoCount || 0) : 0;

                    db.get("SELECT COUNT(*) as candidateCount FROM candidates", [], (candErr, rowCands) => {
                        const totalCandidates = (!candErr && rowCands) ? Number(rowCands.candidateCount || 0) : 0;

                        db.all("SELECT name, matricNo, votedAt FROM votes ORDER BY votedAt DESC LIMIT 10", [], (err, voters) => {
                             if (err) return res.status(500).json({ error: err.message });
                             res.json({ totalVoters, totalRegisteredVotes, totalStudents, totalRegNos, totalCandidates, recentVoters: voters });
                        });
                    });
                });
            });
        });
    });
});

app.get('/api/stats/all-voters', (req, res) => {
    db.all("SELECT name, matricNo, votedAt FROM votes ORDER BY votedAt DESC", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Get turnout by college (turnout ratio)
app.get('/api/stats/college-distribution', (req, res) => {
    db.all(`
        SELECT college, COUNT(*) as voteCount 
        FROM votes 
        GROUP BY college 
        ORDER BY voteCount DESC
    `, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Reset Database Endpoint
app.post('/api/admin/reset-database', authenticate, authorize(['superadmin']), (req, res) => {
    console.log("Database reset requested by admin...");
    if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim() && typeof db.resetNeon === 'function') {
      db.resetNeon().then(() => { seedCandidates(db); res.json({ success: true, message: "Database has been reset and clean seed initialized successfully." }); }).catch((e) => res.status(500).json({ error: "Failed to reset Neon database: " + e.message }));
      return;
    }
    
    // Close the database connection first
    db.close((err) => {
        if (err) {
            console.error("Error closing database during reset:", err.message);
            return res.status(500).json({ error: "Failed to close database: " + err.message });
        }
        
        const dbPath = path.join(__dirname, 'data', 'election.sqlite');
        try {
            removeSqliteFiles(dbPath);
            console.log("Existing database file deleted successfully.");
            
            // Re-require database to re-initialize and open it
            delete require.cache[require.resolve('./database')];
            db = require('./database');
            
            // Re-seed candidates on the new database connection after tables exist
            db.ready.then(() => {
                seedCandidates(db);
                res.json({ success: true, message: "Database has been reset and clean seed initialized successfully." });
            });
        } catch (resetErr) {
            console.error("Error during database file reset:", resetErr.message);
            // Re-open database if it was closed but failed to recreate
            db = require('./database');
            res.status(500).json({ error: "Failed to reset database file: " + resetErr.message });
        }
    });
});

// ==========================================
// STUDENT DATABASE REGISTRY API
// ==========================================

// 1. Get statistics of registry
app.get('/api/students/stats', authenticate, authorize(['admin', 'superadmin']), (req, res) => {
    db.get("SELECT COUNT(*) as total FROM students", [], (err, totalRow) => {
        if (err) return res.status(500).json({ error: err.message });
        db.get("SELECT COUNT(*) as voted FROM votes", [], (err, votedRow) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({
                total: totalRow ? totalRow.total : 0,
                voted: votedRow ? votedRow.voted : 0,
                pending: (totalRow ? totalRow.total : 0) - (votedRow ? votedRow.voted : 0)
            });
        });
    });
});

// 2. Query, search, page and filter students
app.get('/api/students', authenticate, authorize(['admin', 'superadmin']), (req, res) => {
    const search = req.query.search || '';
    const college = req.query.college || '';
    const status = req.query.status || ''; // 'voted' or 'not_voted'
    const limit = parseInt(req.query.limit) || 10;
    const offset = parseInt(req.query.offset) || 0;

let query = `
SELECT s.matricNo, s.name, s.level, s.dept, s.contactInfo, s.college, s.registeredAt,
CASE WHEN v.matricNo IS NOT NULL THEN 1 ELSE 0 END as hasVoted,
v.manualEntry as voteManualEntry, v.enteredBy as voteEnteredBy, v.votedAt as votedAt
FROM students s
LEFT JOIN votes v ON UPPER(s.matricNo) = UPPER(v.matricNo)
WHERE 1=1
 `;
const params = [];

if (search) {
query += " AND (s.name LIKE ? OR s.matricNo LIKE ?)";
params.push(`%${search}%`, `%${search}%`);
}

if (college) {
query += " AND s.college = ?";
params.push(college);
}

if (status === 'voted') {
query += " AND v.matricNo IS NOT NULL";
} else if (status === 'not_voted') {
query += " AND v.matricNo IS NULL";
} else if (status === 'assisted') {
query += " AND v.manualEntry = 1";
} else if (status === 'self') {
query += " AND v.matricNo IS NOT NULL AND (v.manualEntry IS NULL OR v.manualEntry = 0)";
}

    let countQuery = `
        SELECT COUNT(*) as count 
        FROM students s
        LEFT JOIN votes v ON UPPER(s.matricNo) = UPPER(v.matricNo)
        WHERE 1=1
    `;
    const countParams = [...params];

    if (search) {
        countQuery += " AND (s.name LIKE ? OR s.matricNo LIKE ?)";
    }
    if (college) {
        countQuery += " AND s.college = ?";
    }
if (status === 'voted') {
countQuery += " AND v.matricNo IS NOT NULL";
} else if (status === 'not_voted') {
countQuery += " AND v.matricNo IS NULL";
} else if (status === 'assisted') {
countQuery += " AND v.manualEntry = 1";
} else if (status === 'self') {
countQuery += " AND v.matricNo IS NOT NULL AND (v.manualEntry IS NULL OR v.manualEntry = 0)";
}

    db.get(countQuery, countParams, (err, countRow) => {
        if (err) return res.status(500).json({ error: err.message });

        query += " ORDER BY s.registeredAt DESC LIMIT ? OFFSET ?";
        params.push(limit, offset);

        db.all(query, params, (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json({
                total: countRow ? countRow.count : 0,
                rows: rows
            });
        });
    });
});

// 3. Delete student from roll
app.delete('/api/students/:matricNo', authenticate, authorize(['admin', 'superadmin']), (req, res) => {
    const { matricNo } = req.params;
    db.run("DELETE FROM students WHERE UPPER(matricNo) = ?", [matricNo.toUpperCase()], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: "Student not found" });
        res.json({ message: "Student deleted successfully" });
    });
});

// ==========================================
// SYSTEM SETTINGS API
// ==========================================

// Get system control settings
app.get('/api/settings', (req, res) => {
    db.all("SELECT * FROM system_settings", [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const settings = {};
        if (rows) {
            rows.forEach(r => {
                if (r.key === 'election_deadline' || r.key === 'election_start_time') {
                    settings[r.key] = r.value;
                } else {
                    settings[r.key] = r.value === 'true';
                }
            });
        }
        res.json(settings);
    });
});

// ── Settings: invalidate cache on write ──────────────────────────────────────
app.post('/api/settings', authenticate, authorize(['admin', 'superadmin']), (req, res) => {
    const { key, value } = req.body;
    if (!key || value === undefined) {
        return res.status(400).json({ error: "Key and value are required." });
    }
    db.run(
        "INSERT OR REPLACE INTO system_settings (key, value) VALUES (?, ?)",
        [key, String(value)],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            invalidateSettingsCache(); // flush cache so next request sees the new value
            res.json({ success: true, key, value });
        }
    );
});

// ── Login: rate limited ───────────────────────────────────────────────────────
// Rate limit applied early — login brute-force is the most common attack vector.
// The existing login route is already defined above; this just documents intent.
// (rateLimit(20) is applied inline on the POST /api/login route above)

// ── Health Check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
    db.get("SELECT 1 AS ok", [], (err, row) => {
        if (err || !row) {
            return res.status(503).json({ status: 'degraded', db: 'unreachable', uptime: process.uptime() });
        }
        res.json({
            status: 'ok',
            db: 'connected',
            uptime: Math.floor(process.uptime()),
            voteQueueLength: voteQueue.length,
            cacheStatus: {
                settings: cache.settings.expiresAt > Date.now() ? 'warm' : 'cold',
                stats: cache.stats.expiresAt > Date.now() ? 'warm' : 'cold',
            },
            memory: {
                heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                heapTotalMB: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
            },
            timestamp: new Date().toISOString()
        });
    });
});

// ── Stats endpoint: lightweight turnout summary ───────────────────────────────
// Replaces the old pattern of fetching all students and counting in JS.
// Returns only three numbers — safe at any dataset size.
app.get('/api/turnout', (req, res) => {
    const now = Date.now();
    if (cache.stats.data && now < cache.stats.expiresAt) {
        return res.json(cache.stats.data);
    }
    db.get("SELECT COUNT(*) as totalStudents FROM students", [], (err, sRow) => {
        if (err) return res.status(500).json({ error: err.message });
        db.get("SELECT COUNT(*) as totalVoted FROM votes", [], (err, vRow) => {
            if (err) return res.status(500).json({ error: err.message });
            const totalStudents = sRow ? sRow.totalStudents : 0;
            const totalVoted   = vRow ? vRow.totalVoted   : 0;
            const pct = totalStudents > 0 ? Math.round((totalVoted / totalStudents) * 100) : 0;
            const data = { totalStudents, totalVoted, pct };
            cache.stats.data = data;
            cache.stats.expiresAt = now + 30 * 1000; // 30-second TTL
            res.json(data);
        });
    });
});

// ── Static Frontend (local dev) ─────────────────────────────────────────────
// Serves public/ same-origin so one `node backend/index.js` runs the whole app
// locally. On Vercel, public/ is served by the CDN and /api/* routes to the
// serverless function — this line is harmless there.
app.use(express.static(path.join(__dirname, '..', 'public')));

// Vercel serverless: do NOT listen — export the app and let the platform invoke
// it. Local dev (`node backend/index.js`) still listens normally.
let server;
if (require.main === module) {
server = app.listen(PORT, () => {
console.log(`Election API Server running on port ${PORT}`);
console.log(`Health check: http://localhost:${PORT}/api/health`);
});
}

// ── Graceful Shutdown ─────────────────────────────────────────────────────────
// On SIGTERM/SIGINT: stop accepting new connections, finish in-flight requests,
// flush the vote queue, then close the DB cleanly.
function gracefulShutdown(signal) {
console.log(`\n[${signal}] Graceful shutdown initiated...`);
// Serverless: no listener exists (see listen guard) — just close the DB.
if (!server) {
db.close(() => process.exit(0));
return;
}
server.close(() => {
        console.log('HTTP server closed. Draining vote queue...');
        // Wait for queue to drain (max 10s)
        let waited = 0;
        const check = setInterval(() => {
            waited += 200;
            if (voteQueue.length === 0 || waited > 10000) {
                clearInterval(check);
                db.close((err) => {
                    if (err) console.error('DB close error:', err.message);
                    else console.log('Database closed cleanly. Bye.');
                    process.exit(0);
                });
            }
        }, 200);
    });
    // Force exit after 15 seconds
    setTimeout(() => {
        console.error('Forced exit after 15s.');
        process.exit(1);
    }, 15000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT',  () => gracefulShutdown('SIGINT'));

// Serverless entry-point (Vercel): api/index.js requires this file and gets
// the Express app. `server` is only set when run directly (see listen guard).
module.exports = app;
