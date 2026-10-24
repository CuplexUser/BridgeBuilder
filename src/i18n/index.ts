import { en, type Plural } from './en';

/**
 * Every string the game shows. English (`en.ts`) is the source and the fallback: a locale table
 * holds what it has translated, and anything missing reads in English. Level, chapter, material,
 * vehicle and scene text stays in its own data file as English (see `data.ts`), keyed here by id.
 *
 * Messages take `{name}` placeholders. A number passed as a parameter is formatted for the
 * locale, with up to two decimals; pass a string for anything already formatted, such as money
 * or a fixed decimal.
 */

export type Key = keyof typeof en;
export type Message = string | Plural;
/** A locale's table: any message by key, or level and chapter text by its `level.<id>.name` style key. */
export type Table = Partial<Record<Key, Message>> & Record<string, Message | undefined>;
export type Params = Record<string, string | number>;

/** Languages the game ships, with their own names for the picker. */
export const LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'de', name: 'Deutsch' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'pl', name: 'Polski' },
  { code: 'pt-BR', name: 'Português (Brasil)' },
  { code: 'sv', name: 'Svenska' },
  { code: 'ru', name: 'Русский' },
  { code: 'ja', name: '日本語' },
] as const;
export type Lang = (typeof LANGUAGES)[number]['code'];
export const SUPPORTED: readonly Lang[] = LANGUAGES.map((l) => l.code);

type Loader = () => Promise<{ default: Table }>;
const loaders = new Map<Lang, Loader>();
const loaded = new Map<Lang, Table>([['en', en as Table]]);
let current: Lang = 'en';
let table: Table = en as Table;
let plurals = new Intl.PluralRules('en');
const listeners: (() => void)[] = [];

/**
 * Hands over the locale tables as lazy imports, keyed by file path, e.g. from
 * `import.meta.glob('./i18n/locales/*.ts')`. Only the browser build does this; tests and the
 * tools stay in English unless they add a table themselves with `addLocale`.
 */
export function registerLocales(files: Record<string, () => Promise<unknown>>): void {
  for (const [path, load] of Object.entries(files)) {
    const code = path.replace(/^.*\//, '').replace(/\.ts$/, '') as Lang;
    if (SUPPORTED.includes(code)) loaders.set(code, load as Loader);
  }
}

/** Adds a table that is already loaded. */
export function addLocale(code: Lang, messages: Table): void {
  loaded.set(code, messages);
}

/** The best supported match for the device's languages, e.g. "pt-PT" → "pt-BR", "de-AT" → "de". */
export function detectLocale(wanted: readonly string[] = typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language]): Lang {
  for (const w of wanted) {
    const exact = SUPPORTED.find((c) => c.toLowerCase() === w.toLowerCase());
    if (exact) return exact;
    const base = w.split('-')[0].toLowerCase();
    const near = SUPPORTED.find((c) => c.split('-')[0].toLowerCase() === base);
    if (near) return near;
  }
  return 'en';
}

/** Switches language, loading its table first. Unknown codes and failed loads fall back to English. */
export async function setLocale(code: string): Promise<void> {
  const lang: Lang = SUPPORTED.includes(code as Lang) ? (code as Lang) : 'en';
  if (!loaded.has(lang)) {
    const load = loaders.get(lang);
    try {
      if (load) loaded.set(lang, (await load()).default);
    } catch {
      // Offline or a bad chunk: stay readable in English.
    }
  }
  const next = loaded.get(lang);
  current = next ? lang : 'en';
  table = next ?? (en as Table);
  plurals = new Intl.PluralRules(current);
  formatters.clear();
  for (const cb of listeners) cb();
}

export function locale(): Lang {
  return current;
}

/** Runs `cb` after every language change. */
export function onLocaleChange(cb: () => void): void {
  listeners.push(cb);
}

function lookup(key: string): Message | undefined {
  return table[key] ?? (en as Table)[key];
}

function fill(text: string, params?: Params): string {
  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (all, name: string) => {
    const v = params[name];
    return v === undefined ? all : typeof v === 'number' ? fmt.dec(v) : v;
  });
}

function pick(msg: Message, n: number): string {
  if (typeof msg === 'string') return msg;
  const form = plurals.select(n) as keyof Plural;
  return msg[form] ?? msg.other;
}

/** A message, with its placeholders filled. */
export function t(key: Key, params?: Params): string {
  const msg = lookup(key);
  return msg === undefined ? key : fill(pick(msg, 0), params);
}

/** A message that depends on a count: picks the locale's plural form for `n`, which is also `{n}`. */
export function tn(key: Key, n: number, params?: Params): string {
  const msg = lookup(key);
  return msg === undefined ? key : fill(pick(msg, n), { n, ...params });
}

/** A data string by its own key, e.g. `level.12.name`, or `fallback` (the data's English) when untranslated. */
export function tData(key: string, fallback: string): string {
  if (current === 'en') return fallback;
  const msg = table[key];
  return typeof msg === 'string' ? msg : fallback;
}

const formatters = new Map<string, Intl.NumberFormat>();
function nf(key: string, opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  let f = formatters.get(key);
  if (!f) formatters.set(key, (f = new Intl.NumberFormat(current, opts)));
  return f;
}

export const fmt = {
  /** A whole number with the locale's grouping, e.g. 12,500 or 12 500. */
  num: (v: number): string => nf('int', { maximumFractionDigits: 0 }).format(Math.round(v)),
  /** A number with a fixed count of decimals, e.g. 4.0 or 4,0. */
  fixed: (v: number, digits: number): string => nf(`f${digits}`, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v),
  /** A number with up to `digits` decimals and no trailing zeros, e.g. 2.5 or 3. */
  dec: (v: number, digits = 2): string => nf(`d${digits}`, { maximumFractionDigits: digits }).format(v),
  /** Dollars, the game's one currency, as the locale writes them, e.g. $12,500 or 12.500 $. */
  money: (v: number): string => nf('usd', { style: 'currency', currency: 'USD', maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(Math.round(v)),
  /** A ratio as a whole percent, e.g. 0.66 → 66%. */
  pct: (ratio: number): string => nf('pct', { style: 'percent', maximumFractionDigits: 0 }).format(ratio),
  /** "a, b and c" in the locale's own words. */
  list: (items: string[], type: 'conjunction' | 'disjunction' = 'conjunction'): string => new Intl.ListFormat(current, { type }).format(items),
  /** Upper case by the locale's rules. */
  upper: (s: string): string => s.toLocaleUpperCase(current),
};
