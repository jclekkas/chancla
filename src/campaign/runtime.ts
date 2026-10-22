// Runs one mission inside the engine: fixed 60 Hz simulation, camera,
// viewmodel, projectiles, the mission view and HUD, and the mapping from
// mission events to sound, music and dialogue. Mission rules live in
// shared/campaign; this file only presents them.
import * as THREE from 'three';
import { MissionSim, CAMPAIGN, DT, type MEvent, type MissionResult } from '../../shared/campaign/mission';
import { missionHints, type MHint } from '../../shared/campaign/hints';
import { MissionBot } from '../../shared/campaign/bot';
import type { ActorSpec, MissionDef } from '../../shared/campaign/types';
import type { ClientProjectile } from '../net/session';
import type { Controller, Engine } from '../fps/engine';
import { audio } from '../audio/audio';
import type { Dialogue } from '../audio/dialogue';
import { music } from '../audio/music';
import { Avatar } from '../fps/render/rosa';
import { buildBocinas, buildInfluencer, buildSoplador } from '../models/characters';
import { COLORS, toon } from '../fps/render/materials';
import { MissionView, toonify } from './view';
import { MissionHud } from './mhud';

export interface RuntimeHooks {
  complete(res: MissionResult): void;
  ko(on: boolean): void;
}

const ARCH_LINE: Record<string, string> = { influencer: 'influ_hit', speaker: 'bocinas_hit', blower: 'soplador_hit', cart: 'cart_hit', rollcart: 'rollcart_hit' };

export class MissionRuntime implements Controller {
  sim: MissionSim;
  readonly view: MissionView;
  readonly hud: MissionHud;
  paused = false;
  autopilot: MissionBot | null = null; // tests and demos only
  private acc = 0;
  private prev = { x: 0, y: 0, z: 0 };
  private lastThrow = -1e9;
  private victory: { t: number; avatar: Avatar; center: THREE.Vector3; result: MissionResult; extras: THREE.Object3D[] } | null = null;
  private focus: MHint | null = null;
  private hintTick = 0;
  private lastHintLine = 0;
  private wasLow = false;
  private shake = 0;
  private finished = false;
  readonly eventLog: MEvent[] = [];

  constructor(private engine: Engine, readonly def: MissionDef, private dialogue: Dialogue, private hooks: RuntimeHooks, seed = 1) {
    this.sim = new MissionSim(def, seed);
    engine.setWorld({ boxes: this.sim.map.boxes, theme: def.theme, teamDecor: false });
    engine.vm.setTeam(0);
    this.view = new MissionView(this.sim, engine.proj.particles);
    engine.scene.add(this.view.group);
    this.hud = new MissionHud(def);
    this.hud.show(true);
    this.snapPrev();
    engine.input.yaw = def.start.yaw;
    engine.input.pitch = 0;
    engine.input.weapon = 0;
    music.play(def.music);
    this.handle(this.sim.drainEvents());
    // Dusk party lighting for the finale (skipped on low quality).
    if (def.theme === 'dusk' && engine.settings().quality !== 'low') {
      for (const [c, x, z] of [[COLORS.pink, -8, -6], [COLORS.turquoise, 8, 6], [COLORS.gold, -8, 6], [0x9a6ad0, 8, -6]] as const) {
        const l = new THREE.PointLight(c, 18, 18, 1.6);
        l.position.set(x, 6.2, z);
        this.view.group.add(l);
      }
    }
    // Compile every material now so the first throw or reveal never hitches.
    try { engine.renderer.compile(engine.scene, engine.camera); } catch { /* compiled lazily */ }
  }

  private snapPrev(): void {
    const p = this.sim.state.player;
    this.prev = { x: p.x, y: p.y, z: p.z };
  }

  // ------------------------------------------------------------ control

  retryCheckpoint(): void {
    this.sim.retryCheckpoint();
    this.afterReset();
  }

  restart(seed = 1): void {
    this.sim = new MissionSim(this.def, seed);
    // The view keys entities by id, so it can keep its meshes.
    (this.view as unknown as { sim: MissionSim }).sim = this.sim;
    this.afterReset();
    this.handle(this.sim.drainEvents());
  }

  private afterReset(): void {
    const p = this.sim.state.player;
    this.engine.input.yaw = p.yaw;
    this.engine.input.pitch = 0;
    this.engine.proj.clear();
    this.dialogue.reset();
    this.engine.hud.reset();
    this.hooks.ko(false);
    this.acc = 0;
    this.snapPrev();
    this.sim.drainEvents();
  }

  /** Hands control to the helper bot (automated tests and demos only). */
  enableAutopilot(seed = 7): void { this.autopilot = new MissionBot({ seed }); }

  /** Skips the victory presentation. */
  skipVictory(): void { if (this.victory) this.victory.t = 99; }

  get inVictory(): boolean { return !!this.victory; }

  // -------------------------------------------------------------- frame

  frame(dt: number): void {
    const e = this.engine;
    const st = this.sim.state;
    if (this.victory) { this.victoryFrame(dt); return; }
    if (!this.paused) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= DT && n++ < 6) {
        this.acc -= DT;
        this.snapPrev();
        const c = e.inputActive ? e.input.sample() : { mx: 0, mz: 0, jump: false, crouch: false, fire: false, weapon: e.input.weapon };
        let inp = { mx: c.mx, mz: c.mz, yaw: e.input.yaw, pitch: e.input.pitch, fire: c.fire, jump: c.jump, crouch: c.crouch, weapon: c.weapon };
        if (this.autopilot) {
          inp = this.autopilot.think(this.sim);
          e.input.yaw = inp.yaw; e.input.pitch = inp.pitch; e.input.weapon = inp.weapon;
        }
        const wasAlive = st.player.alive;
        this.sim.step(inp);
        if (!wasAlive && this.sim.state.player.alive) { e.input.yaw = this.sim.state.player.yaw; e.input.pitch = 0; }
        this.handle(this.sim.drainEvents());
        if (this.sim.state.complete) break;
      }
      if (this.acc > DT * 6) this.acc = 0;
    }
    const s = this.sim.state;
    const p = s.player;
    const settings = e.settings();
    const reduced = settings.reducedMotion;

    // Camera: interpolate between the last two ticks.
    const a = this.paused ? 1 : Math.min(1, this.acc / DT);
    const eh = p.crouched ? 0.98 : 1.58;
    const cam = e.camera;
    cam.position.set(this.prev.x + (p.x - this.prev.x) * a, this.prev.y + (p.y - this.prev.y) * a + eh, this.prev.z + (p.z - this.prev.z) * a);
    if (p.alive) cam.rotation.set(e.input.pitch, e.input.yaw, 0, 'YXZ');
    else cam.rotation.set(-0.6, e.input.yaw, 0.15, 'YXZ');
    this.shake = Math.max(0, this.shake - dt * 3.5);
    if (this.shake > 0 && !reduced) { cam.position.x += (Math.random() - 0.5) * this.shake * 0.05; cam.position.y += (Math.random() - 0.5) * this.shake * 0.05; }

    // Projectiles through the shared projectile view (Rosa's chanclas only).
    const map = new Map<string, ClientProjectile>();
    for (const pr of s.projs) {
      if (pr.hostile) continue;
      const id = `m${pr.id}`;
      map.set(id, { id, weapon: pr.weapon, pr, owner: 0, predicted: true, startAt: 0, endAt: Infinity, endPos: null, done: false, trail: [] });
    }
    e.proj.sync(map, 0, cam, this.paused ? 0 : dt);

    // What Rosa is carrying, held low on the left of the first-person view.
    const carried = p.carrying ? s.pickups.find((x) => x.id === p.carrying)?.item ?? null : null;
    if (carried !== this.carryItem) {
      if (this.carryObj) { this.carryObj.removeFromParent(); this.carryObj = null; }
      this.carryItem = carried;
      if (carried) {
        this.carryObj = this.view.buildCarried(carried);
        const sc = carried === 'chairs' ? 0.42 : 0.6;
        this.carryObj.scale.setScalar(sc);
        this.carryObj.position.set(-0.32, carried === 'chairs' ? -0.62 : -0.42, -0.78);
        this.carryObj.rotation.set(0.35, 0.4, 0);
        e.vmScene.add(this.carryObj);
      }
    }
    if (this.carryObj) this.carryObj.position.y += Math.sin(performance.now() / 160) * 0.0008 * speedNow(p);
    const speed = Math.hypot(p.vx, p.vz);
    e.vm.update({ weapon: p.weapon, cooldownMs: p.cooldownMs, switchMs: p.switchMs, speed, onGround: p.onGround, crouched: p.crouched, alive: p.alive, msSinceThrow: performance.now() - this.lastThrow }, dt, reduced);

    // Hints: refreshed a few times a second.
    if (--this.hintTick <= 0) {
      this.hintTick = 12;
      const hs = missionHints(this.sim);
      const actionable = hs.filter((h) => h.kind !== 'wait' && h.kind !== 'stay');
      const pool = actionable.length ? actionable : hs;
      this.focus = pool.sort((x, y) => dist(p, x) - dist(p, y))[0] ?? null;
    }
    const showHints = settings.campaignHints !== false;
    this.view.update(this.paused ? 0 : dt, cam, showHints ? this.focus?.id ?? null : null);
    const { w, h } = e.size;
    this.hud.update(this.sim, this.focus, showHints, cam, w, h, this.view);
    e.hud.update({
      hp: p.hp, alive: p.alive, weapon: p.weapon, cooldownMs: p.cooldownMs, switchMs: p.switchMs, respawnInMs: p.koMs, protectedMs: p.invulnMs,
      scores: [0, 0], timeLeftMs: 0, phase: 'campaign', countdownMs: 0, region: '', rtt: 0, quality: 'good', fps: e.fps, showStats: settings.showStats, practice: false, team: null,
    }, dt, e.input.yaw);
    e.hud.placeLabels(cam, w, h, [], dt);
    this.dialogue.update();

    // Low health nudge, once per dip.
    const low = p.alive && p.hp < 30;
    if (low && !this.wasLow) { this.dialogue.react('low'); audio.play('heartbeat'); }
    this.wasLow = low;

    // A spoken tip when nothing has moved forward for a while.
    if (showHints && !this.paused && s.timeMs - s.lastProgressMs > CAMPAIGN.hintAfterMs && s.timeMs - this.lastHintLine > CAMPAIGN.hintAfterMs && this.focus) {
      this.lastHintLine = s.timeMs;
      this.hud.tip(this.focus);
      if (this.focus.need === 'bank') this.dialogue.say('bank_hint');
      else if (this.focus.need === 'heavy') this.dialogue.say('heavy_hint');
    }
    music.setIntensity(this.intensity());
    // Mission 3: the courtyard brightens as each area is finished.
    const br = this.def.config?.brighten as { from: number; per: number; goals: string[] } | undefined;
    if (br) {
      const n = s.goals.filter((g) => g.done && br.goals.includes(g.id)).length + (this.sim.stageDef.id !== this.def.stages[0]!.id ? br.goals.length : 0);
      const k = Math.min(1.12, br.from + br.per * Math.min(n, br.goals.length));
      if (k !== this.brightness) { this.brightness = k; e.world.setBrightness(k); }
    }
  }
  private brightness = -1;
  private carryItem: string | null = null;
  private carryObj: THREE.Object3D | null = null;

  private intensity(): number {
    const s = this.sim.state;
    if (s.pinata && !s.pinata.defeated) return s.pinata.phase / 3;
    return s.hazards.length ? 0.8 : s.actors.some((a) => a.enabled && !a.done && (a.mode === 'chase' || a.mode === 'drive' || a.mode === 'windup')) ? 0.6 : 0.35;
  }

  // --------------------------------------------------------- events

  private handle(events: MEvent[]): void {
    const e = this.engine;
    const p = this.sim.state.player;
    const near = (x: number, z: number) => Math.max(0.2, 1.1 - Math.hypot(x - p.x, z - p.z) / 30);
    for (const ev of events) {
      this.eventLog.push(ev);
      if (this.eventLog.length > 2000) this.eventLog.shift();
      this.view.onEvent(ev);
      switch (ev.k) {
        case 'throw':
          if (!ev.hostile) { this.lastThrow = performance.now(); audio.play(ev.w === 1 ? 'throwHeavy' : 'throw'); }
          else audio.play('throw', near(ev.p[0], ev.p[2]) * 0.7);
          break;
        case 'bounce':
          audio.play('ricochet', near(ev.p[0], ev.p[2]));
          break;
        case 'pend':
          e.proj.impact(ev.w, ev.p, ev.hit);
          if (!ev.hostile) audio.play(ev.w === 1 ? 'heavyImpact' : 'thwap', near(ev.p[0], ev.p[2]));
          break;
        case 'miss':
          this.dialogue.react('miss');
          break;
        case 'hit': {
          e.hud.hitMarker('body');
          audio.play('hitConfirm');
          if (ev.bank) this.dialogue.react('ricochet');
          if (ev.what === 'actor') {
            const spec = this.sim.spec<ActorSpec>(ev.id);
            const line = spec ? ARCH_LINE[spec.archetype] : undefined;
            if (line === 'influ_hit') this.dialogue.react('influ_hit'); else if (line) this.dialogue.say(line);
          }
          if (ev.what === 'pinata' && ev.part?.startsWith('tip')) this.dialogue.say('pinata_hit');
          break;
        }
        case 'reject':
          audio.play('blocked');
          if (ev.why === 'bank') this.dialogue.say('bank_hint');
          else if (ev.why === 'heavy') this.dialogue.say('heavy_hint');
          else if (ev.why === 'timing') this.dialogue.say('timing_hint');
          else if (ev.why === 'dodge') this.dialogue.say('influ_dodge');
          break;
        case 'collect':
          audio.play('pickup');
          this.hud.pop();
          break;
        case 'carry': audio.play('catch'); break;
        case 'deliver': audio.play('legendary'); break;
        case 'spill': audio.play('splash'); this.dialogue.say('m2_spill'); break;
        case 'knocked': audio.play('bassDrop'); this.dialogue.say('m2_recover'); break;
        case 'drop': audio.play('land'); break;
        case 'goal': music.stinger('objective'); break;
        case 'stage': this.hud.stageChanged(); break;
        case 'checkpoint': this.hud.checkpoint(); break;
        case 'say': this.dialogue.say(ev.line); break;
        case 'hurt': {
          const angle = Math.atan2(-(ev.from[0] - p.x), -(ev.from[1] - p.z));
          e.hud.hurt(angle);
          audio.play('hurtFps', Math.min(1.4, 0.6 + ev.dmg / 40));
          this.shake = Math.min(1, this.shake + ev.dmg / 40);
          this.dialogue.react('hurt');
          break;
        }
        case 'ko': audio.play('died'); this.dialogue.say('ko1'); this.hooks.ko(true); break;
        case 'respawn': audio.play('spawn'); this.dialogue.react('respawn'); this.hooks.ko(false); break;
        case 'telegraph':
          if (ev.src.startsWith('blow')) this.dialogue.say('soplador_warn');
          this.dialogue.hold(ev.ms + 500);
          audio.play('telegraph');
          break;
        case 'actor':
          if (ev.mode === 'warn') { this.dialogue.say('bocinas_warn'); this.dialogue.hold(1500); audio.play('telegraph'); }
          if (ev.mode === 'film') this.dialogue.say('m2_influ');
          if (ev.mode === 'pose' && this.sim.state.actors.find((a) => a.id === ev.id)?.holds) audio.play('chargeReady', 0.6);
          break;
        case 'hazard': audio.play(ev.src === 'pinata' ? 'blast' : 'gust'); break;
        case 'scatter': this.dialogue.say('m3_scatter'); break;
        case 'setback': music.stinger('setback'); this.dialogue.say('m2_setback'); break;
        case 'segment': music.stinger('objective'); this.dialogue.say('m2_segment'); break;
        case 'flag': if (ev.on && ev.flag.endsWith('_off')) this.dialogue.say('m3_blower_off'); break;
        case 'phase':
          if (ev.n === 2) { this.dialogue.say('pinata_phase2'); this.dialogue.say('m4_phase2'); music.stinger('phase'); }
          if (ev.n === 3) { this.dialogue.say('pinata_phase3'); this.dialogue.say('m4_phase3'); music.stinger('phase'); }
          if (ev.n === 4) { audio.play('legendary'); this.dialogue.say('m4_final'); }
          break;
        case 'complete': this.startVictory(); break;
        default: break;
      }
    }
  }

  // ------------------------------------------------------- victory

  private startVictory(): void {
    if (this.victory || this.finished) return;
    const e = this.engine;
    const p = this.sim.state.player;
    const v = (this.def.config?.victory as { at: [number, number, number]; yaw: number } | undefined);
    const avatar = new Avatar(0, { home: true });
    const rul = this.sim.state.pickups.filter((x) => x.item === 'rulero' && x.state === 'collected').length;
    // Her hair: the recovered ruleros (mission 1), or the finished look after it.
    avatar.setRuleros(this.def.id === 'ruleros' ? rul : 0);
    const at = v?.at ?? [p.x, p.y, p.z];
    avatar.root.position.set(at[0], at[1], at[2]);
    avatar.root.rotation.y = v?.yaw ?? p.yaw;
    e.scene.add(avatar.root);
    const extras: THREE.Object3D[] = [];
    if (this.def.config?.finale) {
      // The gathering: neighbors and the reformed helpers at the party tables,
      // and a capped, short-lived scatter of wrapped candy.
      const guests: Array<[THREE.Object3D, number, number, number]> = [
        [buildInfluencer().root, -7.0, 3.4, Math.PI], [buildBocinas().root, 7.0, -3.4, 0], [buildSoplador().root, -1.0, -5.8, 0],
        [new Avatar(1).root, 1.0, 5.8, Math.PI], [new Avatar(0).root, -3.2, 1.8, 2.2],
      ];
      for (const [obj, x, z, ry] of guests) { toonify(obj); obj.position.set(x, 0, z); obj.rotation.y = ry; e.scene.add(obj); extras.push(obj); }
      const candyCols = [COLORS.pink, COLORS.turquoise, COLORS.gold, COLORS.marigold, 0x9a6ad0];
      for (let i = 0; i < 24; i++) {
        const c = new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.12, 3, 6), toon(candyCols[i % candyCols.length]!));
        const a = (i / 24) * Math.PI * 2;
        c.position.set(Math.cos(a) * 0.4, 5.3, Math.sin(a) * 0.4);
        c.userData.v = new THREE.Vector3(Math.cos(a) * (2 + (i % 5)), 3 + (i % 3), Math.sin(a) * (2 + (i % 5)));
        e.scene.add(c);
        extras.push(c);
      }
      e.world.setBrightness(1.15);
    }
    music.stinger('complete');
    audio.play('victory');
    this.victory = { t: 0, avatar, center: new THREE.Vector3(at[0], at[1] + 1.1, at[2]), result: this.sim.result(), extras };
    this.hud.victory(true);
    e.vm.root.visible = false;
  }

  private victoryFrame(dt: number): void {
    const v = this.victory!;
    const e = this.engine;
    v.t += dt;
    const reduced = e.settings().reducedMotion;
    const a = (reduced ? 0.6 : 0.6 + v.t * 0.45);
    const r = this.def.config?.finale ? 8.5 : 3.6;
    e.camera.position.set(v.center.x + Math.sin(a + v.avatar.root.rotation.y) * r, v.center.y + 0.5, v.center.z + Math.cos(a + v.avatar.root.rotation.y) * r);
    e.camera.lookAt(v.center);
    // Candy falls and settles, then is cleared (never something to collect).
    for (const o of v.extras) {
      const vel = o.userData.v as THREE.Vector3 | undefined;
      if (!vel) continue;
      if (o.position.y > 0.06) { vel.y -= 9.8 * dt; o.position.addScaledVector(vel, dt); o.rotation.x += dt * 6; }
      else { o.position.y = 0.06; vel.set(0, 0, 0); }
      o.visible = v.t < 5.8;
    }
    const cycle = (v.t * 1000) % 1600;
    v.avatar.update({ speed: 0, strafe: 0, back: 0, onGround: true, crouched: false, alive: true, protected: false, pitch: 0.2, weapon: 0, msSinceThrow: cycle < 420 ? cycle : 1e6, msSinceHit: 1e6, connected: true }, dt, reduced);
    this.view.update(dt, e.camera, null);
    e.proj.sync(new Map(), 0, e.camera, dt);
    e.vm.root.visible = false;
    this.dialogue.update();
    if (v.t > 6.5 && !this.finished) {
      this.finished = true;
      this.hooks.complete(v.result);
    }
  }

  dispose(): void {
    if (this.victory) {
      this.victory.avatar.root.removeFromParent(); this.victory.avatar.dispose();
      for (const o of this.victory.extras) o.removeFromParent();
    }
    if (this.carryObj) this.carryObj.removeFromParent();
    this.view.dispose();
    this.hud.show(false);
    this.dialogue.reset();
    this.engine.proj.clear();
    this.engine.vm.root.visible = true;
  }
}

function speedNow(p: { vx: number; vz: number }): number { return Math.hypot(p.vx, p.vz); }

function dist(p: { x: number; z: number }, h: MHint): number {
  const a = h.stand ?? h.pos;
  return Math.hypot(a[0] - p.x, a[2] - p.z);
}
