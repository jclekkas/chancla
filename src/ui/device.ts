// What this device can play with, from input capabilities and viewport size
// (not the user agent). A phone or a tablet without a mouse is "touch only";
// a tablet with a trackpad or mouse, or a touch laptop, is not. A real mouse
// or keyboard showing up later (a tablet keyboard case) upgrades the page.
export interface InputProfile {
  /** No fine pointer and no hover anywhere: fingers only. */
  touchOnly: boolean;
  /** The shorter side is phone-sized. */
  small: boolean;
}

const mq = (q: string): boolean => typeof matchMedia === 'function' && matchMedia(q).matches;

export function inputProfile(): InputProfile {
  const touch = mq('(any-pointer: coarse)') || (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0);
  const precise = mq('(any-pointer: fine)') || mq('(any-hover: hover)');
  const short = typeof window !== 'undefined' ? Math.min(window.innerWidth, window.innerHeight) : 1000;
  return { touchOnly: touch && !precise, small: short < 500 };
}

/**
 * Calls `onChange` when the profile changes: a mouse or trackpad is
 * connected (media queries change), a mouse actually moves, or a physical
 * key is pressed outside a text field. Returns a function that stops watching.
 */
export function watchInputProfile(onChange: (p: InputProfile) => void): () => void {
  let upgraded = false;
  const emit = () => onChange(upgraded ? { ...inputProfile(), touchOnly: false } : inputProfile());
  const queries = ['(any-pointer: fine)', '(any-hover: hover)', '(any-pointer: coarse)'].map((q) => (typeof matchMedia === 'function' ? matchMedia(q) : null));
  for (const m of queries) m?.addEventListener?.('change', emit);
  const onMouse = (e: PointerEvent) => { if (e.pointerType === 'mouse' && (e.movementX || e.movementY)) { upgraded = true; emit(); } };
  const onKey = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return; // could be an on-screen keyboard
    if (e.key.length === 1 || /^Arrow|^Escape$|^Tab$/.test(e.key)) { upgraded = true; emit(); }
  };
  window.addEventListener('pointermove', onMouse);
  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', emit);
  return () => {
    for (const m of queries) m?.removeEventListener?.('change', emit);
    window.removeEventListener('pointermove', onMouse);
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', emit);
  };
}

/** Copies a link, or selects it in `fallback` for a manual copy. Resolves true when copied. */
export async function copyLink(url: string, fallback: HTMLInputElement): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(url);
    return true;
  } catch {
    fallback.value = url;
    fallback.hidden = false;
    fallback.focus();
    fallback.select();
    return false;
  }
}
