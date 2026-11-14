import { AudioBus } from './audio';
import {
  ENEMIES,
  MAPS,
  emptyRanks,
  type Diff,
  type MapDef,
  type Ranks,
  type WeaponId,
} from './content';
import { Controls } from './input';
import type { Lang } from './i18n';
import { t } from './i18n';
import { Renderer, type Quality } from './render';
import {
  endlessGrade,
  gradeRun,
  respetoEarned,
  multiplier,
  type Grade,
} from './rules';
import { STEP, Sim, blankInput, clearedWaves, type FrameIn, type SimOpts } from './sim';

export interface HudModel {
  playing: boolean;
  hp: number;
  maxHp: number;
  score: number;
  combo: number;
  mult: number;
  wave: number;
  waves: number;
  endless: boolean;
  weapon: number;
  weapons: WeaponId[];
  cooldown: number;
  pool: number;
  dash: number;
  legend: number;
  legendOn: boolean;
  charge: number;
  boss: { hp: number; max: number } | null;
  stall: { hp: number; max: number } | null;
  buffs: ('cafe' | 'chile' | 'rebozo')[];
  banner: string | null;
  bannerT: number;
  fps: number;
  showFps: boolean;
  objective: 'clear' | 'stall' | 'boss' | 'endless';
  showTip: boolean;
}

export interface RunResult {
  won: boolean;
  score: number;
  grade: Grade;
  kills: number;
  accuracy: number;
  bestCombo: number;
  time: number;
  respeto: number;
  wave: number;
  waves: number;
  missionId: string;
  mapId: string;
  endless: boolean;
}

export interface Hooks {
  hud: (h: HudModel) => void;
  over: (r: RunResult) => void;
  toast: (text: string) => void;
}

export interface StartOpts {
  missionId: string;
  map: MapDef;
  waves: SimOpts['waves'];
  diff: Diff;
  ranks: Ranks;
  weapons: WeaponId[];
  endless: boolean;
  finale: boolean;
  defend: boolean;
  showTip: boolean;
  par: number;
}

export class Game {
  mode: 'attract' | 'play' | 'paused' | 'over' = 'attract';
  sim: Sim;
  lang: Lang = 'en';
  showFps = false;
  reduce = false;
  assist = true;
  shakeOn = true;
  autoQuality = true;
  private renderer: Renderer;
  private audio: AudioBus;
  private controls: Controls;
  private hooks: Hooks;
  private running = true;
  private last = 0;
  private acc = 0;
  private shake = 0;
  private hitstop = 0;
  private ended = false;
  private botCd = 0.4;
  private bannerId: string | null = null;
  private bannerT = 0;
  private showTip = false;
  private tipUntil = 0;
  private missionId = 'patio';
  private par = 5000;
  private endless = false;
  private fps = 0;
  private frames = 0;
  private fpsT = 0;
  private slow = 0;
  private recentKills = 0;
  private raf = 0;

  constructor(canvas: HTMLCanvasElement, controls: Controls, audio: AudioBus, hooks: Hooks) {
    this.renderer = new Renderer(canvas);
    this.controls = controls;
    this.audio = audio;
    this.hooks = hooks;
    this.sim = this.makeAttract('patio');
    this.renderer.snap(this.sim.player.x, this.sim.player.y);
    this.renderer.resize();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  setQuality(q: Quality | 'auto'): void {
    this.autoQuality = q === 'auto';
    if (q !== 'auto') this.renderer.setQuality(q);
  }

  attract(mapId: string): void {
    this.mode = 'attract';
    this.ended = false;
    this.controls.enabled = false;
    this.sim = this.makeAttract(mapId);
    this.renderer.snap(this.sim.player.x, this.sim.player.y);
    this.shake = 0;
    this.hitstop = 0;
  }

  preview(mapId: string): void {
    if (this.mode === 'attract' && this.sim.map.id === mapId) return;
    this.attract(mapId);
  }

  start(opts: StartOpts): void {
    this.missionId = opts.missionId;
    this.par = opts.par;
    this.endless = opts.endless;
    this.showTip = opts.showTip;
    this.tipUntil = 14;
    this.ended = false;
    this.mode = 'play';
    this.controls.enabled = true;
    this.acc = 0;
    this.hitstop = 0;
    this.shake = 0;
    this.bannerId = null;
    this.sim = new Sim({
      map: opts.map,
      waves: opts.waves,
      diff: opts.diff,
      ranks: opts.ranks,
      weapons: opts.weapons,
      seed: (Math.random() * 1e9) | 0,
      loop: false,
      god: false,
      endless: opts.endless,
      finale: opts.finale,
      defend: opts.defend,
    });
    this.renderer.snap(this.sim.player.x, this.sim.player.y);
  }

  pause(): void {
    if (this.mode !== 'play') return;
    this.mode = 'paused';
    this.controls.enabled = false;
  }

  resume(): void {
    if (this.mode !== 'paused') return;
    this.mode = 'play';
    this.controls.enabled = true;
    this.last = performance.now();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  private makeAttract(mapId: string): Sim {
    const map = MAPS[mapId] ?? MAPS.patio!;
    return new Sim({
      map,
      waves: [{ kinds: ['bocinas', 'influencer', 'bocinas', 'soplador', 'pinata', 'bocinas', 'influencer', 'chismosa'], max: 4, gap: 1.25 }],
      diff: 'easy',
      ranks: emptyRanks(),
      weapons: ['chancla', 'pesada'],
      seed: 11,
      loop: true,
      god: true,
      endless: false,
      finale: false,
      defend: false,
    });
  }

  private frame = (now: number): void => {
    if (!this.running) return;
    const dt = this.last === 0 ? 0 : Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.sampleFps(now);
    this.renderer.resize();
    if (this.autoQuality) this.watch(dt);
    const live = this.mode === 'play' || this.mode === 'attract';
    if (live && this.hitstop > 0 && !this.reduce) this.hitstop -= dt;
    else if (live) {
      this.acc += dt;
      const input = this.mode === 'attract' ? this.bot(dt) : this.readInput();
      const edge: FrameIn = { ...input };
      this.sim.events.length = 0;
      let n = 0;
      while (this.acc >= STEP && n < 5) {
        this.sim.step(STEP, edge);
        edge.firePressed = false;
        edge.fireReleased = false;
        edge.dash = false;
        edge.recall = false;
        edge.legend = false;
        edge.slot = -1;
        edge.cycle = 0;
        this.acc -= STEP;
        n++;
      }
      if (n >= 5) this.acc = 0;
      this.consume();
      if (this.mode === 'play' && (this.sim.phase === 'won' || this.sim.phase === 'lost')) this.finish();
    }
    if (this.bannerT > 0) this.bannerT -= dt;
    this.shake *= Math.exp(-dt * 8);
    const attract = this.mode === 'attract';
    const shake = this.shakeOn && !this.reduce ? this.shake * (attract ? 0.3 : 1) : 0;
    this.renderer.render(this.sim, this.hitstop > 0 ? 0 : dt, shake, this.reduce);
    this.audio.duck = attract ? 0.3 : 1;
    this.audio.update();
    this.hooks.hud(this.snapshot());
    if (location.search.includes('debug=1')) {
      (window as unknown as { __duty?: Sim }).__duty = this.sim;
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  private watch(dt: number): void {
    if (dt > 0.022 && dt < 0.08) this.slow++;
    else this.slow = Math.max(0, this.slow - 1);
    if (this.slow > 90 && this.renderer.quality !== 'low') {
      this.renderer.setQuality(this.renderer.quality === 'high' ? 'med' : 'low');
      this.slow = 0;
    }
  }

  private sampleFps(now: number): void {
    this.frames++;
    if (now - this.fpsT > 500) {
      this.fps = Math.round((this.frames * 1000) / (now - this.fpsT));
      this.frames = 0;
      this.fpsT = now;
      document.body.dataset['fps'] = String(this.fps);
    }
  }

  private readInput(): FrameIn {
    const axis = this.controls.axis();
    const edges = this.controls.takeEdges();
    const p = this.sim.player;
    let aim = this.controls.hasPointer
      ? this.renderer.screenToWorld(this.controls.clientX, this.controls.clientY)
      : { x: p.x + Math.cos(p.facing) * 140, y: p.y + Math.sin(p.facing) * 140 };
    if (this.controls.usingTouch && this.controls.touchAim) {
      const dist = 150 + this.controls.touchMag * 160;
      aim = {
        x: p.x + Math.cos(this.controls.touchAngle) * dist,
        y: p.y + Math.sin(this.controls.touchAngle) * dist,
      };
    }
    return {
      mx: axis.x,
      my: axis.y,
      aimX: aim.x,
      aimY: aim.y,
      fireDown: this.controls.fireDown,
      firePressed: edges.firePressed,
      fireReleased: edges.fireReleased,
      dash: edges.dash,
      recall: edges.recall,
      legend: edges.legend,
      slot: edges.slot,
      cycle: edges.cycle,
      assist: this.assist,
    };
  }

  private bot(dt: number): FrameIn {
    const p = this.sim.player;
    let tx = p.x + 80;
    let ty = p.y;
    let best = 1e12;
    for (const e of this.sim.enemies) {
      if (e.dying !== null) continue;
      const d = (e.x - p.x) ** 2 + (e.y - p.y) ** 2;
      if (d < best) { best = d; tx = e.x; ty = e.y; }
    }
    this.botCd -= dt;
    const fire = this.botCd <= 0;
    if (fire) this.botCd = 0.48;
    const close = best < 80 * 80;
    return blankInput({
      mx: Math.cos(this.sim.stats.time * 0.75),
      my: Math.sin(this.sim.stats.time * 0.55) * 0.65,
      aimX: tx,
      aimY: ty,
      firePressed: fire,
      fireReleased: fire,
      dash: close && p.dashCd <= 0 && Math.sin(this.sim.stats.time * 5) > 0.6,
      assist: true,
    });
  }

  private consume(): void {
    this.recentKills = 0;
    for (const e of this.sim.events) {
      if (e.t === 'throw') {
        this.audio.throw(e.charged);
        this.renderer.burst(e.x, e.y, e.charged ? 8 : 4, '#f4e6c8', 90);
        this.renderer.flash(e.x, e.y);
        this.shake = Math.max(this.shake, e.charged ? 6 : 2.5);
      } else if (e.t === 'hit') {
        this.audio.slap(e.crit);
        this.renderer.floater(e.x, e.y - 16, `+${e.n}`, e.crit ? '#f5c542' : '#fff6e4');
        this.renderer.burst(e.x, e.y, 7, '#f2a33a', 120);
        if (e.banner) this.banner(e.banner);
        this.shake = Math.max(this.shake, 3.5);
      } else if (e.t === 'kill') {
        this.recentKills++;
        this.audio.slap(true);
        this.renderer.confetti(e.x, e.y);
        this.renderer.ring(e.x, e.y, '#f2a33a', 140);
        this.renderer.burst(e.x, e.y, 12, '#f4e6c8', 160);
        if (!this.reduce) this.hitstop = Math.max(this.hitstop, 0.04);
        this.shake = Math.max(this.shake, 9);
        if (e.banner) this.banner(e.banner);
        if (this.mode === 'play') {
          const name = ENEMIES[e.kind].name[this.lang];
          this.hooks.toast(`${name} ${t(this.lang, 'toast.out')}`);
        }
      } else if (e.t === 'bounce') {
        this.audio.tick();
        this.renderer.burst(e.x, e.y, 4, '#fff6e4', 70);
      } else if (e.t === 'splash') {
        this.audio.slap(true);
        this.renderer.ring(e.x, e.y, '#c8553d', e.r * 3);
        this.shake = Math.max(this.shake, 7);
      } else if (e.t === 'hurt') {
        this.audio.hurt();
        this.shake = Math.max(this.shake, 8);
        document.body.dataset['hurt'] = String(performance.now());
      } else if (e.t === 'pickup') {
        this.audio.pickup();
        this.renderer.floater(e.x, e.y - 10, e.kind, '#fff');
      } else if (e.t === 'dash') {
        this.audio.dash();
      } else if (e.t === 'legend') {
        this.audio.fanfare();
        this.shake = Math.max(this.shake, 5);
      } else if (e.t === 'dry') {
        this.audio.dry();
      } else if (e.t === 'banner') {
        this.banner(e.id);
        if (e.id === 'boss' || e.id === 'breath') this.audio.boom();
        if (e.id === 'wave') this.audio.fanfare();
      } else if (e.t === 'map') {
        this.renderer.snap(this.sim.player.x, this.sim.player.y);
      }
    }
    if (this.recentKills >= 4) this.banner('orale');
    else if (this.recentKills === 3) this.banner('triple');
    else if (this.recentKills === 2) this.banner('double');
  }

  private banner(id: string): void {
    if (this.mode !== 'play' && id !== 'boss') return;
    const loud = id === 'boss' || id === 'breath' || id === 'legend' || id === 'orale';
    if (this.bannerT > 0.45 && !loud) return;
    this.bannerId = id;
    this.bannerT = 1.05;
  }

  private snapshot(): HudModel {
    const s = this.sim;
    const p = s.player;
    const rey = s.enemies.find((e) => e.kind === 'rey' && e.dying === null);
    const buffs: HudModel['buffs'] = [];
    if (p.cafe > 0) buffs.push('cafe');
    if (p.chile > 0) buffs.push('chile');
    if (p.rebozo > 0) buffs.push('rebozo');
    const id = s.weapons[p.weapon] ?? 'chancla';
    const poolWeapon = id === 'chancla';
    return {
      playing: this.mode === 'play',
      hp: Math.max(0, Math.ceil(p.hp)),
      maxHp: p.maxHp,
      score: s.score,
      combo: s.combo,
      mult: multiplier(s.combo),
      wave: s.wave + 1,
      waves: s.endless ? 0 : s.waves.length,
      endless: s.endless,
      weapon: p.weapon,
      weapons: s.weapons,
      cooldown: poolWeapon ? 0 : p.cdMax > 0 ? 1 - p.cd / p.cdMax : 1,
      pool: CHANCLA_READY(s),
      dash: p.dashCd <= 0 ? 1 : 1 - p.dashCd / Math.max(0.01, dashMax(s)),
      legend: p.legendT > 0 ? p.legendT / 5.2 : p.legend,
      legendOn: p.legendT > 0 || p.legend >= 1,
      charge: p.charge,
      boss: rey ? { hp: Math.max(0, rey.hp), max: rey.maxHp } : null,
      stall: s.defend ? { hp: Math.max(0, s.stallHp), max: s.stallMax } : null,
      buffs,
      banner: this.bannerT > 0 ? this.bannerId : null,
      bannerT: this.bannerT,
      fps: this.fps,
      showFps: this.showFps,
      objective: s.endless ? 'endless' : s.finale ? 'boss' : s.defend ? 'stall' : 'clear',
      showTip: this.showTip && this.mode === 'play' && s.stats.time < this.tipUntil,
    };
  }

  private finish(): void {
    if (this.ended) return;
    this.ended = true;
    this.mode = 'over';
    this.controls.enabled = false;
    const s = this.sim;
    const won = s.phase === 'won';
    const wave = clearedWaves(s);
    const grade = this.endless ? endlessGrade(wave) : gradeRun(won, s.score, this.par, s.player.hp / s.player.maxHp);
    const respeto = respetoEarned(s.score, this.endless ? wave >= 2 : won, grade, this.endless ? wave : 0);
    this.hooks.over({
      won: this.endless ? wave >= 2 : won,
      score: s.score,
      grade,
      kills: s.stats.kills,
      accuracy: s.stats.throws > 0 ? s.stats.connected / s.stats.throws : 0,
      bestCombo: s.stats.bestCombo,
      time: s.stats.time,
      respeto,
      wave,
      waves: this.endless ? 0 : s.waves.length,
      missionId: this.missionId,
      mapId: s.map.id,
      endless: this.endless,
    });
  }
}

function CHANCLA_READY(s: Sim): number {
  let n = 0;
  for (const shot of s.shots) if (shot.alive && shot.kind === 'chancla' && shot.team === 'player') n++;
  return Math.max(0, 2 - n);
}

function dashMax(s: Sim): number {
  return 1.18 * Math.pow(0.8, s.ranks.dash);
}
