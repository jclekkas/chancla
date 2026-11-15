// Upgrades the original first-person renderer without editing it:
// filmic tone mapping, softer shadows, a cheap rim light, and a pixel
// ratio that steps down when a frame runs long so the rate stays up.
import * as THREE from 'three';
import { Engine } from '../../src/fps/engine';
import type { SimEvent } from '../../shared/sim';

type Loose = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  frameMs: number;
  fps: number;
  _dutyCap?: number;
  _dutyLit?: boolean;
};

const origStart = Engine.prototype.start;
Engine.prototype.start = function () {
  const self = this as unknown as Loose;
  const r = self.renderer;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.08;
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
  if (!self._dutyLit) {
    self._dutyLit = true;
    const rim = new THREE.DirectionalLight(0xffc9a0, 0.45);
    rim.position.set(18, 22, -14);
    const fill = new THREE.HemisphereLight(0xfff0d8, 0x5a3040, 0.28);
    self.scene.add(rim, fill);
  }
  self._dutyCap = 1.35;
  origStart.call(this);
};

const origResize = Engine.prototype.resize;
Engine.prototype.resize = function () {
  origResize.call(this);
  const self = this as unknown as Loose;
  const cap = self._dutyCap ?? 1.35;
  const pr = Math.min(window.devicePixelRatio || 1, cap);
  const canvas = self.renderer.domElement;
  self.renderer.setPixelRatio(pr);
  self.renderer.setSize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, false);
};

const origFrame = (Engine.prototype as unknown as { frame: (now: number) => void }).frame;
(Engine.prototype as unknown as { frame: (now: number) => void }).frame = function (now: number) {
  origFrame.call(this, now);
  const self = this as unknown as Loose;
  const ms = self.frameMs;
  if (ms > 20) self._dutyCap = Math.max(0.8, (self._dutyCap ?? 1.35) - 0.1);
  else if (ms > 0 && ms < 12) self._dutyCap = Math.min(1.5, (self._dutyCap ?? 1.35) + 0.02);
  if (document.body) document.body.dataset['dutyFps'] = String(Math.round(self.fps || 0));
};

const origEvent = Engine.prototype.onEvent;
Engine.prototype.onEvent = function (this: Engine, e: SimEvent) {
  origEvent.call(this, e);
  window.dispatchEvent(new CustomEvent('duty-event', { detail: e }));
};
