require('dotenv').config();
// ── Neon Postgres mode ─────────────────────────────────────────────────────
// When DATABASE_URL is set, use Neon (Postgres) instead of local SQLite.
// The adapter below exposes the same sqlite3-style API (get/all/run/prepare/
// serialize/close/ready) so backend/index.js works unchanged.
if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim()) {
module.exports = require('./db-postgres')(process.env.DATABASE_URL.trim());
return;
}

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { MOUAU_COLLEGES } = require('./mouau-colleges');

function hashPassword(password, salt) {
    return crypto.createHmac('sha256', salt.toUpperCase()).update(password).digest('hex');
}

// Ensure the data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
}

let resolveStudentsReady;
let resolveSettingsReady;
const studentsReady = new Promise((resolve) => { resolveStudentsReady = resolve; });
const settingsReady = new Promise((resolve) => { resolveSettingsReady = resolve; });
const ready = Promise.all([studentsReady, settingsReady]);

const dbPath = path.join(dataDir, 'election.sqlite');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error connecting to the database:', err.message);
        if (resolveStudentsReady) resolveStudentsReady();
        if (resolveSettingsReady) resolveSettingsReady();
    } else {
        console.log('Connected to SQLite database.');

        // ── Performance & Concurrency PRAGMAs ──────────────────────────────
        // WAL mode: allows concurrent reads while a write is in progress.
        // Without this, every write exclusively locks the file and readers block.
        db.run("PRAGMA journal_mode=WAL");

        // Increase in-memory cache to 64 MB (default is ~2 MB).
        // Hot pages (students, votes, candidates) stay in RAM between requests.
        db.run("PRAGMA cache_size=-65536");

        // NORMAL sync is safe with WAL and far faster than FULL (the default).
        // Data is safe on OS crash; only a power-cut mid-write risks the last tx.
        db.run("PRAGMA synchronous=NORMAL");

        // Keep temp tables in memory instead of writing to disk.
        db.run("PRAGMA temp_store=MEMORY");

        // Allow up to 5 seconds of retry on SQLITE_BUSY before failing.
        db.configure("busyTimeout", 5000);

        initializeDatabase();
    }
});

db.ready = ready;

function initializeDatabase() {
    db.serialize(() => {
        // Create Candidates table
        db.run(`
            CREATE TABLE IF NOT EXISTS candidates (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                level TEXT,
                position TEXT NOT NULL,
                college TEXT,
                dept TEXT,
                votes INTEGER DEFAULT 0,
                status TEXT DEFAULT 'active',
                matricNo TEXT,
                email TEXT,
                phone TEXT,
                slogan TEXT,
                manifesto TEXT,
                experience TEXT,
                profileImageUrl TEXT,
                posterImageUrl TEXT
            )
        `, (err) => {
            if (!err) {
                // Safely alter table to add columns if they don't exist
                const columns = ['status', 'matricNo', 'email', 'phone', 'slogan', 'manifesto', 'experience', 'profileImageUrl', 'posterImageUrl'];
                columns.forEach(col => {
                    db.run(`ALTER TABLE candidates ADD COLUMN ${col} TEXT DEFAULT NULL`, (alterErr) => {
                        // Suppress error if column already exists
                    });
                });
            }
        });

        db.run(`
            CREATE TABLE IF NOT EXISTS media_objects (
                id TEXT PRIMARY KEY,
                candidateId TEXT,
                kind TEXT NOT NULL DEFAULT 'profile',
                filename TEXT,
                mimeType TEXT NOT NULL,
                sizeBytes INTEGER NOT NULL,
                data BLOB NOT NULL,
                uploadedBy TEXT,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        db.run(`
            CREATE TABLE IF NOT EXISTS upload_chunks (
                uploadId TEXT NOT NULL,
                chunkIndex INTEGER NOT NULL,
                totalChunks INTEGER NOT NULL,
                mimeType TEXT NOT NULL,
                filename TEXT,
                kind TEXT NOT NULL DEFAULT 'profile',
                uploadedBy TEXT,
                data BLOB NOT NULL,
                createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (uploadId, chunkIndex)
            )
        `);

        // Create Votes table (Main voter ledger)
        db.run(`
            CREATE TABLE IF NOT EXISTS votes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT,
                matricNo TEXT UNIQUE NOT NULL,
                votedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
                manualEntry BOOLEAN DEFAULT 0,
                isAutoGenerated BOOLEAN DEFAULT 0,
                enteredBy TEXT,
                college TEXT
            )
        `, (err) => {
            if (!err) {
                // Safely try to alter the table for existing databases that don't have the college column yet
                db.run("ALTER TABLE votes ADD COLUMN college TEXT", (alterErr) => {
                    // It will error if the column already exists, which is expected on subsequent runs
                });
            }
        });

        // Create Vote Details (Who voted for whom)
        db.run(`
            CREATE TABLE IF NOT EXISTS vote_details (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                voteId INTEGER,
                position TEXT NOT NULL,
                candidateName TEXT NOT NULL,
                FOREIGN KEY(voteId) REFERENCES votes(id)
            )
        `);
        
        // Create Bulk Vote Audit Log
        db.run(`
            CREATE TABLE IF NOT EXISTS bulk_vote_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                addedBy TEXT,
                position TEXT,
                candidate TEXT,
                votesAdded INTEGER
            )
        `);

// Create approved matric numbers table (source of truth for registration).
// The .txt files in backend/data/ are backups / seed source only.
db.run(`
CREATE TABLE IF NOT EXISTS approved_matrics (
matricNo TEXT NOT NULL,
level TEXT NOT NULL,
createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
PRIMARY KEY (matricNo, level)
)
`, (err) => {
if (!err) {
seedApprovedMatrics();
}
});

function seedApprovedMatrics() {
let approved;
try {
approved = require('./approved-matrics');
} catch (e) {
console.error('Could not load approved-matrics module:', e.message);
return;
}
let rows = [];
try {
rows = approved.readAllTxtBackup(dataDir);
} catch (e) {
console.error('Could not read txt backups for approved matrics:', e.message);
return;
}
if (!rows.length) {
console.log('No approved matric numbers found in txt backups — skipping seed.');
return;
}
// Seed only new entries (INSERT OR IGNORE) so re-uploads just add rows.
const stmt = db.prepare('INSERT OR IGNORE INTO approved_matrics (matricNo, level) VALUES (?, ?)');
for (const r of rows) {
stmt.run([r.matricNo, r.level]);
}
stmt.finalize(() => {
db.get('SELECT COUNT(*) AS total FROM approved_matrics', (tErr, tRow) => {
const total = !tErr && tRow ? tRow.total : '?';
console.log(`Approved matric numbers synced from txt backups (total in DB: ${total}).`);
});
});
}

// Create students table if not exists
db.run(`
CREATE TABLE IF NOT EXISTS students (
                matricNo TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                level TEXT NOT NULL,
                dept TEXT NOT NULL,
                contactInfo TEXT NOT NULL,
                college TEXT NOT NULL,
                nacomeReceipt TEXT,
                password TEXT NOT NULL,
                registeredAt DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `, (err) => {
            if (!err) {
                db.run("ALTER TABLE students ADD COLUMN nacomeReceipt TEXT", () => {});
                if (resolveStudentsReady) resolveStudentsReady();
            } else {
                if (resolveStudentsReady) resolveStudentsReady();
            }
        });

        console.log('Database schema initialized.');
        
        // ── Query Indexes ─────────────────────────────────────────────────
        // These turn O(n) full-table scans into O(log n) lookups.
        // MUST exist for the system to survive election-day load.
        db.run("CREATE INDEX IF NOT EXISTS idx_approved_matrics_matric ON approved_matrics(matricNo)");
        db.run("CREATE INDEX IF NOT EXISTS idx_approved_matrics_level ON approved_matrics(level)");
        db.run("CREATE INDEX IF NOT EXISTS idx_votes_matricNo ON votes(matricNo)");
        db.run("CREATE INDEX IF NOT EXISTS idx_votes_votedAt     ON votes(votedAt DESC)");
        db.run("CREATE INDEX IF NOT EXISTS idx_votes_college     ON votes(college)");
        db.run("CREATE INDEX IF NOT EXISTS idx_students_matricNo ON students(matricNo)");
        db.run("CREATE INDEX IF NOT EXISTS idx_students_college  ON students(college)");
        db.run("CREATE INDEX IF NOT EXISTS idx_students_dept     ON students(dept)");
        db.run("CREATE INDEX IF NOT EXISTS idx_students_name     ON students(name)");
        db.run("CREATE INDEX IF NOT EXISTS idx_candidates_level  ON candidates(level)");
        db.run("CREATE INDEX IF NOT EXISTS idx_candidates_pos    ON candidates(position)");
        db.run("CREATE INDEX IF NOT EXISTS idx_votedetails_vote  ON vote_details(voteId)");

        
        // Create system settings table
        db.run(`
            CREATE TABLE IF NOT EXISTS system_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        `, (err) => {
            if (!err) {
                db.run("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('registration_active_sug', 'true')");
                db.run("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('voting_active_sug', 'true')");
                db.run("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('registration_active_college', 'true')");
                db.run("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('voting_active_college', 'true')");
                db.run("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('registration_active_department', 'true')");
                db.run("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('voting_active_department', 'true')");
                db.run("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('election_deadline', '2026-10-31T23:59:59')");
                // Keep legacy flags for backward compatibility
                db.run("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('registration_active', 'true')");
                db.run("INSERT OR IGNORE INTO system_settings (key, value) VALUES ('voting_active', 'true')", () => {
                    if (resolveSettingsReady) resolveSettingsReady();
                });
            } else {
                if (resolveSettingsReady) resolveSettingsReady();
            }
        });
    });
}

module.exports = db;
