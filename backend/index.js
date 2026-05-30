const express = require('express');
const cors = require('cors');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 5005;

// Middleware
app.use(cors());
app.use(express.json());

// ==========================================
// SEED INITIAL DATA
// ==========================================
const INITIAL_CANDIDATES = [
    { id: 'john-adebayo', name: 'John Adebayo', level: 'SUG', position: 'president', college: 'Biological & Physical Sciences', dept: 'Computer Science' },
    { id: 'amina-ibrahim', name: 'Amina Ibrahim', level: 'SUG', position: 'president', college: 'Law', dept: 'Law' },
    { id: 'chukwuemeka-obi', name: 'Chukwuemeka Obi', level: 'SUG', position: 'president', college: 'Engineering & Environmental Studies', dept: 'Engineering' },
    { id: 'sarah-johnson', name: 'Sarah Johnson', level: 'SUG', position: 'vp', college: 'Business Administration', dept: 'Accounting' },
    { id: 'michael-oku', name: 'Michael Oku', level: 'SUG', position: 'vp', college: 'Humanities', dept: 'History' },
    { id: 'david-nduka', name: 'David Nduka', level: 'SUG', position: 'general-secretary', college: 'Education', dept: 'Educational Management' },
    { id: 'grace-okoli', name: 'Grace Okoli', level: 'SUG', position: 'general-secretary', college: 'Clinical Sciences', dept: 'Medicine' }
];

db.get("SELECT COUNT(*) as count FROM candidates", (err, row) => {
    if (!err && row.count === 0) {
        console.log("Seeding initial candidates...");
        const stmt = db.prepare("INSERT INTO candidates (id, name, level, position, college, dept, votes) VALUES (?, ?, ?, ?, ?, ?, 0)");
        INITIAL_CANDIDATES.forEach(c => {
            stmt.run(c.id, c.name, c.level, c.position, c.college, c.dept);
        });
        stmt.finalize();
    }
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

app.post('/api/candidates', (req, res) => {
    const { name, level, position, college, dept } = req.body;
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    
    db.run(
        "INSERT INTO candidates (id, name, level, position, college, dept, votes, status) VALUES (?, ?, ?, ?, ?, ?, 0, 'active')",
        [id, name, level, position, college, dept],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id, name, level, position, college, dept, votes: 0, status: 'active' });
        }
    );
});

// Update candidate status (disqualify/re-instate)
app.put('/api/candidates/:id/status', (req, res) => {
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
app.delete('/api/candidates/:id', (req, res) => {
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
app.post('/api/register', (req, res) => {
    const { name, matricNo, level, dept, contactInfo, password } = req.body;
    if (!name || !matricNo || !level || !dept || !contactInfo || !password) {
        return res.status(400).json({ error: "All registration fields are required." });
    }

    const absuColleges = [
        { name: "Biological & Physical Sciences", depts: ["Computer Science", "Biochemistry", "Microbiology", "Mathematics"] },
        { name: "Law", depts: ["Public Law", "Private Law", "International Law"] },
        { name: "Engineering & Environmental Studies", depts: ["Mechanical Engineering", "Civil Engineering", "Architecture"] },
        { name: "Business Administration", depts: ["Accounting", "Marketing", "Banking & Finance"] },
        { name: "Humanities", depts: ["History", "English", "Linguistics"] },
        { name: "Education", depts: ["Educational Management", "Guidance & Counseling"] },
        { name: "Clinical Sciences", depts: ["Medicine & Surgery", "Nursing", "Medical Laboratory"] }
    ];

    let matchedCollege = "Biological & Physical Sciences";
    for (const col of absuColleges) {
        if (col.depts.includes(dept)) {
            matchedCollege = col.name;
            break;
        }
    }

    db.run(
        "INSERT INTO students (matricNo, name, level, dept, contactInfo, college, password) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [matricNo.toUpperCase(), name, level, dept, contactInfo, matchedCollege, password],
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

app.post('/api/login', (req, res) => {
    const { matricNo, password } = req.body;
    if (!matricNo || !password) {
        return res.status(400).json({ error: "Matric number and password are required." });
    }

    db.get(
        "SELECT * FROM students WHERE UPPER(matricNo) = ? AND password = ?",
        [matricNo.toUpperCase(), password],
        (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!row) return res.status(400).json({ error: "Invalid matriculation number or password." });
            
            res.json({
                success: true,
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
                const stmtDetails = db.prepare("INSERT INTO vote_details (voteId, position, candidateName) VALUES (?, ?, ?)");
                const stmtUpdate = db.prepare("UPDATE candidates SET votes = votes + 1 WHERE position = ? AND name = ?");
                
                let success = true;
                for (const [position, candidateName] of Object.entries(votes)) {
                    if (candidateName) {
                        stmtDetails.run(voteId, position, candidateName, (e) => { if(e) success = false; });
                        stmtUpdate.run(position, candidateName, (e) => { if(e) success = false; });
                    }
                }
                
                stmtDetails.finalize();
                stmtUpdate.finalize(() => {
                    if (success) {
                        db.run("COMMIT");
                        res.json({ success: true, message: "Vote recorded successfully" });
                    } else {
                        db.run("ROLLBACK");
                        res.status(500).json({ error: "Failed to record vote details" });
                    }
                });
            }
        );
    });
}

// Standard Student Vote
app.post('/api/vote', (req, res) => {
    processVote(req.body, res);
});

// Manual Admin Vote
app.post('/api/vote/manual', (req, res) => {
    // Expected to have enteredBy, manualEntry flags
    processVote(req.body, res);
});

// Bulk Admin Vote
app.post('/api/vote/bulk', (req, res) => {
    const { votes, voteCount, addedBy } = req.body;
    
    if (!votes || !voteCount) {
        return res.status(400).json({ error: "Missing parameters" });
    }

    const absuColleges = [
        "Biological & Physical Sciences",
        "Law",
        "Engineering & Environmental Studies",
        "Business Administration",
        "Humanities",
        "Education",
        "Clinical Sciences",
        "Agriculture",
        "Social Sciences"
    ];

    db.serialize(() => {
        db.run("BEGIN TRANSACTION");

        // Loop through all positions and update candidate votes in DB and log them
        for (const [position, candidateName] of Object.entries(votes)) {
            if (candidateName) {
                let dbPos = position;
                if (dbPos === 'vice-president') dbPos = 'vp';
                
                db.run("UPDATE candidates SET votes = votes + ? WHERE position = ? AND name = ?", [voteCount, dbPos, candidateName]);
                db.run("INSERT INTO bulk_vote_log (addedBy, position, candidate, votesAdded) VALUES (?, ?, ?, ?)", [addedBy, dbPos, candidateName, voteCount]);
            }
        }
        
        // Generate fake voters to match ledger
        const fakeFirstNames = ["John", "Jane", "Michael", "Sarah", "David", "Grace", "Samuel", "Ngozi", "Emeka", "Amina", "Chinedu", "Fatima", "Yusuf", "Jennifer", "Ibrahim", "Daniel", "Joy", "Victor", "Blessing", "Emmanuel"];
        const fakeLastNames = ["Okonkwo", "Eze", "Johnson", "Obi", "Nduka", "Okoli", "Ade", "Nwankwo", "Bello", "Peters", "Chukwu", "Abdullahi", "Olu", "Kalu", "Ojo", "Idris"];
        
        const absuCollegesData = [
            { name: "Biological & Physical Sciences", depts: ["Computer Science", "Biochemistry", "Microbiology", "Mathematics"] },
            { name: "Law", depts: ["Public Law", "Private Law", "International Law"] },
            { name: "Engineering & Environmental Studies", depts: ["Mechanical Engineering", "Civil Engineering", "Architecture"] },
            { name: "Business Administration", depts: ["Accounting", "Marketing", "Banking & Finance"] },
            { name: "Humanities", depts: ["History", "English", "Linguistics"] },
            { name: "Education", depts: ["Educational Management", "Guidance & Counseling"] },
            { name: "Clinical Sciences", depts: ["Medicine & Surgery", "Nursing", "Medical Laboratory"] }
        ];

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
            
            const randomCollegeObj = absuCollegesData[Math.floor(Math.random() * absuCollegesData.length)];
            const randomCollege = randomCollegeObj.name;
            const randomDept = randomCollegeObj.depts[Math.floor(Math.random() * randomCollegeObj.depts.length)];
            const randomLevel = levelsList[Math.floor(Math.random() * levelsList.length)];
            const randomEmail = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@absu.edu.ng`;
            
            stmtStudent.run(matric, studentName, randomLevel, randomDept, randomEmail, randomCollege, "student2026", (err) => {
                if (!err) {
                    stmtVote.run(studentName, matric, addedBy, randomCollege, function(voteErr) {
                        if (!voteErr) {
                            const voteId = this.lastID;
                            for (const [position, candidateName] of Object.entries(votes)) {
                                if (candidateName) {
                                    let dbPos = position;
                                    if (dbPos === 'vice-president') dbPos = 'vp';
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
            let key = row.position;
            if (key === 'vice-president') key = 'vicePresident';
            if (key === 'general-secretary') key = 'generalSecretary';
            if (key === 'financial-secretary') key = 'financialSecretary';
            
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
                const totalStudents = (!err && rowStudents) ? rowStudents.studentCount : 15000;
                
                db.all("SELECT name, matricNo, votedAt FROM votes ORDER BY votedAt DESC LIMIT 10", [], (err, voters) => {
                     if (err) return res.status(500).json({ error: err.message });
                     res.json({ totalVoters, totalRegisteredVotes, totalStudents, recentVoters: voters });
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

app.listen(PORT, () => {
    console.log(`Election API Server running on port ${PORT}`);
});
