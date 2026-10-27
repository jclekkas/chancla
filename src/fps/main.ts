// Entry point and UI flow for Chancla Warfare: La Ley de la Chancla.
//
//   Title → Online (create / join) or Practice → Lobby → Match → Results
//         → Rematch / Lobby / Leave
//
// Menus are plain DOM and work without WebGL. The 3D engine loads after a
// WebGL check; if that fails the title explains why and play is disabled.
import { setHowTouch } from '../campaign/howto';
import { installDiag, diagProvide, diagLog, diagError, diagCopy, diagText, diagBuild } from '../diag';
import './fps.css';
import { SafeStorage } from '../persistence/storage';
import { audio } from '../audio/audio';
import { MATCH, WEAPONS, isRulesetId, rulesetOf, type BotDifficulty, type RulesetId } from '../../shared/config';
import { isValidCode, normalizeCode, sanitizeName, type ErrorCode, type RoomView } from '../../shared/protocol';
import type { Team } from '../../shared/map';
import { GameSession, wsTransport, type ConnState, type TransportFactory } from '../net/session';
import { LocalHost } from '../net/local';
import { applyDom, detectLang, getLang, hasKey, setLang, t, type Key } from './strings';
import { FpsSettingsStore, defaults, type Quality, type QualityMode } from './settings';
import { FpsInput, describeEl } from './input';
import { FpsTouch } from './touch';
import { Hud } from './hud';
import { rosaSVG, svgUrl } from '../ui/art';
import type { Engine } from './engine';
import { music } from '../audio/music';
import { loadMusicPrefs } from '../audio/prefs';
import { SoundtrackPanel } from '../ui/soundtrackPanel';
import { SoundGate } from '../ui/soundGate';
import { renderMapCards, type MapChoice } from '../ui/mapSelect';
import { copyLink, inputProfile, watchInputProfile, type InputProfile } from '../ui/device';
import { isMapId, mapData, mapEntry, randomMapId, type MapId } from '../../shared/maps';
import { Minimap, type MiniLegend } from './minimap';
import { Dialogue } from '../audio/dialogue';
import { LINES } from '../audio/lines';
import { CampaignUi } from '../campaign/ui';
import type { SimEvent } from '../../shared/sim';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
let soundtrack: SoundtrackPanel | null = null;

type ScreenId = 'title' | 'online' | 'practice' | 'lobby' | 'results' | 'pause' | 'map' | 'settings' | 'controls' | 'confirm' | 'lost' | 'campaign' | 'mintro' | 'mresults' | 'none';
const SCREENS: ScreenId[] = ['title', 'online', 'practice', 'lobby', 'results', 'pause', 'map', 'settings', 'controls', 'confirm', 'lost', 'campaign', 'mintro', 'mresults'];
const OVERLAYS = new Set<ScreenId>(['settings', 'controls', 'confirm', 'map']);

// ---------------------------------------------------------------------
// Environment

const storage = new SafeStorage();
const reducedPref = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const lowEnd = (navigator.hardwareConcurrency ?? 8) <= 4;
const store = new FpsSettingsStore(storage, defaults(detectLang(), reducedPref, lowEnd));
setLang(store.value.lang);
/** Auto graphics: Low on touch-only and low-core devices (no shadows, 1x pixels, no antialiasing), Medium elsewhere. */
function resolveQuality(m: QualityMode): Quality {
  return m !== 'auto' ? m : inputProfile().touchOnly || lowEnd ? 'low' : 'medium';
}
if (store.value.quality !== resolveQuality(store.value.qualityMode)) store.update({ quality: resolveQuality(store.value.qualityMode) });
const BASE = import.meta.env.BASE_URL || '/';

// The production game server (docs/DEPLOY.md). Its origin allow-list covers
// the production domains and this project's multiplayer preview, so those
// sites use it when the build doesn't name a server. Anything else needs
// VITE_GAME_SERVER_URL (which always takes precedence).
const PRODUCTION_SERVER = 'wss://chanclawarfare-game-server.onrender.com/ws';
const PRODUCTION_HOSTS = /^(www\.)?chanclawarfare\.fun$|^chancla(warfare)?\.vercel\.app$|^chancla-git-multiplayer-jclekkas\.vercel\.app$/;

declare const __OFFLINE_ONLY__: boolean;
const OFFLINE_ONLY = typeof __OFFLINE_ONLY__ !== 'undefined' && __OFFLINE_ONLY__;

function serverUrl(): string | null {
  if (OFFLINE_ONLY) return null;
  const env = import.meta.env.VITE_GAME_SERVER_URL as string | undefined;
  if (env) return env;
  const h = location.hostname;
  if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]') return `ws://${h}:8787/ws`;
  if (PRODUCTION_HOSTS.test(h)) return PRODUCTION_SERVER;
  return null;
}

function healthUrl(ws: string): string {
  const u = new URL(ws);
  u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
  u.pathname = u.pathname.replace(/\/ws$/, '') + '/healthz';
  u.search = '';
  return u.toString();
}

// ---------------------------------------------------------------------
// State

let engine: Engine | null = null;
let input: FpsInput | null = null;
let touch: FpsTouch | null = null;
/** Touch is the active input: on-screen controls, no pointer lock. Follows what the player actually uses. */
let touchMode = false;
const hud = new Hud();
let session: GameSession | null = null;
let host: LocalHost | null = null;
let practice = false;
let base: ScreenId = 'title';
const overlayStack: ScreenId[] = [];
let inMatch = false;
let serverOk: boolean | null = null;
let lastRoom: RoomView | null = null;
let confirmAction: (() => void) | null = null;
let lastLostDetail = '';
let retry: (() => void) | null = null;
let pendingInviteCode = '';
let lastCode: string | null = null;
let lockFailures = 0;
let pauseOpenedAt = -1e9;
// The map the current (or last) practice match was started on: Restart keeps it,
// even when the choice was "Random".
let practiceMapId: MapId = 'patio';
/**
 * The suggested arena for ¡Puro Chanclazo!: La Fiesta, where bot-only melee
 * matches meet most often (about 15.6 eliminations a minute, against 13-14 on
 * the others; see docs/puro-chanclazo).
 */
const MELEE_MAP: MapId = 'fiesta';
/**
 * The combat rules in effect: the room's (the host decides; a joined room never
 * uses this player's saved choice), Classic outside a room and in the campaign.
 */
let activeRules: RulesetId = 'classic';
let appliedRulesKey = '';
/** The compact map (arena matches in Practice and Online), and the expanded one in the menu. */
let minimap: Minimap | null = null;
let minimapKey = '';
let mapDrawnAt = 0;
const miniLegend = (): MiniLegend => ({ you: t('minimap.you'), mate: t('minimap.mate'), cafe: t('minimap.cafe'), cafeOff: t('minimap.cafeOff'), wall: t('minimap.wall'), low: t('minimap.low'), raised: t('minimap.raised'), over: t('minimap.over') });
function arenaMatch(): boolean { return inMatch && !!session && !campaign?.active; }
function syncMinimap(now: number): void {
  if (!minimap) return;
  const room = lastRoom;
  if (!arenaMatch() || !room) { minimap.setVisible(false); minimapKey = ''; return; }
  const key = `${room.map}:${getLang()}`;
  if (key !== minimapKey) { minimap.setMap(mapData(room.map), t(mapEntry(room.map).nameKey as Key)); minimapKey = key; }
  // Live positions only while you are alive and not watching a replay (it restores on respawn).
  const marks = engine?.miniMarkers() ?? null;
  const show = store.value.minimap && !!marks && !!session?.alive && !engine?.replaying && !$('hud').hidden;
  minimap.setVisible(show);
  if (show && marks) minimap.update(marks);
  // The expanded map follows an online match while it is open.
  if (top() === 'map' && marks && now - mapDrawnAt > 200) { mapDrawnAt = now; minimap.drawExpanded($('map-canvas') as HTMLCanvasElement, marks, miniLegend()); }
}
/** The expanded map, over the menu: practice pauses, online keeps going (the menu's own rules). */
function openMap(): void {
  if (!arenaMatch()) return;
  if (base !== 'pause') openPause();
  pushOverlay('map');
  mapDrawnAt = 0;
  requestAnimationFrame(() => { const m = engine?.miniMarkers(); if (m && minimap) minimap.drawExpanded($('map-canvas') as HTMLCanvasElement, m, miniLegend()); });
}

function applyRules(): void {
  const rules: RulesetId = session && !campaign?.active ? session.rules : 'classic';
  const touchOn = !!input?.touchMode;
  const key = `${rules}:${getLang()}:${touchOn}`;
  touch?.setMeleeOnly(rules === 'melee', t('touch.slap'), t('touch.throw'));
  if (key === appliedRulesKey) return;
  const changed = rules !== activeRules;
  appliedRulesKey = key;
  activeRules = rules;
  // A button held across a change of rules must not act under the new ones.
  if (changed) { input?.release('combat mode changed'); diagLog('match', `combat mode ${rules}`); }
  document.body.classList.toggle('melee-only', rules === 'melee');
  hud.setRules(rules, touchOn);
}

// Dialogue (campaign and multiplayer quips) with subtitles.
const SPEAKERS: Record<string, string> = { rosa: 'Rosa', influ: 'Influencer', bocinas: 'El Bocinas', soplador: 'El Soplador', cart: 'Express 3000', rollcart: 'Carrito', pinata: 'Party System', vecina: 'Vecina' };
const dialogue = new Dialogue(
  () => ({ banter: store.value.banter, subtitles: store.value.subtitles, uiLang: getLang }),
  (text, who) => {
    const box = $('subs');
    box.hidden = !text;
    if (!text) return;
    $('subs-who').textContent = SPEAKERS[who] ? `${SPEAKERS[who]}:` : '';
    $('subs-text').textContent = text;
  },
);
let campaign: CampaignUi;
let soundGate: SoundGate | null = null;

function renderSoundStatus(): void {
  if (!soundGate) return;
  $('sound-status').textContent = soundGate.describe((k) => t(`sound.status.${k}` as Key));
}

// ---------------------------------------------------------------------
// Screens

function show(id: ScreenId): void {
  base = id;
  overlayStack.length = 0;
  render();
}

function pushOverlay(id: ScreenId): void {
  overlayStack.push(id);
  render();
}

function popOverlay(): void {
  overlayStack.pop();
  render();
}

function top(): ScreenId {
  return overlayStack[overlayStack.length - 1] ?? base;
}

let lastLoggedView = '';
function modeName(): string {
  if (campaign?.active) return `campaign ${campaign.missionId}`;
  if (inMatch) return practice ? 'practice' : 'online';
  return 'menu';
}

function render(): void {
  const view = `${modeName()} / ${[base, ...overlayStack].join('>')}`;
  if (view !== lastLoggedView) { lastLoggedView = view; diagLog('screen', view); }
  const visible = new Set<ScreenId>([base, ...overlayStack]);
  for (const s of SCREENS) {
    const el = $(`scr-${s}`);
    const on = visible.has(s);
    if (el.hidden === on) el.hidden = !on;
  }
  // The title stays as a backdrop under its sub-panels.
  $('scr-title').hidden = !(base === 'title' || ((base === 'online' || base === 'practice') && !inMatch));
  const hudOn = inMatch && base !== 'lobby';
  $('hud').hidden = !hudOn;
  // System overlays (graphics paused, the game stopped, the diagnostics box)
  // sit outside the screen stack but still block play.
  const sysOverlay = !$('scr-gfx').hidden || !$('scr-crash').hidden || !$('scr-diagbox').hidden;
  const playing = inMatch && base === 'none' && overlayStack.length === 0 && !sysOverlay;
  const rotate = rotateBlocked();
  const ctp = !(playing && !touchMode && !input?.locked && !input?.fallback);
  $('click-to-play').hidden = ctp;
  if (!ctp) $('ctp-note').textContent = t(practice || campaign?.active ? 'hud.waitingSolo' : 'hud.waitingOnline');
  $('fps-rotate').hidden = !rotate;
  if (rotate) $('fps-rotate-body').textContent = t(practice ? 'touch.rotateSolo' : 'touch.rotateOnline');
  if (input) {
    const was = input.enabled;
    input.enabled = playing && !rotate;
    if (was && !input.enabled) { input.release('menu or overlay'); diagLog('input', `play input off (${top()})`); } // nothing stays held behind a menu or the rotate screen
    if (!was && input.enabled) {
      // Back in play: nothing on screen takes typing, so a field or button
      // still holding focus from a menu (macOS Safari keeps it on a clicked
      // button's panel) must not swallow the game's keys.
      const a = document.activeElement as HTMLElement | null;
      if (a && a !== document.body && !$('hud').contains(a) && !$('fps-touch').contains(a)) { diagLog('input', `play input on; dropped focus from ${describeEl(a)}`); a.blur(); }
      else diagLog('input', 'play input on');
    }
  }
  document.body.classList.toggle('mouse-captured', !!input?.locked && !touchMode);
  const touchPlay = playing && touchMode && !rotate;
  // Zoomed in already (a menu pinch, iOS zooming into a text field): the play
  // surface would block the pinch that undoes it, so play waits behind a
  // "pinch out" notice that allows zoom, and resumes at normal scale.
  const zoomed = touchPlay && pageZoom() > 1.03;
  $('zoom-note').hidden = !zoomed;
  if (zoomed) placeOnVisibleArea($('zoom-note'));
  if (zoomed && input?.enabled) { input.enabled = false; input.release(); }
  touch?.setVisible(touchPlay && !zoomed);
  // While the touch controls are live, nothing on the page pans or zooms.
  document.documentElement.classList.toggle('touch-play', touchPlay && !zoomed);
  if (engine) engine.inputActive = !!input?.enabled && (!!input.locked || input.fallback || touchMode);
  // Focus the first control of the newest panel for keyboard players.
  const cur = top();
  if (cur !== 'none') {
    const panel = $(`scr-${cur}`);
    if (!panel.contains(document.activeElement)) {
      const f = panel.querySelector<HTMLElement>('input:not([type=hidden]):not([readonly]), button:not([hidden]):not([disabled]), a[href]');
      f?.focus({ preventScroll: true });
    }
  }
  updatePracticePause();
}

/** Solo play waits while the mouse isn't captured: the menu, or the "click to aim" prompt after a refused or lost lock. */
function waitingForAim(): boolean {
  if (touchMode) return rotateBlocked() || (inMatch && base === 'none' && overlayStack.length === 0 && pageZoom() > 1.03); // touch needs no lock
  return inMatch && base === 'none' && overlayStack.length === 0 && !!input && !input.locked && !input.fallback;
}

/**
 * The notice covers the whole page (so any finger can pinch on it) and puts
 * its message where a zoomed-in screen actually looks, at normal size. No
 * transforms: a pinch that starts on a transformed layer doesn't zoom.
 */
function placeOnVisibleArea(note: HTMLElement): void {
  const vv = window.visualViewport;
  const box = note.querySelector<HTMLElement>('.zn-box');
  if (!vv || !box) return;
  box.style.left = `${vv.offsetLeft}px`;
  box.style.top = `${vv.offsetTop}px`;
  box.style.width = `${vv.width}px`;
  box.style.height = `${vv.height}px`;
  (box.firstElementChild as HTMLElement).style.setProperty('zoom', String(1 / vv.scale));
}

/** The page's pinch-zoom factor (1 = not zoomed). */
function pageZoom(): number {
  return window.visualViewport?.scale ?? 1;
}

/** A touch match in portrait: the controls don't fit, so play waits behind a "turn your phone" screen. */
function rotateBlocked(): boolean {
  return touchMode && inMatch && base === 'none' && overlayStack.length === 0 && window.innerHeight > window.innerWidth;
}

/** Switches between touch and mouse/keyboard play, from what the player actually used. */
function setTouchMode(on: boolean): void {
  setHowTouch(on);
  if (on === touchMode) return;
  touchMode = on;
  if (input) input.touchMode = on;
  document.body.classList.toggle('touch-input', on);
  if (on) input?.exitLock();
  render();
}

/** The graphics benchmark's controlled scene holds a practice match still (offline previews only). */
let benchHold = false;
/** The last practice pause: when, inputs discarded, and whether momentum (a jump, a knockback) was kept (diagnostics). */
let lastPause: { at: number; discarded: number; keptVelocity: boolean | null } | null = null;

function updatePracticePause(): void {
  if (campaign?.active) campaign.setPaused(base === 'pause' || overlayStack.length > 0 || waitingForAim());
  if (!host || !engine) return;
  const shouldPause = practice && inMatch && (base === 'pause' || overlayStack.length > 0 || waitingForAim() || benchHold);
  if (shouldPause && !host.paused) {
    // Pausing mid-stride used to leave inputs queued on the host and her
    // walking momentum in place, so she walked on after Resume with no key
    // held. Now held keys are dropped, everything already sent is flushed,
    // and the host discards what it had not simulated and re-syncs the
    // client (Room.pauseSync) without simulating anything: the clock, bots,
    // attacks and cooldowns freeze where they are. The benchmark's hold
    // keeps its scripted scene.
    input?.release();
    let sync: ReturnType<LocalHost['pauseSync']>[number] | undefined;
    if (!benchHold && session) {
      session.flush();
      sync = host.pauseSync().find((r) => r.id === session!.id);
      if (sync) session.pauseSync(sync.ackBefore);
    }
    host.pause(); engine.paused = true;
    lastPause = { at: Math.round(performance.now()), discarded: sync?.discarded ?? 0, keptVelocity: sync?.keptVelocity ?? null };
    diagLog('input', `practice paused (discarded ${sync?.discarded ?? 0} queued inputs${sync?.keptVelocity ? ', momentum kept' : ''})`);
  }
  if (!shouldPause && host.paused) { host.resume(); engine.paused = false; }
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;
function toast(text: string, ms = 2600): void {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), ms);
}

function errText(code: string): string {
  const k = `err.${code}`;
  return hasKey(k) ? t(k as Key) : t('lost.generic');
}

// ---------------------------------------------------------------------
// Boot

function bootProgress(pct: number, key: Key): void {
  const fill = document.getElementById('boot-fill');
  if (fill) fill.style.width = `${pct}%`;
  fill?.parentElement?.setAttribute('aria-valuenow', String(pct));
  const st = document.getElementById('boot-status');
  if (st) st.textContent = t(key);
}

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    return !!gl;
  } catch {
    return false;
  }
}

async function boot(): Promise<void> {
  installDiag('shooter');
  diagProvide('game', () => ({
    mode: modeName(),
    screen: [base, ...overlayStack].join('>'),
    map: lastRoom?.map ?? engine?.diag().map,
    phase: session?.phase,
    conn: session?.state ?? 'none',
    msSinceServerMsg: session?.msSinceMsg ?? null,
    rttMs: session ? Math.round(session.rtt) : null,
    players: lastRoom?.members.length,
    input: touchMode ? 'touch' : input?.locked ? 'mouse (locked)' : input?.fallback ? 'mouse (no lock)' : 'mouse',
    inputEnabled: input?.enabled ?? null,
    held: input?.heldCount ?? null,
    lang: getLang(),
  }));
  diagProvide('input', () => ({ ...(input?.diag() ?? { mode: 'none' }), menu: top(), clickToAim: !$('click-to-play').hidden, engineInput: !!engine?.inputActive }));
  // Movement, to tell a stuck key from knockback, a correction or a stale command.
  diagProvide('movement', () => {
    const s = session;
    if (!s) return { session: 'none' };
    const room = host ? [...host.hub.rooms.values()][0] : null;
    const sp = room?.sim?.players.get(s.id);
    const now = Math.round(performance.now());
    return {
      speed: +Math.hypot(s.body.vx, s.body.vz).toFixed(2), onGround: s.body.onGround, alive: s.alive, phase: s.phase,
      pendingInputs: s.pendingInputs, hostQueue: sp ? sp.queue.length : null, hostSpeed: sp ? +Math.hypot(sp.body.vx, sp.body.vz).toFixed(2) : null,
      corrections: s.corrections, maxCorrection: +s.maxCorrection.toFixed(3), lastCorrection: +s.lastCorrection.toFixed(3),
      lastHitOnMe: s.lastHitOnMe ? { ...s.lastHitOnMe, msAgo: now - s.lastHitOnMe.at } : null,
      lastPracticePause: lastPause ? { ...lastPause, msAgo: now - lastPause.at } : null,
    };
  });
  diagProvide('render', () => engine?.diag() ?? { webgl: 'not started' });
  diagProvide('audio', () => ({ context: audio.state, music: music.status() }));
  campaign = new CampaignUi({
    engine: () => engine,
    input: () => input,
    dialogue,
    get base() { return base; },
    show: (id) => show(id as ScreenId),
    confirm: confirmBox,
    toast,
    setActive: (on) => {
      inMatch = on;
      practice = false;
      if (!on) { input?.release(); hud.reset(); }
      render();
    },
    render,
    baseUrl: BASE,
  }, storage);
  const uiTick = () => {
    // Scheduled first: one exception here used to end this loop for good
    // (dialogue, victory controls and the touch cooldown ring stopped).
    requestAnimationFrame(uiTick);
    campaign.tick();
    if (!campaign.active) dialogue.update();
    const s = session;
    applyRules();
    syncMinimap(performance.now());
    if (touch?.visible && s) {
      const def = WEAPONS[s.weapon];
      const swingReady = s.meleeMs <= 0 && s.cooldownMs <= 0 && s.switchMs <= 0;
      if (activeRules === 'melee') touch.setReady(swingReady ? 1 : 0);
      else touch.setReady(s.switchMs > 0 ? 0 : def ? Math.max(0, Math.min(1, 1 - s.cooldownMs / def.cooldownMs)) : 1);
      // The melee button names the attack the chancla in hand makes.
      touch.setMelee(t(s.weapon === 1 ? 'melee.reves' : 'melee.chanclazo'), s.weapon === 1, s.meleeMs <= 0 && s.cooldownMs <= 0 && s.switchMs <= 0);
    }
    // Melee is a multiplayer and practice move: the campaign keeps its own rules.
    touch?.setMeleeAvailable(!campaign.active);
  };
  requestAnimationFrame(uiTick);
  music.setPrefs(loadMusicPrefs());
  soundtrack = new SoundtrackPanel($('soundtrack'), { lang: getLang, musicSilenced: () => store.value.music <= 0.001, onUi: () => audio.play('ui') });
  music.play('menu');
  document.documentElement.lang = getLang();
  document.title = t('meta.title');
  applyDom(document);
  bootProgress(15, 'loading.shell');
  ($('lnk-classic') as HTMLAnchorElement).href = `${BASE}classic.html`;
  ($('lnk-touch-arcade') as HTMLAnchorElement).href = `${BASE}classic.html`;
  $('rosa-portrait').style.backgroundImage = svgUrl(rosaSVG('smirk'));
  // Touch-only devices (phones, tablets without a mouse) get the Arcade's
  // touch beta and a link to play the rest on a computer.
  applyInputProfile(inputProfile());
  watchInputProfile(applyInputProfile);
  setTouchMode(inputProfile().touchOnly);
  // Then follow what is actually used: a finger on the screen means touch;
  // a mouse that moves means mouse and keyboard (a tablet with a trackpad).
  window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') setTouchMode(true); else if (e.pointerType === 'mouse') setTouchMode(false); }, { capture: true });
  window.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' && (e.movementX || e.movementY) && touchMode && !inMatch) setTouchMode(false); }, { capture: true, passive: true });
  bindUi();
  soundGate = new SoundGate({
    text: (k) => (k === 'enable' && touchOnly ? t('touch.tapSound') : t(`sound.${k}` as Key)),
    inGame: () => inMatch && base === 'none',
    openSettings: () => { renderSettings(); pushOverlay('settings'); },
    musicStatus: () => music.status(),
  });
  setInterval(() => { if (top() === 'settings') renderSoundStatus(); }, 1000);
  readInvite();

  // Offline graphics previews only: ?bench runs the section benchmark (src/fps/bench.ts).
  // The settings it needs apply to this page load only and are put back when it leaves.
  const bench = OFFLINE_ONLY && /[?&]bench(=|&|$)/.test(location.search) ? await import('./bench') : null;
  const benchRun = bench?.benchParams(location.search) ?? null;
  if (bench && benchRun) {
    const saved = { qualityMode: store.value.qualityMode, quality: store.value.quality, practiceMap: store.value.practiceMap, practiceAllies: store.value.practiceAllies, practiceEnemies: store.value.practiceEnemies, practiceDifficulty: store.value.practiceDifficulty };
    store.update({ qualityMode: benchRun.quality, quality: benchRun.quality, practiceMap: 'patio', practiceAllies: 1, practiceEnemies: 2, practiceDifficulty: 'normal' });
    window.addEventListener('pagehide', () => store.update(saved));
    bench.prepareBench(benchRun);
  }

  if (webglAvailable()) {
    try {
      bootProgress(35, 'loading.engine');
      const mod = await import('./engine');
      // El Patio's sourced textures (by quality; ?mat=classic|toon|std overrides), loaded before the
      // engine builds its first world (at most 4 s; classic otherwise).
      await mod.preloadSourced(store.value.quality);
      bootProgress(65, 'loading.world');
      await new Promise((r) => setTimeout(r, 0));
      input = new FpsInput($('stage'));
      input.touchMode = touchMode;
      touch = new FpsTouch(input);
      // A tap on the compact map (touch only) opens the expanded one; the map consumes the tap.
      minimap = new Minimap($('minimap'), { onTap: () => { if (touchMode) openMap(); } });
      bindInput(input);
      applyInputSettings();
      engine = new mod.Engine($('stage'), () => store.value, hud, input);
      engine.onContextLost = (lost) => graphicsLost(lost);
      engine.onOwnMiss = () => touch?.meleeMiss();
      engine.onFatal = () => showCrash();
      engine.start();
    } catch (err) {
      console.error(err);
      diagError('boot', err);
      engine = null;
      // A chunk that failed to download is not a graphics problem: say so,
      // and offer the reload that fixes it.
      if (isLoadError(err)) showLoadFailed();
      else showNoWebgl();
    }
  } else {
    showNoWebgl();
  }
  bootProgress(100, 'loading.ready');
  document.getElementById('boot')?.remove();
  $('app').removeAttribute('hidden');
  show('title');
  checkServer();
  if (pendingInviteCode) openOnline();
  // Another invite opened in this tab changes only the #room= part: pick it up
  // (outside a match; in one, the code waits for the player to leave).
  window.addEventListener('hashchange', () => {
    readInvite();
    if (pendingInviteCode && !inMatch && !lastRoom) openOnline();
  });
  (window as unknown as { __fps: unknown }).__fps = debugApi();
  if (bench && benchRun) bench.runBench(benchRun, { api: debugApi(), startPractice: () => startPractice(), screen: () => top(), hold: (on) => { benchHold = on; updatePracticePause(); } });
}

let touchOnly = false;
let showAllModes = false;

let lastProfile: InputProfile | null = null;

function applyInputProfile(p: InputProfile): void {
  lastProfile = p;
  touchOnly = p.touchOnly;
  document.body.classList.toggle('touch-only', touchOnly);
  document.body.classList.toggle('small-screen', p.small);
  $('mobile-gate').hidden = !touchOnly;
  $('title-actions').classList.toggle('collapsed', touchOnly && !showAllModes);
  document.body.classList.toggle('modes-collapsed', touchOnly && !showAllModes);
  $('mobile-note').hidden = true;
  for (const el of document.querySelectorAll<HTMLElement>('.needs-pc')) el.dataset.pcLabel = t('mobile.pcOnly');
  document.body.classList.toggle('touch-help', touchOnly);
}

/** Story on a touch-only device: explain instead of starting something unplayable (online and practice have touch controls). */
function needsComputer(): boolean {
  if (!touchOnly) return false;
  toast(t('mobile.pcOnlyToast'), 4200);
  return true;
}

// ---------------------------------------------------------------------
// Diagnostics and recovery

/** A dynamic import or module script that failed to download. */
function isLoadError(err: unknown): boolean {
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Failed to fetch/i.test(String((err as Error)?.message ?? err));
}

function showLoadFailed(): void {
  const el = $('webgl-status');
  el.hidden = false;
  el.textContent = t('load.failed');
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn small';
  b.textContent = t('crash.reload');
  b.addEventListener('click', () => location.reload());
  el.append(' ', b);
  ($('btn-online') as HTMLButtonElement).disabled = true;
  ($('btn-practice') as HTMLButtonElement).disabled = true;
}

async function copyDiagnostics(): Promise<void> {
  if (await diagCopy()) { toast(t('diag.copied'), 3500); return; }
  const ta = $('diagbox-text') as HTMLTextAreaElement;
  ta.value = diagText();
  $('scr-diagbox').hidden = false;
  render();
  ta.focus();
  ta.select();
}

let gfxSlowTimer: ReturnType<typeof setTimeout> | null = null;
/** WebGL context lost: say what happened, pause solo modes, wait for it to come back. */
function graphicsLost(lost: boolean): void {
  if (gfxSlowTimer) clearTimeout(gfxSlowTimer);
  gfxSlowTimer = null;
  if (lost) {
    input?.release();
    input?.exitLock();
    if (inMatch && base === 'none' && (practice || campaign.active)) openPause();
    $('gfx-body').textContent = t(inMatch && !practice && !campaign.active ? 'gfx.bodyOnline' : 'gfx.bodySolo');
    $('gfx-slow').hidden = true;
    gfxSlowTimer = setTimeout(() => ($('gfx-slow').hidden = false), 8000);
  }
  $('scr-gfx').hidden = !lost;
  render();
}

let crashShown = false;
/** Frames keep failing: the picture has stopped. Never hidden; the player chooses. */
function showCrash(): void {
  if (crashShown) return;
  crashShown = true;
  diagLog('screen', 'game stopped (frames keep failing)');
  input?.release();
  input?.exitLock();
  $('scr-crash').hidden = false;
  render();
  ($('btn-crash-diag') as HTMLButtonElement).focus();
}

function crashToMenu(): void {
  crashShown = false;
  $('scr-crash').hidden = true;
  render();
  if (campaign.active) campaign.toSelect();
  endSession('title');
  engine?.clearFatal();
}

function showNoWebgl(): void {
  const el = $('webgl-status');
  el.hidden = false;
  el.textContent = `${t('status.webgl')} ${t('status.webglTips')}`;
  ($('btn-online') as HTMLButtonElement).disabled = true;
  ($('btn-practice') as HTMLButtonElement).disabled = true;
}

async function checkServer(): Promise<void> {
  const el = $('server-status');
  const url = serverUrl();
  if (!url) { serverOk = false; el.textContent = t(OFFLINE_ONLY ? 'status.offlinePreview' : 'status.serverMissing'); el.className = 'server-status warn'; return; }
  el.textContent = t('status.serverChecking');
  el.className = 'server-status';
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);
    const r = await fetch(healthUrl(url), { signal: ctl.signal, cache: 'no-store' });
    clearTimeout(timer);
    serverOk = r.ok;
  } catch {
    serverOk = false;
  }
  el.textContent = serverOk ? t('status.serverOk') : t('status.serverDown');
  el.className = `server-status ${serverOk ? 'ok' : 'warn'}`;
}

// Invite links look like https://host/#room=ABCD2345. The code is read and
// then removed from the address bar so it does not linger in history.
function readInvite(): void {
  const m = /(?:^|[#&])room=([A-Za-z0-9-]{4,16})/.exec(location.hash);
  if (!m) return;
  const code = normalizeCode(m[1]!);
  if (isValidCode(code)) pendingInviteCode = code;
  try { history.replaceState(null, '', location.pathname + location.search); } catch { /* sandboxed */ }
}

function inviteUrl(code: string): string {
  return `${location.origin}${BASE}#room=${code}`;
}

// ---------------------------------------------------------------------
// Sessions

function handlers() {
  return {
    state: (s: ConnState, detail?: string) => onState(s, detail),
    room: (room: RoomView) => onRoom(room),
    error: (code: ErrorCode) => onError(code),
    // Live voice lines wait out a replay (it plays none of its own).
    event: (e: Parameters<Engine['onEvent']>[0]) => { engine?.onEvent(e); if (!engine?.replaying) mpDialogue(e); },
    snapshot: (r: Parameters<Engine['onSnapshot']>[0]) => engine?.onSnapshot(r),
    localThrow: (w: 0 | 1) => engine?.onLocalThrow(w),
    localMelee: (w: 0 | 1) => engine?.onLocalMelee(w),
    impact: (...a: Parameters<Engine['onImpact']>) => engine?.onImpact(...a),
    left: () => endSession('title'),
  };
}

// Multiplayer voice lines, played locally from replicated game events (no
// audio is ever sent over the network):
//   local       your own reactions: eliminations, respawns, low health
//   proximity   another Rosa's elimination quip if she is within 12 m,
//               quieter with distance; the line is picked from the event so
//               every nearby listener hears the same one
//   match-wide  start and result lines, each client for its own team
let mpLowHp = false;
function mpDialogue(e: SimEvent): void {
  const s = session;
  if (!s) return;
  const me = s.id;
  switch (e.k) {
    case 'elim': {
      if (e.a === me) { dialogue.react('elim'); break; }
      const r = s.remotes.get(e.a);
      if (r && e.a !== e.v) {
        const d = Math.hypot(r.x - s.body.x, r.z - s.body.z);
        if (d < 12) dialogue.say(['elim1', 'elim2', 'elim3', 'elim4'][(e.a * 7 + e.v * 3) % 4]!, { volume: Math.max(0.25, 1 - d / 12) });
      }
      break;
    }
    case 'spawn':
      if (e.id === me && s.phase === 'playing') dialogue.react('respawn');
      break;
    case 'hit':
      // Now and then, when El Revés knocks a roller off your own head.
      if (e.v === me && e.ru?.length && Math.random() < 0.6) dialogue.react('rulero');
      if (e.v === me && e.hp > 0 && e.hp <= 30 && !mpLowHp) { mpLowHp = true; dialogue.react('low'); }
      if (e.v === me && e.hp > 30) mpLowHp = false;
      break;
    case 'end': {
      const team = s.team;
      dialogue.react(e.winner === -1 ? 'start' : e.winner === team ? 'win' : 'lose');
      break;
    }
    default:
      break;
  }
}

function newSession(factory: TransportFactory, now?: () => number): GameSession {
  const s = new GameSession(factory, handlers(), now);
  session = s;
  return s;
}

function playerName(): string {
  const raw = ($('in-name') as HTMLInputElement).value;
  const name = sanitizeName(raw, t('online.namePh'));
  if (name !== store.value.name) store.update({ name });
  return name;
}

function startOnline(join: string | null): void {
  const url = serverUrl();
  const errEl = $('online-err');
  if (!url) { errEl.textContent = t(OFFLINE_ONLY ? 'status.offlinePreview' : 'status.serverMissing'); return; }
  errEl.textContent = t('online.connecting');
  endSession(null);
  practice = false;
  const s = newSession(wsTransport(url));
  s.connect(playerName());
  // Creating: this player's chosen rules (and, for ¡Puro Chanclazo!, the arena that suits it). Joining: the host's, whatever is saved here.
  const rules = store.value.roomRules;
  s.send(join ? { t: 'join', code: join } : rules === 'melee' ? { t: 'create', rules, map: MELEE_MAP } : { t: 'create' });
  retry = () => startOnline(join ?? lastCode);
}

/** `keepMap` (Restart) replays the same arena; otherwise the saved choice is used, resolving Random. */
function startPractice(keepMap = false): void {
  const v = store.value;
  if (!keepMap) practiceMapId = v.practiceMap === 'random' ? randomMapId() : isMapId(v.practiceMap) ? v.practiceMap : 'patio';
  endSession(null);
  practice = true;
  const h = new LocalHost();
  host = h;
  const s = newSession(h.transport(), () => h.now());
  s.connect(sanitizeName(store.value.name, t('online.namePh')));
  s.send({ t: 'create', practice: { difficulty: v.practiceDifficulty, allies: v.practiceAllies, enemies: v.practiceEnemies }, map: practiceMapId, rules: v.practiceRules });
  retry = () => startPractice(true);
}

// Leaves the room and tears the session down. `to` picks the next screen.
function endSession(to: ScreenId | null): void {
  const s = session;
  session = null;
  if (s) { s.leave(); s.close(); }
  const h = host;
  host = null;
  h?.dispose();
  inMatch = false;
  lastRoom = null;
  input?.exitLock();
  input?.release();
  unguardBack();
  engine?.enterMenu();
  if (engine) engine.paused = false;
  hud.scoreboard(false, null, new Map(), -1);
  hud.connection(null);
  music.play('menu');
  dialogue.reset();
  if (to) show(to);
}

function onState(s: ConnState, detail?: string): void {
  diagLog('net', `connection ${s}${detail ? ` (${detail})` : ''}`);
  if (s === 'online') { hud.connection(null); $('online-err').textContent = ''; return; }
  if (s === 'reconnecting') { hud.connection(t('hud.reconnecting')); setLobbyStatusOverride(t('hud.reconnecting')); return; }
  if (s === 'lost') {
    lastLostDetail = detail ?? 'generic';
    const key = `lost.${lastLostDetail}`;
    const body = hasKey(key) ? t(key as Key) : hasKey(`err.${lastLostDetail}`) ? errText(lastLostDetail) : t('lost.generic');
    const wasOnlineFlow = base === 'online' && !lastRoom;
    session = null;
    const h = host; host = null; h?.dispose();
    inMatch = false;
    lastRoom = null;
    input?.exitLock();
    engine?.enterMenu();
    hud.connection(null);
    if (wasOnlineFlow && lastLostDetail === 'unreachable') {
      $('online-err').textContent = t('lost.unreachable');
      return;
    }
    $('lost-body').textContent = body;
    ($('btn-lost-retry') as HTMLButtonElement).hidden = lastLostDetail === 'version';
    show('lost');
  }
}

function onError(code: ErrorCode): void {
  const text = errText(code);
  if (base === 'online') $('online-err').textContent = text;
  else if (base === 'lobby') $('lobby-err').textContent = text;
  else toast(text);
  // A failed join leaves us connected without a room; drop the socket.
  if ((code === 'room_not_found' || code === 'room_full' || code === 'server_full') && !lastRoom && session) {
    const s = session; session = null; s.close();
  }
}

function onRoom(room: RoomView): void {
  const prev = lastRoom;
  if (prev?.phase !== room.phase || prev?.map !== room.map) diagLog('match', `room ${room.phase}, map ${room.map}, ${room.members.length} players${room.practice ? ' (practice)' : ''}`);
  lastRoom = room;
  if (!room.practice) lastCode = room.code;
  if (room.phase === 'countdown' || room.phase === 'playing') {
    if (!inMatch) {
      inMatch = true;
      engine?.enterMatch(session!, room.practice);
      music.play('combat');
      dialogue.react('start');
      show('none');
      guardBack();
      if (practice && !touchMode) input?.requestLock(); // the Start click is still a user gesture in most browsers
    } else if (base === 'results') {
      // Rematch: straight back in (on the room's map, which the owner may have changed).
      engine?.useMap(room.map);
      engine?.resetRound();
      show('none');
    }
    if (prev?.phase === 'results' || prev?.phase === 'lobby') hud.reset();
    return;
  }
  if (room.phase === 'results') {
    music.play('results');
    input?.exitLock();
    input?.release();
    renderResults(room);
    if (base !== 'results') show('results');
    return;
  }
  // Lobby
  if (inMatch) { inMatch = false; engine?.enterMenu(); }
  music.play('lobby');
  if (room.practice && room.owner === session?.id) {
    // Practice rooms start immediately with the chosen bots.
    session?.send({ t: 'start' });
    return;
  }
  renderLobby(room);
  if (base !== 'lobby') show('lobby');
}

// ---------------------------------------------------------------------
// Lobby and results rendering (textContent only, never innerHTML)

let lobbyOverride = '';
function setLobbyStatusOverride(text: string): void {
  lobbyOverride = text;
  if (lastRoom && base === 'lobby') renderLobby(lastRoom);
}

function renderLobby(room: RoomView): void {
  const me = session?.id ?? -1;
  const isOwner = room.owner === me;
  $('lobby-title').textContent = t('lobby.title');
  $('room-code').textContent = room.code;
  const url = inviteUrl(room.code);
  const inv = $('invite-url') as HTMLInputElement;
  inv.value = url;
  inv.hidden = false;
  $('btn-share-invite').hidden = typeof navigator.share !== 'function';
  for (const team of [0, 1] as const) {
    const ul = $(`team-${team}`);
    const rows: HTMLLIElement[] = [];
    const members = room.members.filter((m) => m.team === team);
    for (const m of members) {
      const li = document.createElement('li');
      li.className = `${m.id === me ? 'me ' : ''}${m.bot ? 'bot ' : ''}${m.ready || m.bot || m.id === room.owner ? 'ready' : ''}`.trim();
      const name = document.createElement('span');
      name.className = 'nm';
      name.textContent = m.name;
      li.appendChild(name);
      const tags: string[] = [];
      if (m.id === me) tags.push(t('lobby.you'));
      if (m.id === room.owner) tags.push(t('lobby.host'));
      if (m.bot) tags.push(t('lobby.bot'));
      if (!m.connected && !m.bot) tags.push(t('lobby.away'));
      else if (!m.bot && m.id !== room.owner) tags.push(m.ready ? t('lobby.ready') : t('lobby.notReady'));
      for (const tag of tags) { const s = document.createElement('span'); s.className = 'tag'; s.textContent = tag; li.appendChild(s); }
      rows.push(li);
    }
    for (let i = members.length; i < room.teamSize; i++) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = t('lobby.empty');
      rows.push(li);
    }
    ul.replaceChildren(...rows);
  }
  const mine = room.members.find((m) => m.id === me);
  showMyTeam($('lobby-myteam'), mine ? mine.team : null);
  for (const team of [0, 1] as const) $(`team-${team}`).parentElement?.classList.toggle('mine', mine?.team === team);
  $('lobby-owner').hidden = !isOwner;
  // The map is the host's call; everyone sees it, and the room enforces it.
  document.querySelectorAll<HTMLButtonElement>('[data-lmap]').forEach((b) => {
    const on = b.dataset.lmap === room.map;
    b.setAttribute('aria-checked', String(on));
    b.classList.toggle('on', on);
    b.disabled = !isOwner && !on;
  });
  // So are the combat rules: everyone sees them, and they hold for the whole match (rematches too).
  const rules = rulesetOf(room.rules);
  document.querySelectorAll<HTMLButtonElement>('[data-lrules]').forEach((b) => {
    const on = b.dataset.lrules === rules;
    b.setAttribute('aria-checked', String(on));
    b.classList.toggle('on', on);
    b.disabled = !isOwner && !on;
  });
  $('lobby-rules').textContent = t(rules === 'melee' ? 'lobby.rulesMelee' : 'lobby.rules');
  ($('chk-bots') as HTMLInputElement).checked = room.bots.enabled;
  document.querySelectorAll<HTMLButtonElement>('[data-bdiff]').forEach((b) => {
    const on = b.dataset.bdiff === room.bots.difficulty;
    b.setAttribute('aria-checked', String(on));
    b.classList.toggle('on', on);
  });
  const participants = room.members.filter((m) => m.bot || m.connected).length;
  const waitingReady = room.members.some((m) => !m.bot && m.connected && m.id !== room.owner && !m.ready);
  const startBtn = $('btn-start') as HTMLButtonElement;
  startBtn.hidden = !isOwner;
  startBtn.disabled = participants < MATCH.minParticipants || waitingReady;
  const readyBtn = $('btn-ready') as HTMLButtonElement;
  readyBtn.hidden = isOwner;
  readyBtn.textContent = mine?.ready ? t('lobby.unreadyBtn') : t('lobby.readyBtn');
  readyBtn.setAttribute('aria-pressed', String(!!mine?.ready));
  let status: string;
  if (lobbyOverride && session?.state === 'reconnecting') status = lobbyOverride;
  else if (!isOwner) status = t('lobby.waitHost');
  else if (participants < MATCH.minParticipants) status = t('lobby.needTwo');
  else if (waitingReady) status = t('lobby.needReady');
  else status = t('lobby.canStart');
  $('lobby-status').textContent = status;
}

/** "YOUR TEAM: SOL" with its icon and colour: name, icon and colour together, never colour alone. */
function showMyTeam(el: HTMLElement, team: Team | null): void {
  el.hidden = team === null;
  if (team === null) return;
  el.className = `team-chip big ${team === 0 ? 'sol' : 'luna'}`;
  el.querySelector('.tc-icon')!.textContent = team === 0 ? '☀' : '☾';
  el.querySelector('.tc-text')!.textContent = t('hud.yourTeam', { team: t(team === 0 ? 'hud.sol' : 'hud.luna').toUpperCase() });
}

function renderResults(room: RoomView): void {
  const r = room.results;
  if (!r) return;
  const myTeam = session?.team ?? null;
  showMyTeam($('res-myteam'), myTeam);
  $('res-title').textContent = r.winner === -1 ? t('results.tie') : r.winner === 0 ? t('results.sol') : t('results.luna');
  const flavor = r.winner === -1 ? t('results.youTie') : r.winner === myTeam ? t('results.youWin') : t('results.youLose');
  const reason = r.reason === 'score' ? t('results.byScore', { n: MATCH.scoreToWin }) : t('results.byTime');
  $('res-sub').textContent = `${reason} · ${flavor} · ${t(mapEntry(room.map).nameKey as Key)}${rulesetOf(room.rules) === 'melee' ? ` · ${t('mode.melee')}` : ''}`;
  ($('btn-res-maps') as HTMLButtonElement).hidden = !room.practice;
  $('res-sol').textContent = String(r.scores[0]);
  $('res-luna').textContent = String(r.scores[1]);
  const rows = [...r.rows].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || b.damage - a.damage);
  const mvp = rows[0]?.id;
  const table = document.createElement('table');
  table.className = 'stats';
  const head = document.createElement('tr');
  for (const [k, num] of [['score.name', false], ['score.k', true], ['score.d', true], ['score.dmg', true], ['score.acc', true]] as const) {
    const th = document.createElement('th'); th.textContent = t(k); if (num) th.className = 'num'; head.appendChild(th);
  }
  table.appendChild(head);
  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.className = `${row.team === 0 ? 'sol' : 'luna'}${row.id === session?.id ? ' me' : ''}`;
    const name = `${row.team === 0 ? '☀' : '☾'} ${row.name}${row.bot ? ` (${t('lobby.bot')})` : ''}${row.id === mvp && row.kills > 0 ? ` · ${t('results.mvp')}` : ''}`;
    const cells = [name, String(row.kills), String(row.deaths), String(Math.round(row.damage)), `${Math.round(row.accuracy * 100)}%`];
    cells.forEach((c, i) => { const td = document.createElement('td'); td.textContent = c; if (i) td.className = 'num'; tr.appendChild(td); });
    table.appendChild(tr);
  }
  $('res-table').replaceChildren(table);
  const isOwner = room.owner === session?.id;
  ($('btn-rematch') as HTMLButtonElement).hidden = !isOwner;
  ($('btn-to-lobby') as HTMLButtonElement).hidden = !isOwner || room.practice;
  $('res-status').textContent = isOwner ? '' : t('results.waitHost');
}

// ---------------------------------------------------------------------
// Settings

function applyInputSettings(): void {
  const v = store.value;
  if (input) { input.sensitivity = v.sensitivity; input.touchSensitivity = v.touchSensitivity; input.invertY = v.invertY; }
  audio.setLevels(v.music, v.sfx);
  audio.setVoiceLevel(v.voice);
  engine?.applySettings();
  document.documentElement.classList.toggle('reduced-motion', v.reducedMotion);
}

function renderSettings(): void {
  $('build-id').textContent = t('diag.build', { id: diagBuild() });
  renderSoundStatus();
  soundtrack?.render();
  const v = store.value;
  const seg = (attr: string, val: string) => document.querySelectorAll<HTMLButtonElement>(`[data-${attr}]`).forEach((b) => {
    const on = b.dataset[attr] === val;
    b.setAttribute('aria-checked', String(on));
    b.classList.toggle('on', on);
  });
  seg('lang', v.lang);
  seg('q', v.qualityMode);
  seg('subs', v.subtitles);
  ($('set-voice') as HTMLInputElement).value = String(Math.round(v.voice * 100));
  $('out-voice').textContent = `${Math.round(v.voice * 100)}%`;
  ($('set-banter') as HTMLInputElement).checked = v.banter;
  ($('set-hints') as HTMLInputElement).checked = v.campaignHints;
  ($('set-sens') as HTMLInputElement).value = String(Math.round(v.sensitivity * 100));
  $('out-sens').textContent = v.sensitivity.toFixed(2);
  ($('set-tsens') as HTMLInputElement).value = String(Math.round(v.touchSensitivity * 100));
  $('out-tsens').textContent = v.touchSensitivity.toFixed(2);
  ($('set-invert') as HTMLInputElement).checked = v.invertY;
  ($('set-fov') as HTMLInputElement).value = String(v.fov);
  $('out-fov').textContent = `${v.fov}°`;
  ($('set-motion') as HTMLInputElement).checked = v.reducedMotion;
  ($('set-rosa-cand') as HTMLInputElement).checked = v.rosaCandidate;
  ($('set-music') as HTMLInputElement).value = String(Math.round(v.music * 100));
  $('out-music').textContent = `${Math.round(v.music * 100)}%`;
  ($('set-sfx') as HTMLInputElement).value = String(Math.round(v.sfx * 100));
  $('out-sfx').textContent = `${Math.round(v.sfx * 100)}%`;
  ($('set-stats') as HTMLInputElement).checked = v.showStats;
  ($('set-killcam') as HTMLInputElement).checked = v.killcam;
  ($('set-minimap') as HTMLInputElement).checked = v.minimap;
}

function renderPracticeSetup(): void {
  const v = store.value;
  const seg = (attr: string, val: string) => document.querySelectorAll<HTMLButtonElement>(`[data-${attr}]`).forEach((b) => {
    const on = b.dataset[attr] === val;
    b.setAttribute('aria-checked', String(on));
    b.classList.toggle('on', on);
  });
  seg('prules', v.practiceRules);
  seg('rrules', v.roomRules);
  seg('diff', v.practiceDifficulty);
  seg('allies', String(v.practiceAllies));
  seg('enemies', String(v.practiceEnemies));
  renderMapCards($('practice-maps'), {
    selected: v.practiceMap,
    t: (k) => t(k as Key),
    onPick: (c: MapChoice) => { store.update({ practiceMap: c }); renderPracticeSetup(); },
  });
}

function changeLang(lang: 'en' | 'es'): void {
  store.update({ lang });
  setLang(lang);
  document.documentElement.lang = lang;
  document.title = t('meta.title');
  applyDom(document);
  hud.invalidate();
  soundGate?.render();
  soundtrack?.render();
  if (lastProfile) applyInputProfile(lastProfile); // relabel, keeping a detected mouse or keyboard
  if (serverOk !== null || !serverUrl()) checkServer();
  if (lastRoom && base === 'lobby') renderLobby(lastRoom);
  if (lastRoom && base === 'results') renderResults(lastRoom);
  if (lastLostDetail && base === 'lost') onState('lost', lastLostDetail);
  renderSettings();
}

// ---------------------------------------------------------------------
// Menu actions

function openOnline(): void {
  ($('in-name') as HTMLInputElement).value = store.value.name;
  ($('in-code') as HTMLInputElement).value = pendingInviteCode;
  renderPracticeSetup(); // also marks the Create Room combat mode
  $('online-err').textContent = serverUrl() ? '' : t(OFFLINE_ONLY ? 'status.offlinePreview' : 'status.serverMissing');
  show('online');
  // From an invite: the code is filled in; ask for a name first if there isn't one.
  if (pendingInviteCode) $(store.value.name ? 'btn-join' : 'in-name').focus();
  pendingInviteCode = '';
}

function openPause(): void {
  if (!inMatch || base !== 'none') return;
  $('pause-build').textContent = t('diag.build', { id: diagBuild() });
  if (campaign.runtime?.inVictory) return;
  ($('btn-fullscreen') as HTMLButtonElement).hidden = !(document.documentElement.requestFullscreen || (document.documentElement as HTMLElement & { webkitRequestFullscreen?: unknown }).webkitRequestFullscreen);
  input?.release();
  input?.exitLock();
  pauseOpenedAt = performance.now();
  const m = campaign.active;
  const online = !m && !practice;
  $('pause-note').textContent = m ? t('pause.missionNote') : practice ? t('pause.practiceNote') : t('pause.note');
  $('pause-note').classList.toggle('live', online);
  ($('btn-pause-retrycp') as HTMLButtonElement).hidden = !m;
  const rb = $('btn-pause-restart') as HTMLButtonElement;
  rb.hidden = !m && !practice;
  rb.dataset.t = m ? 'pause.restart' : 'pause.restartMatch';
  rb.textContent = t(rb.dataset.t as Key);
  ($('btn-pause-maps') as HTMLButtonElement).hidden = !practice;
  ($('btn-pause-map') as HTMLButtonElement).hidden = m;
  // Match information: the combat rules of this match (not shown for missions).
  $('pause-mode').hidden = m;
  $('pause-mode-text').textContent = t('mode.pause', { mode: t(activeRules === 'melee' ? 'mode.melee' : 'mode.classic') });
  ($('pause-mode').querySelector('.mode-ico') as HTMLElement).hidden = activeRules !== 'melee';
  ($('btn-pause-select') as HTMLButtonElement).hidden = !m;
  const lb = $('btn-pause-leave');
  lb.dataset.t = online ? 'pause.leaveMatch' : 'pause.home';
  lb.textContent = t(lb.dataset.t as Key);
  show('pause');
}

function confirmBox(title: string, body: string, yes: string, action: () => void): void {
  $('confirm-title').textContent = title;
  $('confirm-body').textContent = body;
  $('btn-confirm-yes').textContent = yes;
  confirmAction = action;
  pushOverlay('confirm');
}

// From a click (or Enter on the Resume button) the mouse is captured again
// right away. From Escape it can't be: browsers only grant pointer lock to a
// click or key press that counts as user activation, and Escape never does.
// Then the "click to aim" prompt asks for that explicit click.
function resume(viaClick: boolean): void {
  show('none');
  if (touchMode) { touch?.arm(); return; } // the tap on Resume must not also move or throw
  if (viaClick) input?.requestLock();
}

// A phone's Back gesture or button during a match opens the menu instead of
// leaving the page (leaving is in the menu, with a confirmation).
let backGuarded = false;
function guardBack(): void {
  if (backGuarded) return;
  try { history.pushState({ chanclaMatch: 1 }, ''); backGuarded = true; } catch { /* sandboxed */ }
}
function unguardBack(): void {
  if (!backGuarded) return;
  backGuarded = false;
  if ((history.state as { chanclaMatch?: number } | null)?.chanclaMatch) { try { history.back(); } catch { /* sandboxed */ } }
}
window.addEventListener('popstate', () => {
  if (!backGuarded) return;
  backGuarded = false;
  if (inMatch) {
    guardBack();
    if (base === 'none') openPause();
  }
});

/** Main menu from the pause menu: confirms first, because a run or match is in progress. */
function askHome(): void {
  if (campaign.active) {
    confirmBox(t('confirm.leaveTitle'), t('confirm.leaveMission'), t('confirm.yes'), () => { campaign.toSelect(); show('title'); music.play('menu'); });
    return;
  }
  confirmBox(t('confirm.leaveTitle'), practice ? t('confirm.leavePractice') : t('confirm.leaveBody'), t('confirm.yes'), () => endSession('title'));
}

/** Practice: the same match settings and map again. */
function askRestartPractice(): void {
  confirmBox(t('confirm.restartPracticeTitle'), t('confirm.restartPractice'), t('confirm.restartYes'), () => { overlayStack.length = 0; startPractice(true); });
}

/** Back to the practice setup to pick another map. From the pause menu a match is in progress, so it asks. */
function changePracticeMap(confirmFirst: boolean): void {
  const go = () => { endSession(null); renderPracticeSetup(); show('practice'); };
  if (confirmFirst) confirmBox(t('confirm.leaveTitle'), t('confirm.leavePractice'), t('confirm.yes'), go);
  else go();
}

async function copyInvite(): Promise<void> {
  if (!lastRoom) return;
  const url = inviteUrl(lastRoom.code);
  try {
    await navigator.clipboard.writeText(url);
    toast(t('lobby.copied'));
  } catch {
    const inv = $('invite-url') as HTMLInputElement;
    inv.hidden = false;
    inv.focus();
    inv.select();
    toast(t('lobby.copyFailed'));
  }
}

function toggleFullscreen(): void {
  const d = document as Document & { webkitFullscreenElement?: Element; webkitExitFullscreen?: () => void };
  const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => void };
  try {
    if (document.fullscreenElement || d.webkitFullscreenElement) (document.exitFullscreen?.() ?? d.webkitExitFullscreen?.());
    else if (el.requestFullscreen) void el.requestFullscreen().catch(() => toast(t('lost.generic')));
    else el.webkitRequestFullscreen?.();
  } catch { /* not allowed here */ }
}

// Touch taps on buttons. While another finger is down (a thumb on the
// movement stick, or resting on the glass), browsers don't turn a tap into a
// click, so the menu button or Resume would do nothing. On touch, a button
// acts when the same finger goes down and up on it; the browser's own click
// that may follow is swallowed so nothing fires twice. A drag that scrolls a
// menu is cancelled by the browser (pointercancel) and presses nothing.
function armTouchTaps(): void {
  let down: { id: number; el: HTMLElement } | null = null;
  // The browser's own click for the last tap, still to come: swallowed when it
  // arrives, however late (a busy phone can take a while), but never past the
  // start of the next touch, or a couple of seconds for a click that never comes.
  let swallow = 0;
  const btnAt = (t: EventTarget | null) => (t instanceof Element ? t.closest<HTMLElement>('button, a.btn') : null);
  document.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    swallow = 0; // a new touch: the previous tap's click is not coming
    const b = btnAt(e.target);
    down = b && !b.closest('#fps-touch') ? { id: e.pointerId, el: b } : null;
  }, true);
  document.addEventListener('pointercancel', (e) => { if (down?.id === e.pointerId) down = null; }, true);
  document.addEventListener('pointerup', (e) => {
    const d = down;
    if (!d || e.pointerId !== d.id) return;
    down = null;
    const b = btnAt(document.elementFromPoint(e.clientX, e.clientY));
    if (b !== d.el || (b as HTMLButtonElement).disabled || b.hidden) return;
    swallow = performance.now() + 2500;
    b.click();
  }, true);
  // The browser's click for the same tap comes next, and the screen may have
  // changed under it (a panel closed): swallow it wherever it lands.
  document.addEventListener('click', (e) => {
    if (!e.isTrusted || performance.now() > swallow) return;
    swallow = 0;
    e.stopImmediatePropagation();
    e.preventDefault();
  }, true);
}

function on(id: string, f: (e: Event) => void): void {
  $(id).addEventListener('click', (e) => { audio.unlock(); audio.play('ui'); f(e); });
}

function bindUi(): void {
  armTouchTaps();
  on('btn-campaign', () => { if (!needsComputer()) campaign.openSelect(); });
  on('btn-online', () => openOnline());
  on('btn-practice', () => { renderPracticeSetup(); show('practice'); music.preload('combat'); });
  on('btn-copy-link', () => {
    void copyLink(`${location.origin}${BASE}`, $('mg-link') as HTMLInputElement).then((ok) => toast(t(ok ? 'mobile.copied' : 'mobile.copyManual'), 3600));
  });
  on('btn-mg-online', () => openOnline());
  on('btn-mg-practice', () => { renderPracticeSetup(); show('practice'); music.preload('combat'); });
  on('btn-rotate-menu', () => openPause());
  on('btn-mg-settings', () => { renderSettings(); pushOverlay('settings'); });
  on('btn-mg-lang', () => changeLang(getLang() === 'en' ? 'es' : 'en'));
  on('btn-mg-more', () => { showAllModes = true; if (lastProfile) applyInputProfile(lastProfile); $('btn-mg-more').hidden = true; });
  on('btn-controls', () => pushOverlay('controls'));
  on('btn-settings', () => { renderSettings(); pushOverlay('settings'); });
  on('btn-lang', () => changeLang(getLang() === 'en' ? 'es' : 'en'));
  on('btn-online-back', () => show('title'));
  on('btn-practice-back', () => show('title'));
  on('btn-create', () => startOnline(null));
  on('btn-join', () => {
    const code = normalizeCode(($('in-code') as HTMLInputElement).value);
    if (!isValidCode(code)) { $('online-err').textContent = t('err.room_not_found'); return; }
    startOnline(code);
  });
  ($('in-code') as HTMLInputElement).addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join').click(); });
  ($('in-name') as HTMLInputElement).addEventListener('keydown', (e) => { if (e.key === 'Enter') $(($('in-code') as HTMLInputElement).value ? 'btn-join' : 'btn-create').click(); });

  document.querySelectorAll<HTMLButtonElement>('[data-diff]').forEach((b) => b.addEventListener('click', () => { store.update({ practiceDifficulty: b.dataset.diff as BotDifficulty }); renderPracticeSetup(); }));
  document.querySelectorAll<HTMLButtonElement>('[data-allies]').forEach((b) => b.addEventListener('click', () => { store.update({ practiceAllies: Number(b.dataset.allies) }); renderPracticeSetup(); }));
  document.querySelectorAll<HTMLButtonElement>('[data-enemies]').forEach((b) => b.addEventListener('click', () => { store.update({ practiceEnemies: Number(b.dataset.enemies) }); renderPracticeSetup(); }));
  on('btn-practice-start', () => startPractice());

  on('btn-copy-invite', () => void copyInvite());
  on('btn-share-invite', () => { if (lastRoom) navigator.share?.({ title: t('meta.title'), url: inviteUrl(lastRoom.code) }).catch(() => { /* cancelled */ }); });
  on('btn-start', () => { $('lobby-err').textContent = ''; session?.send({ t: 'start' }); });
  on('btn-ready', () => {
    const mine = lastRoom?.members.find((m) => m.id === session?.id);
    session?.send({ t: 'ready', ready: !mine?.ready });
  });
  on('btn-switch', () => {
    const team = session?.team;
    if (team === null || team === undefined) return;
    $('lobby-err').textContent = '';
    session?.send({ t: 'team', team: (team === 0 ? 1 : 0) as Team });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-lrules]').forEach((b) => b.addEventListener('click', () => {
    if (lastRoom?.owner === session?.id && isRulesetId(b.dataset.lrules)) session?.send({ t: 'rules', rules: b.dataset.lrules });
  }));
  document.querySelectorAll<HTMLButtonElement>('[data-prules]').forEach((b) => b.addEventListener('click', () => {
    const rules = rulesetOf(b.dataset.prules);
    // Switching to ¡Puro Chanclazo! suggests the arena where fights happen most (any map can still be picked).
    if (rules === 'melee' && store.value.practiceRules !== 'melee') store.update({ practiceMap: MELEE_MAP });
    store.update({ practiceRules: rules });
    renderPracticeSetup();
  }));
  document.querySelectorAll<HTMLButtonElement>('[data-rrules]').forEach((b) => b.addEventListener('click', () => {
    store.update({ roomRules: rulesetOf(b.dataset.rrules) });
    renderPracticeSetup();
  }));
  document.querySelectorAll<HTMLButtonElement>('[data-lmap]').forEach((b) => b.addEventListener('click', () => {
    if (lastRoom?.owner === session?.id && isMapId(b.dataset.lmap)) session?.send({ t: 'map', map: b.dataset.lmap });
  }));
  ($('chk-bots') as HTMLInputElement).addEventListener('change', (e) => {
    session?.send({ t: 'bots', enabled: (e.target as HTMLInputElement).checked, difficulty: lastRoom?.bots.difficulty ?? 'normal' });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-bdiff]').forEach((b) => b.addEventListener('click', () => {
    session?.send({ t: 'bots', enabled: lastRoom?.bots.enabled ?? false, difficulty: b.dataset.bdiff as BotDifficulty });
  }));
  on('btn-lobby-settings', () => { renderSettings(); pushOverlay('settings'); });
  on('btn-leave-room', () => endSession('title'));

  on('btn-rematch', () => session?.send({ t: 'rematch' }));
  on('btn-to-lobby', () => session?.send({ t: 'lobby' }));
  on('btn-res-leave', () => endSession('title'));

  on('btn-resume', () => resume(true));
  for (const id of ['btn-pause-diag', 'btn-settings-diag', 'btn-lost-diag', 'btn-crash-diag', 'btn-gfx-diag']) on(id, () => void copyDiagnostics());
  on('btn-diagbox-close', () => { $('scr-diagbox').hidden = true; render(); });
  on('btn-crash-home', crashToMenu);
  on('btn-crash-reload', () => location.reload());
  on('btn-gfx-reload', () => location.reload());
  on('btn-mi-reload', () => location.reload());
  on('btn-pause-settings', () => { renderSettings(); pushOverlay('settings'); });
  on('btn-pause-controls', () => pushOverlay('controls'));
  on('btn-pause-map', () => openMap());
  on('btn-map-back', () => popOverlay());
  on('btn-fullscreen', toggleFullscreen);
  on('btn-pause-leave', askHome);
  on('btn-pause-select', () => campaign.leave());
  on('btn-pause-restart', () => { if (campaign.active) campaign.restart(); else if (practice) askRestartPractice(); });
  on('btn-pause-maps', () => changePracticeMap(true));
  on('btn-res-maps', () => changePracticeMap(false));
  on('btn-menu', () => { input?.exitLock(); openPause(); });
  on('btn-click-play', () => input?.requestLock());

  on('btn-settings-close', popOverlay);
  on('btn-controls-close', popOverlay);
  on('btn-confirm-no', popOverlay);
  on('btn-confirm-yes', () => { const f = confirmAction; confirmAction = null; overlayStack.length = 0; f?.(); });

  on('btn-lost-retry', () => { const f = retry; show('title'); if (f) { if (practice) f(); else { openOnline(); f(); } } });
  on('btn-lost-practice', () => { renderPracticeSetup(); show('practice'); });
  on('btn-lost-title', () => show('title'));

  // Settings controls.
  document.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((b) => b.addEventListener('click', () => changeLang(b.dataset.lang === 'es' ? 'es' : 'en')));
  document.querySelectorAll<HTMLButtonElement>('[data-q]').forEach((b) => b.addEventListener('click', () => {
    const mode = b.dataset.q as QualityMode;
    store.update({ qualityMode: mode, quality: resolveQuality(mode) });
    applyInputSettings();
    renderSettings();
  }));
  const range = (id: string, f: (v: number) => void) => ($(id) as HTMLInputElement).addEventListener('input', (e) => { f(Number((e.target as HTMLInputElement).value)); applyInputSettings(); renderSettings(); });
  range('set-sens', (v) => store.update({ sensitivity: v / 100 }));
  range('set-tsens', (v) => store.update({ touchSensitivity: v / 100 }));
  range('set-fov', (v) => store.update({ fov: v }));
  range('set-music', (v) => store.update({ music: v / 100 }));
  range('set-sfx', (v) => store.update({ sfx: v / 100 }));
  const check = (id: string, f: (v: boolean) => void) => ($(id) as HTMLInputElement).addEventListener('change', (e) => { f((e.target as HTMLInputElement).checked); applyInputSettings(); renderSettings(); });
  check('set-invert', (v) => store.update({ invertY: v }));
  check('set-motion', (v) => store.update({ reducedMotion: v }));
  check('set-stats', (v) => store.update({ showStats: v }));
  check('set-killcam', (v) => store.update({ killcam: v }));
  check('set-minimap', (v) => store.update({ minimap: v }));
  // Preview builds only: Sol drawn with the candidate Blender model (review; the current model stays the default).
  if (OFFLINE_ONLY) { $('field-rosa-cand').hidden = false; check('set-rosa-cand', (v) => store.update({ rosaCandidate: v })); }
  // The replay's Skip button (mouse, when the pointer is free) and the touch "Tap to skip" layer.
  for (const id of ['kc-skip', 'kc-tap']) $(id).addEventListener('click', (e) => { e.preventDefault(); (e.currentTarget as HTMLElement).blur(); engine?.skipReplay(); });
  range('set-voice', (v) => store.update({ voice: v / 100 }));
  check('set-banter', (v) => store.update({ banter: v }));
  check('set-hints', (v) => store.update({ campaignHints: v }));
  document.querySelectorAll<HTMLButtonElement>('[data-subs]').forEach((b) => b.addEventListener('click', () => {
    store.update({ subtitles: b.dataset.subs as 'auto' | 'es' | 'en' | 'off' });
    renderSettings();
    dialogue.refreshSubtitle();
  }));

  // Esc closes the newest panel when the pointer is not locked. This handler
  // is registered before the game's input handler: whenever it acts on the
  // key it stops the event, or closing the menu would re-enable game input
  // and the same press would open the menu again.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || input?.locked) return;
    const cur = top();
    if (cur !== 'none') e.stopImmediatePropagation();
    if (OVERLAYS.has(cur)) { e.preventDefault(); popOverlay(); return; }
    if (cur === 'online' || cur === 'practice' || cur === 'campaign') { e.preventDefault(); show('title'); music.play('menu'); return; }
    if (cur === 'mintro' || cur === 'mresults') { e.preventDefault(); campaign.openSelect(); return; }
    // The same Escape press that opened the menu (some browsers deliver it
    // just after releasing the pointer) must not close it again.
    if (cur === 'pause') { e.preventDefault(); if (!e.repeat && performance.now() - pauseOpenedAt > 250) resume(false); }
  });
  window.addEventListener('resize', () => { engine?.resize(); if (inMatch) render(); });
  window.addEventListener('orientationchange', () => setTimeout(() => { engine?.resize(); input?.release(); render(); }, 150));
  // iOS Safari pinch gestures and double-tap zoom, only while the touch
  // controls are live: menus keep pinch zoom for accessibility.
  const touchPlaying = () => document.documentElement.classList.contains('touch-play');
  document.addEventListener('gesturestart', (e) => { if (touchPlaying()) e.preventDefault(); });
  document.addEventListener('dblclick', (e) => { if (touchPlaying()) e.preventDefault(); });
  // The usable area changed (keyboard shown or dismissed, toolbars, zoom):
  // resize, drop held input if the size changed, re-check the zoom notice.
  let vvSize = '';
  const viewportChanged = () => {
    const vv = window.visualViewport;
    const size = vv ? `${Math.round(vv.width)}x${Math.round(vv.height)}` : '';
    if (size !== vvSize) { vvSize = size; input?.release(); }
    engine?.resizeIfNeeded();
    if (inMatch) render();
  };
  window.visualViewport?.addEventListener('resize', viewportChanged);
  window.visualViewport?.addEventListener('scroll', () => { if (!$('zoom-note').hidden) placeOnVisibleArea($('zoom-note')); });
  // iOS can leave the page scrolled after the keyboard closes (the fixed game
  // then looks cropped): put it back.
  document.addEventListener('focusout', () => setTimeout(() => { if (window.scrollX || window.scrollY) window.scrollTo(0, 0); }, 60));
  document.addEventListener('fullscreenchange', () => engine?.resize());
  window.addEventListener('beforeunload', (e) => {
    if (inMatch && !practice && !campaign.active) { e.preventDefault(); e.returnValue = ''; }
  });
  window.addEventListener('pagehide', () => { session?.close(); });
  // Audio starts on the first eligible gesture, and resumes after the tab is
  // hidden or the page comes back from the back/forward cache. The music
  // controller starts the intended cue itself when audio becomes available.
  audio.setLevels(store.value.music, store.value.sfx);
  audio.setVoiceLevel(store.value.voice);
  audio.armLifecycle();
  // Shared reaction lines (used online and offline) load after the first interaction.
  const warm = () => { void dialogue.loadManifest(BASE).then(() => dialogue.preload(LINES.filter((l) => !/^m\d_/.test(l.id)).map((l) => l.id))); };
  window.addEventListener('pointerdown', warm, { once: true });
  window.addEventListener('keydown', warm, { once: true });
}

function bindInput(inp: FpsInput): void {
  inp.onLockChange = (locked) => {
    if (locked) { lockFailures = 0; render(); return; }
    // Switching to touch releases the mouse on purpose: that's not "pause".
    if (touchMode) { render(); return; }
    // Losing the lock mid-match (Esc, alt-tab, a browser prompt) opens the menu.
    if (inMatch && base === 'none') openPause();
    else render();
  };
  inp.onLockError = () => {
    // Browsers refuse a re-lock for about a second after the lock was
    // released (Chrome after Esc). That is expected, not a failure: the
    // "click to aim" prompt stays and the next click tries again. Only fall
    // back to drag-to-look when the lock is missing or keeps failing later.
    const cooldown = performance.now() - inp.unlockedAt < 1600;
    if (cooldown) { if (inMatch && base === 'none') { render(); toast(t('hud.clickAgain'), 2200); } return; }
    lockFailures++;
    if (lockFailures >= 3 || typeof $('stage').requestPointerLock !== 'function') {
      if (!inp.fallback) toast(t(activeRules === 'melee' ? 'mode.dragLook' : 'hud.dragLook'), 4000);
      inp.fallback = true;
    }
    if (inMatch && base === 'none') render();
  };
  inp.onMenu = () => { if (inMatch && base === 'none') { inp.exitLock(); openPause(); } };
  inp.onScoreboard = (open) => hud.scoreboard(open, lastRoom, engine?.stats ?? new Map(), session?.id ?? -1);
  inp.onSwitch = () => audio.play('switch');
  $('stage').addEventListener('click', () => { if (inMatch && base === 'none' && !inp.locked && !touchMode) inp.requestLock(); });
  // Switching tabs or apps, or locking the phone, always opens the menu (it
  // pauses local modes) and drops held input. Coming back, check that the
  // connection survived: a phone may have frozen the page and its socket.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { inp.release(); if (inMatch && base === 'none') openPause(); }
    else { session?.checkAlive(); session?.retryNow(); engine?.resizeIfNeeded(); render(); }
  });
  window.addEventListener('pageshow', () => { session?.checkAlive(); session?.retryNow(); });
  // The browser says the network is back: don't wait out a hung reconnect attempt.
  window.addEventListener('online', () => session?.retryNow());
}

// ---------------------------------------------------------------------
// Test and debugging hooks (no secrets: room codes are reported as set/unset)

function debugApi() {
  return {
    get screen() { return top(); },
    get inMatch() { return inMatch; },
    get room() { return lastRoom ? { phase: lastRoom.phase, members: lastRoom.members.length, owner: lastRoom.owner === session?.id, practice: lastRoom.practice } : null; },
    get code() { return lastRoom?.code ?? null; },
    info: () => engine?.debugInfo() ?? { mode: 'no-webgl' },
    session: () => session,
    host: () => host,
    touch: () => touch,
    get touchMode() { return touchMode; },
    engine: () => engine,
    input: () => input,
    minimap: () => ({ created: !!minimap, key: minimapKey, setting: store.value.minimap, arena: arenaMatch(), hidden: $('minimap').hidden }),
    campaign: () => campaign,
    dialogue: () => dialogue,
    music: () => music,
    audio: () => audio,
    diagText: () => diagText(),
  };
}

void boot();
