// Renderer and scene owner for the shooter. Two modes:
//   * menu: a slow orbit over El Patio with two Rosas posed by the fountain,
//   * match: first person, driven by a GameSession at a fixed 60 Hz.
// The engine never decides gameplay. It predicts movement through the
// session and shows what the server confirms.
import * as THREE from 'three';
import { MATCH, MOVE, NET, WEAPONS, type WeaponId } from '../../shared/config';
import { EL_PATIO, regionAt, type MapData, type Team } from '../../shared/map';
import { mapEntry } from '../../shared/maps';
import { lineOfSight } from '../../shared/collision';
import { buildCafecito, type CafecitoModel } from './render/cafecito-model';
import { CafecitoLabel, pickCafecitoGuide } from './cafecito';
import { teammateMarkers, type MiniMarkers } from './minimap';
import type { SimEvent } from '../../shared/sim';
import type { ClientProjectile, GameSession, RemotePlayer, SnapRecord } from '../net/session';
import { audio } from '../audio/audio';
import { buildWorld, type WorldOptions, type WorldView } from './render/world';
import { Avatar, type AvatarState } from './render/rosa';
import { CombatFx } from './render/combat-fx';
import { OwnSwingLog } from './miss-feedback';
import { ClipCursor, KillcamDirector, eyeOf, meleeCamera, noteFrom, thirdPersonCamera, type Clip } from './killcam';
import { ViewModel } from './render/viewmodel';
import { ProjectileView } from './render/projectiles';
import { RuleroFx } from './render/ruleros';
import { ContactShadows } from './render/contact-shadows';
import { setToonRamp } from './render/materials';
import type { Hud } from './hud';
import type { FpsInput } from './input';
import type { FpsSettings, Quality } from './settings';
import { t } from './strings';
import { diagError, diagLog, diagVisibleFor } from '../diag';

const DT = 1 / NET.tickRate;
const PIXEL_CAP: Record<Quality, number> = { low: 1, medium: 1.5, high: 2 };

export interface PlayerStats { k: number; d: number }

// A self-contained game mode driven by the engine's frame loop (the solo
// campaign). It owns its own simulation and uses the engine's scene,
// camera, viewmodel, projectile view and HUD.
export interface Controller {
  frame(dt: number): void;
  dispose(): void;
}

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly vmScene = new THREE.Scene();
  readonly vmCamera = new THREE.PerspectiveCamera(62, 1, 0.01, 20);
  mode: 'menu' | 'match' | 'controller' = 'menu';
  controller: Controller | null = null;
  session: GameSession | null = null;
  practice = false;
  paused = false; // practice menu: stop ticking entirely
  inputActive = false; // false while an online menu is open
  readonly stats = new Map<number, PlayerStats>();
  fps = 0;
  frameMs = 0;
  world: WorldView;
  private worldOpts: WorldOptions = {};
  private quality: Quality;
  private avatars = new Map<number, Avatar>();
  private menuAvatars: Avatar[] = [];
  readonly proj = new ProjectileView();
  readonly vm = new ViewModel({ arena: true });
  /** Flying ruleros (cosmetic, pooled, capped). */
  readonly ruleros = new RuleroFx();
  /** Melee contact, miss and shielded effects (cosmetic, pooled). */
  readonly fx = new CombatFx();
  /** Soft discs grounding the characters (every quality). */
  readonly contact = new ContactShadows();
  private vmHemi = new THREE.HemisphereLight(0xffe7c4, 0x7a4a5a, 2.2);
  private vmSun = new THREE.DirectionalLight(0xfff0d0, 1.6);
  /** The elimination replay: its recorder and when to play it (killcam.ts). */
  readonly killcam = new KillcamDirector(() => this.session?.id ?? -1);
  /** The replay being shown, if any. */
  private replay: Replay | null = null;
  /** Characters for the replay, reused from one replay to the next (never more than the players shown). */
  private replayPool: Avatar[] = [];
  /** Why the last replay ended, and when it started (tests and diagnostics). */
  lastReplay: { startedAt: number; endedAt: number; reason: string; view: string; killer: number; ms: number; cues?: number; ruleros?: number; projMax?: number; shownMs?: number; swingShown?: boolean; jsMsPerFrame?: number; frames?: number } | null = null;
  /** Called when a replay starts or ends (main.ts: the overlay, input). */
  onReplay: ((on: boolean, clip: Clip | null) => void) | null = null;
  private lastLocalMelee = -1e9;
  private localMeleeWeapon: WeaponId = 0;
  /** Effects of other players' melee, played when the delayed render timeline reaches them. */
  private fxQueue: Array<{ at: number; run: () => void }> = [];
  /** Rollers due to fly off but not launched yet: still drawn on her head. */
  private heldRuleros = new Map<number, number>();
  private meleeHinted = false;
  private tmpV = new THREE.Vector3();
  private tmpD = new THREE.Vector3();
  private pickups: THREE.Group[] = [];
  private cups: CafecitoModel[] = [];
  /** "Cafecito · Walk over to heal" and its siblings, near the nearest cup in plain sight. */
  private cafeLabel = new CafecitoLabel(document.getElementById('names') ?? document.body);
  private cafeLos = { t: 0, i: -1 };
  /** The arena being played (El Patio for menus and the campaign). */
  private map: MapData = EL_PATIO;
  private pinataHits = new Set<string>();
  private acc = 0;
  private last = 0;
  private raf = 0;
  private time = 0;
  private fpsFrames = 0;
  private fpsT = 0;
  private lastLocalThrow = -1e9;
  private shake = 0;
  private eye = { x: 0, y: 0, z: 0 };
  private wasGround = true;
  private wasAlive = false;
  private spawnedOnce = false; // the first spawn of a match gets the longer team banner
  private stepT = 0;
  private heartT = 0;
  private lastCountdown = -1;
  private lastPhase = '';
  private losCache = new Map<number, boolean>();
  private losT = 0;
  private contextLost = false;
  private disposed = false;
  onContextLost: ((lost: boolean) => void) | null = null;

  constructor(
    private stage: HTMLElement,
    readonly settings: () => FpsSettings,
    readonly hud: Hud,
    readonly input: FpsInput,
  ) {
    const s = settings();
    this.quality = s.quality;
    this.renderer = new THREE.WebGLRenderer({ antialias: s.quality !== 'low', powerPreference: 'high-performance', alpha: false, stencil: false });
    this.renderer.autoClear = false;
    this.renderer.shadowMap.enabled = s.quality !== 'low';
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.setClearColor(0xf2a36b);
    this.renderer.domElement.tabIndex = -1;
    stage.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(s.fov, 1.6, 0.05, 260);
    this.scene.fog = new THREE.Fog(0xf3b07a, 45, 140);

    this.world = buildWorld(s.quality);
    this.scene.add(this.world.group, this.proj.group, this.ruleros.group, this.fx.group, this.contact.mesh);
    this.contact.setStrength(contactStrength(s.quality));
    this.fx.setQuality(s.quality);
    this.fx.setReducedMotion(s.reducedMotion);
    this.buildPickups();
    this.buildMenuAvatars();
    input.onSkip = () => this.skipReplay();

    this.vmSun.position.set(-1, 2, 1);
    this.vmScene.add(this.vmHemi, this.vmSun, this.vm.root);
    this.lightHand();

    const canvas = this.renderer.domElement;
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.contextLost = true; diagLog('gfx', 'WebGL context lost'); this.onContextLost?.(true); });
    canvas.addEventListener('webglcontextrestored', () => { this.contextLost = false; diagLog('gfx', 'WebGL context restored'); this.onContextLost?.(false); });
    this.resize();
  }

  get canvas(): HTMLCanvasElement { return this.renderer.domElement; }

  get isContextLost(): boolean { return this.contextLost; }

  /** For the diagnostics report. */
  diag(): Record<string, unknown> {
    const now = performance.now();
    const m = this.renderer.info.memory;
    return {
      mode: this.mode, map: this.map.id, msSinceFrame: this.lastGoodFrameAt ? Math.round(now - this.lastGoodFrameAt) : null, frameErrors: this.frameErrors,
      fps: Math.round(this.fps), contextLost: this.contextLost, quality: this.quality, drawCalls: this.drawCalls, geometries: m.geometries, textures: m.textures, paused: this.paused,
    };
  }

  get drawCalls(): number { return this.renderer.info.render.calls; }

  /** When the last frame completed without an error (diagnostics). */
  lastGoodFrameAt = 0;
  /** Frames in a row that threw. */
  frameErrors = 0;
  /** Called once when frames keep failing: the picture has stopped. */
  onFatal: ((err: unknown) => void) | null = null;
  private fatalSent = false;
  private lastLoopAt = 0;

  start(): void {
    this.last = performance.now();
    const loop = (now: number) => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      // A long gap between frames while the page is visible is a stall
      // (main thread blocked, or the browser stopped scheduling frames).
      if (this.lastLoopAt && now - this.lastLoopAt > 1000 && diagVisibleFor() > now - this.lastLoopAt) diagLog('stall', `no frame for ${Math.round(now - this.lastLoopAt)} ms (mode ${this.mode})`);
      this.lastLoopAt = now;
      // After the stopped-picture screen, stop running the failing frame: no
      // endless error loop burning the battery behind it. The player's choice
      // (Back to the menu: clearFatal) starts frames again.
      if (this.fatalSent) return;
      try {
        this.resizeIfNeeded();
        this.frame(now);
        this.lastGoodFrameAt = now;
        this.frameErrors = 0;
      } catch (err) {
        // Recorded, never swallowed silently: one bad frame is logged; a run
        // of them means the picture has stopped, and the player is told.
        if (this.frameErrors++ < 3) { diagError('frame', err); console.error(err); }
        if (this.frameErrors >= 30 && !this.fatalSent) { this.fatalSent = true; this.onFatal?.(err); }
      }
    };
    this.raf = requestAnimationFrame(loop);
  }

  /** After the player chose to go back to the menu from the error screen. */
  clearFatal(): void { this.fatalSent = false; this.frameErrors = 0; }

  private sizeKey = '';

  /**
   * The usable area can change without a window resize event (iOS keyboard
   * dismissal, toolbars, rotation while the page was in the background), so
   * the size is compared every frame. setSize(..., false) never touches the
   * canvas's CSS size, so this can't feed back into layout.
   */
  resizeIfNeeded(): void {
    const key = `${this.stage.clientWidth}x${this.stage.clientHeight}@${window.devicePixelRatio}`;
    if (key !== this.sizeKey) this.resize();
  }

  /** The drawing buffer and camera match the stage (tests). */
  get viewSize(): { css: [number, number]; buffer: [number, number]; aspect: number } {
    const c = this.renderer.domElement;
    return { css: [this.stage.clientWidth, this.stage.clientHeight], buffer: [c.width, c.height], aspect: +this.camera.aspect.toFixed(4) };
  }

  resize(): void {
    this.sizeKey = `${this.stage.clientWidth}x${this.stage.clientHeight}@${window.devicePixelRatio}`;
    const w = Math.max(1, this.stage.clientWidth || window.innerWidth);
    const h = Math.max(1, this.stage.clientHeight || window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, PIXEL_CAP[this.quality]));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h;
    this.vmCamera.updateProjectionMatrix();
  }

  applySettings(): void {
    const s = this.settings();
    this.camera.fov = s.fov;
    this.camera.updateProjectionMatrix();
    this.fx.setReducedMotion(s.reducedMotion);
    if (s.quality !== this.quality) {
      this.quality = s.quality;
      this.fx.setQuality(s.quality);
      this.contact.setStrength(contactStrength(s.quality));
      this.renderer.shadowMap.enabled = s.quality !== 'low';
      this.scene.remove(this.world.group);
      disposeTree(this.world.group);
      this.world = buildWorld(s.quality, this.worldOpts);
      this.scene.add(this.world.group);
      this.lightHand();
      this.renderer.shadowMap.needsUpdate = true;
      // Characters are built per quality: rebuild them (match ones come back on the next frame).
      for (const av of this.avatars.values()) { this.scene.remove(av.root); av.dispose(); }
      this.avatars.clear();
      this.endReplay('quality');
      this.disposeReplayPool();
      const menuShown = this.menuAvatars[0]?.root.visible ?? true;
      for (const av of this.menuAvatars) { this.scene.remove(av.root); av.dispose(); }
      this.buildMenuAvatars();
      for (const av of this.menuAvatars) av.root.visible = menuShown;
      this.resize();
    }
  }

  /**
   * The first-person hand is drawn in its own scene: light it like the world
   * (the same sky fill and sun colours, at the strengths the hand was tuned for),
   * so it matches the characters around it.
   */
  private lightHand(): void {
    const l = this.world.light;
    // The arena maps use the deeper shadow band; campaign layouts keep the original.
    setToonRamp(l ? 'arena' : 'classic');
    // The sculpted arena hand for arena maps; campaign layouts keep the original hand.
    this.vm.setArena(!!l);
    // Campaign layouts keep the hand's original light.
    this.vmHemi.color.setHex(l ? l.hemi[0] : 0xffe7c4);
    this.vmHemi.groundColor.setHex(l ? l.hemi[1] : 0x7a4a5a);
    this.vmHemi.intensity = l ? 2.2 * Math.min(1.25, l.hemi[2] / 1.2) : 2.2;
    this.vmSun.color.setHex(l ? l.sun[0] : 0xfff0d0);
    this.vmSun.intensity = l ? 1.6 * Math.min(1.25, l.sun[1] / 2.7) : 1.6;
  }

  private buildMenuAvatars(): void {
    this.menuAvatars = [];
    for (const team of [0, 1] as const) {
      const a = new Avatar(team, { quality: this.quality, arena: true });
      a.root.position.set(team === 0 ? -1.6 : 1.6, 0, 3.4);
      a.root.rotation.y = team === 0 ? -0.5 : 0.5;
      this.menuAvatars.push(a);
      this.scene.add(a.root);
    }
  }

  // ------------------------------------------------------------------
  // Mode switches

  /** Rebuilds the world: a map, a campaign layout and lighting (or El Patio by default). */
  setWorld(opts: WorldOptions): void {
    this.worldOpts = opts;
    this.map = opts.map ?? EL_PATIO;
    this.placePickups();
    this.scene.remove(this.world.group);
    disposeTree(this.world.group);
    this.world = buildWorld(this.quality, opts);
    this.scene.add(this.world.group);
    this.lightHand();
    (this.scene.fog as THREE.Fog).color.setHex(this.world.fog);
    this.renderer.shadowMap.needsUpdate = true;
  }

  enterController(c: Controller): void {
    this.leaveController();
    this.mode = 'controller';
    this.session = null;
    this.clearMatch();
    for (const a of this.menuAvatars) a.root.visible = false;
    this.controller = c;
  }

  private leaveController(): void {
    if (!this.controller) return;
    const c = this.controller;
    this.controller = null;
    c.dispose();
  }

  get size(): { w: number; h: number } {
    return { w: this.stage.clientWidth || window.innerWidth, h: this.stage.clientHeight || window.innerHeight };
  }

  enterMenu(): void {
    this.leaveController();
    if (this.worldOpts.boxes || this.worldOpts.theme || this.worldOpts.map) this.setWorld({});
    this.mode = 'menu';
    this.session = null;
    this.clearMatch();
    for (const a of this.menuAvatars) a.root.visible = true;
  }

  /**
   * Loads the room's map if it isn't the one on screen. The previous map's
   * meshes, geometries and textures are disposed (setWorld).
   */
  useMap(id: string | undefined): void {
    const e = mapEntry(id);
    if (this.map === e.data && (this.worldOpts.map ?? EL_PATIO) === e.data && !this.worldOpts.boxes) return;
    this.setWorld(e.data === EL_PATIO ? {} : { map: e.data, theme: e.theme });
  }

  enterMatch(session: GameSession, practice: boolean): void {
    this.useMap(session.room?.map);
    this.pinataHits.clear();
    this.mode = 'match';
    this.session = session;
    this.practice = practice;
    this.clearMatch();
    for (const a of this.menuAvatars) a.root.visible = false;
    this.acc = 0;
    this.wasAlive = false;
    this.spawnedOnce = false;
    this.lastPhase = '';
    this.lastCountdown = -1;
    this.meleeHinted = false;
    const team = session.team;
    if (team !== null) this.vm.setTeam(team);
  }

  private clearMatch(): void {
    this.endReplay('match');
    this.killcam.reset();
    this.cafeLabel.hide();
    this.cafeLos.i = -1;
    for (const a of this.avatars.values()) { this.scene.remove(a.root); a.dispose(); }
    this.avatars.clear();
    this.disposeReplayPool();
    this.proj.clear();
    this.stats.clear();
    this.hud.reset();
    this.shake = 0;
    this.clearMelee();
  }

  private clearMelee(): void {
    this.ruleros.clear();
    this.fx.clear();
    this.fxQueue = [];
    this.heldRuleros.clear();
    this.lastLocalMelee = -1e9;
    this.ownSwings.reset();
    this.vm.cancelMiss();
  }

  // Clears per-match bookkeeping for a rematch without leaving match mode.
  resetRound(): void {
    this.endReplay('round');
    this.killcam.reset();
    this.stats.clear();
    this.proj.clear();
    this.hud.reset();
    this.clearMelee();
  }

  // ------------------------------------------------------------------
  // Session event wiring (called from the session handlers in main.ts)

  private nameOf(id: number): string {
    return this.session?.room?.members.find((m) => m.id === id)?.name ?? '?';
  }

  private teamOf(id: number): Team {
    return this.session?.room?.members.find((m) => m.id === id)?.team ?? 0;
  }

  private stat(id: number): PlayerStats {
    let s = this.stats.get(id);
    if (!s) { s = { k: 0, d: 0 }; this.stats.set(id, s); }
    return s;
  }

  // Volume falloff for sounds made by other players.
  private near(p: [number, number, number] | { x: number; y: number; z: number }): number {
    const x = Array.isArray(p) ? p[0] : p.x, z = Array.isArray(p) ? p[2] : p.z;
    const d = Math.hypot(x - this.eye.x, z - this.eye.z);
    return Math.max(0, 1.1 - d / 32);
  }

  /** A snapshot arrived: the replay recorder keeps its players (by reference). */
  onSnapshot(rec: SnapRecord): void {
    if (this.mode === 'match' && this.settings().killcam) this.killcam.rec.snapshot(rec);
  }

  /** Live combat sounds; none while a replay is showing (it has its own single cue). */
  private sfx(name: Parameters<typeof audio.play>[0], k?: number): void {
    if (!this.replay) audio.play(name, k);
  }

  /** True while the replay is on screen (main.ts holds back live voice lines). */
  get replaying(): boolean { return !!this.replay; }

  onEvent(e: SimEvent): void {
    const s = this.session;
    if (!s) return;
    const me = s.id;
    const st = s.snap?.st ?? s.renderTime();
    if (this.settings().killcam) this.killcam.rec.event(e, st);
    if (e.k === 'elim' && e.v === me) this.killcam.onElim(noteFrom(e, st, s.room?.members ?? []));
    switch (e.k) {
      case 'throw':
        if (e.o !== me) { const k = this.near(e.p); if (k > 0.05) this.sfx(e.w === 1 ? 'throwHeavy' : 'throw', k); }
        break;
      case 'swing':
        // Someone else's swing: its swish, in step with her animation.
        if (e.a === me) this.ownSwings.serverSwing(e.id, e.w, e.tm, performance.now());
        else this.later(e.tm, () => { const r = s.remotes.get(e.a); const k = r ? this.near(r) : 0; if (k > 0.05) this.sfx(e.w === 1 ? 'swishHeavy' : 'swish', k); });
        break;
      case 'hit': {
        if (e.m !== undefined) { this.onMeleeHit(e); break; }
        if (e.a === me && e.v !== me) {
          this.hud.hitMarker(e.head ? 'head' : 'body');
          this.sfx(e.head ? 'headshot' : 'hitConfirm');
          this.hud.floatText(String(e.d), new THREE.Vector3(e.p[0], e.p[1] + 0.3, e.p[2]), e.head ? 'head' : '');
        }
        if (e.v === me) {
          const att = s.remotes.get(e.a);
          const angle = att ? Math.atan2(-(att.x - s.body.x), -(att.z - s.body.z)) : null;
          this.hud.hurt(angle);
          this.sfx('hurtFps', Math.min(1.4, 0.6 + e.d / 60));
          if (!this.settings().reducedMotion) this.shake = Math.min(1, this.shake + e.d / 70);
        }
        break;
      }
      case 'shielded': {
        if (e.a === me) { this.sfx('shielded'); this.hud.sub(t('hud.protected'), 0.8); if (e.m !== undefined) this.ownSwings.settled(e.m); }
        const v = e.v === me ? null : s.remotes.get(e.v);
        if (v && e.m !== undefined) {
          const show = () => { const r = s.remotes.get(e.v); if (r && !this.replay) this.fx.shielded({ x: r.x, y: r.y + 1.2, z: r.z }); };
          if (e.a === me) show(); else this.later(this.lastMeleeAt.get(e.m) ?? s.renderTime(), show);
        }
        break;
      }
      case 'whiff': {
        // A swing that touched nobody: the miss reads on the attacker.
        if (e.a === me) { this.ownWhiff(e); break; }
        this.later(e.tm, () => {
          const r = s.remotes.get(e.a);
          if (!r || this.replay) return;
          this.fx.meleeWhiff(e.w, { x: r.x, y: r.y, z: r.z }, r.yaw);
          this.avatars.get(e.a)?.whiff(e.w);
        });
        break;
      }
      case 'elim': {
        this.stat(e.a).k++;
        this.stat(e.v).d++;
        this.hud.killfeed(this.nameOf(e.a), this.teamOf(e.a), this.nameOf(e.v), this.teamOf(e.v), e.w, e.a === me || e.v === me, e.m !== undefined);
        // An El Revés to the face that finishes her scatters what is left of her rollers.
        if (e.ru?.length) {
          const ru = e.ru;
          this.holdRuleros(e.v, ru);
          const dir = this.blowDirection(e.a, e.w);
          const go = () => this.popRuleros(e.v, ru, dir, true);
          if (e.a === me || e.v === me) go(); else this.later(this.lastMeleeAt.get(e.m ?? -1) ?? s.renderTime(), go);
        }
        if (e.a === me) { this.hud.hitMarker('kill'); this.sfx('elimConfirm'); this.hud.center(t('hud.youEliminated', { name: this.nameOf(e.v) }), 1.4); }
        if (e.v === me) { this.sfx('died'); this.hud.center(t('hud.eliminatedBy', { name: this.nameOf(e.a) }), 2.2); }
        break;
      }
      case 'spawn':
        if (e.id === me) audio.play('spawn');
        break;
      case 'pickup':
        if (e.id === me) {
          audio.play('pickup');
          const p = this.map.pickups[e.i];
          // The health actually restored (a cup near full health gives less than the full amount).
          const n = e.n;
          if (p && n > 0) this.hud.floatText(t('hud.pickup', { n }), new THREE.Vector3(p.x, 1.2, p.z), 'heal');
        }
        break;
      case 'end': {
        const team = s.team;
        audio.play(e.winner === -1 ? 'countdown' : e.winner === team ? 'win' : 'lose');
        break;
      }
      default:
        break;
    }
  }

  /** Your own swing missed (confirmed): the touch button's nudge (set by main). */
  onOwnMiss: ((weapon: WeaponId) => void) | null = null;

  // Your own confirmed miss (the session has already deduplicated it): tied
  // to the swing it came from by the server's swing id, shown on top of the
  // swing in hand, faded by lateness, never by replaying it; suppressed when
  // the swing it belongs to is not the one in hand, or is uncertain.
  private ownWhiff(e: Extract<SimEvent, { k: 'whiff' }>): void {
    const s = this.session;
    const f = this.ownSwings.miss(e.id, e.w, e.tm, performance.now(), (s?.weapon ?? this.input.weapon) as WeaponId);
    this.lastOwnMiss = { at: Math.round(performance.now()), id: e.id, weapon: e.w, motion: +f.motion.toFixed(2), mark: f.mark };
    if (f.motion > 0) this.vm.whiff(e.w, f.motion);
    if (f.mark) { this.hud.missMarker(e.w === 1 ? 1 : -1); this.onOwnMiss?.(e.w); }
  }
  /** Your own swings, matched to the server's, so a miss shows only for the swing it came from. */
  private ownSwings = new OwnSwingLog();
  /** The last own miss and what it showed (diagnostics and tests). */
  lastOwnMiss: { at: number; id: number; weapon: WeaponId; motion: number; mark: boolean } | null = null;

  /** Your own swing started (predicted): animation clock and swish. */
  onLocalMelee(weapon: WeaponId): void {
    this.lastLocalMelee = performance.now();
    this.localMeleeWeapon = weapon;
    this.ownSwings.localStart(weapon, this.lastLocalMelee);
    this.sfx(weapon === 1 ? 'swishHeavy' : 'swish');
  }

  /** Server time each confirmed melee contact happened, so the elimination's scatter follows it. */
  private lastMeleeAt = new Map<number, number>();

  // A confirmed melee hit. Your own hits and hits on you play at once (the
  // server has decided); hits between others wait for the delayed timeline
  // so they line up with the swing you see.
  private onMeleeHit(e: Extract<SimEvent, { k: 'hit' }>): void {
    const s = this.session!;
    const me = s.id;
    if (e.a === me && e.m !== undefined) this.ownSwings.settled(e.m);
    const heavy = e.w === 1;
    const involved = e.a === me || e.v === me;
    const at = e.tm ?? s.renderTime();
    if (e.m !== undefined) { this.lastMeleeAt.set(e.m, at); if (this.lastMeleeAt.size > 64) this.lastMeleeAt.delete(this.lastMeleeAt.keys().next().value!); }
    const dir = this.blowDirection(e.a, e.w);
    if (e.ru?.length) this.holdRuleros(e.v, e.ru);
    const ru = e.ru;
    const go = () => {
      const k = involved ? 1 : this.near(e.p);
      if (k > 0.05) this.sfx(heavy ? 'paf' : 'slap', k);
      const av = this.avatars.get(e.v);
      if (av) {
        // The head turns the way the blow travels.
        const r = s.remotes.get(e.v);
        const yaw = r ? r.yaw : 0;
        const left = { x: -Math.cos(yaw), z: Math.sin(yaw) };
        av.react(e.head, dir.x * left.x + dir.z * left.z);
      }
      // Your own face: the contact effect would fill the view, so it is not drawn.
      if (e.v !== me && !this.replay) this.fx.meleeHit(e.w, { x: e.p[0], y: e.p[1], z: e.p[2] }, dir, e.head);
      if (ru?.length) this.popRuleros(e.v, ru, dir, false);
    };
    if (involved) go(); else this.later(at, go);
    if (e.a === me && e.v !== me) {
      this.hud.hitMarker(e.head ? 'head' : 'body');
      this.sfx(e.head ? 'headshot' : 'hitConfirm', 0.8);
      this.hud.floatText(String(e.d), new THREE.Vector3(e.p[0], e.p[1] + 0.3, e.p[2]), e.head ? 'head' : '');
    }
    if (e.v === me) {
      const att = s.remotes.get(e.a);
      const angle = att ? Math.atan2(-(att.x - s.body.x), -(att.z - s.body.z)) : null;
      this.hud.hurt(angle);
      this.sfx('hurtFps', Math.min(1.4, 0.6 + e.d / 60));
      if (!this.settings().reducedMotion) this.shake = Math.min(1, this.shake + e.d / 90);
    }
  }

  // Which way a blow travels across the target's face: a forehand from the
  // attacker's right to left, a backhand left to right, and a little away
  // from her.
  private blowDirection(attacker: number, weapon: WeaponId): { x: number; z: number } {
    const s = this.session!;
    return blowDir(attacker === s.id ? this.input.yaw : s.remotes.get(attacker)?.yaw ?? 0, weapon);
  }

  private holdRuleros(victim: number, ru: readonly number[]): void {
    let m = this.heldRuleros.get(victim) ?? 0;
    for (const i of ru) m |= 1 << i;
    this.heldRuleros.set(victim, m);
  }

  // Launches rollers from where they sit on her head (or, for you, from just
  // above your view). Low quality: the signature roller only, simpler flight.
  private popRuleros(victim: number, ru: readonly number[], dir: { x: number; z: number }, scatter: boolean): void {
    const s = this.session;
    if (!s) return;
    const low = this.quality === 'low';
    // Reduced motion: the same simple flight as Low (no spin-and-bounce).
    const simple = low || this.settings().reducedMotion;
    const held = this.heldRuleros.get(victim) ?? 0;
    let release = 0;
    ru.forEach((i, n) => {
      release |= 1 << i;
      if (scatter && low && n >= 1) return; // Low: less debris
      const from = this.tmpV;
      let ground: number;
      if (victim === s.id) {
        // Your own: it pops up and out past the edge of the view, never across the crosshair.
        const cam = this.camera;
        const right = this.tmpD.set(1, 0, 0).applyQuaternion(cam.quaternion);
        from.copy(cam.position).addScaledVector(right, i % 2 === 0 ? -0.22 : 0.22).add({ x: 0, y: 0.22, z: 0 } as THREE.Vector3);
        ground = s.body.y;
      } else {
        const av = this.avatars.get(victim);
        if (!av) return;
        av.ruleroWorld(i, from);
        ground = av.groundY;
      }
      if (this.replay) return; // the bookkeeping above still happens; nothing flies over the replay
      const spread = scatter ? (n - (ru.length - 1) / 2) * 0.6 : 0;
      const d = this.tmpD.set(dir.x * Math.cos(spread) - dir.z * Math.sin(spread), 0, dir.x * Math.sin(spread) + dir.z * Math.cos(spread));
      this.ruleros.spawn(i, from, d, ground, { simple, strength: scatter ? 0.75 : 1 });
      if (n === 0) { const k = victim === s.id ? 1 : this.near(from); if (k > 0.05) this.sfx('ruleroPop', k); }
    });
    const left = held & ~release;
    if (left) this.heldRuleros.set(victim, left); else this.heldRuleros.delete(victim);
  }

  private later(at: number, run: () => void): void {
    this.fxQueue.push({ at, run });
    if (this.fxQueue.length > 64) this.fxQueue.shift()!.run();
  }

  private runFx(s: GameSession): void {
    if (!this.fxQueue.length) return;
    const rt = s.renderTime();
    const due = this.fxQueue.filter((f) => f.at <= rt || f.at < rt - 2000);
    if (!due.length) return;
    this.fxQueue = this.fxQueue.filter((f) => !due.includes(f));
    for (const f of due) f.run();
  }

  onLocalThrow(weapon: WeaponId): void {
    this.lastLocalThrow = performance.now();
    this.sfx(weapon === 1 ? 'throwHeavy' : 'throw');
  }

  onImpact(p: ClientProjectile, pos: [number, number, number], reason: string): void {
    if (this.replay) return;
    this.proj.impact(p.weapon, pos, reason === 'player');
    const k = this.near(pos);
    if (k > 0.05) this.sfx(p.weapon === 1 ? 'heavyImpact' : 'thwap', k);
  }

  // ------------------------------------------------------------------
  // Frame

  private frame(now: number): void {
    // The menu backdrop does not need full rate: cap it at 30 fps.
    if (this.mode === 'menu' && now - this.last < 1000 / 30 - 2) return;
    const dt = Math.min(0.1, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.time += dt;
    this.fpsFrames++;
    this.fpsT += dt;
    if (this.fpsT >= 0.5) { this.fps = this.fpsFrames / this.fpsT; this.fpsFrames = 0; this.fpsT = 0; }
    const t0 = performance.now();
    this.contact.begin();
    if (this.mode === 'match' && this.session) this.matchFrame(this.session, dt);
    else if (this.mode === 'controller' && this.controller) this.controller.frame(dt);
    else this.menuFrame(dt);
    this.world.update(this.time);
    this.contact.end();
    if (!this.contextLost) {
      this.renderer.clear();
      this.renderer.render(this.scene, this.camera);
      if (this.mode !== 'menu' && this.vm.root.visible) {
        this.renderer.clearDepth();
        this.renderer.render(this.vmScene, this.vmCamera);
      }
    }
    this.frameMs = this.frameMs * 0.9 + (performance.now() - t0) * 0.1;
  }

  /** Screenshots and review only: show a map from a fixed camera instead of the menu orbit. */
  private showcase: { pos: [number, number, number]; look: [number, number, number] } | null = null;
  setShowcase(mapId: string | null, pos?: [number, number, number], look?: [number, number, number]): void {
    if (!mapId) { this.showcase = null; this.enterMenu(); return; }
    this.useMap(mapId);
    for (const a of this.menuAvatars) a.root.visible = false;
    this.showcase = { pos: pos ?? [0, 30, 26], look: look ?? [0, 0, 0] };
  }

  private menuFrame(dt: number): void {
    if (this.showcase) {
      this.camera.position.set(...this.showcase.pos);
      this.camera.lookAt(...this.showcase.look);
      this.world.update(this.time);
      return;
    }
    const a = this.time * 0.05 + 0.6;
    // Stays inside the open plaza so it never clips through a house.
    const r = 9.5;
    this.camera.position.set(Math.sin(a) * r, 7.5 + Math.sin(this.time * 0.13) * 0.6, Math.cos(a) * r);
    this.camera.lookAt(0, 1.8, 0);
    const reduced = this.settings().reducedMotion;
    for (const av of this.menuAvatars) {
      if (!av.root.visible) continue;
      // Idle with a throw every few seconds, staggered between the two.
      const cycle = (this.time + (av.team === 0 ? 0 : 1.7)) % 3.4;
      av.update(idleState(cycle * 1000), dt, reduced);
      this.contact.add(av, av.root.position.x, av.root.position.y, av.root.position.z, true);
    }
    this.proj.sync(new Map(), 0, this.camera, dt);
  }

  private matchFrame(s: GameSession, dt: number): void {
    const settings = this.settings();
    const reduced = settings.reducedMotion;
    // Spawn: face the spawn direction the server chose (before ticking,
    // which would overwrite it with the old look direction).
    // Death and respawn: no miss cue or pending swing carries across either.
    if (this.wasAlive !== s.alive) { this.ownSwings.reset(); this.vm.cancelMiss(); }
    if (this.wasAlive && !s.alive) this.killcam.onDeath(s.snap?.st ?? s.renderTime(), performance.now());
    if (!this.wasAlive && s.alive) { this.killcam.onRespawn(); this.endReplay('respawn'); }
    if (!this.wasAlive && s.alive) {
      this.input.yaw = s.yaw;
      this.input.pitch = 0;
      this.input.weapon = s.weapon;
      if (s.team !== null) { this.hud.spawnBanner(s.team, !this.spawnedOnce); this.spawnedOnce = true; }
      // Practice: say once how melee works.
      // Melee-only matches explain the swing everywhere (online too); Classic keeps its practice tip.
      if (!this.meleeHinted && s.rules === 'melee') { this.meleeHinted = true; this.hud.sub(t(this.input.touchMode ? 'mode.hintTouch' : 'mode.hint'), 6); }
      if (this.practice && !this.meleeHinted) { this.meleeHinted = true; this.hud.sub(t(this.input.touchMode ? 'hud.meleeHintTouch' : 'hud.meleeHint'), 6); }
    }
    this.wasAlive = s.alive;
    // Fixed-rate prediction ticks.
    if (!this.paused) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= DT && n++ < 6) {
        this.acc -= DT;
        const c = this.inputActive ? this.input.sample() : { mx: 0, mz: 0, jump: false, crouch: false, fire: false, melee: false, firePress: false, weapon: this.input.weapon };
        s.tick({ mx: c.mx, mz: c.mz, yaw: this.input.yaw, pitch: this.input.pitch, fire: c.fire, jump: c.jump, crouch: c.crouch, melee: c.melee, firePress: c.firePress, weapon: c.weapon });
      }
      if (this.acc > DT * 6) this.acc = 0;
      s.flush();
    }
    s.updateRemotes();
    if (!this.paused) s.updateProjectiles(dt);
    this.runFx(s);
    this.replayLifecycle(s, settings.killcam);

    const team = s.team;
    if (team !== null) this.vm.setTeam(team);

    // Camera.
    s.eye(this.eye);
    this.shake = Math.max(0, this.shake - dt * 3.5);
    const cam = this.camera;
    const replay = this.replay;
    if (replay) {
      // The replay's camera is placed below, once its characters are.
    } else if (s.alive) {
      cam.position.set(this.eye.x, this.eye.y, this.eye.z);
      cam.rotation.set(this.input.pitch, this.input.yaw, 0, 'YXZ');
      if (this.shake > 0 && !reduced) {
        const k = this.shake * 0.05;
        cam.position.x += (Math.random() - 0.5) * k;
        cam.position.y += (Math.random() - 0.5) * k;
        cam.rotation.z = (Math.random() - 0.5) * k * 0.6;
      }
    } else {
      // Defeat camera: rise and look down at where you fell.
      const k = Math.min(1, (MATCH.respawnMs - s.respawnInMs) / 700);
      cam.position.set(this.eye.x, this.eye.y + k * 1.6, this.eye.z);
      cam.rotation.set(-0.5 * k + this.input.pitch * (1 - k), this.input.yaw, 0, 'YXZ');
    }

    this.syncAvatars(s, dt, reduced);
    if (replay) this.replayFrame(replay, s, dt, reduced);
    else this.proj.sync(s.projectiles, s.renderTime(), cam, dt);
    // Effects face this frame's camera (placed above), so billboards never lag a turn.
    this.ruleros.update(this.paused ? 0 : dt);
    this.fx.update(this.paused ? 0 : dt, cam);
    // La Fiesta: a chancla through the piñata makes it spin and shower confetti (just for fun).
    const pin = this.world.pinata;
    if (pin && !replay) {
      for (const [id, cp] of s.projectiles) {
        if (this.pinataHits.has(id)) continue;
        const pr = cp.pr;
        if (pr && Math.hypot(pr.x - pin.x, pr.y - pin.y, pr.z - pin.z) < pin.r) { this.pinataHits.add(id); pin.hit(); audio.play('ricochet'); }
      }
      if (this.pinataHits.size > 200) this.pinataHits.clear();
    }
    this.syncPickups(s, dt);

    const speed = Math.hypot(s.body.vx, s.body.vz);
    // On touch screens the hand sits nearer the bottom-right corner, behind
    // the Throw and Jump buttons instead of between them (same size: the
    // viewmodel camera looks from its origin, so this is a plain shift).
    if (this.input.touchMode) this.vm.root.position.set(0.07, -0.06, 0); else this.vm.root.position.set(0, 0, 0);
    this.vm.update({
      weapon: s.weapon, cooldownMs: s.cooldownMs, switchMs: s.switchMs, speed, onGround: s.body.onGround,
      crouched: s.body.crouched, alive: s.alive && s.phase !== 'results', msSinceThrow: performance.now() - this.lastLocalThrow,
      msSinceMelee: performance.now() - this.lastLocalMelee, meleeWeapon: s.swingWeapon === null ? null : this.localMeleeWeapon,
      lookYaw: this.input.yaw, lookPitch: this.input.pitch,
    }, dt, reduced);

    this.movementSounds(s, dt, speed);
    this.phaseCues(s);

    const snap = s.snap;
    this.hud.update({
      hp: s.hp, alive: s.alive, weapon: s.weapon, cooldownMs: s.cooldownMs, switchMs: s.switchMs, meleeMs: s.meleeMs,
      respawnInMs: s.respawnInMs, protectedMs: s.protectedMs, scores: snap?.sc ?? [0, 0],
      timeLeftMs: snap?.tl ?? MATCH.durationMs, phase: s.phase, countdownMs: snap?.cd ?? 0,
      region: regionAt(this.map, s.body.x, s.body.y, s.body.z), rtt: s.rtt, quality: s.connectionQuality,
      fps: this.fps, showStats: settings.showStats, practice: this.practice, team: s.team,
    }, dt, this.input.yaw);

    // Name tags: teammates always, opponents only in plain sight.
    const w = this.stage.clientWidth || window.innerWidth, h = this.stage.clientHeight || window.innerHeight;
    this.losT -= dt;
    const refreshLos = this.losT <= 0;
    if (refreshLos) this.losT = 0.1;
    const labels = [];
    for (const r of replay ? [] : s.remotes.values()) {
      const m = s.room?.members.find((x) => x.id === r.id);
      if (!m) continue;
      const pos = new THREE.Vector3(r.x, r.y + (r.crouched ? MOVE.crouchHeight : MOVE.standHeight) + 0.32, r.z);
      let visible = r.alive;
      if (visible && m.team !== team) {
        if (refreshLos || !this.losCache.has(r.id)) {
          const d = Math.hypot(r.x - this.eye.x, r.z - this.eye.z);
          this.losCache.set(r.id, d < 40 && lineOfSight(this.eye, { x: pos.x, y: pos.y - 0.4, z: pos.z }, s.world.boxes, (b) => b.tag !== 'floor'));
        }
        visible = this.losCache.get(r.id)!;
      }
      labels.push({ id: r.id, name: m.name, team: m.team, pos, hp: r.hp, visible, bot: m.bot });
    }
    this.hud.placeLabels(cam, w, h, labels, dt, team);
    this.placeCafeHint(s, cam, w, h, !!replay, dt);
  }

  private syncAvatars(s: GameSession, dt: number, reduced: boolean): void {
    const seen = new Set<number>();
    // Rollers come from the newest snapshot (it arrives with the event that
    // knocked one off), plus any still waiting to fly.
    const masks = new Map<number, number>();
    for (const tp of s.snap?.p ?? []) masks.set(tp[0], tp[14] ?? 15);
    for (const r of s.remotes.values()) {
      const team = this.teamOf(r.id);
      let av = this.avatars.get(r.id);
      if (av && av.team !== team) { this.scene.remove(av.root); av.dispose(); av = undefined; }
      if (!av) { av = new Avatar(team, { quality: this.quality, arena: true }); this.avatars.set(r.id, av); this.scene.add(av.root); }
      seen.add(r.id);
      driveAvatar(av, r, (masks.get(r.id) ?? r.ruleros) | (this.heldRuleros.get(r.id) ?? 0), dt, reduced);
      // During a replay the live characters keep animating, out of sight.
      av.root.visible = !this.replay;
      if (!this.replay) this.contact.add(av, r.x, r.y, r.z, r.onGround);
    }
    for (const [id, av] of this.avatars) if (!seen.has(id)) { this.scene.remove(av.root); av.dispose(); this.avatars.delete(id); }
  }

  // ------------------------------------------------------------------
  // Elimination replay (killcam.ts records and chooses; this draws it).
  // Nothing here touches the session, the inputs or the match: live state
  // keeps updating underneath, out of sight, and shows again on exit.

  /** Starts, or ends, the replay as the match goes on. */
  private replayLifecycle(s: GameSession, enabled: boolean): void {
    const r = this.replay;
    if (r) {
      // Ends at once when you can respawn, when the match or connection
      // changes, when a menu takes over (online; practice pauses it instead),
      // when the setting is turned off, or at its end.
      const why = s.alive || s.respawnInMs <= 0 ? 'respawn'
        : s.phase !== 'playing' ? 'phase'
        : s.state !== 'online' ? 'connection'
        : !enabled ? 'setting'
        : !this.paused && !this.inputActive ? 'menu'
        : r.rt >= r.clip.end ? 'done' : null;
      if (why) this.endReplay(why);
      return;
    }
    if (s.alive || this.paused || s.phase !== 'playing') return;
    // Online with a menu open: wait (the death screen shows; a late start is refused by poll).
    if (!this.inputActive) return;
    const clip = this.killcam.poll(performance.now(), s.respawnInMs, enabled, s.world.boxes);
    if (clip) this.startReplay(clip, s);
  }

  private startReplay(clip: Clip, s: GameSession): void {
    // Live effects are short-lived: cleared, so nothing from now plays over the past.
    this.fx.clear();
    this.ruleros.clear();
    this.proj.clear();
    const teams = new Map<number, Team>();
    for (const m of s.room?.members ?? []) teams.set(m.id, m.team);
    if (clip.note.team !== null) teams.set(clip.killer, clip.note.team);
    const held = new Map<number, number>();
    const weapons = new Map<number, WeaponId>();
    for (const r of clip.events) {
      const e = r.e;
      if (e.k === 'throw') weapons.set(e.id, e.w);
      if ((e.k === 'hit' || e.k === 'elim') && e.ru?.length && r.t >= clip.start) held.set(e.v, (held.get(e.v) ?? 0) | e.ru.reduce((m, i) => m | (1 << i), 0));
    }
    this.replay = { clip, cur: new ClipCursor(clip), rt: clip.start, teams, held, weapons, avatars: new Map(), projs: new Map(), cues: 0, startedAt: performance.now(), lastNow: performance.now(), rulerosShown: 0, projMax: 0, jsMs: 0, frames: 0, swingShown: false, camSet: false };
    this.hud.killcam({ name: clip.note.name || this.nameOf(clip.killer), team: clip.note.team, w: clip.note.w, melee: clip.note.melee });
    this.lastReplay = { startedAt: Math.round(performance.now()), endedAt: 0, reason: '', view: clip.view, killer: clip.killer, ms: Math.round(clip.end - clip.start) };
    diagLog('replay', `started (${clip.view} view, ${Math.round(clip.end - clip.start)} ms)`);
    this.onReplay?.(true, clip);
  }

  /** Space, the Skip button or a tap: back to the death screen. True if a replay was showing. */
  skipReplay(): boolean {
    if (!this.replay) return false;
    this.endReplay('skip');
    return true;
  }

  private endReplay(reason: string): void {
    const r = this.replay;
    if (!r) return;
    this.replay = null;
    for (const av of r.avatars.values()) av.root.visible = false;
    for (const av of this.avatars.values()) av.root.visible = true;
    this.fx.clear();
    this.ruleros.clear();
    this.proj.clear();
    this.hud.killcam(null);
    // Anything held during the replay (Space to skip, a finger on the screen) is dropped.
    this.input.release('replay ended');
    if (this.lastReplay) Object.assign(this.lastReplay, { endedAt: Math.round(performance.now()), reason, cues: r.cues, ruleros: r.rulerosShown, projMax: r.projMax, shownMs: Math.round(r.rt - r.clip.start), swingShown: r.swingShown, jsMsPerFrame: r.frames ? +(r.jsMs / r.frames).toFixed(2) : 0, frames: r.frames });
    diagLog('replay', `ended (${reason})`);
    this.onReplay?.(false, null);
  }

  private disposeReplayPool(): void {
    for (const av of this.replayPool) { this.scene.remove(av.root); av.dispose(); }
    this.replayPool = [];
  }

  /** A replay character for `team`, reused when one is free. */
  private replayAvatar(r: Replay, id: number, team: Team): Avatar {
    let av = r.avatars.get(id);
    if (av) return av;
    const used = new Set(r.avatars.values());
    av = this.replayPool.find((a) => a.team === team && !used.has(a));
    if (!av) { av = new Avatar(team, { quality: this.quality, arena: true }); this.replayPool.push(av); this.scene.add(av.root); }
    av.reset(); // a pooled one keeps nothing from the live scene or an earlier replay
    r.avatars.set(id, av);
    return av;
  }

  private replayFrame(r: Replay, s: GameSession, dt: number, reduced: boolean): void {
    const t0 = performance.now();
    // Wall-clock time, like the respawn countdown (a slow frame does not slow the replay; no slow motion either).
    const now = performance.now();
    if (!this.paused) r.rt = Math.min(r.clip.end, r.rt + Math.min(1000, now - r.lastNow));
    r.lastNow = now;
    const rt = r.rt, clip = r.clip;
    const players = r.cur.playersAt(rt);
    const live = new Set<Avatar>();
    for (const [id, p] of players) {
      const av = this.replayAvatar(r, id, r.teams.get(id) ?? (id === s.id ? s.team ?? 0 : 0));
      live.add(av);
      driveAvatar(av, p, p.ruleros | (r.held.get(id) ?? 0), this.paused ? 0 : dt, reduced);
      // From her own eyes the attacker is not drawn; in the melee view she is the point.
      av.root.visible = !(clip.view === 'attacker' && id === clip.killer && players.get(clip.killer)?.alive);
      if (id === clip.killer && av.root.visible && p.msSinceMelee < 600) r.swingShown = true;
      if (av.root.visible) this.contact.add(av, p.x, p.y, p.z, p.onGround);
    }
    for (const [id, av] of r.avatars) if (!live.has(av)) { av.root.visible = false; r.avatars.delete(id); }
    for (const ev of r.cur.due(rt)) this.replayEvent(r, ev.e, players);
    // Camera: from the attacker's eyes, or behind you facing her.
    const cam = this.camera, k = players.get(clip.killer), v = players.get(clip.victim);
    if (clip.view === 'attacker' && k) {
      const e = eyeOf(k);
      cam.position.set(e.x, e.y, e.z);
      cam.rotation.set(k.pitch, k.yaw, 0, 'YXZ');
    } else if (clip.view === 'melee' && k && v) {
      // The side chosen at the blow, held; a frame with no clear spot keeps the last one.
      const c = meleeCamera(k, v, s.world.boxes, clip.camSide);
      if (c.ok || !r.camSet) { cam.position.set(c.pos.x, c.pos.y, c.pos.z); cam.lookAt(c.look.x, c.look.y, c.look.z); r.camSet = true; }
    } else if (v) {
      const c = thirdPersonCamera(v, k, s.world.boxes);
      cam.position.set(c.pos.x, c.pos.y, c.pos.z);
      cam.lookAt(c.look.x, c.look.y, c.look.z);
    }
    // The chanclas in the air, as they were drawn.
    const seen = new Set<string>();
    for (const it of r.cur.projectilesAt(rt)) {
      seen.add(it.key);
      let cp = r.projs.get(it.key);
      if (!cp) {
        cp = { id: `r${it.key}`, weapon: it.w, owner: -1, predicted: false, startAt: -Infinity, endAt: Infinity, endPos: null, done: false, trail: [], pr: { id: -1, owner: -1, team: 0, weapon: it.w, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, ageMs: 0, traveled: 0, bounces: 0, fireSeq: 0 } };
        r.projs.set(it.key, cp);
      }
      cp.pr.x = it.x; cp.pr.y = it.y; cp.pr.z = it.z;
    }
    for (const k2 of [...r.projs.keys()]) if (!seen.has(k2)) r.projs.delete(k2);
    r.projMax = Math.max(r.projMax, r.projs.size);
    this.proj.sync(r.projs, rt, cam, this.paused ? 0 : dt);
    r.jsMs += performance.now() - t0;
    r.frames++;
  }

  /** One recorded event, drawn in the replay: effects as they happened, sound only for the finishing blow. */
  private replayEvent(r: Replay, e: SimEvent, players: Map<number, RemotePlayer>): void {
    const c = r.clip;
    const cue = (name: Parameters<typeof audio.play>[0]) => { if (r.cues < 2) { r.cues++; audio.play(name, 0.8); } };
    switch (e.k) {
      case 'throw':
        if (e.id === c.finishThrow) cue(e.w === 1 ? 'throwHeavy' : 'throw');
        break;
      case 'swing':
        if (e.id === c.finishSwing) cue(e.w === 1 ? 'swishHeavy' : 'swish');
        break;
      case 'whiff': {
        const p = players.get(e.a);
        if (p) this.fx.meleeWhiff(e.w, { x: p.x, y: p.y, z: p.z }, p.yaw);
        r.avatars.get(e.a)?.whiff(e.w);
        break;
      }
      case 'hit': {
        const dir = blowDir(players.get(e.a)?.yaw ?? 0, e.w);
        if (e.m !== undefined) {
          const vp = players.get(e.v);
          if (vp) r.avatars.get(e.v)?.react(e.head, dir.x * -Math.cos(vp.yaw) + dir.z * Math.sin(vp.yaw));
          this.fx.meleeHit(e.w, { x: e.p[0], y: e.p[1], z: e.p[2] }, dir, e.head);
          if (e.m === c.finishSwing) cue(e.w === 1 ? 'paf' : 'slap');
        }
        if (e.ru?.length) this.replayRuleros(r, e.v, e.ru, dir, false);
        break;
      }
      case 'elim':
        if (e.ru?.length) this.replayRuleros(r, e.v, e.ru, blowDir(players.get(e.a)?.yaw ?? 0, e.w), true);
        break;
      case 'pend': {
        const w = r.weapons.get(e.id);
        if (w === undefined) break;
        this.proj.impact(w, e.p, e.r === 'player');
        if (e.id === c.finishThrow) cue(w === 1 ? 'heavyImpact' : 'thwap');
        break;
      }
      case 'shielded': {
        const p = players.get(e.v);
        if (p) this.fx.shielded({ x: p.x, y: p.y + 1.2, z: p.z });
        break;
      }
      default:
        break;
    }
  }

  /** Rollers the server said came off, from where they sat on her head: once, and only those. */
  private replayRuleros(r: Replay, victim: number, ru: readonly number[], dir: { x: number; z: number }, scatter: boolean): void {
    const av = r.avatars.get(victim);
    const simple = this.quality === 'low' || this.settings().reducedMotion;
    let held = r.held.get(victim) ?? 0;
    ru.forEach((i, n) => {
      held &= ~(1 << i);
      if (!av || (scatter && this.quality === 'low' && n >= 1)) return;
      const from = av.ruleroWorld(i, this.tmpV);
      const spread = scatter ? (n - (ru.length - 1) / 2) * 0.6 : 0;
      const d = this.tmpD.set(dir.x * Math.cos(spread) - dir.z * Math.sin(spread), 0, dir.x * Math.sin(spread) + dir.z * Math.cos(spread));
      this.ruleros.spawn(i, from, d, av.groundY, { simple, strength: scatter ? 0.75 : 1 });
      r.rulerosShown++;
    });
    r.held.set(victim, held);
  }

  /** The replay's state (tests and diagnostics). */
  get killcamState(): Record<string, unknown> {
    const r = this.replay;
    return {
      active: !!r, view: r?.clip.view ?? null, rt: r ? Math.round(r.rt - r.clip.start) : null, length: r ? Math.round(r.clip.end - r.clip.start) : null,
      killer: r?.clip.killer ?? null, cues: r?.cues ?? 0, ruleros: r?.rulerosShown ?? 0, projMax: r?.projMax ?? 0, avatars: r?.avatars.size ?? 0, pool: this.replayPool.length,
      buffer: this.killcam.rec.size, counts: this.killcam.counts, lastFallback: this.killcam.lastFallback, last: this.lastReplay,
    };
  }

  private movementSounds(s: GameSession, dt: number, speed: number): void {
    if (!s.alive || s.phase !== 'playing') { this.wasGround = true; return; }
    const g = s.body.onGround;
    if (this.wasGround && !g && s.body.vy > 2) audio.play('jump', 0.7);
    if (!this.wasGround && g) audio.play('landSoft', 0.8);
    this.wasGround = g;
    if (g && speed > 1.5) {
      this.stepT -= dt * (speed / MOVE.walkSpeed);
      if (this.stepT <= 0) { this.stepT = s.body.crouched ? 0.5 : 0.36; audio.play('step', s.body.crouched ? 0.4 : 0.7); }
    }
    if (s.hp <= 30) {
      this.heartT -= dt;
      if (this.heartT <= 0) { this.heartT = 0.85; audio.play('heartbeat'); }
    } else this.heartT = 0;
  }

  private phaseCues(s: GameSession): void {
    const ph = s.phase;
    if (ph === 'countdown') {
      const n = Math.ceil((s.snap?.cd ?? 0) / 1000);
      if (n !== this.lastCountdown && n > 0) { this.lastCountdown = n; audio.play('countdown'); }
    }
    if (ph === 'playing' && this.lastPhase === 'countdown') {
      audio.play('go');
      this.hud.center(t('hud.go'), 1.2);
    }
    if (ph !== this.lastPhase && ph === 'countdown') this.resetRound();
    this.lastPhase = ph;
  }

  // ------------------------------------------------------------------
  // Cafecito pickups: a steaming cup on a saucer, hidden while recharging.

  private buildPickups(): void {
    for (const c of this.cups) { this.scene.remove(c.group); c.dispose(); }
    this.cups = []; this.pickups = [];
    for (const p of this.map.pickups) {
      const c = buildCafecito();
      c.group.position.set(p.x, p.y, p.z);
      this.cups.push(c);
      this.pickups.push(c.group);
      this.scene.add(c.group);
    }
  }

  private placePickups(): void {
    if (this.pickups.length !== this.map.pickups.length) { this.buildPickups(); return; }
    this.pickups.forEach((g, i) => {
      const p = this.map.pickups[i];
      g.visible = !!p;
      if (p) g.position.set(p.x, p.y, p.z);
    });
  }

  private syncPickups(s: GameSession, _dt: number): void {
    const pk = s.snap?.pk ?? [];
    this.cups.forEach((c, i) => {
      const ms = pk[i] ?? 0;
      c.setState(ms <= 0, this.time, 1 - ms / MATCH.pickupRespawnMs);
    });
  }

  /** What the minimap shows: you, your living teammates and the cafecitos (never an opponent). */
  miniMarkers(): MiniMarkers | null {
    const s = this.session;
    if (!s) return null;
    const pk = s.snap?.pk ?? [];
    return {
      me: { x: s.body.x, z: s.body.z, yaw: this.input.yaw, alive: s.alive, team: s.team },
      mates: teammateMarkers(s.remotes.values(), (id) => s.room?.members.find((m) => m.id === id)?.team ?? null, s.id, s.team),
      pickups: this.map.pickups.map((p, i) => ({ x: p.x, z: p.z, ready: (pk[i] ?? 0) <= 0 })),
    };
  }

  /** The cafecito hint: the nearest cup in plain sight and in front, at most one, never during a replay. */
  private placeCafeHint(s: GameSession, cam: THREE.Camera, w: number, h: number, replaying: boolean, dt: number): void {
    const pk = s.snap?.pk ?? [];
    const cups = this.map.pickups.map((p, i) => ({ x: p.x, y: p.y, z: p.z, ready: (pk[i] ?? 0) <= 0 }));
    if (replaying || !s.alive || s.phase !== 'playing' || !cups.length) { this.cafeLabel.hide(); return; }
    // Which cup (if any) is chosen ten times a second, like the name tags' line of sight;
    // its state (ready, your health) is read every frame.
    this.cafeLos.t -= dt;
    if (this.cafeLos.t <= 0) {
      this.cafeLos.t = 0.1;
      const g = pickCafecitoGuide({ ...this.eye, yaw: this.input.yaw, hp: s.hp, maxHp: MATCH.maxHealth, alive: s.alive }, cups,
        (a, b) => lineOfSight(a, b, s.world.boxes, (bx) => bx.tag !== 'floor'));
      this.cafeLos.i = g ? g.i : -1;
    }
    const i = this.cafeLos.i;
    if (i < 0 || !cups[i]) { this.cafeLabel.hide(); return; }
    const g = { i, state: !cups[i]!.ready ? 'unavailable' as const : s.hp >= MATCH.maxHealth ? 'full' as const : 'walk' as const };
    const c = cups[g.i]!;
    const v = new THREE.Vector3(c.x, c.y + 1.15, c.z).project(cam);
    if (v.z >= 1) { this.cafeLabel.hide(); return; }
    this.cafeLabel.show((v.x + 1) / 2 * w, (1 - v.y) / 2 * h, t(`cafe.${g.state}` as const), g.state, this.hud.nameRects());
  }

  // ------------------------------------------------------------------

  debugInfo(): Record<string, unknown> {
    const s = this.session;
    return {
      mode: this.mode, fps: Math.round(this.fps), frameMs: +this.frameMs.toFixed(2), drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles, geometries: this.renderer.info.memory.geometries, textures: this.renderer.info.memory.textures,
      avatars: this.avatars.size, quality: this.quality, pixelRatio: this.renderer.getPixelRatio(),
      session: s ? {
        id: s.id, state: s.state, phase: s.phase, team: s.team, alive: s.alive, hp: s.hp, weapon: s.weapon, rtt: Math.round(s.rtt),
        pos: [+s.body.x.toFixed(2), +s.body.y.toFixed(2), +s.body.z.toFixed(2)], scores: s.snap?.sc, remotes: s.remotes.size,
        projectiles: s.projectiles.size, corrections: s.corrections, maxCorrection: +s.maxCorrection.toFixed(3), code: s.room?.code ? 'set' : null,
      } : null,
    };
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.clearMatch();
    this.cafeLabel.dispose();
    for (const c of this.cups) c.dispose();
    disposeTree(this.scene);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

interface Replay {
  clip: Clip;
  cur: ClipCursor;
  /** The render time being shown (server ms). */
  rt: number;
  teams: Map<number, Team>;
  /** Rollers still drawn on a head until the event that knocked them off plays. */
  held: Map<number, number>;
  /** Each recorded chancla's weapon, by projectile id. */
  weapons: Map<number, WeaponId>;
  avatars: Map<number, Avatar>;
  projs: Map<string, ClientProjectile>;
  /** Replay sounds played (at most two: the finishing attack and its impact). */
  cues: number;
  startedAt: number;
  lastNow: number;
  /** Rollers launched and the most chanclas drawn at once (tests, diagnostics). */
  rulerosShown: number;
  projMax: number;
  /** The replay's own work per frame (sampling, characters, events, camera), without drawing: the cost report. */
  jsMs: number;
  frames: number;
  /** The attacker was drawn mid-swing (tests); the melee camera has been placed. */
  swingShown: boolean;
  camSet: boolean;
}

/** Which way a blow travels: a forehand from the attacker's right to left, a backhand left to right, and a little away from her. */
function blowDir(yaw: number, weapon: WeaponId): { x: number; z: number } {
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const side = weapon === 1 ? 1 : -1;
  const x = rx * side + fx * 0.45, z = rz * side + fz * 0.45;
  const l = Math.hypot(x, z) || 1;
  return { x: x / l, z: z / l };
}

/** Poses a character from a player record (live or replayed). */
function driveAvatar(av: Avatar, r: RemotePlayer, ruleros: number, dt: number, reduced: boolean): void {
  av.root.position.set(r.x, r.y, r.z);
  av.root.rotation.y = r.yaw;
  const speed = Math.hypot(r.vx, r.vz);
  const sin = Math.sin(r.yaw), cos = Math.cos(r.yaw);
  const fwd = speed > 0.01 ? (-r.vx * sin - r.vz * cos) / speed : 0;
  const side = speed > 0.01 ? (r.vx * cos - r.vz * sin) / speed : 0;
  av.update({
    speed, strafe: side, back: -fwd, onGround: r.onGround, crouched: r.crouched, alive: r.alive, protected: r.protected,
    pitch: r.pitch, weapon: r.weapon, msSinceThrow: r.msSinceThrow, msSinceHit: r.msSinceHit, connected: r.connected,
    msSinceMelee: r.msSinceMelee, ruleros,
  }, dt, reduced);
}

/** How dark the characters' contact discs are: lighter where the sun's shadow map also grounds them. */
function contactStrength(q: Quality): number { return q === 'high' ? 0.32 : q === 'medium' ? 0.36 : 0.46; }

function idleState(msSinceThrow: number): AvatarState {
  return {
    speed: 0, strafe: 0, back: 0, onGround: true, crouched: false, alive: true, protected: false, pitch: 0.1,
    weapon: 0, msSinceThrow: msSinceThrow < WEAPONS[0]!.cooldownMs ? msSinceThrow : 1e6, msSinceHit: 1e6, connected: true,
  };
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose?.();
  });
}
