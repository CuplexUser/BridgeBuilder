import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error plain JS server module
import { createHandler, jpegSize, shortCode as serviceCode } from '../share-service/app.mjs';
// @ts-expect-error plain JS server module
import { memoryStore } from '../share-service/stores.mjs';
import { LEVELS } from '../src/levels';
import { readShareLink, SHARE_SERVICE, shortCode, storeBridge } from '../src/share';
import { SOLUTIONS } from '../src/solutions';

const GAME = 'https://bridgebuilder.cuplex.org';
const PUBLIC = 'https://b.cuplex.org';
const level = LEVELS.find((l) => l.id === 3)!;
const design = SOLUTIONS[3](level).serialize();

/** The smallest file the service reads as a JPEG of the given size: a start, a frame header and an end. */
function jpeg(w: number, h: number): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9]);
}

const bytes = (s: string) => new TextEncoder().encode(s);
const bridgeJson = (name = 'Ada') => JSON.stringify({ v: 1, l: 3, n: name, d: JSON.parse(design), p: { title: '1-3 THE TRUSS', line: '1,000 points', by: `by ${name}` } });

describe('share service', () => {
  let server: Server;
  let base = '';
  let clock = 0;

  beforeEach(async () => {
    clock = 0;
    server = createServer(createHandler({ store: memoryStore(), gameOrigin: GAME, publicOrigin: PUBLIC, now: () => clock }));
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await new Promise((resolve) => server.close(resolve));
  });

  const put = (path: string, body: Uint8Array | string, type = 'application/json') => fetch(`${base}${path}`, { method: 'PUT', body: typeof body === 'string' ? bytes(body) : (body as BodyInit), headers: { 'Content-Type': type } });

  /** Stores a bridge under its code, and says what the service answered. */
  const store = async (json: string) => (await put(`/api/bridges/${await shortCode(bytes(json))}`, json)).status;

  it('works out the same code as the game', async () => {
    const samples = ['', 'a', bridgeJson()].map(bytes);
    expect(await Promise.all(samples.map(serviceCode))).toEqual(await Promise.all(samples.map(shortCode)));
    expect(await shortCode(bytes(bridgeJson()))).toMatch(/^[0-9A-Za-z]{8}$/);
  });

  it('stores a bridge under its own code, once, and hands it back', async () => {
    const json = bridgeJson();
    const code = await shortCode(bytes(json));
    expect((await put(`/api/bridges/${code}`, json)).status).toBe(201);
    // Shared again: the same code, nothing new stored.
    expect((await put(`/api/bridges/${code}`, json)).status).toBe(200);
    const res = await fetch(`${base}/api/bridges/${code}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(await res.text()).toBe(json);
    expect((await fetch(`${base}/api/bridges/AAAAAAAA`)).status).toBe(404);
  });

  it('takes nothing under a code that isn’t its own, and nothing that isn’t a bridge', async () => {
    const json = bridgeJson();
    const other = await shortCode(bytes(bridgeJson('Eve')));
    expect((await put(`/api/bridges/${other}`, json)).status).toBe(400);
    const bad = ['not json', '{"v":1}', JSON.stringify({ v: 1, l: 3, n: 'x'.repeat(41), d: { n: [], m: [] } })];
    const answers = await Promise.all(bad.map(async (b) => (await put(`/api/bridges/${await shortCode(bytes(b))}`, b)).status));
    expect(answers).toEqual([400, 400, 400]);
    const huge = JSON.stringify({ v: 1, l: 3, n: 'Ada', d: { n: Array(40000).fill(0), m: [] } });
    expect((await put(`/api/bridges/${await shortCode(bytes(huge))}`, huge)).status).toBe(413);
  });

  it('keeps a 1200×675 JPEG for a stored bridge, and only that', async () => {
    const json = bridgeJson();
    const code = await shortCode(bytes(json));
    expect((await put(`/api/bridges/${code}/image`, jpeg(1200, 675), 'image/jpeg')).status).toBe(404);
    await put(`/api/bridges/${code}`, json);
    expect((await put(`/api/bridges/${code}/image`, bytes('<svg/>'), 'image/jpeg')).status).toBe(400);
    expect((await put(`/api/bridges/${code}/image`, jpeg(4000, 4000), 'image/jpeg')).status).toBe(400);
    expect((await put(`/api/bridges/${code}/image`, jpeg(1200, 675), 'image/jpeg')).status).toBe(201);
    const pic = await fetch(`${base}/${code}.jpg`);
    expect(pic.headers.get('content-type')).toBe('image/jpeg');
    expect(new Uint8Array(await pic.arrayBuffer())).toEqual(jpeg(1200, 675));
    expect(jpegSize(Buffer.from(jpeg(1200, 675)))).toEqual({ w: 1200, h: 675 });
  });

  it('answers a short link with preview tags, then sends the player to the game', async () => {
    const json = JSON.stringify({ v: 1, l: 3, n: '<b>Ada</b>', d: JSON.parse(design), p: { title: '1-3 "THE" TRUSS', line: '1,000 points', by: 'by <b>Ada</b>' } });
    const code = await shortCode(bytes(json));
    await put(`/api/bridges/${code}`, json);
    const res = await fetch(`${base}/${code}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`<meta property="og:image" content="${PUBLIC}/${code}.jpg">`);
    expect(html).toContain(`<meta property="og:url" content="${PUBLIC}/${code}">`);
    expect(html).toContain(`${GAME}/?s=${code}`);
    expect(html).toContain('1-3 &#34;THE&#34; TRUSS · Bridge Builder');
    expect(html).not.toContain('<b>Ada');
    expect((await fetch(`${base}/ZZZZZZZZ`)).status).toBe(404);
    const root = await fetch(`${base}/`, { redirect: 'manual' });
    expect(root.status).toBe(302);
    expect(root.headers.get('location')).toBe(GAME);
  });

  it('limits how much one address stores', async () => {
    const answers = await Promise.all(Array.from({ length: 41 }, (_, i) => store(bridgeJson(`P${i}`))));
    expect(answers.filter((s) => s === 201)).toHaveLength(40);
    expect(answers.filter((s) => s === 429)).toHaveLength(1);
    clock += 11 * 60 * 1000;
    expect(await store(bridgeJson('Later'))).toBe(201);
  });

  it('is what the game stores to and opens short links from', async () => {
    // The game's fetches go to this server instead of b.cuplex.org.
    const real = globalThis.fetch;
    vi.stubGlobal('fetch', (input: string, init?: RequestInit) => real(input.replace(SHARE_SERVICE, base), init));
    const stored = await storeBridge({ level: 3, design, name: 'Ada' }, { title: '1-3', line: 'Crossed', by: 'by Ada' });
    expect(stored.url).toBe(`${SHARE_SERVICE}/${stored.code}`);
    await stored.saved;
    // From the app's App Link, and from the game's own address after the preview page.
    const links = [stored.url, `${GAME}/?s=${stored.code}`, `?debug&s=${stored.code}`];
    expect(await Promise.all(links.map(readShareLink))).toEqual(links.map(() => ({ level: 3, design, name: 'Ada' })));
    expect(await readShareLink(`${SHARE_SERVICE}/AAAAAAAA`)).toBeNull();
    // No service to ask: the player hears so, rather than that the link is bad.
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Failed to fetch')));
    await expect(readShareLink(stored.url)).rejects.toThrow('Failed to fetch');
  });
});
