import { STRINGS, QUIPS, type Lang, type QuipKey, type StringKey } from './strings';

let current: Lang = 'en';
const listeners = new Set<(lang: Lang) => void>();

export function getLang(): Lang {
  return current;
}

export function detectLang(): Lang {
  const nav = typeof navigator !== 'undefined' ? navigator.language || '' : '';
  return nav.toLowerCase().startsWith('es') ? 'es' : 'en';
}

export function setLang(lang: Lang): void {
  if (lang !== 'en' && lang !== 'es') lang = 'en';
  current = lang;
  for (const fn of listeners) fn(lang);
}

export function onLangChange(fn: (lang: Lang) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function t(key: StringKey, params?: Record<string, string | number>): string {
  let s = STRINGS[current][key] ?? STRINGS.en[key] ?? key;
  if (params) {
    for (const k of Object.keys(params)) s = s.replaceAll(`{${k}}`, String(params[k]));
  }
  return s;
}

export function quip(key: QuipKey): { es: string; sub: string } {
  const q = QUIPS[key];
  return { es: q.es, sub: current === 'en' ? q.en : '' };
}

export function formatNumber(n: number): string {
  return Math.round(n).toLocaleString(current === 'es' ? 'es-MX' : 'en-US');
}

// Applies translations to static markup: data-i18n for text,
// data-i18n-aria for aria-label, data-i18n-alt for alt, data-i18n-title for title.
export function applyDom(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n as StringKey);
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-aria]').forEach((el) => {
    el.setAttribute('aria-label', t(el.dataset.i18nAria as StringKey));
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-alt]').forEach((el) => {
    el.setAttribute('alt', t(el.dataset.i18nAlt as StringKey));
  });
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    el.setAttribute('title', t(el.dataset.i18nTitle as StringKey));
  });
  if (typeof document !== 'undefined') {
    document.documentElement.lang = current;
    document.title = t('meta.title');
  }
}

export function hasKey(key: string): key is StringKey {
  return key in STRINGS.en;
}
