import { locale, t, type Key } from './index';

/**
 * Fills the static page's text from the message table: `data-i18n` sets an element's contents
 * (messages may hold simple markup), and `data-i18n-title`, `-aria` and `-ph` set its title,
 * aria-label and placeholder. Runs at start and after every language change.
 */
export function applyStatic(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) el.innerHTML = t(el.dataset.i18n as Key);
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle as Key);
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria as Key));
  for (const el of root.querySelectorAll<HTMLInputElement>('[data-i18n-ph]')) el.placeholder = t(el.dataset.i18nPh as Key);
  document.documentElement.lang = locale();
}

/** Escapes text for use inside HTML. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
