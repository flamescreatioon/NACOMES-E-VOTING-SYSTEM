/**
 * Approved matriculation numbers — single source of truth lives in the
 * database (`approved_matrics` table). The .txt files in backend/data/
 * are kept only as a BACKUP / seed source and as a fallback if the DB
 * lookup fails.
 *
 * Used by:
 *  - backend/database.js  -> ensureApprovedMatricsTable() + seed on boot
 *  - backend/index.js     -> isMatricApproved() inside POST /api/register
 *  - backend/sync-approved-matrics.js -> re-import txt files into SQLite
 *  - migrate-to-supabase.js / Neon -> approved_matrics table (same shape)
 */
const fs = require('fs');
const path = require('path');

function normalizeMatric(value) {
  return String(value || '').trim().replace(/\\/g, '/').toUpperCase();
}

// Level -> backup txt file (kept for seeding / fallback only)
const LEVEL_FILES = {
  '100L': '100level_matric_numbers.txt',
  '200L': 'matric_numbers_only.txt',
  '300L': '300level_matric_numbers.txt',
  '400L': '400level_matric_numbers.txt',
  '500L': '500_level_matric_numbers.txt',
};

const LEVEL_LABELS = {
  '100L': '100 Level',
  '200L': '200 Level',
  '300L': '300 Level',
  '400L': '400 Level',
  '500L': '500 Level',
};

// In-memory copy of the txt backups, loaded once at boot.
const txtWhitelists = {};
let txtLoaded = false;

function loadTxtWhitelists(dataDir) {
  const dir = dataDir || path.join(__dirname, 'data');
  for (const [levelKey, fileName] of Object.entries(LEVEL_FILES)) {
    const filePath = path.join(dir, fileName);
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        const list = raw.split(/\r?\n/).map(normalizeMatric).filter(Boolean);
        txtWhitelists[levelKey] = new Set(list);
        console.log(`Loaded ${list.length} approved ${LEVEL_LABELS[levelKey]} matric numbers from backup file.`);
      } else {
        txtWhitelists[levelKey] = new Set();
        console.warn(`Approved ${LEVEL_LABELS[levelKey]} backup file not found at ${filePath} — DB remains the source of truth.`);
      }
    } catch (err) {
      txtWhitelists[levelKey] = new Set();
      console.error(`Error loading approved ${LEVEL_LABELS[levelKey]} backup file:`, err.message);
    }
  }
  txtLoaded = true;
  return txtWhitelists;
}

function getTxtSet(levelKey) {
  if (!txtLoaded) loadTxtWhitelists();
  return txtWhitelists[levelKey] || new Set();
}

/** Read every matric from the backup txt files (for seeding / migration). */
function readAllTxtBackup(dataDir) {
  if (!txtLoaded) loadTxtWhitelists(dataDir);
  const rows = [];
  for (const [levelKey, set] of Object.entries(txtWhitelists)) {
    for (const matricNo of set) rows.push({ matricNo, level: levelKey });
  }
  return rows;
}

/**
 * Primary check: is this matric approved for this level?
 * 1. Try the `approved_matrics` table first (source of truth).
 * 2. If the DB lookup errors (table missing, DB down), fall back to the
 *    txt backup so registration can continue.
 * Returns a Promise<boolean>.
 */
function isMatricApproved(db, levelKey, normalizedMatric) {
  return new Promise((resolve) => {
    if (!db || typeof db.get !== 'function') {
      resolve(getTxtSet(levelKey).has(normalizedMatric));
      return;
    }
    db.get(
      'SELECT 1 AS ok FROM approved_matrics WHERE matricNo = ? AND level = ? LIMIT 1',
      [normalizedMatric, levelKey],
      (err, row) => {
        if (err) {
          // Table may not exist on old DBs — fall back to txt backup.
          resolve(getTxtSet(levelKey).has(normalizedMatric));
          return;
        }
        if (row) return resolve(true);
        // Not in DB for this level — do NOT fall back to txt allow;
        // txt is only a fallback when the DB itself is unreadable.
        // But if the DB table is completely empty (fresh boot before seed),
        // consult txt so we fail open only in that narrow case.
        db.get('SELECT COUNT(*) AS c FROM approved_matrics', [], (cErr, cRow) => {
          if (!cErr && cRow && Number(cRow.c) === 0) {
            resolve(getTxtSet(levelKey).has(normalizedMatric));
          } else {
            resolve(false);
          }
        });
      }
    );
  });
}

function isMatricApprovedAnyLevel(db, rawMatric) {
  const normalized = normalizeMatric(rawMatric);
  if (!normalized) return Promise.resolve(false);
  return new Promise((resolve) => {
    if (!db || typeof db.get !== 'function') {
      if (!txtLoaded) loadTxtWhitelists();
      for (const set of Object.values(txtWhitelists)) {
        if (set.has(normalized)) return resolve(true);
      }
      return resolve(false);
    }
    db.get(
      'SELECT 1 AS ok FROM approved_matrics WHERE UPPER(matricNo) = ? LIMIT 1',
      [normalized],
      (err, row) => {
        if (err) {
          if (!txtLoaded) loadTxtWhitelists();
          for (const set of Object.values(txtWhitelists)) {
            if (set.has(normalized)) return resolve(true);
          }
          return resolve(false);
        }
        resolve(Boolean(row));
      }
    );
  });
}

/** Count of approved matrics in DB per level — for health checks / admin. */
function countApprovedByLevel(db) {
  return new Promise((resolve, reject) => {
    db.all('SELECT level, COUNT(*) AS count FROM approved_matrics GROUP BY level', [], (err, rows) => {
      if (err) return reject(err);
      resolve(rows || []);
    });
  });
}

module.exports = {
  normalizeMatric,
  LEVEL_FILES,
  LEVEL_LABELS,
  loadTxtWhitelists,
  getTxtSet,
  readAllTxtBackup,
  isMatricApproved,
  isMatricApprovedAnyLevel,
  countApprovedByLevel,
};
