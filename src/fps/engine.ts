// Renderer and scene owner for the shooter. Two modes:
//   * menu: a slow orbit over El Patio with two Rosas posed by the fountain,
//   * match: first person, driven by a GameSession at a fixed 60 Hz.
// The engine never decides gameplay. It predicts movement through the
// session and shows what the server confirms.
import * as THREE from 'three';
import { MATCH, MOVE, NET, WEAPONS, type WeaponId } from '../../shared/config';
import { EL_PATIO, regionAt, type Team } from '../../shared/map';
import { lineOfSight } from '../../shared/collision';
import type { SimEvent } from '../../shared/sim';
import type { ClientProjectile, GameSession } from '../net/session';
import { audio } from '../audio/audio';
import { buildWorld, type WorldView } from './render/world';
import { Avatar, type AvatarState } from './render/rosa';
import { ViewModel } from './render/viewmodel';
import { ProjectileView } from './render/projectiles';
import { COLORS, toon, flat, OUTLINE } from './render/materials';
import type { Hud } from './hud';
import type { FpsInput } from './input';
import type { FpsSettings, Quality } from './settings';
import { t } from './strings';

const DT = 1 / NET.tickRate;
const PIXEL_CAP: Record<Quality, number> = { low: 1, medium: 1.5, high: 2 };

export interface PlayerStats { k: number; d: number }

export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly vmScene = new THREE.Scene();
  readonly vmCamera = new THREE.PerspectiveCamera(62, 1, 0.01, 20);
  mode: 'menu' | 'match' = 'menu';
  session: GameSession | null = null;
  practice = false;
  paused = false; // practice menu: stop ticking entirely
  inputActive = false; // false while an online menu is open
  readonly stats = new Map<number, PlayerStats>();
  fps = 0;
  frameMs = 0;
  private world: WorldView;
  private quality: Quality;
  private avatars = new Map<number, Avatar>();
  private menuAvatars: Avatar[] = [];
  private proj = new ProjectileView();
  private vm = new ViewModel();
  private pickups: THREE.Group[] = [];
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
    private settings: () => FpsSettings,
    private hud: Hud,
    private input: FpsInput,
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
    this.scene.add(this.world.group, this.proj.group);
    this.buildPickups();
    for (const team of [0, 1] as const) {
      const a = new Avatar(team);
      a.root.position.set(team === 0 ? -1.6 : 1.6, 0, 3.4);
      a.root.rotation.y = team === 0 ? -0.5 : 0.5;
      this.menuAvatars.push(a);
      this.scene.add(a.root);
    }

    this.vmScene.add(new THREE.HemisphereLight(0xffe7c4, 0x7a4a5a, 2.2));
    const vmSun = new THREE.DirectionalLight(0xfff0d0, 1.6);
    vmSun.position.set(-1, 2, 1);
    this.vmScene.add(vmSun, this.vm.root);

    const canvas = this.renderer.domElement;
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.contextLost = true; this.onContextLost?.(true); });
    canvas.addEventListener('webglcontextrestored', () => { this.contextLost = false; this.onContextLost?.(false); });
    this.resize();
  }

  get canvas(): HTMLCanvasElement { return this.renderer.domElement; }

  get drawCalls(): number { return this.renderer.info.render.calls; }

  start(): void {
    this.last = performance.now();
    const loop = (now: number) => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      this.frame(now);
    };
    this.raf = requestAnimationFrame(loop);
  }

  resize(): void {
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
    if (s.quality !== this.quality) {
      this.quality = s.quality;
      this.renderer.shadowMap.enabled = s.quality !== 'low';
      this.scene.remove(this.world.group);
      disposeTree(this.world.group);
      this.world = buildWorld(s.quality);
      this.scene.add(this.world.group);
      this.renderer.shadowMap.needsUpdate = true;
      this.resize();
    }
  }

  // ------------------------------------------------------------------
  // Mode switches

  enterMenu(): void {
    this.mode = 'menu';
    this.session = null;
    this.clearMatch();
    for (const a of this.menuAvatars) a.root.visible = true;
  }

  enterMatch(session: GameSession, practice: boolean): void {
    this.mode = 'match';
    this.session = session;
    this.practice = practice;
    this.clearMatch();
    for (const a of this.menuAvatars) a.root.visible = false;
    this.acc = 0;
    this.wasAlive = false;
    this.lastPhase = '';
    this.lastCountdown = -1;
    const team = session.team;
    if (team !== null) this.vm.setTeam(team);
  }

  private clearMatch(): void {
    for (const a of this.avatars.values()) { this.scene.remove(a.root); a.dispose(); }
    this.avatars.clear();
    this.proj.clear();
    this.stats.clear();
    this.hud.reset();
    this.shake = 0;
  }

  // Clears per-match bookkeeping for a rematch without leaving match mode.
  resetRound(): void {
    this.stats.clear();
    this.proj.clear();
    this.hud.reset();
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

  onEvent(e: SimEvent): void {
    const s = this.session;
    if (!s) return;
    const me = s.id;
    switch (e.k) {
      case 'throw':
        if (e.o !== me) { const k = this.near(e.p); if (k > 0.05) audio.play(e.w === 1 ? 'throwHeavy' : 'throw', k); }
        break;
      case 'hit': {
        if (e.a === me && e.v !== me) {
          this.hud.hitMarker(e.head ? 'head' : 'body');
          audio.play(e.head ? 'headshot' : 'hitConfirm');
          this.hud.floatText(String(e.d), new THREE.Vector3(e.p[0], e.p[1] + 0.3, e.p[2]), e.head ? 'head' : '');
        }
        if (e.v === me) {
          const att = s.remotes.get(e.a);
          const angle = att ? Math.atan2(-(att.x - s.body.x), -(att.z - s.body.z)) : null;
          this.hud.hurt(angle);
          audio.play('hurtFps', Math.min(1.4, 0.6 + e.d / 60));
          if (!this.settings().reducedMotion) this.shake = Math.min(1, this.shake + e.d / 70);
        }
        break;
      }
      case 'shielded':
        if (e.a === me) { audio.play('shielded'); this.hud.sub(t('hud.protected'), 0.8); }
        break;
      case 'elim': {
        this.stat(e.a).k++;
        this.stat(e.v).d++;
        this.hud.killfeed(this.nameOf(e.a), this.teamOf(e.a), this.nameOf(e.v), this.teamOf(e.v), e.w, e.a === me || e.v === me);
        if (e.a === me) { this.hud.hitMarker('kill'); audio.play('elimConfirm'); this.hud.center(t('hud.youEliminated', { name: this.nameOf(e.v) }), 1.4); }
        if (e.v === me) { audio.play('died'); this.hud.center(t('hud.eliminatedBy', { name: this.nameOf(e.a) }), 2.2); }
        break;
      }
      case 'spawn':
        if (e.id === me) audio.play('spawn');
        break;
      case 'pickup':
        if (e.id === me) {
          audio.play('pickup');
          const p = EL_PATIO.pickups[e.i];
          if (p) this.hud.floatText(t('hud.pickup', { n: MATCH.pickupHeal }), new THREE.Vector3(p.x, 1.2, p.z), 'heal');
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

  onLocalThrow(weapon: WeaponId): void {
    this.lastLocalThrow = performance.now();
    audio.play(weapon === 1 ? 'throwHeavy' : 'throw');
  }

  onImpact(p: ClientProjectile, pos: [number, number, number], reason: string): void {
    this.proj.impact(p.weapon, pos, reason === 'player');
    const k = this.near(pos);
    if (k > 0.05) audio.play(p.weapon === 1 ? 'heavyImpact' : 'thwap', k);
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
    if (this.mode === 'match' && this.session) this.matchFrame(this.session, dt);
    else this.menuFrame(dt);
    this.world.update(this.time);
    if (!this.contextLost) {
      this.renderer.clear();
      this.renderer.render(this.scene, this.camera);
      if (this.mode === 'match' && this.vm.root.visible) {
        this.renderer.clearDepth();
        this.renderer.render(this.vmScene, this.vmCamera);
      }
    }
    this.frameMs = this.frameMs * 0.9 + (performance.now() - t0) * 0.1;
  }

  private menuFrame(dt: number): void {
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
    }
    this.proj.sync(new Map(), 0, this.camera, dt);
  }

  private matchFrame(s: GameSession, dt: number): void {
    const settings = this.settings();
    const reduced = settings.reducedMotion;
    // Spawn: face the spawn direction the server chose (before ticking,
    // which would overwrite it with the old look direction).
    if (!this.wasAlive && s.alive) {
      this.input.yaw = s.yaw;
      this.input.pitch = 0;
      this.input.weapon = s.weapon;
    }
    this.wasAlive = s.alive;
    // Fixed-rate prediction ticks.
    if (!this.paused) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= DT && n++ < 6) {
        this.acc -= DT;
        const c = this.inputActive ? this.input.sample() : { mx: 0, mz: 0, jump: false, crouch: false, fire: false, weapon: this.input.weapon };
        s.tick({ mx: c.mx, mz: c.mz, yaw: this.input.yaw, pitch: this.input.pitch, fire: c.fire, jump: c.jump, crouch: c.crouch, weapon: c.weapon });
      }
      if (this.acc > DT * 6) this.acc = 0;
      s.flush();
    }
    s.updateRemotes();
    if (!this.paused) s.updateProjectiles(dt);

    const team = s.team;
    if (team !== null) this.vm.setTeam(team);

    // Camera.
    s.eye(this.eye);
    this.shake = Math.max(0, this.shake - dt * 3.5);
    const cam = this.camera;
    if (s.alive) {
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
    this.proj.sync(s.projectiles, s.renderTime(), cam, dt);
    this.syncPickups(s, dt);

    const speed = Math.hypot(s.body.vx, s.body.vz);
    this.vm.update({
      weapon: s.weapon, cooldownMs: s.cooldownMs, switchMs: s.switchMs, speed, onGround: s.body.onGround,
      crouched: s.body.crouched, alive: s.alive && s.phase !== 'results', msSinceThrow: performance.now() - this.lastLocalThrow,
    }, dt, reduced);

    this.movementSounds(s, dt, speed);
    this.phaseCues(s);

    const snap = s.snap;
    this.hud.update({
      hp: s.hp, alive: s.alive, weapon: s.weapon, cooldownMs: s.cooldownMs, switchMs: s.switchMs,
      respawnInMs: s.respawnInMs, protectedMs: s.protectedMs, scores: snap?.sc ?? [0, 0],
      timeLeftMs: snap?.tl ?? MATCH.durationMs, phase: s.phase, countdownMs: snap?.cd ?? 0,
      region: regionAt(EL_PATIO, s.body.x, s.body.y, s.body.z), rtt: s.rtt, quality: s.connectionQuality,
      fps: this.fps, showStats: settings.showStats, practice: this.practice,
    }, dt, this.input.yaw);

    // Name tags: teammates always, opponents only in plain sight.
    const w = this.stage.clientWidth || window.innerWidth, h = this.stage.clientHeight || window.innerHeight;
    this.losT -= dt;
    const refreshLos = this.losT <= 0;
    if (refreshLos) this.losT = 0.1;
    const labels = [];
    for (const r of s.remotes.values()) {
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
    this.hud.placeLabels(cam, w, h, labels, dt);
  }

  private syncAvatars(s: GameSession, dt: number, reduced: boolean): void {
    const seen = new Set<number>();
    for (const r of s.remotes.values()) {
      const team = this.teamOf(r.id);
      let av = this.avatars.get(r.id);
      if (av && av.team !== team) { this.scene.remove(av.root); av.dispose(); av = undefined; }
      if (!av) { av = new Avatar(team); this.avatars.set(r.id, av); this.scene.add(av.root); }
      seen.add(r.id);
      av.root.position.set(r.x, r.y, r.z);
      av.root.rotation.y = r.yaw;
      const speed = Math.hypot(r.vx, r.vz);
      const sin = Math.sin(r.yaw), cos = Math.cos(r.yaw);
      const fwd = speed > 0.01 ? (-r.vx * sin - r.vz * cos) / speed : 0;
      const side = speed > 0.01 ? (r.vx * cos - r.vz * sin) / speed : 0;
      av.update({
        speed, strafe: side, back: -fwd, onGround: r.onGround, crouched: r.crouched, alive: r.alive, protected: r.protected,
        pitch: r.pitch, weapon: r.weapon, msSinceThrow: r.msSinceThrow, msSinceHit: r.msSinceHit, connected: r.connected,
      }, dt, reduced);
    }
    for (const [id, av] of this.avatars) if (!seen.has(id)) { this.scene.remove(av.root); av.dispose(); this.avatars.delete(id); }
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
    const cupGeo = new THREE.CylinderGeometry(0.16, 0.12, 0.22, 16);
    const saucerGeo = new THREE.CylinderGeometry(0.26, 0.22, 0.04, 20);
    const handleGeo = new THREE.TorusGeometry(0.07, 0.022, 6, 12);
    const glowGeo = new THREE.RingGeometry(0.4, 0.55, 28);
    const cupMat = toon(COLORS.cream), saucerMat = toon(COLORS.turquoise), coffee = toon(COLORS.woodDark);
    for (const p of EL_PATIO.pickups) {
      const g = new THREE.Group();
      const spin = new THREE.Group();
      const cup = new THREE.Mesh(cupGeo, cupMat);
      cup.position.y = 0.13;
      const outline = new THREE.Mesh(cupGeo, OUTLINE);
      outline.position.y = 0.13;
      outline.scale.setScalar(1.08);
      const top = new THREE.Mesh(new THREE.CircleGeometry(0.15, 16), coffee);
      top.rotation.x = -Math.PI / 2;
      top.position.y = 0.235;
      const handle = new THREE.Mesh(handleGeo, cupMat);
      handle.position.set(0.17, 0.13, 0);
      const saucer = new THREE.Mesh(saucerGeo, saucerMat);
      spin.add(cup, outline, top, handle, saucer);
      spin.position.y = 0.7;
      const glow = new THREE.Mesh(glowGeo, flat(COLORS.marigold, { transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = 0.03;
      g.add(spin, glow);
      g.position.set(p.x, p.y, p.z);
      this.pickups.push(g);
      this.scene.add(g);
    }
  }

  private syncPickups(s: GameSession, dt: number): void {
    const pk = s.snap?.pk ?? [];
    this.pickups.forEach((g, i) => {
      const ready = (pk[i] ?? 0) <= 0;
      const spin = g.children[0]!;
      spin.visible = ready;
      spin.rotation.y += dt * 1.6;
      spin.position.y = 0.7 + Math.sin(this.time * 2.2 + i) * 0.06;
      (g.children[1] as THREE.Mesh).visible = ready;
    });
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
    disposeTree(this.scene);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

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
