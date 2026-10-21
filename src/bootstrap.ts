import * as THREE from 'three';
import { App } from './app';
import { Game } from './game/game';
import type { SafeStorage, SettingsStore, ProgressStore } from './persistence/storage';
import type { StringKey } from './i18n/strings';
import { applyDom } from './i18n/i18n';

export interface StartOptions {
  storage: SafeStorage;
  settings: SettingsStore;
  progress: ProgressStore;
  onProgress(pct: number, key: StringKey): Promise<void>;
}

declare global {
  interface Window {
    __chancla?: {
      app: App;
      snapshot(): Record<string, unknown>;
    };
  }
}

async function precompile(renderer: THREE.WebGLRenderer, scene: THREE.Object3D, cam: THREE.Camera): Promise<void> {
  const hidden: THREE.Object3D[] = [];
  scene.traverse((o) => {
    if (!o.visible) {
      hidden.push(o);
      o.visible = true;
    }
  });
  try {
    await renderer.compileAsync(scene, cam);
  } catch {
    try { renderer.compile(scene, cam); } catch { /* compile lazily instead */ }
  } finally {
    for (const o of hidden) o.visible = false;
  }
}

export async function start(o: StartOptions): Promise<App> {
  const quality = o.settings.value.quality;
  const renderer = new THREE.WebGLRenderer({
    antialias: quality !== 'low',
    powerPreference: 'high-performance',
    alpha: false,
    stencil: false,
  });
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(0xf6a76b);
  await o.onProgress(52, 'loading.world');
  const game = new Game();
  await o.onProgress(78, 'loading.shaders');
  const cam = new THREE.PerspectiveCamera(74, 1.6, 0.1, 200);
  cam.position.set(0, 1.6, 15);
  const app = new App(renderer, game, o.storage, o.settings, o.progress);
  // Precompile every shader, including objects that start hidden (chanclas,
  // trails, enemies, hazards, the hand), so the first throw never hitches.
  await precompile(renderer, game.scene, cam);
  await precompile(renderer, app.vmScene, app.vmCamera);
  await o.onProgress(100, 'loading.ready');
  document.getElementById('app')?.removeAttribute('hidden');
  document.getElementById('boot')?.remove();
  applyDom(document);
  app.resize();
  window.__chancla = { app, snapshot: () => app.debugSnapshot() };
  (document.getElementById('btn-play') as HTMLElement | null)?.focus({ preventScroll: true });
  return app;
}
