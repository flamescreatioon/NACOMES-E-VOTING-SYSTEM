// Re-imports backend/data/*.txt backups into SQLite `approved_matrics`.
// New rows are added (INSERT OR IGNORE); nothing is deleted — delete stale
// matrics via SQL if a reg no must be revoked.
//
// Usage: node backend/sync-approved-matrics.js
const path = require('path');
const db = require('./database');
const approved = require('./approved-matrics');

db.ready.then(() => {
  let rows = [];
  try {
    rows = approved.readAllTxtBackup(path.join(__dirname, 'data'));
  } catch (e) {
    console.error('Could not read txt backups:', e.message);
    process.exit(1);
  }
  if (!rows.length) {
    console.log('No matric numbers found in txt backups — nothing to sync.');
    process.exit(0);
  }
  db.serialize(() => {
    const stmt = db.prepare('INSERT OR IGNORE INTO approved_matrics (matricNo, level) VALUES (?, ?)');
    for (const r of rows) stmt.run([r.matricNo, r.level]);
    stmt.finalize((err) => {
      if (err) {
        console.error('Sync failed:', err.message);
        process.exit(1);
      }
      approved.countApprovedByLevel(db).then((counts) => {
        console.log('Synced from txt backups. Per-level totals:');
        for (const c of counts) console.log(`  ${c.level}: ${c.count}`);
        db.close(() => process.exit(0));
      }).catch((e) => {
        console.error('Sync finalize failed:', e.message);
        process.exit(1);
      });
    });
  });
});
