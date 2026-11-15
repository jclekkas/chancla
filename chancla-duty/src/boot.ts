// Chancla Duty boots the original first-person game, then wears a sharper light
// and a new voice. The Warfare page at / is not imported from here.
import './graphics-patch';
import './voice-patch';
import '../../src/fps/main.ts';

const KEY = 'chancla-duty-fps-meta';

function meta(): { respeto: number; combo: number; best: number; shoes: number[] } {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { respeto: 40, combo: 0, best: 0, shoes: [] };
    const p = JSON.parse(raw) as { respeto?: number; combo?: number; best?: number; shoes?: number[] };
    return { respeto: p.respeto ?? 0, combo: 0, best: p.best ?? 0, shoes: p.shoes ?? [] };
  } catch {
    return { respeto: 40, combo: 0, best: 0, shoes: [] };
  }
}

function save(m: { respeto: number; best: number; shoes: number[] }): void {
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
    save({ respeto: state.respeto, best: state.best, shoes: state.shoes });
    banner.textContent = state.combo >= 3 ? `×${state.combo} ¡ÓRALE!` : '¡Fuera!';
    banner.style.display = 'block';
    window.clearTimeout(timer);
    timer = window.setTimeout(() => { banner.style.display = 'none'; }, 900);
  } else if (e?.k === 'end') {
    state.combo = 0;
  }
}) as EventListener);

const mark = document.getElementById('duty-mark');
function paintMark(): void {
  if (mark) mark.textContent = `First-person remaster · ${state.respeto} respeto · best combo ${state.best}. Keys 3–5 shoes, V dash, R recall, G La Legendaria. Hold throw to charge.`;
}
paintMark();

const shop = document.createElement('div');
shop.id = 'duty-shop';
shop.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:40;display:flex;flex-direction:column;gap:6px;font:600 13px/1.2 system-ui,sans-serif;';
const SHOES = [
  { id: 2, name: 'La Huarache', cost: 30 },
  { id: 3, name: 'Las Gemelas', cost: 55 },
  { id: 4, name: 'El Tacón', cost: 80 },
];
function paintShop(): void {
  shop.replaceChildren();
  for (const shoe of SHOES) {
    const b = document.createElement('button');
    const owned = state.shoes.includes(shoe.id);
    b.type = 'button';
    b.textContent = owned ? `${shoe.name} · owned` : `${shoe.name} · ${shoe.cost} respeto`;
    b.disabled = owned;
    b.style.cssText = 'border:0;border-radius:999px;padding:8px 12px;background:#2a1840;color:#ffe7a8;cursor:pointer;';
    b.addEventListener('click', () => {
      if (state.shoes.includes(shoe.id) || state.respeto < shoe.cost) return;
      state.respeto -= shoe.cost;
      state.shoes.push(shoe.id);
      save({ respeto: state.respeto, best: state.best, shoes: state.shoes });
      paintMark();
      paintShop();
    });
    shop.appendChild(b);
  }
  const endless = document.createElement('button');
  endless.type = 'button';
  const on = sessionStorage.getItem('duty-endless') === '1';
  endless.textContent = on ? 'Endless waves: on' : 'Endless waves: off';
  endless.style.cssText = 'border:0;border-radius:999px;padding:8px 12px;background:#6b2a4b;color:#fff;cursor:pointer;';
  endless.addEventListener('click', () => {
    sessionStorage.setItem('duty-endless', on ? '0' : '1');
    paintShop();
  });
  shop.appendChild(endless);
}
paintShop();
document.body.appendChild(shop);
document.title = 'Chancla Duty';
const charge = document.createElement('div');
charge.id = 'duty-charge';
charge.style.cssText = 'position:fixed;left:50%;bottom:92px;width:140px;height:6px;margin-left:-70px;transform-origin:left center;transform:scaleX(0);background:#f5c542;border-radius:99px;z-index:25;pointer-events:none;';
document.body.appendChild(charge);
const hud = document.getElementById('hud');
if (hud) {
  const syncShop = (): void => { shop.hidden = !hud.hidden; };
  new MutationObserver(syncShop).observe(hud, { attributes: true, attributeFilter: ['hidden'] });
}
