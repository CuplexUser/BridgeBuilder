import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { traffic } from '../src/brief';
import { costReview } from '../src/review';
import { en, type Plural } from '../src/i18n/en';
import { addLocale, detectLocale, fmt, setLocale, SUPPORTED, t, tn, type Table } from '../src/i18n';
import { levelName } from '../src/i18n/data';
import { allKeys, placeholders, tags } from '../src/i18n/keys';
import { LEVELS } from '../src/levels';

const LOCALES = import.meta.glob<{ default: Table }>('../src/i18n/locales/*.ts', { eager: true });
const tables = Object.entries(LOCALES).map(([path, mod]) => [path.replace(/^.*\//, '').replace(/\.ts$/, ''), mod.default] as const);
const EN = en as Record<string, string | Plural>;

/** Every form of a message: a plain string, or each plural category. */
const forms = (m: string | Plural | undefined): string[] => (m === undefined ? [] : typeof m === 'string' ? [m] : Object.values(m).filter((v): v is string => !!v));
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
/** German and French put a no-break space before % and $. */
const plain = (s: string) => s.replace(/[  ]/g, ' ');

/** How long a translation may run where space is tight, in characters. */
const CAPS: [RegExp, number][] = [
  [/^mat\.\w+\.short$/, 8],
  [/^mat\.\w+\.name$/, 14],
  [/^tool\.(test|edit)$/, 10],
  [/^hud\.budget$/, 12],
  [/^level\.\d+\.tip$/, 240],
];

/** Problems with a locale table, as readable lines; empty when it's sound. */
function problems(code: string, table: Table): { unknown: string[]; mismatched: string[]; plurals: string[]; tooLong: string[] } {
  const keys = allKeys();
  const cats = new Intl.PluralRules(code).resolvedOptions().pluralCategories as (keyof Plural)[];
  const out = { unknown: [] as string[], mismatched: [] as string[], plurals: [] as string[], tooLong: [] as string[] };
  for (const [key, msg] of Object.entries(table)) {
    const source = keys.get(key);
    if (source === undefined) {
      out.unknown.push(key);
      continue;
    }
    if (msg === undefined) continue;
    // A plural form may spell out its count ("one squad") instead of {n}.
    const want = placeholders(forms(source)[0]).filter((p) => p !== 'n');
    const wantTags = tags(forms(source)[0]);
    for (const form of forms(msg)) {
      const got = placeholders(form).filter((p) => p !== 'n');
      if (got.join() !== want.join() || tags(form).join() !== wantTags.join()) out.mismatched.push(`${key}: ${form}`);
      const cap = CAPS.find(([re]) => re.test(key))?.[1];
      if (cap && form.length > cap) out.tooLong.push(`${key} (${form.length} > ${cap}): ${form}`);
    }
    if (typeof msg !== 'string') for (const cat of cats) if (!msg[cat]) out.plurals.push(`${key} lacks "${cat}"`);
  }
  return out;
}

afterEach(async () => {
  await setLocale('en');
});

describe('i18n: the English table', () => {
  it('matches the English written into index.html', () => {
    const html = readFileSync('index.html', 'utf8');
    const wrong: string[] = [];
    let seen = 0;
    for (const m of html.matchAll(/<(\w+)\b[^>]*?\sdata-i18n="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)) {
      seen++;
      if (norm(m[3]) !== norm(String(EN[m[2]]))) wrong.push(`${m[2]}: ${norm(m[3])}`);
    }
    const attrFor = { title: 'title', aria: 'aria-label', ph: 'placeholder' };
    for (const [tag] of html.matchAll(/<[a-z][^>]*>/g)) {
      const attrs = Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]]));
      for (const [kind, attr] of Object.entries(attrFor)) {
        const key = attrs[`data-i18n-${kind}`];
        if (key && attrs[attr] !== EN[key]) wrong.push(`${key}: ${attrs[attr]}`);
      }
    }
    expect(wrong).toEqual([]);
    expect(seen).toBeGreaterThan(100);
  });

  it('gives every plural message an "other" form', () => {
    expect(Object.entries(EN).filter(([, m]) => typeof m !== 'string' && !m.other)).toEqual([]);
  });

  it('formats numbers, money, lists and plurals', () => {
    expect(fmt.money(12500)).toBe('$12,500');
    expect(fmt.pct(0.664)).toBe('66%');
    expect(fmt.list(['road', 'heavy deck'], 'disjunction')).toBe('road or heavy deck');
    expect(tn('collapse.lives', 1)).toBe('1 life left.');
    expect(tn('collapse.lives', 3)).toBe('3 lives left.');
    expect(t('rule.channel', { top: '+2' })).toBe('Keep the ship channel clear: nothing may be built in it, up to +2 m.');
  });
});

describe('i18n: switching language', () => {
  it('offers Android the same languages the game ships', () => {
    const xml = readFileSync('android/app/src/main/res/xml/locales_config.xml', 'utf8');
    expect([...xml.matchAll(/android:name="([^"]+)"/g)].map((m) => m[1])).toEqual([...SUPPORTED]);
  });

  it('follows the device to the nearest language it ships', () => {
    expect(detectLocale(['de-AT', 'en'])).toBe('de');
    expect(detectLocale(['pt-PT'])).toBe('pt-BR');
    expect(detectLocale(['fi', 'sv-FI'])).toBe('sv');
    expect(detectLocale(['ko'])).toBe('en');
  });

  it('translates messages and data, and falls back to English for anything missing', async () => {
    addLocale('de', { 'goal.target': 'Baue für {money} oder weniger', 'level.1.name': 'Erste Überquerung', 'vehicle.van.name': 'Lieferwagen' });
    await setLocale('de');
    expect(plain(t('goal.target', { money: fmt.money(9500) }))).toBe('Baue für $9.500 oder weniger');
    expect(levelName(LEVELS.find((l) => l.id === 1)!)).toBe('Erste Überquerung');
    expect(t('goal.safeNote')).toBe(en['goal.safeNote']);
    expect(traffic(LEVELS.find((l) => l.id === 32)!)).toMatch(/^Lieferwagen ×3 · 15 t/);
    expect(plain(costReview(1140, 1000, fmt.money))).toBe('14 % above the best known design ($1.000).');
  });
});

describe.runIf(tables.length).each(tables)('i18n: the %s table', (code, table) => {
  const found = problems(code, table);
  it('has only keys the game uses', () => expect(found.unknown).toEqual([]));
  it('keeps every placeholder and tag of the English', () => expect(found.mismatched).toEqual([]));
  it('gives each plural message every form its language needs', () => expect(found.plurals).toEqual([]));
  it('fits where space is tight', () => expect(found.tooLong).toEqual([]));
});
