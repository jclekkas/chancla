// Entry point and UI flow for Chancla Warfare: La Ley de la Chancla.
//
//   Title → Online (create / join) or Practice → Lobby → Match → Results
//         → Rematch / Lobby / Leave
//
// Menus are plain DOM and work without WebGL. The 3D engine loads after a
// WebGL check; if that fails the title explains why and play is disabled.
import './fps.css';
import { SafeStorage } from '../persistence/storage';
import { audio } from '../audio/audio';
import { MATCH, type BotDifficulty } from '../../shared/config';
import { isValidCode, normalizeCode, sanitizeName, type ErrorCode, type RoomView } from '../../shared/protocol';
import type { Team } from '../../shared/map';
import { GameSession, wsTransport, type ConnState, type TransportFactory } from '../net/session';
import { LocalHost } from '../net/local';
import { applyDom, detectLang, getLang, hasKey, setLang, t, type Key } from './strings';
import { FpsSettingsStore, defaults } from './settings';
import { FpsInput } from './input';
import { Hud } from './hud';
import { rosaSVG, svgUrl } from '../ui/art';
import type { Engine } from './engine';
import { music } from '../audio/music';
import { Dialogue } from '../audio/dialogue';
import { CampaignUi } from '../campaign/ui';
import type { SimEvent } from '../../shared/sim';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

type ScreenId = 'title' | 'online' | 'practice' | 'lobby' | 'results' | 'pause' | 'settings' | 'controls' | 'confirm' | 'lost' | 'campaign' | 'mintro' | 'mresults' | 'none';
const SCREENS: ScreenId[] = ['title', 'online', 'practice', 'lobby', 'results', 'pause', 'settings', 'controls', 'confirm', 'lost', 'campaign', 'mintro', 'mresults'];
const OVERLAYS = new Set<ScreenId>(['settings', 'controls', 'confirm']);

// ---------------------------------------------------------------------
// Environment

const storage = new SafeStorage();
const reducedPref = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const lowEnd = (navigator.hardwareConcurrency ?? 8) <= 4;
const store = new FpsSettingsStore(storage, defaults(detectLang(), reducedPref, lowEnd));
setLang(store.value.lang);
const BASE = import.meta.env.BASE_URL || '/';

function serverUrl(): string | null {
  const env = import.meta.env.VITE_GAME_SERVER_URL as string | undefined;
  if (env) return env;
  const h = location.hostname;
  if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]') return `ws://${h}:8787/ws`;
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

function render(): void {
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
  $('click-to-play').hidden = !(inMatch && base === 'none' && overlayStack.length === 0 && !input?.locked && !input?.fallback);
  if (input) input.enabled = inMatch && base === 'none' && overlayStack.length === 0;
  if (engine) engine.inputActive = !!input?.enabled && (!!input.locked || input.fallback);
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

function updatePracticePause(): void {
  if (campaign?.active) campaign.setPaused(base === 'pause' || overlayStack.length > 0);
  if (!host || !engine) return;
  const shouldPause = practice && inMatch && (base === 'pause' || overlayStack.length > 0);
  if (shouldPause && !host.paused) { host.pause(); engine.paused = true; input?.release(); }
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
  const uiTick = () => { campaign.tick(); if (!campaign.active) dialogue.update(); requestAnimationFrame(uiTick); };
  requestAnimationFrame(uiTick);
  music.play('menu');
  document.documentElement.lang = getLang();
  document.title = t('meta.title');
  applyDom(document);
  bootProgress(15, 'loading.shell');
  ($('lnk-classic') as HTMLAnchorElement).href = `${BASE}classic.html`;
  $('rosa-portrait').style.backgroundImage = svgUrl(rosaSVG('smirk'));
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;
  $('mobile-note').hidden = !coarse;
  bindUi();
  readInvite();

  if (webglAvailable()) {
    try {
      bootProgress(35, 'loading.engine');
      const mod = await import('./engine');
      bootProgress(65, 'loading.world');
      await new Promise((r) => setTimeout(r, 0));
      input = new FpsInput($('stage'));
      bindInput(input);
      applyInputSettings();
      engine = new mod.Engine($('stage'), () => store.value, hud, input);
      engine.onContextLost = (lost) => { if (lost) toast(t('status.webgl'), 5000); };
      engine.start();
    } catch (err) {
      console.error(err);
      engine = null;
      showNoWebgl();
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
  (window as unknown as { __fps: unknown }).__fps = debugApi();
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
  if (!url) { serverOk = false; el.textContent = t('status.serverMissing'); el.className = 'server-status warn'; return; }
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
    event: (e: Parameters<Engine['onEvent']>[0]) => { engine?.onEvent(e); mpDialogue(e); },
    localThrow: (w: 0 | 1) => engine?.onLocalThrow(w),
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
  if (!url) { errEl.textContent = t('status.serverMissing'); return; }
  errEl.textContent = t('online.connecting');
  endSession(null);
  practice = false;
  const s = newSession(wsTransport(url));
  s.connect(playerName());
  s.send(join ? { t: 'join', code: join } : { t: 'create' });
  retry = () => startOnline(join ?? lastCode);
}

function startPractice(): void {
  const v = store.value;
  endSession(null);
  practice = true;
  const h = new LocalHost();
  host = h;
  const s = newSession(h.transport(), () => h.now());
  s.connect(sanitizeName(store.value.name, t('online.namePh')));
  s.send({ t: 'create', practice: { difficulty: v.practiceDifficulty, allies: v.practiceAllies, enemies: v.practiceEnemies } });
  retry = startPractice;
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
  engine?.enterMenu();
  if (engine) engine.paused = false;
  hud.scoreboard(false, null, new Map(), -1);
  hud.connection(null);
  music.play('menu');
  dialogue.reset();
  if (to) show(to);
}

function onState(s: ConnState, detail?: string): void {
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
  lastRoom = room;
  if (!room.practice) lastCode = room.code;
  if (room.phase === 'countdown' || room.phase === 'playing') {
    if (!inMatch) {
      inMatch = true;
      engine?.enterMatch(session!, room.practice);
      music.play('combat');
      dialogue.react('start');
      show('none');
      if (practice) input?.requestLock(); // the Start click is still a user gesture in most browsers
    } else if (base === 'results') {
      // Rematch: straight back into the courtyard.
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
  $('lobby-owner').hidden = !isOwner;
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

function renderResults(room: RoomView): void {
  const r = room.results;
  if (!r) return;
  const myTeam = session?.team ?? null;
  $('res-title').textContent = r.winner === -1 ? t('results.tie') : r.winner === 0 ? t('results.sol') : t('results.luna');
  const flavor = r.winner === -1 ? t('results.youTie') : r.winner === myTeam ? t('results.youWin') : t('results.youLose');
  const reason = r.reason === 'score' ? t('results.byScore', { n: MATCH.scoreToWin }) : t('results.byTime');
  $('res-sub').textContent = `${reason} · ${flavor}`;
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
  if (input) { input.sensitivity = v.sensitivity; input.invertY = v.invertY; }
  audio.setLevels(v.music, v.sfx);
  audio.setVoiceLevel(v.voice);
  engine?.applySettings();
  document.documentElement.classList.toggle('reduced-motion', v.reducedMotion);
}

function renderSettings(): void {
  const v = store.value;
  const seg = (attr: string, val: string) => document.querySelectorAll<HTMLButtonElement>(`[data-${attr}]`).forEach((b) => {
    const on = b.dataset[attr] === val;
    b.setAttribute('aria-checked', String(on));
    b.classList.toggle('on', on);
  });
  seg('lang', v.lang);
  seg('q', v.quality);
  seg('subs', v.subtitles);
  ($('set-voice') as HTMLInputElement).value = String(Math.round(v.voice * 100));
  $('out-voice').textContent = `${Math.round(v.voice * 100)}%`;
  ($('set-banter') as HTMLInputElement).checked = v.banter;
  ($('set-hints') as HTMLInputElement).checked = v.campaignHints;
  ($('set-sens') as HTMLInputElement).value = String(Math.round(v.sensitivity * 100));
  $('out-sens').textContent = v.sensitivity.toFixed(2);
  ($('set-invert') as HTMLInputElement).checked = v.invertY;
  ($('set-fov') as HTMLInputElement).value = String(v.fov);
  $('out-fov').textContent = `${v.fov}°`;
  ($('set-motion') as HTMLInputElement).checked = v.reducedMotion;
  ($('set-music') as HTMLInputElement).value = String(Math.round(v.music * 100));
  $('out-music').textContent = `${Math.round(v.music * 100)}%`;
  ($('set-sfx') as HTMLInputElement).value = String(Math.round(v.sfx * 100));
  $('out-sfx').textContent = `${Math.round(v.sfx * 100)}%`;
  ($('set-stats') as HTMLInputElement).checked = v.showStats;
}

function renderPracticeSetup(): void {
  const v = store.value;
  const seg = (attr: string, val: string) => document.querySelectorAll<HTMLButtonElement>(`[data-${attr}]`).forEach((b) => {
    const on = b.dataset[attr] === val;
    b.setAttribute('aria-checked', String(on));
    b.classList.toggle('on', on);
  });
  seg('diff', v.practiceDifficulty);
  seg('allies', String(v.practiceAllies));
  seg('enemies', String(v.practiceEnemies));
}

function changeLang(lang: 'en' | 'es'): void {
  store.update({ lang });
  setLang(lang);
  document.documentElement.lang = lang;
  document.title = t('meta.title');
  applyDom(document);
  hud.invalidate();
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
  $('online-err').textContent = serverUrl() ? '' : t('status.serverMissing');
  show('online');
  if (pendingInviteCode) $('btn-join').focus();
  pendingInviteCode = '';
}

function openPause(): void {
  if (!inMatch || base !== 'none') return;
  if (campaign.runtime?.inVictory) return;
  const m = campaign.active;
  $('pause-note').textContent = m ? t('pause.missionNote') : practice ? t('pause.practiceNote') : t('pause.note');
  ($('btn-pause-retrycp') as HTMLButtonElement).hidden = !m;
  ($('btn-pause-restart') as HTMLButtonElement).hidden = !m;
  show('pause');
}

function confirmBox(title: string, body: string, yes: string, action: () => void): void {
  $('confirm-title').textContent = title;
  $('confirm-body').textContent = body;
  $('btn-confirm-yes').textContent = yes;
  confirmAction = action;
  pushOverlay('confirm');
}

function resume(): void {
  show('none');
  input?.requestLock();
}

function askLeave(): void {
  if (campaign.active) { campaign.leave(); return; }
  $('confirm-title').textContent = t('confirm.leaveTitle');
  $('btn-confirm-yes').textContent = t('confirm.yes');
  const body = practice ? t('confirm.leavePractice') : t('confirm.leaveBody');
  $('confirm-body').textContent = body;
  confirmAction = () => endSession('title');
  pushOverlay('confirm');
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

function on(id: string, f: (e: Event) => void): void {
  $(id).addEventListener('click', (e) => { audio.unlock(); audio.play('ui'); f(e); });
}

function bindUi(): void {
  on('btn-campaign', () => campaign.openSelect());
  on('btn-online', openOnline);
  on('btn-practice', () => { renderPracticeSetup(); show('practice'); });
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
  on('btn-practice-start', startPractice);

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

  on('btn-resume', resume);
  on('btn-pause-settings', () => { renderSettings(); pushOverlay('settings'); });
  on('btn-pause-controls', () => pushOverlay('controls'));
  on('btn-fullscreen', toggleFullscreen);
  on('btn-pause-leave', askLeave);
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
    store.update({ quality: b.dataset.q as 'low' | 'medium' | 'high' });
    applyInputSettings();
    renderSettings();
  }));
  const range = (id: string, f: (v: number) => void) => ($(id) as HTMLInputElement).addEventListener('input', (e) => { f(Number((e.target as HTMLInputElement).value)); applyInputSettings(); renderSettings(); });
  range('set-sens', (v) => store.update({ sensitivity: v / 100 }));
  range('set-fov', (v) => store.update({ fov: v }));
  range('set-music', (v) => store.update({ music: v / 100 }));
  range('set-sfx', (v) => store.update({ sfx: v / 100 }));
  const check = (id: string, f: (v: boolean) => void) => ($(id) as HTMLInputElement).addEventListener('change', (e) => { f((e.target as HTMLInputElement).checked); applyInputSettings(); renderSettings(); });
  check('set-invert', (v) => store.update({ invertY: v }));
  check('set-motion', (v) => store.update({ reducedMotion: v }));
  check('set-stats', (v) => store.update({ showStats: v }));
  range('set-voice', (v) => store.update({ voice: v / 100 }));
  check('set-banter', (v) => store.update({ banter: v }));
  check('set-hints', (v) => store.update({ campaignHints: v }));
  document.querySelectorAll<HTMLButtonElement>('[data-subs]').forEach((b) => b.addEventListener('click', () => {
    store.update({ subtitles: b.dataset.subs as 'auto' | 'es' | 'en' | 'off' });
    renderSettings();
    dialogue.refreshSubtitle();
  }));

  // Esc closes the newest panel when the pointer is not locked.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || input?.locked) return;
    const cur = top();
    if (OVERLAYS.has(cur)) { e.preventDefault(); popOverlay(); return; }
    if (cur === 'online' || cur === 'practice' || cur === 'campaign') { e.preventDefault(); show('title'); music.play('menu'); return; }
    if (cur === 'mintro' || cur === 'mresults') { e.preventDefault(); campaign.openSelect(); return; }
    if (cur === 'pause') { e.preventDefault(); resume(); }
  });
  window.addEventListener('resize', () => engine?.resize());
  document.addEventListener('fullscreenchange', () => engine?.resize());
  window.addEventListener('beforeunload', (e) => {
    if (inMatch && !practice && !campaign.active) { e.preventDefault(); e.returnValue = ''; }
  });
  window.addEventListener('pagehide', () => { session?.close(); });
  // Unlock audio on the first interaction of any kind.
  const unlock = () => { audio.unlock(); audio.setLevels(store.value.music, store.value.sfx); audio.setVoiceLevel(store.value.voice); music.resume(); };
  window.addEventListener('pointerdown', unlock, { once: true });
  window.addEventListener('keydown', unlock, { once: true });
}

function bindInput(inp: FpsInput): void {
  inp.onLockChange = (locked) => {
    if (locked) { lockFailures = 0; render(); return; }
    // Losing the lock mid-match (Esc, alt-tab, a browser prompt) opens the menu.
    if (inMatch && base === 'none') openPause();
    else render();
  };
  inp.onLockError = () => {
    // Browsers also refuse a re-lock right after Esc; only fall back to
    // drag-to-look when the lock keeps failing or does not exist at all.
    lockFailures++;
    if (lockFailures >= 2 || typeof $('stage').requestPointerLock !== 'function') {
      if (!inp.fallback) toast(t('hud.dragLook'), 4000);
      inp.fallback = true;
    }
    if (inMatch && base === 'none') render();
  };
  inp.onMenu = () => { if (inMatch && base === 'none') { inp.exitLock(); openPause(); } };
  inp.onScoreboard = (open) => hud.scoreboard(open, lastRoom, engine?.stats ?? new Map(), session?.id ?? -1);
  inp.onSwitch = () => audio.play('switch');
  $('stage').addEventListener('click', () => { if (inMatch && base === 'none' && !inp.locked) inp.requestLock(); });
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
    engine: () => engine,
    input: () => input,
    campaign: () => campaign,
    dialogue: () => dialogue,
    music: () => music,
    audio: () => audio,
  };
}

void boot();
