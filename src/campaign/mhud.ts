// Mission HUD: objective panel with counters and progress, mission clock,
// Rosa's portrait filling with recovered ruleros, the piñata phase bar,
// and an edge arrow toward the current objective when it is off screen.
import * as THREE from 'three';
import type { MissionSim } from '../../shared/campaign/mission';
import type { MHint } from '../../shared/campaign/hints';
import type { MissionDef } from '../../shared/campaign/types';
import { PINATA } from '../../shared/campaign/pinata';
import { t, hasKey, type Key } from '../fps/strings';
import { rosaSVG, svgUrl } from '../ui/art';
import type { MissionView } from './view';

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const V = new THREE.Vector3();

export class MissionHud {
  private cache = new Map<string, string>();
  private tipT = 0;
  private cpT = 0;

  constructor(private def: MissionDef) {
    $('m-portrait').style.backgroundImage = svgUrl(rosaSVG('smirk', 'face'));
    const counter = def.config?.counter as string | undefined;
    $('m-counter').hidden = !counter;
    $('m-curlers').hidden = counter !== 'rulero';
    $('m-boss').hidden = def.id !== 'pinata';
  }

  private set(k: string, v: string, f: () => void): void {
    if (this.cache.get(k) === v) return;
    this.cache.set(k, v);
    f();
  }

  show(on: boolean): void {
    $('m-hud').hidden = !on;
    document.getElementById('hud')?.classList.toggle('campaign', on);
    if (!on) document.getElementById('hud')?.classList.remove('victory');
    if (!on) { $('m-tip').hidden = true; $('m-arrow').hidden = true; }
    this.cache.clear();
  }

  /** Victory presentation: hide everything but subtitles and the skip hint. */
  victory(on: boolean): void {
    document.getElementById('hud')?.classList.toggle('victory', on);
  }

  pop(): void {
    const c = $('m-counter');
    c.classList.remove('pop');
    void c.offsetWidth;
    c.classList.add('pop');
  }

  stageChanged(): void { this.cache.delete('goals'); this.cache.delete('stage'); }

  checkpoint(): void {
    this.cpT = 1.6;
    $('m-cp').hidden = false;
  }

  tip(h: MHint): void {
    const k = h.need === 'bank' ? 'tip.bank' : h.need === 'heavy' ? 'tip.heavy' : h.open === false ? 'tip.timing' : h.kind === 'wait' ? 'tip.wait' : 'tip.default';
    $('m-tip').textContent = t(k as Key);
    $('m-tip').hidden = false;
    this.tipT = 7;
  }

  update(sim: MissionSim, focus: MHint | null, hints: boolean, cam: THREE.Camera, w: number, h: number, view: MissionView): void {
    const st = sim.state;
    const sd = sim.stageDef;
    this.set('title', this.def.title, () => ($('m-title').textContent = t(this.def.title as Key)));
    this.set('stage', sd.title, () => ($('m-stage').textContent = t(sd.title as Key)));
    const goals = sd.goals.map((g, i) => {
      const gs = st.goals[i]!;
      if (g.kind === 'defend') return `${g.id}:${gs.done}:${Math.floor(gs.progress * 100)}:${gs.disruptedMs > 0 ? 1 : 0}`;
      return `${g.id}:${gs.done}:${gs.count}`;
    }).join('|');
    this.set('goals', goals, () => {
      const ul = $('m-goals');
      const rows = sd.goals.map((g, i) => {
        const gs = st.goals[i]!;
        const li = document.createElement('li');
        li.className = gs.done ? 'done' : '';
        const label = document.createElement('span');
        label.textContent = hasKey(g.label) ? t(g.label as Key) : g.label;
        li.appendChild(label);
        if (g.kind === 'collect' || g.kind === 'flags') {
          const n = document.createElement('b');
          n.textContent = `${gs.count}/${gs.total}`;
          li.appendChild(n);
        }
        if (g.kind === 'defend') {
          const bar = document.createElement('div');
          bar.className = `m-bar${gs.disruptedMs > 0 ? ' warn' : ''}`;
          const fill = document.createElement('i');
          fill.style.width = `${(gs.progress * 100).toFixed(1)}%`;
          bar.appendChild(fill);
          for (let k = 1; k < g.segments; k++) { const tick = document.createElement('u'); tick.style.left = `${(k / g.segments) * 100}%`; bar.appendChild(tick); }
          li.appendChild(bar);
        }
        return li;
      });
      ul.replaceChildren(...rows);
    });
    const secs = Math.floor(st.timeMs / 1000);
    this.set('clock', String(secs), () => ($('m-timer').textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`));

    const counter = this.def.config?.counter as string | undefined;
    if (counter) {
      const total = (this.def.config?.total as number) ?? st.pickups.filter((p) => p.item === counter).length;
      const n = st.pickups.filter((p) => p.item === counter && (p.state === 'collected' || p.state === 'delivered')).length;
      this.set('count', `${n}/${total}`, () => {
        $('m-count').textContent = `${n}/${total}`;
        document.querySelectorAll<HTMLElement>('#m-curlers i').forEach((el, i) => el.classList.toggle('on', i < n));
      });
    }
    if (this.def.id === 'pinata' && st.pinata) {
      const s = st.pinata;
      const broken = s.tips.filter((x) => x.hp <= 0).length;
      const label = s.defeated ? '' : s.phase === 1 ? `${broken}/${PINATA.phase1Tips}` : s.phase === 2 ? `${s.decoys.filter((d) => !d.alive).length + (s.wave - 1) * PINATA.decoysPerWave}/${PINATA.decoysPerWave * PINATA.decoyWaves} · ${broken}/5` : `${PINATA.coreHp - s.coreHp}/${PINATA.coreHp}`;
      this.set('boss', `${s.phase}:${label}`, () => {
        $('m-boss-name').textContent = t(`m4.phase${s.phase}` as Key);
        $('m-boss-n').textContent = label;
        document.querySelectorAll<HTMLElement>('#m-boss-pips i').forEach((el, i) => { el.classList.toggle('on', i < s.phase); el.classList.toggle('cur', i === s.phase - 1); });
      });
    }

    // Off-screen objective arrow.
    const arrow = $('m-arrow');
    const pos = hints && focus ? view.focusPos(focus.id) : null;
    if (pos) {
      V.copy(pos).project(cam);
      const behind = V.z > 1;
      const on = !behind && Math.abs(V.x) < 0.92 && Math.abs(V.y) < 0.88;
      arrow.hidden = on;
      if (!on) {
        let x = V.x, y = V.y;
        if (behind) { x = -x; y = -y; }
        const ang = Math.atan2(y, x);
        const r = 0.82;
        const sx = (Math.cos(ang) * r + 1) / 2 * w, sy = (1 - (Math.sin(ang) * r + 1) / 2) * h;
        arrow.style.transform = `translate(${sx.toFixed(0)}px, ${sy.toFixed(0)}px) rotate(${(-ang * 180 / Math.PI).toFixed(0)}deg)`;
      }
    } else arrow.hidden = true;

    if (this.tipT > 0 && (this.tipT -= 1 / 60) <= 0) $('m-tip').hidden = true;
    if (this.cpT > 0 && (this.cpT -= 1 / 60) <= 0) $('m-cp').hidden = true;
  }
}
