// Diagnostics for "the game froze" reports: a small, bounded record of what
// just happened (errors, lifecycle, connection), plus a snapshot of current
// state, that a player can copy and paste to us. Nothing leaves the device
// unless the player copies it themselves; there is no telemetry.
//
// What it can and cannot see:
// - Errors, rejected promises, frame gaps and long main-thread stalls are
//   recorded after they happen. A main thread that is blocked right now
//   cannot report anything until it is unblocked.
// - A breadcrumb (a few hundred bytes in localStorage, updated every few
//   seconds) survives a reload, so a session that ended without a normal
//   page unload shows up in the next session's report.
//
// Privacy: no player names, room codes, invite links, resume tokens or
// settings values. Text is cut to a short length and anything that looks
// like a room code or URL fragment is removed.

declare const __BUILD_ID__: string;

const MAX_EVENTS = 80;
const MAX_TEXT = 220;
const CRUMB_KEY = 'chancla.diag.v1';
const BUILD = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

export interface DiagEvent { t: number; k: string; m: string }
type Provider = () => Record<string, unknown>;

const events: DiagEvent[] = [];
const providers = new Map<string, Provider>();
const t0 = performance.now();
let errors = 0;
let installed = false;
let previous: Record<string, unknown> | null = null;
let entry = 'unknown';
let visibleSince = performance.now();

/** Milliseconds since the page last became visible (frames legitimately stop while hidden). */
export function diagVisibleFor(): number { return document.visibilityState === 'visible' ? performance.now() - visibleSince : 0; }

/** Strips anything that could identify a player or a room. */
export function sanitize(s: string): string {
  return s
    .replace(/#[^\s)'"]*/g, '#…') // URL fragments (invite links carry #room=CODE)
    .replace(/\b((?:room|code|resume|token|name)=)[^&\s]*/gi, '$1…')
    .replace(/(?:https?|wss?):\/\/[^\s)'"]+/g, (u) => u.replace(/[?#].*$/, '').split('/').slice(3).filter(Boolean).pop() ?? '(site)') // keep just the file name
    .replace(/\b[A-HJ-NP-Z2-9]{8}\b/g, '[code]') // anything shaped like a room code (8 of CODE_ALPHABET)
    .slice(0, MAX_TEXT);
}

export function diagLog(k: string, m: string): void {
  events.push({ t: Math.round(performance.now() - t0), k, m: sanitize(m) });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  if (k === 'error') { errors++; saveCrumb(); }
}

export function diagError(where: string, err: unknown): void {
  const e = err as { message?: string; stack?: string } | null;
  const msg = e?.message ?? String(err);
  const at = (e?.stack ?? '').split('\n').slice(1, 3).map((l) => l.trim()).join(' | ');
  diagLog('error', `${where}: ${msg}${at ? ` @ ${at}` : ''}`);
}

/** Registers live state for the report (called on every snapshot, so keep it cheap). */
export function diagProvide(name: string, p: Provider): void { providers.set(name, p); }

export function diagErrorCount(): number { return errors; }

/** The commit and environment this build came from. */
export function diagBuild(): string { return BUILD; }

function state(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, p] of providers) {
    try { out[name] = p(); } catch (err) { out[name] = `unavailable (${(err as Error)?.message ?? err})`; }
  }
  return out;
}

function memory(): string | undefined {
  const m = (performance as unknown as { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  return m ? `${Math.round(m.usedJSHeapSize / 1048576)} MB of ${Math.round(m.jsHeapSizeLimit / 1048576)} MB` : undefined;
}

export function diagSnapshot(): Record<string, unknown> {
  return {
    build: BUILD,
    page: entry,
    uptimeS: Math.round((performance.now() - t0) / 1000),
    visibility: document.visibilityState,
    online: navigator.onLine,
    viewport: `${innerWidth}x${innerHeight}@${devicePixelRatio}${window.visualViewport ? ` (visible ${Math.round(visualViewport!.width)}x${Math.round(visualViewport!.height)}, zoom ${visualViewport!.scale.toFixed(2)})` : ''}`,
    touch: navigator.maxTouchPoints > 0,
    browser: sanitize(navigator.userAgent),
    jsHeap: memory(),
    errors,
    ...state(),
    previousSession: previous ?? undefined,
  };
}

/** The text a player pastes to us. */
export function diagText(): string {
  const snap = diagSnapshot();
  const lines = ['Chancla Warfare diagnostics', JSON.stringify(snap, null, 1), '', 'Recent events (ms since page load):'];
  for (const e of events) lines.push(`${String(e.t).padStart(8)} ${e.k.padEnd(6)} ${e.m}`);
  return lines.join('\n');
}

/**
 * Copies the report. Clipboard access can be refused (permissions, an
 * insecure context, an old browser), so the caller gets the text back to
 * show in a selectable box when this resolves false.
 */
export async function diagCopy(): Promise<boolean> {
  const text = diagText();
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;left:-9999px;top:0;font-size:16px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

/** Shows the report in a selectable box when copying was refused (no page markup needed). */
export function showDiagText(text: string, note: string, close: string): void {
  const wrap = document.createElement('div');
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.style.cssText = 'position:fixed;inset:0;z-index:1000;display:grid;place-items:center;background:rgba(20,10,30,.7);padding:16px';
  const panel = document.createElement('div');
  panel.style.cssText = 'background:#3a2056;color:#f4e6c8;border-radius:16px;padding:16px;width:min(720px,100%);display:flex;flex-direction:column;gap:10px;font:15px system-ui,sans-serif';
  const p = document.createElement('p');
  p.textContent = note;
  p.style.margin = '0';
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.readOnly = true;
  ta.rows = 12;
  ta.style.cssText = 'width:100%;font:16px/1.3 ui-monospace,monospace;background:rgba(0,0,0,.3);color:inherit;border-radius:8px;padding:8px';
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = close;
  b.style.cssText = 'align-self:flex-start;padding:10px 18px;border-radius:12px;font-weight:700;min-height:44px';
  b.addEventListener('click', () => wrap.remove());
  panel.append(p, ta, b);
  wrap.append(panel);
  document.body.append(wrap);
  ta.focus();
  ta.select();
}

// ---------------------------------------------------------------- breadcrumb

let crumbTimer: ReturnType<typeof setInterval> | null = null;

function crumb(clean: boolean): Record<string, unknown> {
  const s = state();
  const pick = (o: unknown, keys: string[]) => (o && typeof o === 'object' ? Object.fromEntries(keys.filter((k) => k in (o as object)).map((k) => [k, (o as Record<string, unknown>)[k]])) : undefined);
  return {
    at: Date.now(),
    build: BUILD,
    page: entry,
    clean,
    uptimeS: Math.round((performance.now() - t0) / 1000),
    errors,
    game: pick(s.game, ['screen', 'mode', 'map', 'conn', 'input']),
    render: pick(s.render, ['msSinceFrame', 'contextLost', 'frameErrors']),
    lastErrors: events.filter((e) => e.k === 'error').slice(-3).map((e) => e.m.slice(0, 140)),
  };
}

function saveCrumb(clean = false): void {
  try { localStorage.setItem(CRUMB_KEY, JSON.stringify(crumb(clean))); } catch { /* storage blocked */ }
}

/**
 * Starts recording. `page` names the entry point (shooter or arcade).
 * Safe to call more than once.
 */
export function installDiag(page: string): void {
  entry = page;
  if (installed) return;
  installed = true;
  try {
    const raw = localStorage.getItem(CRUMB_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Record<string, unknown>;
      const ageMin = Math.round((Date.now() - Number(p.at)) / 60000);
      // Only interesting if it ended without a normal unload, or with errors.
      if (ageMin < 24 * 60 && (p.clean === false || Number(p.errors) > 0)) previous = { ...p, ageMin };
    }
  } catch { /* ignore */ }
  if (previous) diagLog('life', `previous session ${previous.clean === false ? 'ended without a normal page unload' : 'had errors'} ${previous.ageMin} min ago`);

  window.addEventListener('error', (e) => diagError('uncaught', e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => diagError('unhandled promise', e.reason));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') visibleSince = performance.now();
    diagLog('life', `visibility ${document.visibilityState}`);
  });
  window.addEventListener('pageshow', (e) => { visibleSince = performance.now(); diagLog('life', `pageshow${(e as PageTransitionEvent).persisted ? ' (restored from back/forward cache)' : ''}`); });
  window.addEventListener('pagehide', () => { diagLog('life', 'pagehide'); saveCrumb(true); });
  window.addEventListener('online', () => diagLog('net', 'browser online'));
  window.addEventListener('offline', () => diagLog('net', 'browser offline'));
  window.addEventListener('orientationchange', () => diagLog('life', 'orientation change'));
  // Main-thread stalls, after the fact (Chromium only; Safari has no long-task API).
  try {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (e.duration >= 1000) diagLog('stall', `main thread busy ${Math.round(e.duration)} ms`);
    });
    po.observe({ type: 'longtask', buffered: false });
  } catch { /* unsupported */ }
  crumbTimer = setInterval(() => saveCrumb(false), 5000);
  saveCrumb(false);
}

/** Tests: forget everything. */
export function resetDiag(): void {
  events.length = 0;
  errors = 0;
  providers.clear();
  previous = null;
  if (crumbTimer) clearInterval(crumbTimer);
  crumbTimer = null;
  installed = false;
}
