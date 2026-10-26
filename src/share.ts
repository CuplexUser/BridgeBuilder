/**
 * Shared bridges: a link that carries a level, a design and who built it, so whoever opens it
 * watches that bridge drive in their own game. Everything is in the link itself, compressed:
 * there's no server to look it up on, and a custom level travels whole. The design keeps its
 * save format version, so an old link still loads into a changed level the way a saved design does.
 */

/** Where links point: the web game, and the host the Android app opens links for. */
export const SHARE_ORIGIN = 'https://bridgebuilder.cuplex.org';
/** The query parameter that holds a shared bridge. */
const PARAM = 'b';
/** The link format's version, first in the payload. */
const VERSION = 1;

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

/** The link that opens a bridge. */
export async function shareLink(s: SharedBridge): Promise<string> {
  const json = JSON.stringify({ v: VERSION, l: s.level, n: s.name, d: JSON.parse(s.design) as unknown, c: s.custom ? (JSON.parse(s.custom) as unknown) : undefined });
  return `${SHARE_ORIGIN}/?${PARAM}=${base64url(await squeeze(new TextEncoder().encode(json), 'compress'))}`;
}

/** The bridge a link or query string carries, or null if it holds none this version can read. */
export async function readShareLink(url: string): Promise<SharedBridge | null> {
  try {
    const query = url.includes('?') ? url.slice(url.indexOf('?')) : url;
    const payload = new URLSearchParams(query.split('#')[0]).get(PARAM);
    if (!payload) return null;
    const o = JSON.parse(new TextDecoder().decode(await squeeze(unbase64url(payload), 'decompress'))) as { v?: unknown; l?: unknown; n?: unknown; d?: unknown; c?: unknown };
    if (o.v !== VERSION || typeof o.l !== 'number' || !o.d || typeof o.d !== 'object') return null;
    const shared: SharedBridge = { level: o.l, design: JSON.stringify(o.d), name: typeof o.n === 'string' ? o.n.slice(0, 40) : '' };
    if (o.c && typeof o.c === 'object') shared.custom = JSON.stringify(o.c);
    return shared;
  } catch {
    return null;
  }
}

/** Whether a URL carries a shared bridge, before it's read. */
export function hasShareLink(url: string): boolean {
  return /[?&]b=/.test(url);
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
