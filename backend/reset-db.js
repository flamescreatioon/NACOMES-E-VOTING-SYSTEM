require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const fs = require('fs');

// Neon mode: truncate + reseed in place.
if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim()) {
 console.log('Resetting Neon Postgres database...');
 const db = require('./database');
 db.ready.then(() => {
 db.resetNeon().then(() => {
 console.log('Neon database has been reset and clean seed initialized successfully.');
 db.close(() => process.exit(0));
 }).catch((e) => {
 console.error('Neon reset failed:', e.message);
 process.exit(1);
 });
 });
 return;
}

const dbPath = path.join(__dirname, 'data', 'election.sqlite');

console.log('Resetting the database...');

// 1. Delete database file (and WAL/SHM files) if exists
for (const suffix of ['', '-wal', '-shm']) {
 if (fs.existsSync(dbPath + suffix)) {
 try {
 fs.unlinkSync(dbPath + suffix);
 if (suffix === '') console.log('Deleted existing SQLite file.');
 } catch (err) {
 console.error(`Error deleting SQLite file (${dbPath + suffix}):`, err.message);
 }
 }
}

// 2. Require database.js to re-initialize and seed it
require('./database');
console.log('Database has been reset and clean seed initialized successfully.');
