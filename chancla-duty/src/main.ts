import './style.css';
import { AudioBus } from './audio';
import {
  CLASSIC,
  ENDLESS_MAPS,
  MAPS,
  MISSIONS,
  STORY,
  UPGRADES,
  UPGRADE_IDS,
  WEAPONS,
  loadout,
  makeEndlessWave,
  missionById,
  upgradeCost,
  type Diff,
  type MissionDef,
  type UpgradeId,
  type WeaponId,
} from './content';
import { Game, type HudModel, type RunResult } from './game';
import { t, tf, type Lang } from './i18n';
import { Controls } from './input';
import { loadSave, writeSave, type Save } from './persist';
import { RANK_NAME, rankFor } from './rules';
import { Warfare, warfareServerUrl } from './warfare';
import type { MapId } from '../../shared/maps/index';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const save = loadSave();
let screen: Screen = 'title';
let settingsFrom: Screen = 'title';
let diff: Diff = 'normal';
let pending: { id: string; endless: boolean } | null = null;
let endlessMap = 'patio';
let lastRun: RunResult | null = null;
let rotateOk = false;
const toasts: { text: string; life: number }[] = [];

type Screen = 'title' | 'missions' | 'brief' | 'armory' | 'help' | 'settings' | 'pause' | 'results' | 'play' | 'war' | 'lobby' | 'wresults' | 'wplay';

const audio = new AudioBus();
audio.musicVol = save.music;
audio.sfxVol = save.sfx;
const controls = new Controls();
const canvas = $<HTMLCanvasElement>('c');
controls.attach(canvas);
controls.bindTouch($('stick'), $('look'), {
  throw: $('btn-throw'),
  dash: $('btn-dash'),
  recall: $('btn-recall'),
  legend: $('btn-legend'),
  cycle: $('btn-cycle'),
});

let game = new Game(canvas, controls, audio, {
  hud: (h) => paintHud(h),
  over: (r) => onOver(r),
  toast: (text) => pushToast(text),
});
applySettings();

function lang(): Lang { return save.lang; }

function applyI18n(): void {
  const table = lang();
  document.documentElement.lang = table;
  document.querySelectorAll<HTMLElement>('[data-k]').forEach((el) => {
    const key = el.dataset['k'];
    if (!key) return;
    el.textContent = t(table, key);
  });
  $('btn-lang').textContent = table === 'en' ? t(table, 'ui.lang') : t(table, 'ui.lang.es');
  const base = import.meta.env.BASE_URL || '/';
  $<HTMLAnchorElement>('lnk-original').href = base;
  paintRank();
}

function paintRank(): void {
  const name = RANK_NAME[rankFor(save.lifetime)]![lang()];
  $('rankline').textContent = tf(lang(), 'title.rank', { rank: name, n: Math.floor(save.lifetime) });
}

function persist(): void { writeSave(save); }

function applySettings(): void {
  game.lang = save.lang;
  game.showFps = save.fps;
  game.reduce = save.reduce || matchMedia('(prefers-reduced-motion: reduce)').matches;
  game.shakeOn = save.shake && !game.reduce;
  game.assist = save.assist;
  game.setQuality(save.quality);
  audio.musicVol = save.music;
  audio.sfxVol = save.sfx;
  audio.apply();
  document.body.classList.toggle('reduce', game.reduce);
  const shake = $<HTMLInputElement>('set-shake');
  const assist = $<HTMLInputElement>('set-assist');
  const reduce = $<HTMLInputElement>('set-reduce');
  const fps = $<HTMLInputElement>('set-fps');
  const music = $<HTMLInputElement>('set-music');
  const sfx = $<HTMLInputElement>('set-sfx');
  shake.checked = save.shake;
  assist.checked = save.assist;
  reduce.checked = save.reduce;
  fps.checked = save.fps;
  music.value = String(Math.round(save.music * 100));
  sfx.value = String(Math.round(save.sfx * 100));
  document.querySelectorAll<HTMLButtonElement>('#qual-seg button').forEach((b) => {
    b.classList.toggle('on', b.dataset['q'] === save.quality);
  });
}

function show(next: Screen): void {
  screen = next;
  const ids: Screen[] = ['title', 'missions', 'brief', 'armory', 'help', 'settings', 'pause', 'results', 'war', 'lobby', 'wresults'];
  for (const id of ids) {
    const el = document.getElementById('scr-' + id);
    if (el) el.hidden = id !== next;
  }
  const playing = next === 'play' || next === 'wplay';
  $('hud').hidden = next !== 'play';
  $('war-hud').hidden = next !== 'wplay';
  document.body.classList.toggle('playing', playing);
  document.body.classList.toggle('war-touch', next === 'wplay' && wantTouch());
  if (next === 'wplay' && wantTouch()) $('hud').hidden = false;
  canvas.classList.toggle('aiming', playing && !wantTouch());
  if (playing) (document.activeElement as HTMLElement | null)?.blur?.();
}

function wantTouch(): boolean {
  return controls.usingTouch || matchMedia('(pointer: coarse)').matches;
}

function unlockAudio(): void { audio.start(); }

let war: Warfare | null = null;
let warMap: MapId = 'patio';
let warDiff: 'easy' | 'normal' | 'hard' = 'normal';
let crouchOn = false;

function findMission(id: string): MissionDef | undefined {
  return missionById(id) ?? STORY.find((m) => m.id === id) ?? (id === CLASSIC.id ? CLASSIC : undefined);
}

function bootWar(): Warfare {
  war?.stop();
  game.stop();
  war = new Warfare(canvas, controls, audio, {
    room: (room, me) => {
      const code = $('lobby-code');
      code.textContent = room.practice ? 'Practice' : room.code;
      const sol = $('team-sol');
      const luna = $('team-luna');
      sol.innerHTML = '';
      luna.innerHTML = '';
      for (const m of room.members) {
        const li = document.createElement('li');
        li.textContent = `${m.name}${m.bot ? ' · BOT' : ''}${m.ready ? ' · ready' : ''}${m.id === me ? ' · you' : ''}`;
        (m.team === 0 ? sol : luna).append(li);
      }
      const mine = room.members.find((m) => m.id === me);
      const owner = room.owner === me;
      $('btn-start-match').hidden = !owner;
      $('btn-ready').hidden = owner;
      $('btn-ready').textContent = mine?.ready ? 'Not ready' : "I'm ready";
      $('lobby-status').textContent = owner ? 'You are the host.' : 'Waiting for the host.';
      document.querySelectorAll<HTMLButtonElement>('#lobby-maps button').forEach((b) => b.classList.toggle('on', b.dataset['lmap'] === room.map));
      if (room.phase === 'results' && room.results) {
        $('wres-title').textContent = room.results.winner < 0 ? 'Tie' : room.results.winner === (mine?.team ?? 0) ? 'Your team won' : 'Your team lost';
        const body = $('wres-body');
        body.innerHTML = '';
        for (const row of room.results.rows) {
          const p = document.createElement('p');
          p.textContent = `${row.name}${row.bot ? ' · BOT' : ''} · ${row.kills} sent home · ${row.deaths} times`;
          body.append(p);
        }
      }
    },
    phase: (phase) => {
      if (phase === 'playing' || phase === 'countdown') show('wplay');
      else if (phase === 'results') show('wresults');
      else show('lobby');
    },
    error: (code) => { $('war-err').textContent = code === 'no_server' ? 'Online server is not set up on this host. Practice still works.' : code; },
    left: () => leaveWar(),
  });
  return war;
}

function leaveWar(): void {
  war?.stop();
  war = null;
  game = new Game(canvas, controls, audio, { hud: (h) => paintHud(h), over: (r) => onOver(r), toast: (text) => pushToast(text) });
  applySettings();
  show('title');
}

$('btn-online').onclick = () => {
  unlockAudio();
  $('war-title').textContent = 'Play online';
  $('war-note').textContent = warfareServerUrl() ? 'Private rooms, 2 to 4 Rosas, Sol versus Luna.' : 'This host has no game server. Practice still works.';
  $('war-online').hidden = false;
  $('war-practice').hidden = true;
  show('war');
};
$('btn-practice-war').onclick = () => {
  unlockAudio();
  $('war-title').textContent = 'Practice';
  $('war-note').textContent = 'Same match as online, against labeled bots. The clock stops while this menu is open.';
  $('war-online').hidden = true;
  $('war-practice').hidden = false;
  show('war');
};
$('btn-war-back').onclick = () => show('title');
document.querySelectorAll<HTMLButtonElement>('#war-maps button').forEach((b) => {
  b.onclick = () => { warMap = (b.dataset['wmap'] as MapId) || 'patio'; document.querySelectorAll('#war-maps button').forEach((x) => x.classList.toggle('on', x === b)); };
});
document.querySelectorAll<HTMLButtonElement>('#war-diff button').forEach((b) => {
  b.onclick = () => { warDiff = (b.dataset['wd'] as typeof warDiff) || 'normal'; document.querySelectorAll('#war-diff button').forEach((x) => x.classList.toggle('on', x === b)); };
});
$('btn-war-practice').onclick = () => {
  const name = $<HTMLInputElement>('war-name').value || 'Rosa';
  bootWar().practice({ difficulty: warDiff, allies: 1, enemies: 2, map: warMap, name });
};
$('btn-war-create').onclick = () => {
  const name = $<HTMLInputElement>('war-name').value || 'Rosa';
  bootWar().online({ name, create: true, map: warMap });
};
$('btn-war-join').onclick = () => {
  const name = $<HTMLInputElement>('war-name').value || 'Rosa';
  const code = $<HTMLInputElement>('war-code').value;
  bootWar().online({ name, create: false, code, map: warMap });
};
$('btn-ready').onclick = () => {
  const ready = $('btn-ready').textContent !== 'Not ready';
  war?.act({ t: 'ready', ready });
};
$('btn-start-match').onclick = () => war?.act({ t: 'start' });
let myTeam: 0 | 1 = 0;
$('btn-team').onclick = () => { myTeam = myTeam === 0 ? 1 : 0; war?.act({ t: 'team', team: myTeam }); };
$('btn-leave-room').onclick = () => { war?.act({ t: 'leave' }); leaveWar(); };
$('btn-copy-code').onclick = () => { const code = $('lobby-code').textContent ?? ''; if (code && code !== 'Practice') void navigator.clipboard?.writeText(`${location.origin}${location.pathname}#room=${code}`); };
$('btn-rematch').onclick = () => war?.act({ t: 'rematch' });
$('btn-back-lobby').onclick = () => war?.act({ t: 'lobby' });
$('btn-wres-home').onclick = () => leaveWar();
$('btn-war-menu').onclick = () => { war?.act({ t: 'lobby' }); };
document.querySelectorAll<HTMLButtonElement>('#lobby-maps button').forEach((b) => {
  b.onclick = () => { const id = b.dataset['lmap'] as MapId; if (id) war?.act({ t: 'map', map: id }); };
});
$<HTMLInputElement>('chk-bots').onchange = (e) => {
  war?.act({ t: 'bots', enabled: (e.target as HTMLInputElement).checked, difficulty: warDiff });
};
canvas.addEventListener('pointermove', (e) => { if (screen === 'wplay') war?.pointer(e.clientX, e.clientY); });
$('btn-story').onclick = () => { unlockAudio(); renderMissionList(STORY, () => false); show('missions'); };
$('btn-classic').onclick = () => { unlockAudio(); pending = { id: CLASSIC.id, endless: false }; openBrief(CLASSIC.id, false); };

$('btn-campaign').onclick = () => { unlockAudio(); renderMissions(); show('missions'); };
$('btn-endless').onclick = () => { unlockAudio(); openBrief('endless', true); };
$('btn-armory').onclick = () => { renderArmory(); show('armory'); };
$('btn-how').onclick = () => show('help');
$('btn-settings').onclick = () => { settingsFrom = 'title'; show('settings'); };
$('btn-lang').onclick = () => { save.lang = save.lang === 'en' ? 'es' : 'en'; persist(); applyI18n(); game.lang = save.lang; };
$('btn-mis-back').onclick = () => show('title');
$('btn-brief-back').onclick = () => { if (pending?.endless) show('title'); else show('missions'); game.attract('patio'); };
$('btn-arm-back').onclick = () => show('title');
$('btn-help-close').onclick = () => show('title');
$('btn-set-close').onclick = () => show(settingsFrom);
$('btn-pause').onclick = () => openPause();
$('btn-resume').onclick = () => resume();
$('btn-pause-settings').onclick = () => { settingsFrom = 'pause'; show('settings'); };
$('btn-restart').onclick = () => { if (lastStart) begin(lastStart); };
$('btn-quit').onclick = () => { game.attract('patio'); show('title'); };
$('btn-start').onclick = () => { if (pending) begin(pending); };
$('btn-retry').onclick = () => { if (lastStart) begin(lastStart); };
$('btn-next').onclick = () => goNext();
$('btn-res-arm').onclick = () => { renderArmory(); show('armory'); };
$('btn-res-mis').onclick = () => { renderMissions(); show('missions'); game.attract('patio'); };
$('btn-rotate-go').onclick = () => { rotateOk = true; $('rotate').hidden = true; };

document.querySelectorAll<HTMLButtonElement>('#diff-seg button').forEach((b) => {
  b.onclick = () => {
    diff = (b.dataset['diff'] as Diff) || 'normal';
    markDiff();
  };
});
document.querySelectorAll<HTMLButtonElement>('#qual-seg button').forEach((b) => {
  b.onclick = () => {
    save.quality = (b.dataset['q'] as Save['quality']) || 'auto';
    persist();
    applySettings();
  };
});
$<HTMLInputElement>('set-music').oninput = (e) => {
  save.music = Number((e.target as HTMLInputElement).value) / 100;
  audio.musicVol = save.music;
  audio.apply();
  audio.start();
  persist();
};
$<HTMLInputElement>('set-sfx').oninput = (e) => {
  save.sfx = Number((e.target as HTMLInputElement).value) / 100;
  audio.sfxVol = save.sfx;
  audio.apply();
  persist();
};
$<HTMLInputElement>('set-shake').onchange = (e) => { save.shake = (e.target as HTMLInputElement).checked; persist(); applySettings(); };
$<HTMLInputElement>('set-assist').onchange = (e) => { save.assist = (e.target as HTMLInputElement).checked; persist(); applySettings(); };
$<HTMLInputElement>('set-reduce').onchange = (e) => { save.reduce = (e.target as HTMLInputElement).checked; persist(); applySettings(); };
$<HTMLInputElement>('set-fps').onchange = (e) => { save.fps = (e.target as HTMLInputElement).checked; persist(); applySettings(); };

window.addEventListener('pointerdown', unlockAudio, { passive: true });
window.addEventListener('keydown', (e) => {
  unlockAudio();
  if (e.code === 'KeyC' && screen === 'wplay') { crouchOn = !crouchOn; war?.setCrouch(crouchOn); }
  if (e.key === 'Escape') {
    if (screen === 'play') openPause();
    else if (screen === 'pause') resume();
    else if (screen === 'wplay') war?.act({ t: 'lobby' });
    else if (screen === 'lobby' || screen === 'wresults' || screen === 'war') leaveWar();
    else if (screen !== 'title') show('title');
  } else if ((e.key === 'p' || e.key === 'P') && screen === 'play') openPause();
});

let lastStart: { id: string; endless: boolean } | null = null;

function markDiff(): void {
  document.querySelectorAll<HTMLButtonElement>('#diff-seg button').forEach((b) => {
    b.classList.toggle('on', b.dataset['diff'] === diff);
  });
}

function renderMissions(): void {
  renderMissionList(MISSIONS, (i) => i > save.unlocked);
}

function renderMissionList(list: MissionDef[], lockedAt: (i: number) => boolean): void {
  const root = $('mission-list');
  root.innerHTML = '';
  list.forEach((m, i) => {
    const locked = lockedAt(i);
    const best = save.best[m.id];
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mission' + (locked ? ' locked' : '');
    btn.disabled = locked;
    const title = document.createElement('strong');
    title.textContent = m.name[lang()];
    const sub = document.createElement('small');
    sub.textContent = locked
      ? t(lang(), 'mission.locked')
      : best
        ? tf(lang(), 'mission.best', { score: best.score, grade: best.grade })
        : m.blurb[lang()];
    btn.append(title, sub);
    btn.onclick = () => openBrief(m.id, false);
    root.append(btn);
  });
}

function openBrief(id: string, endless: boolean): void {
  pending = { id, endless };
  const maps = $('endless-maps');
  maps.hidden = !endless;
  maps.innerHTML = '';
  if (endless) {
    $('brief-kicker').textContent = t(lang(), 'ui.endless');
    $('brief-title').textContent = 'Duty';
    $('brief-blurb').textContent = t(lang(), 'brief.endless');
    $('brief-obj').textContent = t(lang(), 'hud.obj.endless');
    $('brief-tip').textContent = t(lang(), 'help.lead');
    $('brief-dossier').textContent = '';
    for (const mid of ENDLESS_MAPS) {
      const map = MAPS[mid];
      if (!map) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = map.name[lang()];
      b.classList.toggle('on', mid === endlessMap);
      b.onclick = () => { endlessMap = mid; openBrief(id, true); game.preview(mid); };
      maps.append(b);
    }
    game.preview(endlessMap);
  } else {
    const m = findMission(id);
    if (!m) return;
    $('brief-kicker').textContent = MAPS[m.map]?.name[lang()] ?? '';
    $('brief-title').textContent = m.name[lang()];
    $('brief-blurb').textContent = m.blurb[lang()];
    $('brief-obj').textContent = m.objective[lang()];
    $('brief-tip').textContent = m.tip[lang()];
    $('brief-dossier').textContent = m.dossier[lang()];
    game.preview(m.map);
  }
  markDiff();
  show('brief');
}

function begin(start: { id: string; endless: boolean }): void {
  lastStart = start;
  const weapons = loadout(save.weapons);
  if (start.endless) {
    const map = MAPS[endlessMap] ?? MAPS.patio!;
    game.start({
      missionId: 'endless:' + map.id,
      map,
      waves: [makeEndlessWave(1)],
      diff,
      ranks: save.ranks,
      weapons,
      endless: true,
      finale: false,
      defend: false,
      showTip: false,
      par: 0,
    });
  } else {
    const m = findMission(start.id);
    if (!m) return;
    const map = MAPS[m.map];
    if (!map) return;
    game.start({
      missionId: m.id,
      map,
      waves: m.waves,
      diff,
      ranks: save.ranks,
      weapons,
      endless: false,
      finale: m.finale,
      defend: m.stall,
      showTip: m.id === 'patio',
      par: m.par,
    });
  }
  show('play');
}

function openPause(): void {
  if (screen !== 'play') return;
  game.pause();
  show('pause');
}

function resume(): void {
  show('play');
  game.resume();
}

function onOver(r: RunResult): void {
  lastRun = r;
  save.respeto += r.respeto;
  save.lifetime += r.respeto;
  if (!r.endless && r.won) {
    const idx = MISSIONS.findIndex((m) => m.id === r.missionId);
    if (idx >= 0) save.unlocked = Math.max(save.unlocked, idx + 1);
    const prev = save.best[r.missionId];
    if (!prev || r.score > prev.score) save.best[r.missionId] = { score: r.score, grade: r.grade, wave: r.wave };
  }
  if (r.endless) {
    const key = r.missionId;
    const prev = save.best[key];
    if (!prev || r.wave > prev.wave || r.score > prev.score) save.best[key] = { score: r.score, grade: r.grade, wave: r.wave };
  }
  persist();
  paintRank();
  $('res-grade').textContent = r.grade;
  $('res-title').textContent = t(lang(), r.endless ? 'result.endless' : r.won ? 'result.win' : 'result.lose');
  const rows: [string, string][] = [
    [t(lang(), 'result.score'), String(r.score)],
    [t(lang(), 'result.kills'), String(r.kills)],
    [t(lang(), 'result.acc'), Math.round(r.accuracy * 100) + '%'],
    [t(lang(), 'result.combo'), '×' + r.bestCombo],
    [t(lang(), 'result.time'), formatTime(r.time)],
    [t(lang(), 'result.respeto'), '+' + r.respeto],
  ];
  if (r.endless) rows.splice(1, 0, [t(lang(), 'result.wave'), String(r.wave)]);
  const dl = $('res-stats');
  dl.innerHTML = '';
  for (const [k, v] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = v;
    dl.append(dt, dd);
  }
  $('btn-next').hidden = r.endless || !r.won || !nextMission(r.missionId);
  show('results');
}

function nextMission(id: string): string | null {
  const i = MISSIONS.findIndex((m) => m.id === id);
  if (i < 0 || i + 1 >= MISSIONS.length) return null;
  return MISSIONS[i + 1]!.id;
}

function goNext(): void {
  if (!lastRun) return;
  const n = nextMission(lastRun.missionId);
  if (n) openBrief(n, false);
  else { renderMissions(); show('missions'); }
}

function renderArmory(): void {
  $('armory-have').textContent = `${t(lang(), 'armory.have')}: ${Math.floor(save.respeto)}`;
  const root = $('armory-list');
  root.innerHTML = '';
  for (const id of UPGRADE_IDS) {
    const u = UPGRADES[id];
    const rank = save.ranks[id];
    const cost = upgradeCost(id, rank);
    const row = document.createElement('div');
    row.className = 'arm-row';
    const label = document.createElement('div');
    label.innerHTML = `<b>${u.name[lang()]}</b><br><small>${u.blurb[lang()]} · ${tf(lang(), 'armory.rank', { n: rank, m: u.max })}</small>`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'buy';
    btn.textContent = cost === null ? t(lang(), 'armory.max') : `${t(lang(), 'armory.buy')} ${cost}`;
    btn.disabled = cost === null || save.respeto < cost;
    btn.onclick = () => buyUpgrade(id);
    row.append(label, btn);
    root.append(row);
  }
  (Object.keys(WEAPONS) as WeaponId[]).forEach((id) => {
    const w = WEAPONS[id];
    if (w.unlock <= 0) return;
    const owned = save.weapons.includes(id);
    const row = document.createElement('div');
    row.className = 'arm-row';
    const label = document.createElement('div');
    label.innerHTML = `<b>${w.name}</b><br><small>${w.blurb[lang()]}</small>`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'buy';
    btn.textContent = owned ? t(lang(), 'armory.unlocked') : `${t(lang(), 'armory.buy')} ${w.unlock}`;
    btn.disabled = owned || save.respeto < w.unlock;
    btn.onclick = () => buyWeapon(id);
    row.append(label, btn);
    root.append(row);
  });
}

function buyUpgrade(id: UpgradeId): void {
  const cost = upgradeCost(id, save.ranks[id]);
  if (cost === null || save.respeto < cost) return;
  save.respeto -= cost;
  save.ranks[id] += 1;
  persist();
  renderArmory();
  paintRank();
}

function buyWeapon(id: WeaponId): void {
  const cost = WEAPONS[id].unlock;
  if (save.weapons.includes(id) || save.respeto < cost) return;
  save.respeto -= cost;
  save.weapons.push(id);
  persist();
  renderArmory();
}

function paintHud(h: HudModel): void {
  if (screen === 'play') {
    $('touch').hidden = !wantTouch();
    const stick = controls.stickVisual();
    const knob = $('knob');
    knob.style.transform = `translate(${stick.x * 36}px, ${stick.y * 36}px)`;
    const portrait = window.innerHeight > window.innerWidth && window.innerWidth < 820 && wantTouch() && !rotateOk;
    $('rotate').hidden = !portrait;
  }
  if (!h.playing || screen !== 'play') return;
  $('score').textContent = String(h.score);
  $('mult').textContent = h.combo > 1 ? `×${h.mult}` : '';
  $('obj').textContent = (h.endless ? tf(lang(), 'hud.waveEnd', { n: h.wave }) : tf(lang(), 'hud.wave', { n: h.wave, m: h.waves }))
    + ' · ' + t(lang(), 'hud.obj.' + h.objective);
  const hpPct = h.maxHp > 0 ? h.hp / h.maxHp : 0;
  $('hpfill').style.width = `${Math.max(0, Math.min(1, hpPct)) * 100}%`;
  $('hpnum').textContent = String(h.hp);
  $<HTMLElement>('hp').setAttribute('aria-valuenow', String(h.hp));
  $<HTMLElement>('hp').setAttribute('aria-valuemax', String(h.maxHp));
  $('lowhp').style.opacity = hpPct < 0.3 ? String(0.35 + (0.3 - hpPct)) : '0';
  const hurtAt = Number(document.body.dataset['hurt'] ?? 0);
  $('hurt').style.opacity = performance.now() - hurtAt < 180 ? '1' : '0';
  $('fps').hidden = !h.showFps;
  $('fps').textContent = h.showFps ? `${h.fps} fps` : '';
  $('banner').textContent = h.banner ? t(lang(), 'banner.' + h.banner) : '';
  $('tip').hidden = !h.showTip;
  $('tip').textContent = t(lang(), 'hud.tip');
  $('dashlabel').textContent = t(lang(), 'hud.dash');
  $('legendlbl').textContent = t(lang(), 'hud.legend');
  $<HTMLElement>('dashfill').style.setProperty('--p', `${Math.round(h.dash * 100)}%`);
  $<HTMLElement>('legendfill').style.setProperty('--p', `${Math.round(h.legend * 100)}%`);
  $('legendfill').parentElement?.classList.toggle('ready', h.legendOn);
  const shoes = $('shoes').querySelectorAll('i');
  shoes.forEach((shoe, i) => shoe.classList.toggle('on', i < h.pool));
  const boss = $('bossbar');
  boss.hidden = !h.boss;
  if (h.boss) {
    $('bossname').textContent = t(lang(), 'hud.boss');
    $('bosshp').style.width = `${(h.boss.hp / h.boss.max) * 100}%`;
  }
  const stall = $('stallbar');
  stall.hidden = !h.stall;
  if (h.stall) {
    $('stallname').textContent = t(lang(), 'hud.stall');
    $('stallhp').style.width = `${(h.stall.hp / h.stall.max) * 100}%`;
  }
  const buffs = $('buffs');
  buffs.innerHTML = '';
  for (const b of h.buffs) {
    const s = document.createElement('span');
    s.textContent = b;
    buffs.append(s);
  }
  const box = $('weapons');
  if (box.childElementCount !== h.weapons.length) {
    box.innerHTML = '';
    h.weapons.forEach((_id, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'weapon';
      b.innerHTML = `<b></b><i></i>`;
      b.onclick = () => controls.requestSlot(i);
      box.append(b);
    });
  }
  [...box.children].forEach((node, i) => {
    const el = node as HTMLButtonElement;
    const id = h.weapons[i];
    if (!id) return;
    el.classList.toggle('on', i === h.weapon);
    const name = el.querySelector('b');
    const bar = el.querySelector('i');
    if (name) name.textContent = `${i + 1} ${WEAPONS[id].name}`;
    if (bar) {
      const ready = id === 'chancla' ? h.pool / 2 : h.cooldown;
      bar.style.width = `${Math.max(0, Math.min(1, ready)) * 100}%`;
    }
  });
  paintToasts();
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function pushToast(text: string): void {
  toasts.unshift({ text, life: 2.4 });
  if (toasts.length > 3) toasts.pop();
}

function paintToasts(): void {
  const root = $('toasts');
  root.innerHTML = '';
  for (const item of toasts) {
    const p = document.createElement('p');
    p.textContent = item.text;
    root.append(p);
  }
}

setInterval(() => {
  for (const item of toasts) item.life -= 0.25;
  for (let i = toasts.length - 1; i >= 0; i--) if (toasts[i]!.life <= 0) toasts.splice(i, 1);
}, 250);

const params = new URLSearchParams(location.search);
applyI18n();
markDiff();
if (params.get('go')) {
  const id = params.get('mission') || 'patio';
  diff = (params.get('diff') as Diff) || 'easy';
  if (id === 'endless') begin({ id: 'endless', endless: true });
  else begin({ id, endless: false });
} else {
  show('title');
  game.attract('patio');
}
