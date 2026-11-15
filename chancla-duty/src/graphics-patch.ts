// Upgrades the original first-person renderer without editing it:
// filmic tone mapping, softer shadows, a cheap rim light, and a pixel
// ratio that steps down when a frame runs long so the rate stays up.
import './three-patch';

// Multisample resolve is the expensive part of a software GL present.
// Duty asks for a plain buffer; the original page never loads this file.
const origGetContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, attrs?: unknown) {
  if (type === 'webgl2' || type === 'webgl') {
    const next = { ...(attrs as Record<string, unknown> | undefined), antialias: false, powerPreference: 'high-performance' };
    return origGetContext.call(this, type, next);
  }
  return origGetContext.call(this, type, attrs as never);
} as typeof HTMLCanvasElement.prototype.getContext;
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Engine } from '../../src/fps/engine';
import { ViewModel } from '../../src/fps/render/viewmodel';
import { FpsInput } from '../../src/fps/input';
import { GameSession } from '../../src/net/session';
import type { SimEvent } from '../../shared/sim';
import type { WeaponId } from '../../shared/config';

type Loose = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  frameMs: number;
  fps: number;
  _dutyCap?: number;
  _dutyLit?: boolean;
  _dutyGpu?: string;
  _dutySoftware?: boolean;
  _dutyStamp?: number;
};

function relight(root: THREE.Object3D, software: boolean): void {
  const swapped = new Map<THREE.Material, THREE.Material>();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const next = mats.map((mat) => {
      if (!(mat instanceof THREE.MeshToonMaterial)) return mat;
      const prev = swapped.get(mat);
      if (prev) return prev;
      const lit = software
        ? new THREE.MeshLambertMaterial({
          color: mat.color, map: mat.map, emissive: mat.emissive,
          transparent: mat.transparent, opacity: mat.opacity, side: mat.side,
        })
        : new THREE.MeshStandardMaterial({
          color: mat.color, map: mat.map, emissive: mat.emissive,
          transparent: mat.transparent, opacity: mat.opacity, side: mat.side,
          roughness: 0.52, metalness: 0.08,
        });
      swapped.set(mat, lit);
      return lit;
    });
    mesh.material = Array.isArray(mesh.material) ? next : next[0]!;
  });
}

function plasterTexture(): THREE.CanvasTexture {
  const el = document.createElement('canvas');
  el.width = 512; el.height = 512;
  const c = el.getContext('2d')!;
  c.fillStyle = '#fff';
  c.fillRect(0, 0, 512, 512);
  for (let y = 0; y < 512; y += 28) {
    c.fillStyle = 'rgba(80,40,20,0.07)';
    c.fillRect(0, y, 512, 2);
    for (let x = (y / 28) % 2 ? 0 : 46; x < 512; x += 92) {
      c.fillStyle = 'rgba(90,50,30,0.05)';
      c.fillRect(x, y + 4, 86, 20);
    }
  }
  c.fillStyle = 'rgba(60,30,20,0.18)';
  c.fillRect(0, 430, 512, 82);
  c.fillStyle = 'rgba(255,220,160,0.35)';
  c.fillRect(0, 418, 512, 8);
  const tex = new THREE.CanvasTexture(el);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

function dressCourtyard(scene: THREE.Scene): void {
  const plaster = plasterTexture();
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      const lit = mat as THREE.MeshLambertMaterial;
      const img = lit.map?.image as { width?: number } | undefined;
      if (img?.width !== 256) continue;
      lit.map = plaster;
      lit.needsUpdate = true;
    }
  });
}

const origUseMap = Engine.prototype.useMap;
Engine.prototype.useMap = function (id: string | undefined) {
  origUseMap.call(this, id);
  const self = this as unknown as Loose;
  if (self._dutyGpu === undefined) return;
  relight(self.scene, !!self._dutySoftware);
  dressCourtyard(self.scene);
};

const origStart = Engine.prototype.start;
Engine.prototype.start = function () {
  const self = this as unknown as Loose;
  const r = self.renderer;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.18;
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
  if (!self._dutyLit) {
    self._dutyLit = true;
    const rim = new THREE.DirectionalLight(0xffc9a0, 0.45);
    rim.position.set(18, 22, -14);
    const fill = new THREE.HemisphereLight(0xfff0d8, 0x5a3040, 0.28);
    self.scene.add(rim, fill);
  }
  const gl = r.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
  const software = /swiftshader|llvmpipe|softpipe|software/i.test(gpu);
  self._dutyGpu = gpu;
  self._dutySoftware = software;
  self._dutyCap = software ? 1 : 1.25;
  const sun = (this as unknown as { world?: { sun?: THREE.DirectionalLight } }).world?.sun;
  if (sun) {
    sun.shadow.mapSize.set(software ? 512 : 1024, software ? 512 : 1024);
    sun.castShadow = true;
    sun.shadow.autoUpdate = !software;
  }
  const vm = (this as unknown as { vmScene?: THREE.Scene }).vmScene;
  relight(self.scene, software);
  if (vm) relight(vm, software);
  if (!software) {
    try {
      const pmrem = new THREE.PMREMGenerator(r);
      self.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    } catch { /* environment is optional */ }
  }
  dressCourtyard(self.scene);
  r.shadowMap.autoUpdate = !software;
  origStart.call(this);
  if (software) {
    let n = 0;
    const draw = r.render.bind(r);
    r.render = ((scene: THREE.Scene, camera: THREE.Camera) => {
      n++;
      r.shadowMap.needsUpdate = n % 2 === 0;
      draw(scene, camera);
    }) as typeof r.render;
  }
  (window as unknown as { __duty?: { gpu: string; calls: () => number; engine: Engine } }).__duty = {
    gpu,
    calls: () => r.info.render.calls,
    engine: this,
  };
};

const origResize = Engine.prototype.resize;
Engine.prototype.resize = function () {
  origResize.call(this);
  const self = this as unknown as Loose;
  const cap = self._dutyCap ?? 1.05;
  const pr = Math.min(window.devicePixelRatio || 1, cap);
  const canvas = self.renderer.domElement;
  self.renderer.setPixelRatio(pr);
  self.renderer.setSize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, false);
};

const origFrame = (Engine.prototype as unknown as { frame: (now: number) => void }).frame;
(Engine.prototype as unknown as { frame: (now: number) => void }).frame = function (now: number) {
  origFrame.call(this, now);
  const self = this as unknown as Loose;
  const prev = self._dutyCap ?? 1;
  const nowMs = performance.now();
  const gap = nowMs - (self._dutyStamp ?? nowMs);
  self._dutyStamp = nowMs;
  const ceiling = self._dutySoftware ? 1 : 1.5;
  const floor = self._dutySoftware ? 0.7 : 0.85;
  const locked = sessionStorage.getItem('duty-lock') === '1';
  let next = locked ? prev : prev;
  if (!locked && gap > 22) next = Math.max(floor, prev - 0.08);
  else if (!locked && gap > 5 && gap < 14) next = Math.min(ceiling, prev + 0.03);
  self._dutyCap = next;
  if (Math.abs(next - prev) > 0.02) Engine.prototype.resize.call(this);
  if (document.body) document.body.dataset['dutyFps'] = String(Math.round(self.fps || 0));
  const box = (window as unknown as { __duty?: { cap?: number; frameMs?: number } }).__duty;
  if (box) { box.cap = self._dutyCap; box.frameMs = self.frameMs; }
};

const origEvent = Engine.prototype.onEvent;
Engine.prototype.onEvent = function (this: Engine, e: SimEvent) {
  origEvent.call(this, e);
  window.dispatchEvent(new CustomEvent('duty-event', { detail: e }));
};

const origVm = ViewModel.prototype.update;
ViewModel.prototype.update = function (s, dt, reduced) {
  origVm.call(this, s, dt, reduced);
  const hand = this as unknown as { rig: { sandal: { visible: boolean } }; heavy: { visible: boolean } };
  if (s.weapon >= 2) {
    hand.rig.sandal.visible = true;
    hand.heavy.visible = false;
  }
};

const dutyKeys = { weapon: null as WeaponId | null, dash: false, recall: false, legend: false, hold: 0 };
window.addEventListener('keydown', (e) => {
  if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  const shoes: Record<string, WeaponId> = { Digit3: 2, Digit4: 3, Digit5: 4 };
  const shoe = shoes[e.code];
  if (shoe !== undefined && dutyUnlocked(shoe)) dutyKeys.weapon = shoe;
  if (e.code === 'KeyV') dutyKeys.dash = true;
  if (e.code === 'KeyR') dutyKeys.recall = true;
  if (e.code === 'KeyG') dutyKeys.legend = true;
});

function dutyUnlocked(id: WeaponId): boolean {
  if (id < 2) return true;
  try {
    const raw = localStorage.getItem('chancla-duty-fps-meta');
    const owned = raw ? (JSON.parse(raw) as { shoes?: number[] }).shoes ?? [] : [];
    return owned.includes(id);
  } catch { return false; }
}

const origSample = FpsInput.prototype.sample;
FpsInput.prototype.sample = function () {
  const c = origSample.call(this);
  if (dutyKeys.weapon !== null) this.weapon = dutyKeys.weapon;
  if (c.fire) {
    if (!dutyKeys.hold) dutyKeys.hold = performance.now();
  } else dutyKeys.hold = 0;
  const charge = dutyKeys.hold ? Math.min(1, (performance.now() - dutyKeys.hold) / 640) : 0;
  const dash = dutyKeys.dash; dutyKeys.dash = false;
  const recall = dutyKeys.recall; dutyKeys.recall = false;
  const legend = dutyKeys.legend; dutyKeys.legend = false;
  return { ...c, weapon: this.weapon, dash, recall, legend, charge };
};

const origSend = GameSession.prototype.send;
GameSession.prototype.send = function (msg) {
  if (msg.t === 'create' && sessionStorage.getItem('duty-endless') === '1') msg = { ...msg, endless: true };
  origSend.call(this, msg);
};
