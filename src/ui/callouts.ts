import * as THREE from 'three';

// Floating shouts, point pops and enemy speech bubbles, projected from
// world space every frame. A fixed pool of DOM nodes is reused.
interface Item {
  el: HTMLDivElement;
  active: boolean;
  pos: THREE.Vector3;
  t: number;
  life: number;
  rise: number;
  pop: boolean;
}

const v = new THREE.Vector3();

export class Callouts {
  private items: Item[] = [];
  reducedMotion = false;

  constructor(root: HTMLElement, size = 18) {
    for (let i = 0; i < size; i++) {
      const el = document.createElement('div');
      el.className = 'callout';
      el.style.display = 'none';
      root.appendChild(el);
      this.items.push({ el, active: false, pos: new THREE.Vector3(), t: 0, life: 1, rise: 0, pop: true });
    }
  }

  private take(): Item {
    let it = this.items.find((i) => !i.active);
    if (!it) {
      // Recycle the oldest.
      it = this.items.reduce((a, b) => (a.t / a.life > b.t / b.life ? a : b));
    }
    return it;
  }

  spawn(text: string, x: number, y: number, z: number, cls: string, life = 0.95, rise = 0.9): void {
    const it = this.take();
    it.active = true;
    it.pos.set(x + (Math.random() - 0.5) * 0.4, y, z + (Math.random() - 0.5) * 0.4);
    it.t = 0;
    it.life = life;
    it.rise = rise;
    it.pop = cls !== 'speech';
    it.el.className = `callout ${cls}`;
    it.el.textContent = text;
    it.el.style.display = 'block';
  }

  clear(): void {
    for (const it of this.items) {
      it.active = false;
      it.el.style.display = 'none';
    }
  }

  get activeCount(): number {
    return this.items.filter((i) => i.active).length;
  }

  update(dt: number, camera: THREE.Camera, w: number, h: number): void {
    for (const it of this.items) {
      if (!it.active) continue;
      it.t += dt;
      if (it.t >= it.life) {
        it.active = false;
        it.el.style.display = 'none';
        continue;
      }
      v.copy(it.pos);
      v.y += it.rise * it.t;
      v.project(camera);
      if (v.z > 1 || v.z < -1) {
        it.el.style.opacity = '0';
        continue;
      }
      const sx = (v.x + 1) * 0.5 * w;
      const sy = (1 - v.y) * 0.5 * h;
      const k = it.t / it.life;
      const popK = Math.min(1, it.t / 0.12);
      const scale = it.pop && !this.reducedMotion ? 1 + (1 - popK) * 0.5 : 1;
      const alpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      it.el.style.opacity = alpha.toFixed(2);
      it.el.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) translate(-50%, -50%) scale(${scale.toFixed(2)})`;
    }
  }
}
