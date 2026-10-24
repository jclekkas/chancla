// In-match HUD. DOM is only touched when values change.
import * as THREE from 'three';
import { MATCH, MELEE, WEAPONS, type RulesetId, type WeaponId } from '../../shared/config';
import type { RoomView } from '../../shared/protocol';
import { t, type Key } from './strings';
import { attackKey } from './killcam';
import { chanclaSVG, rosaSVG, svgUrl } from '../ui/art';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

export interface HudFrame {
  hp: number;
  alive: boolean;
  weapon: WeaponId;
  cooldownMs: number;
  switchMs: number;
  /** Melee recovery left (ms), if a swing is under way. */
  meleeMs?: number;
  respawnInMs: number;
  protectedMs: number;
  scores: [number, number];
  timeLeftMs: number;
  phase: string;
  countdownMs: number;
  region: string;
  rtt: number;
  quality: 'good' | 'ok' | 'poor' | 'stalled';
  fps: number;
  showStats: boolean;
  practice: boolean;
  team: number | null; // the local player's team
}

const teamName = (team: number) => t(team === 0 ? 'hud.sol' : 'hud.luna');
const teamIcon = (team: number) => (team === 0 ? '☀' : '☾');

const pesadaIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80"><g transform="rotate(-18 60 40)"><path d="M16 46 C16 30 34 22 60 24 C92 26 106 34 106 46 L106 54 C106 60 92 64 60 64 C30 64 16 60 16 54 Z" fill="#9a6a3e"/><path d="M16 54 C16 60 30 64 60 64 C92 64 106 60 106 54 L106 58 C106 66 90 70 60 70 C30 70 16 66 16 58 Z" fill="#5e3b25"/><path d="M58 26 C80 24 92 34 92 44 C80 46 68 46 56 44 C54 36 54 30 58 26 Z" fill="#6a3a8c"/><g fill="#f5c542"><circle cx="62" cy="30" r="3"/><circle cx="72" cy="28" r="3"/><circle cx="82" cy="31" r="3"/><circle cx="88" cy="38" r="3"/></g></g></svg>`;

export class Hud {
  private cache = new Map<string, string>();
  private el = {
    root: $('hud'), solScore: $('sc-sol'), lunaScore: $('sc-luna'), timer: $('timer'), practice: $('hud-practice'),
    killfeed: $('killfeed'), net: $('net'), netPing: $('net-ping'), fps: $('fps'),
    cd: $('cd-ring'), hitmarker: $('hitmarker'), missmarker: document.getElementById('missmarker'), dmg: $('dmg-ind'), center: $('center-msg'), sub: $('sub-msg'),
    region: $('region'), hp: $('hp'), hpFill: $('hp-fill'), hpNum: $('hp-num'), protect: $('protect'),
    slots: Array.from(document.querySelectorAll<HTMLElement>('.wslot')), conn: $('banner-conn'),
    vigHurt: $('vig-hurt'), vigLow: $('vig-low'), names: $('names'), sb: $('scoreboard'), sbBody: $('sb-body'),
    chip: $('team-chip'), chipIcon: $('team-chip-icon'), chipText: $('team-chip-text'),
    banner: $('spawn-banner'), bannerIcon: $('spawn-banner-icon'), bannerText: $('spawn-banner-text'),
    scoreSol: document.querySelector<HTMLElement>('.teamscore.sol'), scoreLuna: document.querySelector<HTMLElement>('.teamscore.luna'),
  };
  private bannerT = 0;
  /** The match's combat rules: melee-only shows its chip, its key hint and a line on the first banner. */
  private rules: RulesetId = 'classic';
  private touchHints = false;
  private hitT = 0;
  private missT = 0;
  private hurtT = 0;
  private centerT = 0;
  private subT = 0;
  private nameEls = new Map<number, HTMLDivElement>();
  private floats: Array<{ el: HTMLDivElement; pos: THREE.Vector3; t: number }> = [];
  private dmgArcs: Array<{ el: HTMLElement; angle: number; t: number }> = [];

  constructor() {
    document.querySelectorAll<HTMLElement>('.hp-face').forEach((e) => (e.style.backgroundImage = svgUrl(rosaSVG('smirk', 'face'))));
    document.querySelectorAll<HTMLElement>('.wicon.w0').forEach((e) => (e.style.backgroundImage = svgUrl(chanclaSVG(-15))));
    document.querySelectorAll<HTMLElement>('.wicon.w1').forEach((e) => (e.style.backgroundImage = svgUrl(pesadaIcon)));
  }

  private set(k: string, v: string, f: () => void): void {
    if (this.cache.get(k) === v) return;
    this.cache.set(k, v);
    f();
  }

  invalidate(): void { this.cache.clear(); }

  reset(): void {
    this.invalidate();
    this.el.killfeed.innerHTML = '';
    this.el.center.hidden = true;
    this.el.sub.hidden = true;
    this.hitT = this.missT = this.hurtT = this.centerT = this.subT = 0;
    this.el.missmarker?.classList.remove('on');
    for (const f of this.floats) f.el.remove();
    this.floats = [];
    for (const a of this.dmgArcs) a.el.remove();
    this.dmgArcs = [];
    for (const e of this.nameEls.values()) e.remove();
    this.nameEls.clear();
  }

  center(text: string, seconds: number): void {
    this.el.center.textContent = text;
    this.el.center.hidden = false;
    this.centerT = seconds;
  }

  sub(text: string, seconds: number): void {
    this.el.sub.textContent = text;
    this.el.sub.hidden = false;
    this.subT = seconds;
  }

  hitMarker(kind: 'body' | 'head' | 'kill'): void {
    const h = this.el.hitmarker;
    h.classList.add('on');
    h.classList.toggle('head', kind === 'head');
    h.classList.toggle('kill', kind === 'kill');
    this.hitT = kind === 'kill' ? 0.32 : 0.18;
  }

  /** Your own confirmed miss: pale air arcs on the side the swing finished (+1 right, -1 left). Never a hit marker. */
  missMarker(side: 1 | -1): void {
    const m = this.el.missmarker;
    if (!m) return;
    this.el.hitmarker.classList.remove('on');
    m.classList.remove('r', 'l');
    m.classList.add('on', side > 0 ? 'r' : 'l');
    this.missT = 0.2;
  }

  hurt(fromAngle: number | null): void {
    this.el.vigHurt.classList.add('on');
    this.hurtT = 0.2;
    if (fromAngle !== null) {
      const el = document.createElement('i');
      this.el.dmg.appendChild(el);
      this.dmgArcs.push({ el, angle: fromAngle, t: 1.1 });
    }
  }

  floatText(text: string, pos: THREE.Vector3, cls = ''): void {
    const el = document.createElement('div');
    el.className = `float ${cls}`;
    el.textContent = text;
    this.el.names.appendChild(el);
    this.floats.push({ el, pos: pos.clone(), t: 0 });
    if (this.floats.length > 12) this.floats.shift()!.el.remove();
  }

  /** `melee`: the elimination was a Chanclazo or a Revés (named next to the chancla). */
  killfeed(attacker: string, aTeam: number, victim: string, vTeam: number, weapon: WeaponId, mine: boolean, melee = false): void {
    const row = document.createElement('div');
    row.className = `kf${mine ? ' me' : ''}`;
    const a = document.createElement('span'); a.className = aTeam === 0 ? 's' : 'l'; a.textContent = attacker;
    const w = document.createElement('span'); w.className = 'w'; w.style.backgroundImage = svgUrl(weapon === 0 ? chanclaSVG(-15) : pesadaIcon);
    const v = document.createElement('span'); v.className = vTeam === 0 ? 's' : 'l'; v.textContent = victim;
    row.append(a, w);
    if (melee) { const m = document.createElement('span'); m.className = 'kf-melee'; m.textContent = t(weapon === 1 ? 'melee.reves' : 'melee.chanclazo'); row.append(m); }
    row.append(v);
    this.el.killfeed.prepend(row);
    while (this.el.killfeed.children.length > 5) this.el.killfeed.lastElementChild!.remove();
    setTimeout(() => row.remove(), 6000);
  }

  /**
   * The elimination replay's overlay: "REPLAY", who eliminated you (with
   * her team's icon, colour and name) and with what. null hides it.
   */
  killcam(info: { name: string; team: number | null; w: 0 | 1; melee: boolean } | null): void {
    const root = document.getElementById('killcam');
    this.el.root.classList.toggle('killcam-on', !!info);
    document.body.classList.toggle('killcam-on', !!info); // the subtitles live outside the HUD
    if (!root) return;
    root.hidden = !info;
    if (!info) return;
    const name = document.getElementById('kc-name')!;
    const team = info.team === 0 || info.team === 1 ? info.team : null;
    name.className = `kc-name${team === null ? '' : team === 0 ? ' sol' : ' luna'}`;
    name.textContent = team === null ? info.name : `${teamIcon(team)} ${info.name} (${teamName(team)})`;
    document.getElementById('kc-attack')!.textContent = t(attackKey(info.w, info.melee));
  }

  connection(text: string | null): void {
    this.set('conn', text ?? '', () => { this.el.conn.hidden = !text; this.el.conn.textContent = text ?? ''; });
  }

  update(f: HudFrame, dt: number, myYaw: number): void {
    if (this.hitT > 0 && (this.hitT -= dt) <= 0) this.el.hitmarker.classList.remove('on');
    if (this.missT > 0 && (this.missT -= dt) <= 0) this.el.missmarker?.classList.remove('on');
    if (this.hurtT > 0 && (this.hurtT -= dt) <= 0) this.el.vigHurt.classList.remove('on');
    if (this.centerT > 0 && (this.centerT -= dt) <= 0) this.el.center.hidden = true;
    if (this.subT > 0 && (this.subT -= dt) <= 0) this.el.sub.hidden = true;
    for (const a of this.dmgArcs) {
      a.t -= dt;
      a.el.style.transform = `rotate(${(a.angle - myYaw) * -180 / Math.PI}deg)`;
      a.el.style.opacity = String(Math.max(0, Math.min(1, a.t)));
    }
    this.dmgArcs = this.dmgArcs.filter((a) => { if (a.t <= 0) { a.el.remove(); return false; } return true; });

    this.set('sc', `${f.scores[0]}:${f.scores[1]}`, () => { this.el.solScore.textContent = String(f.scores[0]); this.el.lunaScore.textContent = String(f.scores[1]); });
    const secs = Math.ceil(f.timeLeftMs / 1000);
    this.set('timer', String(secs), () => {
      this.el.timer.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      this.el.timer.classList.toggle('low', secs <= 30);
    });
    this.set('practice', String(f.practice), () => (this.el.practice.hidden = !f.practice));
    // Which team you are on, always visible, matching the score blocks and the scoreboard.
    this.set('team', String(f.team), () => {
      const tm = f.team;
      this.el.chip.hidden = tm === null;
      this.el.scoreSol?.classList.toggle('mine', tm === 0);
      this.el.scoreLuna?.classList.toggle('mine', tm === 1);
      if (tm === null) return;
      this.el.chip.className = `team-chip ${tm === 0 ? 'sol' : 'luna'}`;
      this.el.chipIcon.textContent = teamIcon(tm);
      this.el.chipText.textContent = t('hud.yourTeam', { team: teamName(tm).toUpperCase() });
    });
    if (this.bannerT > 0 && (this.bannerT -= dt) <= 0) this.el.banner.hidden = true;
    const hp = Math.max(0, Math.round(f.hp));
    this.set('hp', `${hp}`, () => {
      this.el.hpFill.style.width = `${(hp / MATCH.maxHealth) * 100}%`;
      this.el.hpNum.textContent = String(hp);
      this.el.hp.setAttribute('aria-valuenow', String(hp));
      this.el.hp.classList.toggle('low', hp <= 30);
      this.el.hp.classList.toggle('mid', hp > 30 && hp <= 60);
    });
    this.set('low', String(f.alive && hp <= 30), () => this.el.vigLow.classList.toggle('on', f.alive && hp <= 30));
    this.set('prot', String(f.protectedMs > 0 && f.alive), () => (this.el.protect.hidden = !(f.protectedMs > 0 && f.alive)));
    this.set('weapon', `${f.weapon}`, () => this.el.slots.forEach((s, i) => s.classList.toggle('on', i === f.weapon)));
    const def = WEAPONS[f.weapon]!;
    // Ready when neither a throw nor a swing is recovering.
    const meleeK = f.meleeMs && f.meleeMs > 0 ? 1 - f.meleeMs / (MELEE[f.weapon]!.cycleMs + MELEE[f.weapon]!.whiffMs) : 1;
    const readyK = f.switchMs > 0 ? 0 : Math.min(1 - f.cooldownMs / def.cooldownMs, meleeK);
    const ring = 138.2 * (readyK >= 1 ? 1 : readyK);
    this.set('cd', ring.toFixed(0), () => (this.el.cd.style.strokeDashoffset = (readyK >= 1 ? 138.2 : 138.2 - ring).toFixed(1)));
    this.el.slots.forEach((s, i) => {
      const w = i === f.weapon ? Math.max(0, Math.min(1, readyK)) : 1;
      const bar = s.querySelector('i') as HTMLElement;
      const v = (w * 100).toFixed(0);
      this.set(`wcd${i}`, v, () => (bar.style.width = `${v}%`));
    });
    if (!f.alive && f.phase === 'playing') {
      const s = Math.max(1, Math.ceil(f.respawnInMs / 1000));
      this.set('respawn', String(s), () => this.sub(t('hud.respawn', { s }), 1.2));
    }
    if (f.phase === 'countdown') {
      const s = Math.max(1, Math.ceil(f.countdownMs / 1000));
      this.set('cdmsg', String(s), () => this.center(`${t('hud.countdown')} ${s}`, 1.1));
    }
    this.set('region', f.region, () => (this.el.region.textContent = t(`region.${f.region}` as Key)));
    const showNet = f.showStats || f.quality === 'poor' || f.quality === 'stalled';
    this.set('net', `${showNet}:${f.quality}:${Math.round(f.rtt / 5)}:${f.practice}`, () => {
      this.el.net.className = `net ${showNet && !f.practice ? 'show' : ''} ${f.quality}`;
      this.el.netPing.textContent = t('hud.ping', { ms: Math.round(f.rtt) });
    });
    this.set('fps', `${f.showStats}:${Math.round(f.fps)}`, () => { this.el.fps.hidden = !f.showStats; this.el.fps.textContent = t('fps', { fps: Math.round(f.fps) }); });
  }

  /** Classic shows the HUD as it always was; melee-only adds its chip and turns the swing hint into the primary button. */
  setRules(rules: RulesetId, touch: boolean): void {
    this.rules = rules;
    this.touchHints = touch;
    const melee = rules === 'melee';
    $('hud-rules').hidden = !melee;
    this.el.root.classList.toggle('melee-only', melee);
    for (const k of this.el.root.querySelectorAll<HTMLElement>('.wmelee kbd')) k.textContent = melee ? t('mode.keys') : 'V';
  }

  /** At spawn and respawn: a short reminder of the player's team (and, on the first, of melee-only rules). */
  spawnBanner(team: number, first: boolean): void {
    const rulesLine = first && this.rules === 'melee';
    this.el.banner.className = `spawn-banner ${team === 0 ? 'sol' : 'luna'}${first ? ' first' : ''}${rulesLine ? ' with-rules' : ''}`;
    this.el.bannerIcon.textContent = teamIcon(team);
    this.el.bannerText.textContent = t('hud.youAre', { team: teamName(team).toUpperCase() });
    const rl = $('spawn-banner-rules');
    rl.hidden = !rulesLine;
    if (rulesLine) rl.textContent = `${t('mode.chip')} · ${t(this.touchHints ? 'mode.introTouch' : 'mode.intro')}`;
    this.el.banner.hidden = false;
    this.bannerT = first ? 2.8 : 1.6;
  }

  // Name tags above players, plus floating damage numbers. Teammates and
  // opponents differ by a role tag and its shape, not only by team colour.
  // Visibility rules are the caller's: opponents only in plain sight.
  placeLabels(
    camera: THREE.Camera, w: number, h: number,
    players: Array<{ id: number; name: string; team: number; pos: THREE.Vector3; hp: number; visible: boolean; bot: boolean }>,
    dt: number,
    myTeam: number | null = null,
  ): void {
    const seen = new Set<number>();
    const v = new THREE.Vector3();
    for (const p of players) {
      let el = this.nameEls.get(p.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'nameplate';
        el.innerHTML = '<span class="role"></span><span class="n"></span><span class="bar"><i></i></span>';
        this.el.names.appendChild(el);
        this.nameEls.set(p.id, el);
      }
      seen.add(p.id);
      v.copy(p.pos).project(camera);
      const on = p.visible && v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1;
      el.style.display = on ? 'flex' : 'none';
      if (!on) continue;
      const ally = myTeam !== null && p.team === myTeam;
      el.className = `nameplate ${p.team === 0 ? 'sol' : 'luna'} ${ally ? 'ally' : 'enemy'}`;
      const role = el.querySelector('.role') as HTMLElement;
      const roleText = ally ? `◆ ${t('hud.ally')}` : `✖ ${t('hud.enemy')}`;
      if (role.textContent !== roleText) role.textContent = roleText;
      const n = el.querySelector('.n') as HTMLElement;
      const label = `${p.team === 0 ? '☀' : '☾'} ${p.name}${p.bot ? ` · ${t('lobby.bot')}` : ''}`;
      if (n.textContent !== label) n.textContent = label;
      (el.querySelector('i') as HTMLElement).style.width = `${Math.max(0, p.hp)}%`;
      el.style.transform = `translate(${((v.x + 1) / 2 * w).toFixed(1)}px, ${((1 - v.y) / 2 * h).toFixed(1)}px) translate(-50%, -100%)`;
    }
    for (const [id, el] of this.nameEls) if (!seen.has(id)) { el.remove(); this.nameEls.delete(id); }
    for (const f of this.floats) {
      f.t += dt;
      v.copy(f.pos);
      v.y += f.t * 0.8;
      v.project(camera);
      f.el.style.display = v.z < 1 ? 'block' : 'none';
      f.el.style.opacity = String(Math.max(0, 1 - f.t / 0.9));
      f.el.style.transform = `translate(${((v.x + 1) / 2 * w).toFixed(1)}px, ${((1 - v.y) / 2 * h).toFixed(1)}px) translate(-50%, -50%)`;
    }
    this.floats = this.floats.filter((f) => { if (f.t > 0.9) { f.el.remove(); return false; } return true; });
  }

  scoreboard(open: boolean, room: RoomView | null, stats: Map<number, { k: number; d: number }>, me: number): void {
    this.el.sb.hidden = !open;
    if (!open || !room) return;
    const rows = [...room.members].sort((a, b) => a.team - b.team || (stats.get(b.id)?.k ?? 0) - (stats.get(a.id)?.k ?? 0));
    const table = document.createElement('table');
    table.className = 'stats';
    const head = document.createElement('tr');
    for (const [k, num] of [['score.name', false], ['score.k', true], ['score.d', true], ['score.ping', true]] as const) {
      const th = document.createElement('th');
      th.textContent = t(k);
      if (num) th.className = 'num';
      head.appendChild(th);
    }
    table.appendChild(head);
    const myTeam = room.members.find((m) => m.id === me)?.team ?? null;
    let lastTeam = -1;
    for (const m of rows) {
      if (m.team !== lastTeam) {
        // Team header: the same icon, colour and wording as the HUD chip.
        lastTeam = m.team;
        const hr = document.createElement('tr');
        hr.className = `team-head ${m.team === 0 ? 'sol' : 'luna'}${m.team === myTeam ? ' mine' : ''}`;
        const th = document.createElement('th');
        th.colSpan = 4;
        th.textContent = `${teamIcon(m.team)} ${teamName(m.team).toUpperCase()} · ${m.team === myTeam ? t('score.yourTeam') : t('score.opponents')}`;
        hr.appendChild(th);
        table.appendChild(hr);
      }
      const tr = document.createElement('tr');
      tr.className = `${m.team === 0 ? 'sol' : 'luna'}${m.id === me ? ' me' : ''}`;
      const s = stats.get(m.id) ?? { k: 0, d: 0 };
      const cells = [`${m.team === 0 ? '☀' : '☾'} ${m.name}${m.bot ? ` (${t('lobby.bot')})` : ''}${m.connected ? '' : ` · ${t('lobby.away')}`}`, String(s.k), String(s.d), m.bot ? '–' : String(m.ping || '–')];
      cells.forEach((c, i) => { const td = document.createElement('td'); td.textContent = c; if (i) td.className = 'num'; tr.appendChild(td); });
      table.appendChild(tr);
    }
    this.el.sbBody.replaceChildren(table);
  }
}
