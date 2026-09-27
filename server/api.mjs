// REST API for profiles, progress and high scores, stored in SQLite via Node's built-in node:sqlite.
// Used by the Vite dev server (vite.config.ts) and by server/server.mjs in production.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const MAX_NAME = 16;
const MAX_HIGHS = 10;
const MAX_BODY = 512 * 1024;

export function openDb(file) {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS profiles (
      id         INTEGER PRIMARY KEY,
      name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
      unlocked   INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      played_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS level_progress (
      profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      level_id   INTEGER NOT NULL,
      best_score INTEGER NOT NULL DEFAULT 0,
      stars      INTEGER NOT NULL DEFAULT 0,
      design     TEXT,
      PRIMARY KEY (profile_id, level_id)
    );
    CREATE TABLE IF NOT EXISTS scores (
      id         INTEGER PRIMARY KEY,
      profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      score      INTEGER NOT NULL,
      levels     INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS scores_by_score ON scores(score DESC);
  `);
  return db;
}

function cleanName(v) {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME) : '';
}

function int(v, lo, hi) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo;
}

export function createApi(db) {
  const q = {
    listProfiles: db.prepare(`
      SELECT p.id, p.name, p.unlocked, COALESCE(SUM(l.stars), 0) AS stars
      FROM profiles p LEFT JOIN level_progress l ON l.profile_id = p.id
      GROUP BY p.id ORDER BY p.played_at DESC`),
    findProfile: db.prepare('SELECT id, name, unlocked FROM profiles WHERE name = ?'),
    getProfile: db.prepare('SELECT id, name, unlocked FROM profiles WHERE id = ?'),
    insertProfile: db.prepare('INSERT INTO profiles (name) VALUES (?)'),
    touchProfile: db.prepare("UPDATE profiles SET played_at = datetime('now') WHERE id = ?"),
    starsFor: db.prepare('SELECT COALESCE(SUM(stars), 0) AS stars FROM level_progress WHERE profile_id = ?'),
    levels: db.prepare('SELECT level_id, best_score, stars, design FROM level_progress WHERE profile_id = ?'),
    setUnlocked: db.prepare('UPDATE profiles SET unlocked = MAX(unlocked, ?) WHERE id = ?'),
    upsertLevel: db.prepare(`
      INSERT INTO level_progress (profile_id, level_id, best_score, stars, design) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (profile_id, level_id) DO UPDATE SET
        best_score = MAX(best_score, excluded.best_score),
        stars      = MAX(stars, excluded.stars),
        design     = COALESCE(excluded.design, design)`),
    topScores: db.prepare(`
      SELECT s.id, p.name, s.score, s.levels, substr(s.created_at, 1, 10) AS date
      FROM scores s JOIN profiles p ON p.id = s.profile_id
      ORDER BY s.score DESC, s.id ASC LIMIT ${MAX_HIGHS}`),
    insertScore: db.prepare('INSERT INTO scores (profile_id, score, levels) VALUES (?, ?, ?)'),
  };

  const profileOut = (p) => ({ id: String(p.id), name: p.name, unlocked: p.unlocked, stars: q.starsFor.get(p.id).stars });

  const routes = [
    ['GET', /^health$/, () => ({ ok: true, storage: 'sqlite' })],
    ['GET', /^profiles$/, () => q.listProfiles.all().map((p) => Object.assign(p, { id: String(p.id) }))],
    [
      'POST',
      /^profiles$/,
      (_m, body) => {
        const name = cleanName(body?.name);
        if (!name) throw httpError(400, 'Enter a name');
        let p = q.findProfile.get(name);
        if (!p) p = q.getProfile.get(q.insertProfile.run(name).lastInsertRowid);
        q.touchProfile.run(p.id);
        return profileOut(p);
      },
    ],
    [
      'GET',
      /^profiles\/(\d+)\/progress$/,
      (m) => {
        const p = mustProfile(q, m[1]);
        const best = {};
        const designs = {};
        for (const l of q.levels.all(p.id)) {
          if (l.best_score > 0 || l.stars > 0) best[l.level_id] = { score: l.best_score, stars: l.stars };
          if (l.design) designs[l.level_id] = l.design;
        }
        return { unlocked: p.unlocked, best, designs };
      },
    ],
    [
      'PUT',
      /^profiles\/(\d+)\/progress$/,
      (m, body) => {
        const p = mustProfile(q, m[1]);
        const best = body?.best ?? {};
        const designs = body?.designs ?? {};
        const ids = new Set([...Object.keys(best), ...Object.keys(designs)]);
        db.exec('BEGIN');
        try {
          q.setUnlocked.run(int(body?.unlocked, 1, 99), p.id);
          for (const id of ids) {
            const b = best[id] ?? {};
            const design = typeof designs[id] === 'string' ? designs[id].slice(0, 64 * 1024) : null;
            q.upsertLevel.run(p.id, int(id, 1, 99), int(b.score, 0, 1e7), int(b.stars, 0, 3), design);
          }
          q.touchProfile.run(p.id);
          db.exec('COMMIT');
        } catch (e) {
          db.exec('ROLLBACK');
          throw e;
        }
        return { ok: true };
      },
    ],
    ['GET', /^scores$/, () => q.topScores.all().map(({ id: _id, ...s }) => s)],
    [
      'POST',
      /^scores$/,
      (_m, body) => {
        const p = mustProfile(q, body?.profileId);
        const score = int(body?.score, 0, 1e7);
        if (score <= 0) return { rank: -1 };
        const id = Number(q.insertScore.run(p.id, score, int(body?.levels, 0, 99)).lastInsertRowid);
        const rank = q.topScores.all().findIndex((s) => s.id === id);
        return { rank };
      },
    ],
  ];

  /** Connect-style middleware: handles /api/*, passes everything else to next(). */
  return async function api(req, res, next) {
    const url = new URL(req.url ?? '/', 'http://x');
    const at = url.pathname.indexOf('/api/');
    if (at < 0) return next?.();
    const path = url.pathname.slice(at + 5).replace(/\/+$/, '');
    const route = routes.find(([method, re]) => method === req.method && re.test(path));
    try {
      if (!route) throw httpError(404, 'Not found');
      const body = req.method === 'POST' || req.method === 'PUT' ? await readJson(req) : undefined;
      send(res, 200, route[2](path.match(route[1]), body));
    } catch (e) {
      send(res, e.status ?? 500, { error: e.status ? e.message : 'Server error' });
      if (!e.status) console.error(e);
    }
  };
}

function mustProfile(q, id) {
  const p = q.getProfile.get(int(id, 0, Number.MAX_SAFE_INTEGER));
  if (!p) throw httpError(404, 'Unknown profile');
  return p;
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(httpError(413, 'Too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(httpError(400, 'Bad JSON'));
      }
    });
    req.on('error', reject);
  });
}
