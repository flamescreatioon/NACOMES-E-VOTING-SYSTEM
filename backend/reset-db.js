const path = require('path');
const fs = require('fs');

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
