import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error plain JS server module
import { createApi, openDb } from '../server/api.mjs';
import { LocalStore, ServerStore, type KeyValue, type Store } from '../src/storage';

function memoryKv(): KeyValue & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

/** The same behavior is expected from both backends. */
function contract(name: string, make: () => Store) {
  describe(`${name} store`, () => {
    it('creates a profile once and reopens it case-insensitively', async () => {
      const s = make();
      const a = await s.openProfile('  Ada  Lovelace ');
      expect(a.name).toBe('Ada Lovelace');
      const b = await s.openProfile('ada lovelace');
      expect(b.id).toBe(a.id);
      expect((await s.listProfiles()).filter((p) => p.id === a.id)).toHaveLength(1);
    });

    it('rejects an empty name', async () => {
      await expect(make().openProfile('   ')).rejects.toThrow(/name|400/);
    });

    it('round-trips progress per profile', async () => {
      const s = make();
      const a = await s.openProfile('Grace');
      const b = await s.openProfile('Linus');
      await s.saveProgress(a.id, { unlocked: 4, best: { 1: { score: 900, stars: 3 }, 2: { score: 700, stars: 2 } }, designs: { 1: '{"n":[],"m":[]}' } });
      const got = await s.loadProgress(a.id);
      expect(got.unlocked).toBe(4);
      expect(got.best[1]).toEqual({ score: 900, stars: 3 });
      expect(got.designs[1]).toBe('{"n":[],"m":[]}');
      expect((await s.loadProgress(b.id)).unlocked).toBe(1);
      const listed = (await s.listProfiles()).find((p) => p.id === a.id)!;
      expect(listed.stars).toBe(5);
    });

    it('keeps a sorted high-score table with profile names', async () => {
      const s = make();
      const p = await s.openProfile('Scorer');
      expect(await s.submitScore(p.id, 500, 1)).toBeGreaterThanOrEqual(0);
      const rank = await s.submitScore(p.id, 999999, 12);
      expect(rank).toBe(0);
      const highs = await s.highScores();
      expect(highs[0]).toMatchObject({ name: 'Scorer', score: 999999, levels: 12 });
      expect(await s.submitScore(p.id, 0, 0)).toBe(-1);
    });
  });
}

contract('local', () => new LocalStore(memoryKv()));

let server: Server;
let base = '';
beforeAll(async () => {
  const api = createApi(openDb(':memory:'));
  server = createServer((req, res) => api(req, res, () => ((res.statusCode = 404), res.end())));
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

contract('sqlite server', () => new ServerStore(base));

describe('sqlite server details', () => {
  it('never lowers a best score', async () => {
    const s = new ServerStore(base);
    const p = await s.openProfile('Keeper');
    await s.saveProgress(p.id, { unlocked: 3, best: { 2: { score: 800, stars: 3 } }, designs: {} });
    await s.saveProgress(p.id, { unlocked: 2, best: { 2: { score: 100, stars: 1 } }, designs: {} });
    const got = await s.loadProgress(p.id);
    expect(got.best[2]).toEqual({ score: 800, stars: 3 });
    expect(got.unlocked).toBe(3);
  });

  it('answers the health probe and 404s unknown profiles', async () => {
    expect(await (await fetch(`${base}/health`)).json()).toMatchObject({ ok: true });
    expect((await fetch(`${base}/profiles/99999/progress`)).status).toBe(404);
  });
});

describe('local store migration', () => {
  it('seeds the first profile from pre-profile saves', async () => {
    const kv = memoryKv();
    kv.setItem('bridgebuilder.v1', JSON.stringify({ unlocked: 5, best: { 1: { score: 900, stars: 3 } }, designs: {} }));
    const s = new LocalStore(kv);
    const p = await s.openProfile('First');
    expect((await s.loadProgress(p.id)).unlocked).toBe(5);
    const q = await s.openProfile('Second');
    expect((await s.loadProgress(q.id)).unlocked).toBe(1);
  });
});
