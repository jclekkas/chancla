// Chancla Duty boots the original first-person game, then wears a sharper light
// and a new voice. The Warfare page at / is not imported from here.
import './graphics-patch';
import './voice-patch';
import '../../src/fps/main.ts';

const KEY = 'chancla-duty-fps-meta';

function meta(): { respeto: number; combo: number; best: number } {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { respeto: 0, combo: 0, best: 0 };
    const p = JSON.parse(raw) as { respeto?: number; combo?: number; best?: number };
    return { respeto: p.respeto ?? 0, combo: 0, best: p.best ?? 0 };
  } catch {
    return { respeto: 0, combo: 0, best: 0 };
  }
}

function save(m: { respeto: number; best: number }): void {
  try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* private mode */ }
}

const banner = document.createElement('div');
banner.id = 'duty-banner';
banner.style.cssText = 'position:fixed;left:50%;top:18%;transform:translateX(-50%);z-index:30;pointer-events:none;font:700 42px/1 "Lilita One",system-ui,sans-serif;color:#f5c542;text-shadow:0 3px 0 #4b2a6b;display:none;';
document.body.appendChild(banner);

let state = meta();
let timer = 0;
window.addEventListener('duty-event', ((ev: CustomEvent) => {
  const e = ev.detail as { k?: string };
  if (e?.k === 'elim') {
    state.combo += 1;
    state.respeto += 8 + state.combo;
    if (state.combo > state.best) state.best = state.combo;
    save({ respeto: state.respeto, best: state.best });
    banner.textContent = state.combo >= 3 ? `×${state.combo} ¡ÓRALE!` : '¡Fuera!';
    banner.style.display = 'block';
    window.clearTimeout(timer);
    timer = window.setTimeout(() => { banner.style.display = 'none'; }, 900);
  } else if (e?.k === 'end') {
    state.combo = 0;
  }
}) as EventListener);

const mark = document.getElementById('duty-mark');
if (mark) mark.textContent = `First-person remaster · ${state.respeto} respeto · best combo ${state.best}. New voices, original soundtrack.`;
