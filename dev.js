const { spawn } = require('child_process');
const path = require('path');

// Start backend server natively
const server = spawn(process.execPath, ['backend/index.js'], { stdio: 'inherit' });

// Start frontend server (browser-sync) natively
const browserSyncPath = path.resolve(__dirname, 'node_modules', 'browser-sync', 'dist', 'bin.js');
const client = spawn(process.execPath, [browserSyncPath, 'start', '--server', 'public', '--files', 'public', '--port', '3000', '--no-open'], { stdio: 'inherit' });

process.on('SIGINT', () => {
  server.kill('SIGINT');
  client.kill('SIGINT');
  process.exit();
});

process.on('SIGTERM', () => {
  server.kill('SIGTERM');
  client.kill('SIGTERM');
  process.exit();
});
