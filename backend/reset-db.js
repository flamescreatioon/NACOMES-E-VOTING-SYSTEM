const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'data', 'election.sqlite');

console.log('Resetting the database...');

// 1. Delete database file if exists
if (fs.existsSync(dbPath)) {
    try {
        fs.unlinkSync(dbPath);
        console.log('Deleted existing SQLite file.');
    } catch (err) {
        console.error('Error deleting SQLite file:', err.message);
    }
}

// 2. Require database.js to re-initialize and seed it
require('./database');
console.log('Database has been reset and clean seed initialized successfully.');
