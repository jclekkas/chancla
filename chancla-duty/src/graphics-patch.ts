// Installs Chancla Duty's own scene on the shared match loop.
// The Warfare page does not import this file.
import { DutyScene } from './scene';
import { Engine } from '../../src/fps/engine';
import { FpsInput } from '../../src/fps/input';
import { GameSession } from '../../src/net/session';
import type { SimEvent } from '../../shared/sim';
import type { WeaponId } from '../../shared/config';
import type { WorldOptions } from '../../src/fps/render/world';
import * as THREE from 'three';

(globalThis as { __DUTY_SCENE?: boolean }).__DUTY_SCENE = true;

const origGetContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, attrs?: unknown) {
  if (String(type).indexOf('webgl') === 0) {
    const next = { ...(attrs as Record<string, unknown> | undefined), antialias: false, powerPreference: 'high-performance' };
    return origGetContext.call(this, type, next);
  }
  return origGetContext.call(this, type, attrs as never);
} as typeof HTMLCanvasElement.prototype.getContext;

let duty: DutyScene | null = null;
let highRender: ((scene: THREE.Scene, camera: THREE.Camera) => void) | null = null;
let frameStart = 0;
let rendering = false;

function gpuName(renderer: THREE.WebGLRenderer): { name: string; software: boolean } {
  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const name = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
  return { name, software: /swiftshader|llvmpipe|softpipe|software/i.test(name) };
}

const origSetWorld = Engine.prototype.setWorld;
Engine.prototype.setWorld = function (opts: WorldOptions) {
  origSetWorld.call(this, opts);
  this.world.group.visible = false;
  duty?.rebuild(opts);
  if (duty) void duty.useCompressedGrain(this.renderer);
  const p = opts.map?.decor?.pinata;
  if (p) this.world.pinata = { x: p.x, y: p.y, z: p.z, r: 0.6, hit: () => duty?.spinPinata() };
};

const origStart = Engine.prototype.start;
Engine.prototype.start = function () {
  origStart.call(this);
  const gpu = gpuName(this.renderer);
  const asked = new URLSearchParams(location.search).get('quality');
  const tier = asked === 'high' || asked === 'medium' || asked === 'fast' ? asked : (gpu.software ? 'fast' : 'high');
  duty = new DutyScene(tier);
  duty.stats.gpu = gpu.name;
  duty.rebuild({});
  this.scene.add(duty.root);
  this.world.group.visible = false;
  this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  this.renderer.toneMappingExposure = tier === 'high' ? 1.12 : 1.08;
  this.renderer.outputColorSpace = THREE.SRGBColorSpace;
  this.renderer.shadowMap.enabled = tier !== 'fast';
  this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  this.renderer.setPixelRatio(1);
  for (const vm of duty.viewmodels) this.vmScene.add(vm);
  const stats = duty.stats;
  (window as unknown as { __duty?: unknown }).__duty = { engine: this, scene: duty, stats, gpu: gpu.name, ready: false };
  duty.bind(this.renderer, this.scene);
  installRender(this);
  void duty.useCompressedGrain(this.renderer);
  if (tier === 'high') {
    void duty.enableHigh(this.renderer, this.scene, this.camera).then((render) => {
      highRender = render;
      (window as unknown as { __duty?: { ready?: boolean } }).__duty!.ready = true;
    });
  } else {
    (window as unknown as { __duty?: { ready?: boolean } }).__duty!.ready = true;
  }
  const shot = new URLSearchParams(location.search).get('shot');
  if (shot && duty) {
    const views: Record<string, { map: string; pos: [number, number, number]; look: [number, number, number]; hand: boolean }> = {
      plaza: { map: 'plaza', pos: [0.2, 2.05, 8.4], look: [0, 1.6, -6], hand: false },
      street: { map: 'plaza', pos: [1.2, 1.75, 7.6], look: [0, 1.6, -4], hand: true },
      cast: { map: 'plaza', pos: [0.1, 1.65, 7.5], look: [0.05, 1.15, 4.5], hand: false },
      abuela: { map: 'plaza', pos: [0.55, 1.38, 6.35], look: [0, 1.15, 4.5], hand: false },
      patio: { map: 'patio', pos: [1.5, 1.65, 7.2], look: [-2, 1.5, -6], hand: true },
    };
    const view = views[shot] ?? views.plaza!;
    const engine = this;
    const frameShot = () => {
      const box = (window as unknown as { __duty?: { assets?: boolean } }).__duty;
      if (!box?.assets) { window.setTimeout(frameShot, 300); return; }
      document.querySelectorAll<HTMLElement>('.screen, #click-to-play, button, .panel').forEach((el) => { el.style.visibility = 'hidden'; });
      duty!.handForShot = view.hand;
      engine.setShowcase(view.map, view.pos, view.look);
      document.body.dataset['shot'] = 'ready';
    };
    window.setTimeout(frameShot, 400);
  }
};

const origResize = Engine.prototype.resize;
Engine.prototype.resize = function () {
  origResize.call(this);
  const software = duty?.stats.tier !== 'high';
  const pr = Math.min(window.devicePixelRatio || 1, software ? 1 : 1.5);
  const canvas = this.renderer.domElement;
  this.renderer.setPixelRatio(pr);
  this.renderer.setSize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, false);
};

const origFrame = (Engine.prototype as unknown as { frame: (now: number) => void }).frame;
(Engine.prototype as unknown as { frame: (now: number) => void }).frame = function (now: number) {
  const engine = this as unknown as Engine;
  frameStart = performance.now();
  duty?.sync(engine, now);
  origFrame.call(engine, now);
  if (duty && document.body) document.body.dataset['dutyFps'] = String(Math.round(engine.fps || 0));
};

function installRender(engine: Engine): void {
  const orig = engine.renderer.render.bind(engine.renderer);
  engine.renderer.render = (scene: THREE.Scene, camera: THREE.Camera) => {
    if (scene === engine.scene) {
      for (const child of engine.scene.children) {
        if (child.name === 'duty-scene' || child.name === 'mission-view') continue;
        if (engine.mode === 'controller' && child === engine.proj.group) continue;
        child.visible = false;
      }
      if (duty && frameStart) {
        duty.stats.cpuMs = performance.now() - frameStart;
        duty.stats.frames++;
        frameStart = 0;
      }
    }
    if (scene === engine.vmScene) {
      engine.vm.root.visible = false;
      engine.vmScene.background = null;
    }
    if (!rendering && highRender && scene === engine.scene) {
      rendering = true;
      highRender(scene, camera);
      rendering = false;
      if (duty?.handForShot) {
        engine.vm.root.visible = false;
        engine.renderer.setRenderTarget(null);
        engine.renderer.autoClear = false;
        engine.renderer.autoClearColor = false;
        engine.renderer.clearDepth();
        orig(engine.vmScene, engine.vmCamera);
      }
    } else orig(scene, camera);
    if (duty && scene === engine.scene && engine.renderer.info.render.calls > 4) {
      duty.stats.calls = engine.renderer.info.render.calls;
      duty.stats.triangles = engine.renderer.info.render.triangles;
    }
  };
}

const origEvent = Engine.prototype.onEvent;
Engine.prototype.onEvent = function (this: Engine, e: SimEvent) {
  origEvent.call(this, e);
  window.dispatchEvent(new CustomEvent('duty-event', { detail: e }));
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
  if (c.fire) { if (!dutyKeys.hold) dutyKeys.hold = performance.now(); }
  else dutyKeys.hold = 0;
  const charge = dutyKeys.hold ? Math.min(1, (performance.now() - dutyKeys.hold) / 640) : 0;
  const dash = dutyKeys.dash; dutyKeys.dash = false;
  const recall = dutyKeys.recall; dutyKeys.recall = false;
  const legend = dutyKeys.legend; dutyKeys.legend = false;
  const box = document.getElementById('duty-charge');
  if (box) box.style.transform = `scaleX(${charge})`;
  return { ...c, weapon: this.weapon, dash, recall, legend, charge };
};

const origSend = GameSession.prototype.send;
GameSession.prototype.send = function (msg) {
  if (msg.t === 'create' && sessionStorage.getItem('duty-endless') === '1') msg = { ...msg, endless: true };
  origSend.call(this, msg);
};
