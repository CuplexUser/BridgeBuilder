import { describe, expect, it } from 'vitest';
import { Design } from '../src/design';
import { LEVELS } from '../src/levels';
import { hasShareLink, readShareLink, SHARE_ORIGIN, shareLink } from '../src/share';
import { SOLUTIONS } from '../src/solutions';

const L = (id: number) => LEVELS.find((l) => l.id === id)!;

describe('shared bridge links', () => {
  it('carry a level, a design and who built it, and read back the same', async () => {
    const level = L(3);
    const design = SOLUTIONS[3](level).serialize();
    const url = await shareLink({ level: 3, design, name: 'Ada' });
    expect(url.startsWith(`${SHARE_ORIGIN}/?b=`)).toBe(true);
    expect(hasShareLink(url)).toBe(true);
    // Safe in a URL as it stands: nothing to escape.
    expect(url.slice(url.indexOf('=') + 1)).toMatch(/^[A-Za-z0-9_-]+$/);
    const back = await readShareLink(url);
    expect(back).toEqual({ level: 3, design, name: 'Ada' });
    expect(Design.deserialize(back!.design).members.length).toBe(Design.deserialize(design).members.length);
  });

  it('stay short enough for a chat message on a big bridge', async () => {
    const level = L(7);
    const d = new Design(level);
    for (let x = 0; x < level.width; x += 2) {
      d.add([x, 0], [x + 2, 0], 'road');
      d.add([x, 0], [x + 1, 2], level.materials[1]);
      d.add([x + 1, 2], [x + 2, 0], level.materials[1]);
    }
    const url = await shareLink({ level: 7, design: d.serialize(), name: 'Ada' });
    expect(url.length).toBeLessThan(2000);
  });

  it('read from the query string alone, and leave other parameters be', async () => {
    const url = await shareLink({ level: 3, design: SOLUTIONS[3](L(3)).serialize(), name: 'Ada' });
    const query = `?debug&${url.slice(url.indexOf('?') + 1)}#top`;
    expect((await readShareLink(query))?.level).toBe(3);
  });

  it('turn away links that hold no bridge', async () => {
    expect(hasShareLink(`${SHARE_ORIGIN}/`)).toBe(false);
    expect(await readShareLink(`${SHARE_ORIGIN}/`)).toBeNull();
    expect(await readShareLink(`${SHARE_ORIGIN}/?b=not-a-bridge`)).toBeNull();
    expect(await readShareLink(`${SHARE_ORIGIN}/?b=`)).toBeNull();
  });
});
