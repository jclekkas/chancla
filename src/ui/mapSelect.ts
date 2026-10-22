// Map cards for Arcade and Practice: an overhead view drawn from the map's
// own collision boxes (so it is exactly the layout you play), the name, a
// one-line description and the combat style. Plus a Random card.
import { MAPS, type MapId } from '../../shared/maps';
import type { MapData, MapBox } from '../../shared/map';

export type MapChoice = MapId | 'random';

type Text = (key: string) => string;

const FILL: Partial<Record<MapBox['mat'], string>> = {
  stuccoTerracotta: '#d8765a', stuccoCream: '#e9d6b0', stuccoTurquoise: '#7cc7bb', stuccoMarigold: '#f0b45a', stuccoViolet: '#8a6aa8', stuccoPink: '#eb9aac',
  stone: '#cdbb98', step: '#e6d6b4', parapet: '#f4e6c8', planter: '#9c3d2c', fountain: '#5fc7d0', statue: '#f5c542', stall: '#4fb3a9',
  crate: '#8a5a3b', kiosk: '#3f8f6a', bin: '#3d7d5a', wood: '#8a5a3b', table: '#f4e6c8', hedge: '#3c7037', gift: '#e9789a', stage: '#5a3480',
};

const cache = new Map<string, string>();

/** Overhead view as a data URL (cached per map and size). Ground-level boxes only; lintels are drawn as openings. */
export function overhead(map: MapData, w = 360, h = 220, marks = true): string {
  const key = `${map.id}:${w}:${h}:${marks}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (!g) return '';
  const bd = map.bounds;
  const pad = 6;
  const s = Math.min((w - pad * 2) / (bd.maxX - bd.minX + 2), (h - pad * 2) / (bd.maxZ - bd.minZ + 2));
  const ox = w / 2, oz = h / 2;
  const X = (x: number) => ox + x * s, Z = (z: number) => oz + z * s;
  g.fillStyle = '#2e1846';
  g.fillRect(0, 0, w, h);
  g.fillStyle = '#e8c9a0';
  g.fillRect(X(bd.minX), Z(bd.minZ), (bd.maxX - bd.minX) * s, (bd.maxZ - bd.minZ) * s);
  // Low boxes first, tall ones on top; height reads as darkness.
  const boxes = map.boxes.filter((q) => q.minY < 1.8).sort((a, b) => a.maxY - b.maxY);
  for (const q of boxes) {
    g.fillStyle = FILL[q.mat] ?? '#cdbb98';
    g.fillRect(X(q.minX), Z(q.minZ), Math.max(1, (q.maxX - q.minX) * s), Math.max(1, (q.maxZ - q.minZ) * s));
    if (q.maxY >= 2.4) { g.fillStyle = 'rgba(30, 14, 46, 0.28)'; g.fillRect(X(q.minX), Z(q.minZ), (q.maxX - q.minX) * s, (q.maxZ - q.minZ) * s); }
  }
  if (map.decor?.pinata) {
    const p = map.decor.pinata;
    g.fillStyle = '#f5c542';
    g.beginPath(); g.arc(X(p.x), Z(p.z), Math.max(3, s * 0.9), 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#2e1846'; g.lineWidth = 1.5; g.stroke();
  }
  if (marks) {
    for (const [team, col] of [[0, '#f29a2e'], [1, '#36b9c9']] as const) {
      for (const sp of map.spawns[team]) { g.fillStyle = col; g.beginPath(); g.arc(X(sp.x), Z(sp.z), Math.max(2, s * 0.45), 0, Math.PI * 2); g.fill(); }
    }
    for (const p of map.pickups) { g.fillStyle = '#ffffff'; g.fillRect(X(p.x) - 2, Z(p.z) - 2, 4, 4); }
  }
  const url = c.toDataURL('image/png');
  cache.set(key, url);
  return url;
}

/**
 * Renders the cards into `root` as a radio group. `onPick` fires on click or
 * keyboard selection. All maps are unlocked: no progression gates them.
 */
export function renderMapCards(root: HTMLElement, opts: { selected: MapChoice; t: Text; onPick: (c: MapChoice) => void; marks?: boolean }): void {
  root.setAttribute('role', 'radiogroup');
  root.classList.add('map-cards');
  const cards: HTMLButtonElement[] = [];
  const make = (choice: MapChoice, title: string, desc: string, style: string, img: string): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `map-card${choice === 'random' ? ' random' : ''}`;
    b.setAttribute('role', 'radio');
    b.dataset.map = choice;
    const on = opts.selected === choice;
    b.setAttribute('aria-checked', String(on));
    b.classList.toggle('on', on);
    b.tabIndex = on ? 0 : -1;
    const pic = document.createElement('span');
    pic.className = 'mc-pic';
    if (img) pic.style.backgroundImage = `url(${img})`; else pic.textContent = '?';
    const name = document.createElement('b');
    name.className = 'mc-name';
    name.textContent = title;
    const st = document.createElement('span');
    st.className = 'mc-style';
    st.textContent = style;
    const d = document.createElement('span');
    d.className = 'mc-desc';
    d.textContent = desc;
    b.append(pic, name, st, d);
    b.addEventListener('click', () => opts.onPick(choice));
    return b;
  };
  for (const m of MAPS) cards.push(make(m.id, opts.t(m.nameKey), opts.t(m.descKey), opts.t(m.styleKey), overhead(m.data, 360, 220, opts.marks ?? true)));
  cards.push(make('random', opts.t('map.random'), opts.t('map.randomDesc'), opts.t('map.randomStyle'), ''));
  // Arrow keys move the choice, as in any radio group.
  root.onkeydown = (e) => {
    const i = cards.findIndex((c) => c === document.activeElement);
    if (i < 0) return;
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = cards[(i + d + cards.length) % cards.length]!;
    opts.onPick(n.dataset.map as MapChoice);
    (root.querySelector<HTMLButtonElement>(`[data-map="${n.dataset.map}"]`))?.focus();
  };
  root.replaceChildren(...cards);
}
