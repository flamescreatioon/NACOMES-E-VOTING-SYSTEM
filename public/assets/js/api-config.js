/**
 * Single source of truth for the backend API base URL.
 * MUST load before main.js and before any page inline script.
 * Usage in pages: <script src="assets/js/api-config.js"></script>
 *
 * Same-origin by default ('/api') — works on Vercel, Render, or any static host
 * serving the backend alongside. Override order:
 *   1. <meta name="api-base" content="https://api.example.com/api">
 *   2. window.__API_BASE__ (set before this script loads)
 *   3. '/api' (same-origin — correct for Vercel deployments)
 *
 * Deliberately `var` (not const): re-declarable, so legacy pages that still
 * declare their own API_URL/API_BASE keep working instead of throwing
 * "Identifier has already been declared".
 */
var API_URL = (function () {
  var meta = document.querySelector('meta[name="api-base"]');
  var base = (meta && meta.content) || window.__API_BASE__ || '/api';
  return String(base).replace(/\/+$/, '');
})();
var API_BASE = API_URL;
window.API_URL = API_URL;
window.API_BASE = API_BASE;
