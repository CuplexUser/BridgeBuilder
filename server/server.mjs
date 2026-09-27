// Production server: serves the built game from dist/ and the SQLite-backed API.
//   npm run build && npm start        → http://localhost:3000
// Env: PORT (default 3000), DB_FILE (default data/bridgebuilder.db)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi, openDb } from './api.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const dist = join(root, 'dist');
const port = Number(process.env.PORT) || 3000;
const dbFile = process.env.DB_FILE || join(root, 'data', 'bridgebuilder.db');
const api = createApi(openDb(dbFile));

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

async function serveStatic(req, res) {
  const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
  let file = normalize(join(dist, pathname));
  if (!file.startsWith(dist)) {
    res.statusCode = 403;
    return res.end();
  }
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
    if (file.includes(`${join('dist', 'assets')}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.end(body);
  } catch {
    res.statusCode = 404;
    res.end('Not found');
  }
}

createServer((req, res) => api(req, res, () => serveStatic(req, res))).listen(port, () => {
  console.log(`Bridge Builder on http://localhost:${port}  (database: ${dbFile})`);
});
