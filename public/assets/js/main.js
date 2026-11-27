// Vercel Web Analytics (active on Vercel deployments; skipped on localhost)
(function () {
    if (typeof window === 'undefined') return;
    if (/^(localhost|127\.0\.0\.1)$/i.test(window.location.hostname)) return;
    window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
    if (!document.querySelector('script[src="/_vercel/insights/script.js"]')) {
        const s = document.createElement('script');
        s.defer = true;
        s.src = '/_vercel/insights/script.js';
        document.head.appendChild(s);
    }
})();

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
window.escapeHtml = escapeHtml;

/**
 * MOUAU Election Portal 2026 (mouau.edu.ng) - Main JavaScript
 * Shared functionality across all pages
 */

// Global fetch interceptor to attach Authorization header automatically for all backend API calls
(function () {
    const originalFetch = window.fetch;
    window.fetch = async function (input, init) {
        const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : '');

        // Intercept calls going to our backend API
        if (url.includes('/api/') || url.includes(':5005')) {
            init = init || {};
            init.headers = init.headers || {};

            // Retrieve token from sessionStorage
            const token = sessionStorage.getItem('authToken');

            if (token) {
                if (init.headers instanceof Headers) {
                    init.headers.set('Authorization', `Bearer ${token}`);
                } else if (Array.isArray(init.headers)) {
                    const hasAuth = init.headers.some(h => h[0].toLowerCase() === 'authorization');
                    if (!hasAuth) {
                        init.headers.push(['Authorization', `Bearer ${token}`]);
                    }
                } else {
                    if (!init.headers['Authorization'] && !init.headers['authorization']) {
                        init.headers['Authorization'] = `Bearer ${token}`;
                    }
                }
            }
        }
        return originalFetch.call(this, input, init);
    };
})();

const MOUAU_COLLEGES_MAP = [
    {
        code: 'CEET',
        name: 'College of Engineering and Engineering Technology (CEET)',
        depts: [
            'Computer Engineering'
        ]
    }
];

const CONFIG = {
    appName: 'NACOME Election Portal • MOUAU',
    department: 'Computer Engineering',
    college: 'College of Engineering and Engineering Technology (CEET)',
    university: 'Michael Okpara University of Agriculture, Umudike (MOUAU)',
    storageKeys: {
        loggedInUser: 'loggedInUser',
        allVotes: 'allVotes',
        hasVoted: 'hasVoted',
        darkMode: 'darkMode',
        authToken: 'authToken'
    },
    electionDeadline: '2026-05-15T00:00:00',
    collegesMap: MOUAU_COLLEGES_MAP,
    colleges: MOUAU_COLLEGES_MAP.map(c => c.name)
};

// NACOME Election Data Structure (Computer Engineering Dept, CEET, MOUAU)
const NACOME_POSITIONS = [
    { id: 'president', title: 'NACOME President' },
    { id: 'vice-president', title: 'Vice-President' },
    { id: 'secretary-general', title: 'Secretary-General' },
    { id: 'assistant-secretary-general', title: 'Assistant Secretary-General' },
    { id: 'treasurer', title: 'Treasurer' },
    { id: 'financial-secretary', title: 'Financial Secretary' },
    { id: 'pro', title: 'Public Relations Officer (PRO)' },
    { id: 'director-of-welfare', title: 'Director of Welfare' },
    { id: 'director-of-sports', title: 'Director of Sports' },
    { id: 'director-of-socials', title: 'Director of Socials' },
    { id: 'technical-director', title: 'Technical & Academic Director' }
];

const ELECTION_DATA = {
    levels: {
        DEPARTMENT: 'NACOME (Computer Engineering, CEET • MOUAU)'
    },
    positions: {
        SUG: NACOME_POSITIONS,
        COLLEGE: [],
        DEPARTMENT: NACOME_POSITIONS
    }
};

// Base API URL — provided by assets/js/api-config.js (same-origin '/api').
// `var` (not const): api-config.js already declares it; var re-declaring is legal.
var API_URL = (typeof window !== 'undefined' && window.API_URL) || '/api';

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
    initCountdown: async () => {
        const countdownElements = {
            days: document.querySelector('[data-countdown="days"]'),
            hours: document.querySelector('[data-countdown="hours"]'),
            minutes: document.querySelector('[data-countdown="minutes"]'),
            seconds: document.querySelector('[data-countdown="seconds"]')
        };

        if (!countdownElements.days) return;

        let deadlineStr = CONFIG.electionDeadline;
        let startTimeStr = '';
        const loadSettings = async () => {
            try {
                const res = await fetch(`${API_URL}/settings`, { cache: 'no-store' });
                if (res.ok) {
                    const settings = await res.json();
                    if (settings.election_deadline) {
                        deadlineStr = settings.election_deadline;
                    }
                    startTimeStr = settings.election_start_time || '';
                }
            } catch (e) {
                console.error('Failed to load custom election deadline settings:', e);
            }
        };
        await loadSettings();
        setInterval(loadSettings, 15000);

        const labelEl = document.querySelector('[data-countdown-label]');

        const update = () => {
            const now = new Date().getTime();
            const startMs = startTimeStr ? new Date(startTimeStr).getTime() : NaN;
            const deadline = new Date(deadlineStr).getTime();

            let target = deadline;
            if (!Number.isNaN(startMs) && now < startMs) {
                target = startMs;
                if (labelEl) labelEl.textContent = 'Voting Starts In';
            } else if (!Number.isNaN(deadline) && now <= deadline) {
                target = deadline;
                if (labelEl) labelEl.textContent = 'Voting Closes In';
            } else {
                if (labelEl) labelEl.textContent = 'Voting Closed';
                Object.values(countdownElements).forEach(el => el.textContent = '00');
                return;
            }

            const diff = target - now;

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
            img.onerror = function () {
                if (this.alt.includes('Logo')) {
                    if (!this.src.includes('mouau-logo.svg')) {
                        this.src = 'assets/images/mouau-logo.svg';
                        return;
                    }
                    // Create a text-based logo fallback
                    const div = document.createElement('div');
                    div.className = "flex items-center justify-center bg-primary text-white font-black rounded-lg h-10 px-2 text-xs";
                    div.textContent = "MOUAU";
                    this.replaceWith(div);
                } else if (this.dataset && this.dataset.fallback) {
                    const fallback = this.dataset.fallback;
                    delete this.dataset.fallback;
                    this.src = fallback;
                } else {
                    this.src = 'https://ui-avatars.com/api/?name=' + encodeURIComponent(this.alt) + '&background=0b6623&color=fff';
                }
            };
        });
    },

    /**
     * Initialize Responsive Mobile Navigation (Drawer + Bottom Tab Bar)
     */
    initMobileNav: () => {
        const header = document.querySelector('header');
        if (!header || window.location.pathname.includes('admin') || window.location.pathname.includes('student-db')) return;

        const desktopNav = header.querySelector('nav');
        const headerRow = desktopNav ? desktopNav.parentElement : header.querySelector('.flex');
        if (!desktopNav || !headerRow) return;

        const currentPage = window.location.pathname.split('/').pop() || 'index.html';
        const navLinks = Array.from(desktopNav.querySelectorAll('a'))
            .filter(a => a.getAttribute('href') && a.getAttribute('href') !== '#')
            .map(a => ({ href: a.getAttribute('href'), label: a.textContent.trim() }));

        // Inject hamburger button into the right-hand actions container
        const actionsContainer = headerRow.lastElementChild;
        const menuBtn = document.createElement('button');
        menuBtn.type = 'button';
        menuBtn.id = 'mobile-menu-toggle';
        menuBtn.setAttribute('aria-label', 'Toggle navigation menu');
        menuBtn.setAttribute('aria-expanded', 'false');
        menuBtn.className = 'md:hidden inline-flex items-center justify-center size-10 rounded-xl text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors';
        menuBtn.innerHTML = '<span class="material-symbols-outlined text-2xl">menu</span>';

        if (actionsContainer && actionsContainer !== desktopNav) {
            actionsContainer.appendChild(menuBtn);
        } else {
            headerRow.appendChild(menuBtn);
        }

        // Create slide-down mobile drawer
        const drawer = document.createElement('div');
        drawer.id = 'mobile-nav-drawer';
        drawer.className = 'hidden md:hidden border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 space-y-1 shadow-lg';

        const linkHtml = navLinks.map(item => {
            const isActive = currentPage === item.href;
            return `<a href="${item.href}" class="flex items-center justify-between px-4 py-3 rounded-xl text-sm font-semibold transition-colors ${
                isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
            }"><span>${item.label}</span>${isActive ? '<span class="size-2 rounded-full bg-primary"></span>' : ''}</a>`;
        }).join('');

        const isLoggedIn = Boolean(Auth.getUser() && Auth.getToken());
        const quickAction = isLoggedIn
            ? `<a href="dashboard.html" class="flex items-center justify-center gap-2 mt-2 bg-primary text-white px-4 py-3 rounded-xl text-sm font-bold shadow-sm">
                   <span class="material-symbols-outlined text-lg">how_to_vote</span> Voting Dashboard
               </a>`
            : `<div class="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 mt-2">
                   <a href="login.html" class="flex items-center justify-center gap-1.5 bg-primary text-white px-3 py-3 rounded-xl text-sm font-bold">
                       <span class="material-symbols-outlined text-lg">login</span> Login
                   </a>
                   <a href="register.html" class="flex items-center justify-center gap-1.5 bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 px-3 py-3 rounded-xl text-sm font-bold">
                       <span class="material-symbols-outlined text-lg">person_add</span> Sign Up
                   </a>
               </div>`;

        drawer.innerHTML = linkHtml + quickAction;
        header.appendChild(drawer);

        const toggleMenu = (forceOpen) => {
            const open = typeof forceOpen === 'boolean' ? forceOpen : drawer.classList.contains('hidden');
            drawer.classList.toggle('hidden', !open);
            menuBtn.setAttribute('aria-expanded', String(open));
            menuBtn.innerHTML = `<span class="material-symbols-outlined text-2xl">${open ? 'close' : 'menu'}</span>`;
        };

        menuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleMenu();
        });

        document.addEventListener('click', (e) => {
            if (!drawer.classList.contains('hidden') && !header.contains(e.target)) {
                toggleMenu(false);
            }
        });

        // Add thumb-friendly mobile bottom tab bar on pages without a fixed footer
        const hasFixedFooter = Boolean(document.querySelector('footer.fixed'));
        if (!hasFixedFooter) {
            document.body.classList.add('pb-20', 'md:pb-0');
            const bottomBar = document.createElement('nav');
            bottomBar.setAttribute('aria-label', 'Mobile quick navigation');
            bottomBar.className = 'md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 px-2 py-1.5 flex items-center justify-around shadow-[0_-4px_20px_rgba(0,0,0,0.06)]';

            const tabs = [
                { href: 'index.html', icon: 'home', label: 'Home' },
                { href: 'candidates.html', icon: 'groups', label: 'Candidates' },
                { href: isLoggedIn ? 'dashboard.html' : 'login.html', icon: 'how_to_vote', label: isLoggedIn ? 'Vote' : 'Login' },
                { href: 'results.html', icon: 'leaderboard', label: 'Results' }
            ];

            bottomBar.innerHTML = tabs.map(t => {
                const active = currentPage === t.href;
                return `<a href="${t.href}" class="flex flex-col items-center justify-center py-1 px-3 rounded-xl min-w-[64px] transition-colors ${
                    active ? 'text-primary font-bold' : 'text-slate-500 dark:text-slate-400 hover:text-primary'
                }">
                    <span class="material-symbols-outlined text-[22px]">${t.icon}</span>
                    <span class="text-[11px] mt-0.5">${t.label}</span>
                </a>`;
            }).join('');

            document.body.appendChild(bottomBar);
        }
    }
};

// User Session Management
const Auth = {
    getUser: () => JSON.parse(sessionStorage.getItem(CONFIG.storageKeys.loggedInUser)),
    getToken: () => sessionStorage.getItem(CONFIG.storageKeys.authToken),
    logout: () => {
        sessionStorage.removeItem(CONFIG.storageKeys.loggedInUser);
        sessionStorage.removeItem(CONFIG.storageKeys.authToken);
        window.location.href = 'index.html';
    },
    requireAuth: () => {
        if (!Auth.getUser() || !Auth.getToken()) window.location.href = 'login.html';
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
    getCandidates: async (level, position, college = null, dept = null) => {
        const all = await Data.getAllCandidates();
        return all.filter(c => {
            const levelMatch = c.level === level;
            const posMatch = c.position === position;
            const collegeMatch = level !== 'COLLEGE' || c.college === college;
            const deptMatch = level !== 'DEPARTMENT' || c.dept === dept;
            const activeMatch = c.status !== 'disqualified';
            return levelMatch && posMatch && collegeMatch && deptMatch && activeMatch;
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
                    college: user.college,
                    dept: user.dept
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
    UI.initMobileNav();
    UI.initCountdown();
    UI.handleMissingImages();

    // Global Logout Button Listener
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn && !window.location.pathname.includes('admin') && !window.location.pathname.includes('student-db')) {
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

    // Load background motion effect
    const bgScript = document.createElement('script');
    bgScript.src = 'assets/js/bg-motion.js';
    bgScript.defer = true;
    document.head.appendChild(bgScript);
});
