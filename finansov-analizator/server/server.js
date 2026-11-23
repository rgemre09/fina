/**
 * server.js – входна точка на приложението.
 *
 * Стартиране:  npm start   (или F5 във VS Code)
 * После отвори: http://localhost:3000
 *
 * Сървърът:
 *  1. обработва заявките към /api/... чрез нашия рутер;
 *  2. връща статичните файлове (HTML, CSS, JS) от папка public/.
 */

// Проверка на версията: node:sqlite е вграден без флагове от Node.js 22.13.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`\n  ✖ Нужен е Node.js 22.13 или по-нов (имате ${process.version}). Изтеглете от https://nodejs.org\n`);
  process.exit(1);
}

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const { Router, sendJson } = require('./lib/router');
const { get } = require('./db');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// ---------- Маршрути ----------
const router = new Router();
require('./routes/auth')(router);
require('./routes/transactions')(router);
require('./routes/recurring')(router);
require('./routes/planning')(router);
require('./routes/analytics')(router);

// ---------- Статични файлове ----------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let filePath = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(url.pathname)));
  // Защита: не позволяваме излизане извън папка public (напр. /../server/db.js).
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end('Забранено');
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) filePath = path.join(filePath, 'index.html');
  if (!fs.existsSync(filePath)) {
    // Непознат път → връщаме началната страница (SPA).
    filePath = path.join(PUBLIC_DIR, 'index.html');
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  fs.createReadStream(filePath).pipe(res);
}

// ---------- Сървър ----------
const server = http.createServer(async (req, res) => {
  // Основни заглавки за сигурност
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');

  const handled = await router.handle(req, res);
  if (handled) return;
  if (req.url.startsWith('/api/')) return sendJson(res, 404, { error: 'Няма такъв адрес' });
  serveStatic(req, res);
});

// При първо стартиране създаваме демо профил с данни за една година.
if (!get('SELECT id FROM users LIMIT 1')) {
  require('./seed').seed();
}

if (require.main === module) {
  server.listen(PORT, () => {
    console.log('\n  💶 Умен финансов анализатор');
    console.log(`  ➜ Отвори: http://localhost:${PORT}`);
    console.log('  ➜ Демо профил: demo / demo1234\n');
  });
}

module.exports = { server };
