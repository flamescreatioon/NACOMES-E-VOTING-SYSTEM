// Vercel serverless entry-point: forwards every /api/* request to the Express app.
// Keeps all backend logic in one place (backend/index.js) — this file is just glue.
const app = require('../backend/index');

module.exports = (req, res) => app(req, res);
