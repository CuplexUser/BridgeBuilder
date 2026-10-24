import { onLocaleChange } from '../i18n';

/** Before the page's styles can be read, and in tests. */
const FALLBACK = { sans: '"Space Grotesk", system-ui, sans-serif', mono: '"JetBrains Mono", monospace' };
let stacks: typeof FALLBACK | null = null;

// Japanese swaps in its own font stack (style.css), so read it again after a change.
onLocaleChange(() => {
  stacks = null;
});

function read(): typeof FALLBACK {
  if (typeof document === 'undefined') return FALLBACK;
  const css = getComputedStyle(document.documentElement);
  return { sans: css.getPropertyValue('--font').trim() || FALLBACK.sans, mono: css.getPropertyValue('--mono').trim() || FALLBACK.mono };
}

/** A canvas font in the page's own font stack (--font or --mono), e.g. font(700, 14). */
export function font(weight: number, px: number, kind: 'sans' | 'mono' = 'sans'): string {
  stacks ??= read();
  return `${weight} ${px}px ${stacks[kind]}`;
}
