import './styles.css';
import { inject } from '@vercel/analytics';
import { applyDom, detectLang, setLang, t } from './i18n/i18n';
import type { StringKey } from './i18n/strings';
import { SafeStorage, SettingsStore, ProgressStore, defaultSettings } from './persistence/storage';
import { inputProfile } from './ui/device';
import { installDiag } from './diag';

installDiag('arcade');

// Tiny entry: shows real loading progress, checks WebGL, then loads the
// engine chunk. Failures land on a friendly, actionable screen.

const fill = document.getElementById('boot-fill') as HTMLElement;
const bar = fill.parentElement as HTMLElement;
const status = document.getElementById('boot-status') as HTMLElement;

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
}

async function progress(pct: number, key: StringKey): Promise<void> {
  fill.style.width = `${pct}%`;
  bar.setAttribute('aria-valuenow', String(Math.round(pct)));
  bar.setAttribute('aria-label', t('loading.label'));
  status.textContent = t(key);
  await nextFrame();
}

function showError(kind: 'webgl' | 'load', detail?: unknown): void {
  if (detail) console.error(detail);
  document.getElementById('boot')?.remove();
  document.getElementById('app')?.setAttribute('hidden', '');
  const scr = document.getElementById('screen-error') as HTMLElement;
  (document.getElementById('error-title') as HTMLElement).textContent = t(kind === 'webgl' ? 'error.webglTitle' : 'error.loadTitle');
  (document.getElementById('error-body') as HTMLElement).textContent = t(kind === 'webgl' ? 'error.webglBody' : 'error.loadBody');
  const tips = document.getElementById('error-tips') as HTMLElement;
  tips.innerHTML = '';
  if (kind === 'webgl') {
    for (const k of ['error.tip1', 'error.tip2', 'error.tip3'] as const) {
      const li = document.createElement('li');
      li.textContent = t(k);
      tips.appendChild(li);
    }
  }
  const retry = document.getElementById('btn-error-retry') as HTMLButtonElement;
  retry.textContent = t('error.retry');
  retry.onclick = () => location.reload();
  scr.hidden = false;
  retry.focus();
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return false;
    (gl as WebGLRenderingContext).getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

async function boot(): Promise<void> {
  const storage = new SafeStorage();
  const mobile = inputProfile().touchOnly; // fingers only: start on the light preset
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const settings = new SettingsStore(storage, defaultSettings({ lang: detectLang(), reducedMotion, mobile }));
  const progressStore = new ProgressStore(storage);
  setLang(settings.value.lang);
  applyDom(document);
  const slow = setTimeout(() => { status.textContent = t('loading.slow'); }, 9000);

  await progress(12, 'loading.shell');
  if (!webglAvailable()) {
    clearTimeout(slow);
    showError('webgl');
    return;
  }
  await progress(28, 'loading.engine');
  let mod: typeof import('./bootstrap');
  try {
    mod = await import('./bootstrap');
  } catch (e) {
    clearTimeout(slow);
    showError('load', e);
    return;
  }
  try {
    await mod.start({ storage, settings, progress: progressStore, onProgress: progress });
  } catch (e) {
    clearTimeout(slow);
    const msg = String((e as Error)?.message ?? e);
    showError(/webgl|context/i.test(msg) ? 'webgl' : 'load', e);
    return;
  }
  clearTimeout(slow);
}

// Initialize Vercel Analytics
inject();

void boot();
