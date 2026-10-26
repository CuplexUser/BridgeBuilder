// The share service: keeps shared bridges under short codes, and answers the short links with a
// page that link previews can read and that sends players on to the game.
//
//   PUT /api/bridges/<code>         a bridge, as the game's link payload; <code> must be its hash
//   PUT /api/bridges/<code>/image   its preview picture: a 1200×675 JPEG
//   GET /api/bridges/<code>         the bridge, for the game to open
//   GET /<code>                     the preview page, which goes on to the game
//   GET /<code>.jpg                 the preview picture
//
// A bridge's code is its own hash (see shortCode), so a code always means the same bridge: nothing
// can be stored under another bridge's code, and sharing one bridge twice stores it once. What's
// stored is never changed or deleted by the service.

const MAX_BRIDGE = 64 * 1024;
const MAX_IMAGE = 1024 * 1024;
const IMAGE_W = 1200;
const IMAGE_H = 675;
const MAX_NAME = 40;
const MAX_TEXT = 120;
/** What one address may store in RATE_WINDOW: bridges and pictures together. */
const RATE_MAX = 40;
const RATE_WINDOW = 10 * 60 * 1000;
const CODE = /^[0-9A-Za-z]{8}$/;
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const FOREVER = 'public, max-age=31536000, immutable';

/** A bridge's code: 8 characters of base 62 from the SHA-256 of its bytes. The game works it out the same way. */
export async function shortCode(bytes) {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let n = 0n;
  for (let i = 0; i < 6; i++) n = (n << 8n) | BigInt(hash[i]);
  let s = '';
  for (let i = 0; i < 8; i++) {
    s = ALPHABET[Number(n % 62n)] + s;
    n /= 62n;
  }
  return s;
}

/**
 * The request handler. `store` keeps the files: get(key) gives a Buffer or null, create(key,
 * data, type) stores one unless the key is taken and says whether it did.
 */
export function createHandler({ store, gameOrigin, publicOrigin, now = Date.now }) {
  const allowed = rateLimit(RATE_MAX, RATE_WINDOW, now);

  return async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://x');
      const parts = url.pathname.split('/').filter(Boolean);
      if (parts[0] === 'api') return await api(req, res, parts.slice(1));
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
      if (parts.length === 0) return redirect(res, gameOrigin);
      // Not /healthz: Cloud Run keeps paths that end in z for itself.
      if (parts.length === 1 && parts[0] === 'health') return send(res, 200, 'ok');
      const pic = /^([0-9A-Za-z]{8})\.jpg$/.exec(parts[0] ?? '');
      if (parts.length === 1 && pic) return await picture(res, pic[1]);
      if (parts.length === 1 && CODE.test(parts[0])) return await page(res, parts[0]);
      return send(res, 404, 'Not found');
    } catch (e) {
      console.error(e);
      if (!res.headersSent) send(res, 500, 'Something went wrong');
      else res.end();
    }
  };

  async function api(req, res, parts) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Max-Age', '86400');
      return send(res, 204);
    }
    const [what, code, sub] = parts;
    if (what !== 'bridges' || !CODE.test(code ?? '') || parts.length > 3 || (sub !== undefined && sub !== 'image')) return send(res, 404, 'Not found');
    if (req.method === 'GET' && !sub) {
      const data = await store.get(bridgeKey(code));
      if (!data) return send(res, 404, 'No such bridge');
      return send(res, 200, data, 'application/json', FOREVER);
    }
    if (req.method !== 'PUT') return send(res, 405, 'Method not allowed');
    if (!allowed(clientIp(req))) return send(res, 429, 'Too many shares, try again in a few minutes');
    return sub ? putImage(req, res, code) : putBridge(req, res, code);
  }

  async function putBridge(req, res, code) {
    const body = await readBody(req, MAX_BRIDGE);
    if (!body) return send(res, 413, 'Too large');
    if ((await shortCode(body)) !== code) return send(res, 400, 'The code is not this bridge’s');
    let o;
    try {
      o = JSON.parse(body.toString('utf8'));
    } catch {
      return send(res, 400, 'Not JSON');
    }
    if (!isBridge(o)) return send(res, 400, 'Not a bridge');
    if (await store.create(bridgeKey(code), body, 'application/json')) return json(res, 201, { code });
    // Taken: the same bridge shared before, or, very rarely, another with the same code.
    const was = await store.get(bridgeKey(code));
    return was?.equals(body) ? json(res, 200, { code }) : send(res, 409, 'Another bridge has this code');
  }

  async function putImage(req, res, code) {
    if (!(await store.get(bridgeKey(code)))) return send(res, 404, 'No such bridge');
    const body = await readBody(req, MAX_IMAGE);
    if (!body) return send(res, 413, 'Too large');
    const size = jpegSize(body);
    if (!size || size.w !== IMAGE_W || size.h !== IMAGE_H) return send(res, 400, `Not a ${IMAGE_W}×${IMAGE_H} JPEG`);
    // The first picture stays: a bridge shared again keeps the one its link was first seen with.
    const made = await store.create(imageKey(code), body, 'image/jpeg');
    return send(res, made ? 201 : 200);
  }

  async function picture(res, code) {
    const data = await store.get(imageKey(code));
    if (!data) return send(res, 404, 'No picture', 'text/plain; charset=utf-8', 'no-store');
    return send(res, 200, data, 'image/jpeg', FOREVER);
  }

  async function page(res, code) {
    const data = await store.get(bridgeKey(code));
    if (!data) return send(res, 404, notFoundPage(gameOrigin), 'text/html; charset=utf-8', 'no-store');
    const o = JSON.parse(data.toString('utf8'));
    return send(res, 200, previewPage(o, code, gameOrigin, publicOrigin), 'text/html; charset=utf-8', 'public, max-age=3600');
  }
}

/** Where a bridge and its picture are kept. */
const bridgeKey = (code) => `bridges/${code}.json`;
const imageKey = (code) => `images/${code}.jpg`;

/**
 * What the game puts in a link: a version, a level id, who built it, the design, a custom level
 * when it's on one, and the preview's words. The game checks it all again when it opens one.
 */
function isBridge(o) {
  return (
    isObj(o) &&
    o.v === 1 &&
    Number.isInteger(o.l) &&
    o.l >= 0 &&
    isText(o.n, MAX_NAME) &&
    isObj(o.d) &&
    Array.isArray(o.d.n) &&
    Array.isArray(o.d.m) &&
    (o.c === undefined || isObj(o.c)) &&
    (o.p === undefined || (isObj(o.p) && isText(o.p.title, MAX_TEXT) && isText(o.p.line, MAX_TEXT) && isText(o.p.by, MAX_TEXT)))
  );
}

/** Left out, or a string no longer than `max`. */
function isText(v, max) {
  return v === undefined || (typeof v === 'string' && v.length <= max);
}

function isObj(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** A JPEG's width and height, from its first frame header; null if it isn't a JPEG. */
export function jpegSize(b) {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return null;
    const marker = b[i + 1];
    const len = b.readUInt16BE(i + 2);
    // Start of frame: baseline, extended or progressive.
    if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

/** The page a short link opens: preview tags for chat apps, then on to the game. */
function previewPage(o, code, gameOrigin, publicOrigin) {
  const p = isObj(o.p) ? o.p : {};
  const title = p.title ? `${p.title} · Bridge Builder` : 'A bridge in Bridge Builder';
  const desc = [p.line, p.by].filter(Boolean).join(' · ');
  const target = `${gameOrigin}/?s=${code}`;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta property="og:type" content="website">
<meta property="og:site_name" content="Bridge Builder">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(`${publicOrigin}/${code}`)}">
<meta property="og:image" content="${esc(`${publicOrigin}/${code}.jpg`)}">
<meta property="og:image:width" content="${IMAGE_W}">
<meta property="og:image:height" content="${IMAGE_H}">
<meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0; url=${esc(target)}">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1d38;color:#e9f3ff;font:16px system-ui,sans-serif}a{color:#6cc6ff}</style>
</head>
<body>
<p><a href="${esc(target)}">Open the bridge in Bridge Builder</a></p>
<script>location.replace(${JSON.stringify(target)})</script>
</body>
</html>
`;
}

function notFoundPage(gameOrigin) {
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Bridge Builder</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1d38;color:#e9f3ff;font:16px system-ui,sans-serif;text-align:center}a{color:#6cc6ff}</style></head>
<body><p>This link holds no bridge.<br><a href="${esc(gameOrigin)}">Play Bridge Builder</a></p></body>
</html>
`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Whoever asked: the first address Firebase Hosting and Cloud Run forward. */
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
  return first || req.socket?.remoteAddress || '?';
}

/** At most `max` writes per address in each `window` ms, counted on this instance. */
function rateLimit(max, window, now) {
  const seen = new Map();
  return (key) => {
    const t = now();
    if (seen.size > 10_000) for (const [k, ts] of seen) if (ts.at(-1) <= t - window) seen.delete(k);
    const ts = (seen.get(key) ?? []).filter((x) => x > t - window);
    if (ts.length >= max) return false;
    ts.push(t);
    seen.set(key, ts);
    return true;
  };
}

/** The request's body, or null once it runs past `max` bytes. */
async function readBody(req, max) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function send(res, status, body = '', type = 'text/plain; charset=utf-8', cache = 'no-store') {
  res.statusCode = status;
  res.setHeader('Cache-Control', cache);
  if (body !== '') res.setHeader('Content-Type', type);
  res.end(body);
}

function json(res, status, o) {
  send(res, status, JSON.stringify(o), 'application/json');
}

function redirect(res, to) {
  res.statusCode = 302;
  res.setHeader('Location', to);
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.end();
}
