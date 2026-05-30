# ABSU Election Portal 2026

![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

A modern, secure, and user-friendly web-based election portal for ABSU Student Union Government Elections.

## Features

- **Student Authentication** - Secure login with matriculation number and password
- **Student Registration** - New student account creation with profile management
- **Candidate Registration** - Students can register as candidates for various positions
- **Voting Dashboard** - Clean, card-based UI for casting votes
- **Live Results** - Real-time election results with vote counting algorithm
- **Responsive Design** - Works on desktop, tablet, and mobile devices

## Available Positions

- President
- Vice President
- General Secretary
- Financial Secretary
- Public Relations Officer (PRO)

## Tech Stack

- **HTML5** - Semantic markup
- **Tailwind CSS** - Utility-first CSS framework (via CDN)
- **JavaScript (ES6+)** - Client-side interactivity
- **Google Fonts** - Lexend font family
- **Material Symbols** - Icon library

## Project Structure

```
election-portal/
├── public/
│   ├── index.html              # Homepage (election landing page)
│   ├── login.html              # Student login page
│   ├── register.html           # Student registration page
│   ├── dashboard.html          # Voting dashboard
│   ├── candidates.html         # View all candidates
│   ├── candidate-register.html # Candidate registration form
│   ├── results.html            # Live election results
│   └── assets/
│       ├── css/
│       │   └── styles.css      # Custom styles (optional)
│       ├── js/
│       │   └── main.js         # Shared JavaScript (optional)
│       └── images/
│           └── absu-logo.png   # Official ABSU university logo
├── package.json
├── README.md
├── .gitignore
└── yarn.lock / package-lock.json
```

## Prerequisites

- [Node.js](https://nodejs.org/) (v16 or higher)
- npm (comes with Node.js) or [Yarn](https://yarnpkg.com/)

## Installation

### Using npm

```bash
# Clone the repository
git clone <repository-url>
cd election-portal

# Install dependencies
npm install

# Start development server
npm run dev
```

### Using Yarn

```bash
# Clone the repository
git clone <repository-url>
cd election-portal

# Install dependencies
yarn install

# Start development server
yarn dev
```

The application will open automatically at `http://localhost:3000`

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` / `yarn dev` | Start development server with live reload |
| `npm start` / `yarn start` | Start server without auto-opening browser |
| `npm run build` / `yarn build` | Copy assets to dist folder |
| `npm run clean` / `yarn clean` | Remove dist folder |

## Test Accounts

For testing purposes, use these pre-configured accounts:

| Name | Matric Number | Password |
|------|---------------|----------|
| John Doe | U2024/1234567 | test123 |
| Jane Smith | U2023/7654321 | student |

## Data Storage

This demo uses browser storage for data persistence:

- **sessionStorage** - User login session
- **localStorage** - Votes and candidate registrations

> **Note:** In a production environment, this would be replaced with a proper backend database.

## Voting Algorithm

The results page implements a vote counting algorithm that:

1. Collects all votes from localStorage
2. Counts votes per candidate per position
3. Sorts candidates by vote count (1st to last place)
4. Calculates percentage share for each candidate
5. Displays winner with visual indicators
6. Auto-refreshes results every 10 seconds

## Browser Support

- Chrome (recommended)
- Firefox
- Safari
- Edge

## Security Features (Demo)

- Session-based authentication
- One vote per student (enforced client-side)
- "Secure Session Active" indicator
- End-to-end encryption badge (visual only in demo)

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## Roadmap

- [ ] Backend API integration
- [ ] Real authentication system
- [ ] Admin dashboard
- [ ] Email verification
- [ ] Vote encryption
- [ ] Result export (PDF/Excel)
- [ ] Dark mode toggle

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Contact

University Election Commission - election@university.edu.ng

Project Link: [https://github.com/university/election-portal](https://github.com/university/election-portal)

---

**Made with ❤️ for Student Democracy**
