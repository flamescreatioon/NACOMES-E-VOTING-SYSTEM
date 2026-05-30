/**
 * ABSU Election Portal 2026 - Main JavaScript
 * Shared functionality across all pages
 */

const CONFIG = {
    appName: 'ABSU Election Portal',
    storageKeys: {
        loggedInUser: 'loggedInUser',
        allVotes: 'allVotes',
        hasVoted: 'hasVoted',
        darkMode: 'darkMode'
    },
    electionDeadline: '2026-05-15T00:00:00',
    colleges: [
        'Medicine & Health Sciences',
        'Law',
        'Business Administration',
        'Humanities & Social Sciences',
        'Engineering & Environmental Studies',
        'Biological & Physical Sciences',
        'Agricultural & Veterinary Medicine',
        'Education'
    ]
};

// Election Data Structure
const ELECTION_DATA = {
    levels: {
        SUG: 'University Wide (SUG)',
        COLLEGE: 'College Level'
    },
    positions: {
        SUG: [
            { id: 'president', title: 'Student Union President' },
            { id: 'vp', title: 'Vice President' },
            { id: 'gensec', title: 'General Secretary' },
            { id: 'finsec', title: 'Financial Secretary' },
            { id: 'pro', title: 'Public Relations Officer' }
        ],
        COLLEGE: [
            { id: 'college_rep', title: 'College Representative' },
            { id: 'college_sec', title: 'College Secretary' }
        ]
    }
};

// Base API URL
const API_URL = 'http://localhost:5005/api';

const UI = {
    /**
     * Show a toast notification
     */
    showToast: (message, type = 'info') => {
        const toast = document.createElement('div');
        const bgColor = {
            success: 'bg-emerald-500',
            error: 'bg-red-500',
            info: 'bg-primary'
        }[type] || 'bg-primary';
        
        toast.className = `fixed bottom-8 left-1/2 transform -translate-x-1/2 ${bgColor} text-white px-6 py-3 rounded-lg shadow-xl z-[9999] animate-fade-in flex items-center gap-2`;
        
        const icon = {
            success: 'check_circle',
            error: 'error',
            info: 'info'
        }[type] || 'info';
        
        toast.innerHTML = `<span class="material-symbols-outlined">${icon}</span> ${message}`;
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transition = 'opacity 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    },

    /**
     * Initialize Dark Mode
     */
    initDarkMode: () => {
        const isDark = localStorage.getItem(CONFIG.storageKeys.darkMode) === 'true';
        if (isDark) {
            document.documentElement.classList.add('dark');
        }
        
        const toggleBtn = document.getElementById('dark-mode-toggle');
        if (toggleBtn) {
            toggleBtn.addEventListener('click', () => {
                document.documentElement.classList.toggle('dark');
                localStorage.setItem(CONFIG.storageKeys.darkMode, document.documentElement.classList.contains('dark'));
            });
        }
    },

    /**
     * Update Countdown Timers
     */
    initCountdown: () => {
        const countdownElements = {
            days: document.querySelector('[data-countdown="days"]'),
            hours: document.querySelector('[data-countdown="hours"]'),
            minutes: document.querySelector('[data-countdown="minutes"]'),
            seconds: document.querySelector('[data-countdown="seconds"]')
        };

        if (!countdownElements.days) return;

        const update = () => {
            const now = new Date().getTime();
            const deadline = new Date(CONFIG.electionDeadline).getTime();
            const diff = deadline - now;

            if (diff <= 0) {
                Object.values(countdownElements).forEach(el => el.textContent = '00');
                return;
            }

            const d = Math.floor(diff / (1000 * 60 * 60 * 24));
            const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const s = Math.floor((diff % (1000 * 60)) / 1000);

            if (countdownElements.days) countdownElements.days.textContent = String(d).padStart(2, '0');
            if (countdownElements.hours) countdownElements.hours.textContent = String(h).padStart(2, '0');
            if (countdownElements.minutes) countdownElements.minutes.textContent = String(m).padStart(2, '0');
            if (countdownElements.seconds) countdownElements.seconds.textContent = String(s).padStart(2, '0');
        };

        update();
        setInterval(update, 1000);
    },

    /**
     * Handle Missing Images
     */
    handleMissingImages: () => {
        document.querySelectorAll('img').forEach(img => {
            img.onerror = function() {
                if (this.alt.includes('Logo')) {
                    // Create a text-based logo fallback
                    const div = document.createElement('div');
                    div.className = "flex items-center justify-center bg-primary text-white font-black rounded-lg h-10 w-10 text-xs";
                    div.textContent = "ABSU";
                    this.replaceWith(div);
                } else {
                    this.src = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(this.alt) + '&background=random';
                }
            };
        });
    }
};

// User Session Management
const Auth = {
    getUser: () => JSON.parse(sessionStorage.getItem(CONFIG.storageKeys.loggedInUser)),
    logout: () => {
        sessionStorage.removeItem(CONFIG.storageKeys.loggedInUser);
        window.location.href = 'index.html';
    },
    requireAuth: () => {
        if (!Auth.getUser()) window.location.href = 'login.html';
    }
};

const Data = {
    getAllCandidates: async () => {
        try {
            const res = await fetch(`${API_URL}/candidates`);
            if (!res.ok) throw new Error('Failed to fetch candidates');
            return await res.json();
        } catch (e) {
            console.error('Error fetching candidates:', e);
            return [];
        }
    },
    getCandidates: async (level, position, college = null) => {
        const all = await Data.getAllCandidates();
        return all.filter(c => {
            const levelMatch = c.level === level;
            const posMatch = c.position === position;
            const collegeMatch = level === 'SUG' || c.college === college;
            const activeMatch = c.status !== 'disqualified';
            return levelMatch && posMatch && collegeMatch && activeMatch;
        });
    },
    saveVote: async (user, votes) => {
        try {
            const res = await fetch(`${API_URL}/vote`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: user.name,
                    matricNo: user.matricNo,
                    votes: votes,
                    manualEntry: false,
                    college: user.college
                })
            });
            const data = await res.json();
            if (!res.ok) {
                alert(data.error || "Failed to submit vote");
                return false;
            }
            return true;
        } catch (e) {
            console.error('Error submitting vote:', e);
            alert("Network error: Could not reach the server.");
            return false;
        }
    }
};

// Initialize everything
document.addEventListener('DOMContentLoaded', () => {
    UI.initDarkMode();
    UI.initCountdown();
    UI.handleMissingImages();
    
    // Global Logout Button Listener
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', Auth.logout);
    }
    
    // Display User Info if on dashboard
    const userNameEl = document.getElementById('user-name');
    const userMatricEl = document.getElementById('user-matric');
    const user = Auth.getUser();
    
    if (user) {
        if (userNameEl) userNameEl.textContent = user.name;
        if (userMatricEl) userMatricEl.textContent = 'ID: ' + user.matricNo;
        
        // Also show college in UI if element exists
        const userCollegeEl = document.getElementById('user-college');
        if (userCollegeEl) userCollegeEl.textContent = user.college;
    }
});
