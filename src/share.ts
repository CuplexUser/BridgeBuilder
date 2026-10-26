/**
 * Shared bridges: a link that carries a level, a design and who built it, so whoever opens it
 * watches that bridge drive in their own game. The short link, `b.cuplex.org/<code>`, is a bridge
 * stored by the share service (share-service/), whose code is the bridge's own hash, so the game
 * knows it before the bridge is stored. The long link carries everything itself, compressed, for
 * when the service can't be reached; a custom level travels whole in either. The design keeps its
 * save format version, so an old link still loads into a changed level the way a saved design does.
 */

/** Where links point: the web game, and the host the Android app opens links for. */
export const SHARE_ORIGIN = 'https://bridgebuilder.cuplex.org';
/** The share service: short links, and the stored bridges behind them. */
export const SHARE_SERVICE: string = import.meta.env.VITE_SHARE_SERVICE || 'https://b.cuplex.org';
/** The query parameter that holds a whole bridge, and the one that holds a short code. */
const PARAM = 'b';
const SHORT_PARAM = 's';
/** The link format's version, first in the payload. */
const VERSION = 1;
const CODE = /^[0-9A-Za-z]{8}$/;
const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
/** Longest a preview text may be, as the service takes it. */
const MAX_TEXT = 120;

export interface SharedBridge {
  /** A built-in level's id; for a custom level, its id on the sharer's side. */
  level: number;
  /** A custom level, as exportLevel writes it; absent for a built-in one. */
  custom?: string;
  /** The design as Design.serialize writes it. */
  design: string;
  /** The profile name of whoever built it. */
  name: string;
}

/** The words a short link's preview shows in a chat: the share card's own. */
export interface Preview {
  title: string;
  line: string;
  by: string;
}

/** A bridge on its way to the share service: its short link at once, and the upload that makes it work. */
export interface StoredBridge {
  code: string;
  url: string;
  saved: Promise<void>;
}

/** The long link, which opens a bridge with no service to ask. */
export async function shareLink(s: SharedBridge): Promise<string> {
  const json = JSON.stringify(payload(s));
  return `${SHARE_ORIGIN}/?${PARAM}=${base64url(await squeeze(new TextEncoder().encode(json), 'compress'))}`;
}

/** Stores a bridge under its short code. The link is good as soon as `saved` resolves. */
export async function storeBridge(s: SharedBridge, preview: Preview): Promise<StoredBridge> {
  const body = new TextEncoder().encode(JSON.stringify(payload(s, preview)));
  const code = await shortCode(body);
  return { code, url: `${SHARE_SERVICE}/${code}`, saved: put(`api/bridges/${code}`, body, 'application/json') };
}

/** Stores the picture a short link's preview shows: the share card as a JPEG. */
export function storePicture(code: string, jpeg: Blob): Promise<void> {
  return put(`api/bridges/${code}/image`, jpeg, 'image/jpeg');
}

/**
 * The bridge a link or query string carries, or null if it holds none this version can read.
 * A short link asks the share service, and throws when it can't be reached.
 */
export async function readShareLink(url: string): Promise<SharedBridge | null> {
  const code = codeIn(url);
  if (code) return fetchBridge(code);
  try {
    const packed = params(url).get(PARAM);
    if (!packed) return null;
    return fromPayload(JSON.parse(new TextDecoder().decode(await squeeze(unbase64url(packed), 'decompress'))));
  } catch {
    return null;
  }
}

/** Whether a URL carries a shared bridge, before it's read. */
export function hasShareLink(url: string): boolean {
  return /[?&]b=/.test(url) || codeIn(url) !== null;
}

/** A bridge's code: 8 characters of base 62 from the SHA-256 of its bytes, as the share service works it out. */
export async function shortCode(bytes: Uint8Array): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource));
  let n = 0n;
  for (let i = 0; i < 6; i++) n = (n << 8n) | BigInt(hash[i]);
  let s = '';
  for (let i = 0; i < 8; i++) {
    s = ALPHABET[Number(n % 62n)] + s;
    n /= 62n;
  }
  return s;
}

/** What a link holds: the version, the level, who built it, the design, a custom level, and for a short link the preview's words. */
function payload(s: SharedBridge, preview?: Preview): object {
  return {
    v: VERSION,
    l: s.level,
    n: s.name,
    d: JSON.parse(s.design) as unknown,
    c: s.custom ? (JSON.parse(s.custom) as unknown) : undefined,
    p: preview ? { title: clip(preview.title), line: clip(preview.line), by: clip(preview.by) } : undefined,
  };
}

const clip = (v: string) => v.slice(0, MAX_TEXT);

function fromPayload(raw: unknown): SharedBridge | null {
  const o = raw as { v?: unknown; l?: unknown; n?: unknown; d?: unknown; c?: unknown } | null;
  if (!o || o.v !== VERSION || typeof o.l !== 'number' || !o.d || typeof o.d !== 'object') return null;
  const shared: SharedBridge = { level: o.l, design: JSON.stringify(o.d), name: typeof o.n === 'string' ? o.n.slice(0, 40) : '' };
  if (o.c && typeof o.c === 'object') shared.custom = JSON.stringify(o.c);
  return shared;
}

/** The short code in a link: `?s=<code>` on the game's own address, or the short link itself. */
function codeIn(url: string): string | null {
  const s = params(url).get(SHORT_PARAM);
  if (s && CODE.test(s)) return s;
  if (!url.startsWith(`${SHARE_SERVICE}/`)) return null;
  const path = url.slice(SHARE_SERVICE.length + 1).split(/[?#]/)[0];
  return CODE.test(path) ? path : null;
}

function params(url: string): URLSearchParams {
  const query = url.includes('?') ? url.slice(url.indexOf('?')) : url;
  return new URLSearchParams(query.split('#')[0]);
}

async function fetchBridge(code: string): Promise<SharedBridge | null> {
  const res = await fetch(`${SHARE_SERVICE}/api/bridges/${code}`, { signal: AbortSignal.timeout(10_000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Share service answered ${res.status}`);
  try {
    return fromPayload(await res.json());
  } catch {
    return null;
  }
}

async function put(path: string, body: Uint8Array | Blob, type: string): Promise<void> {
  const res = await fetch(`${SHARE_SERVICE}/${path}`, { method: 'PUT', body: body as BodyInit, headers: { 'Content-Type': type }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Share service answered ${res.status}`);
}

/** Raw deflate, through the platform's own compression streams. */
async function squeeze(data: Uint8Array, way: 'compress' | 'decompress'): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(way === 'compress' ? new CompressionStream('deflate-raw') : new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unbase64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
