import * as THREE from 'three';
import { FixedLoop } from './core/loop';
import { ListenerBag, liveListenerCount } from './core/listeners';
import { activeLoopCount } from './core/loop';
import { Game, emptyInput, type RunResult } from './game/game';
import { InputManager } from './input/input';
import { TouchControls } from './ui/touch';
import { Hud } from './ui/hud';
import { Callouts } from './ui/callouts';
import { audio } from './audio/audio';
import { applyDom, formatNumber, getLang, onLangChange, quip, setLang, t } from './i18n/i18n';
import type { Lang, StringKey } from './i18n/strings';
import { SafeStorage, SettingsStore, ProgressStore, type Settings, type Quality } from './persistence/storage';
import { buildHand, type HandRig } from './models/hand';
import { buildSandal, GOLD_SKIN } from './models/sandal';
import { rosaSVG, svgUrl } from './ui/art';
import { copyText, downloadScoreCard, shareScore, shareText, shareUrl } from './ui/share';
import { PLAYER } from './config';
import { clamp, damp } from './core/math';

type AppState = 'title' | 'playing' | 'paused' | 'results';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

const QUALITY: Record<Quality, { pr: number; shadows: boolean; shadowSize: number; particles: number }> = {
  low: { pr: 1, shadows: false, shadowSize: 512, particles: 0.5 },
  medium: { pr: 1.5, shadows: true, shadowSize: 1024, particles: 1 },
  high: { pr: 2, shadows: true, shadowSize: 2048, particles: 1 },
};

export interface BootProgress {
  (pct: number, key: StringKey): Promise<void>;
}

export class App {
  readonly renderer: THREE.WebGLRenderer;
  readonly game: Game;
  readonly camera: THREE.PerspectiveCamera;
  readonly vmScene = new THREE.Scene();
  readonly vmCamera: THREE.PerspectiveCamera;
  readonly input: InputManager;
  readonly touch: TouchControls;
  readonly hud: Hud;
  readonly callouts: Callouts;
  readonly loop: FixedLoop;
  readonly storage: SafeStorage;
  readonly settings: SettingsStore;
  readonly progress: ProgressStore;
  state: AppState = 'title';
  private bag = new ListenerBag();
  private hand: HandRig;
  private heroSandal: THREE.Group;
  private goldHand: THREE.Group;
  private frame = emptyInput();
  private sample = emptyInput();
  private blank = emptyInput();
  private shake = 0;
  private fovPunch = 0;
  private throwAnim = 0;
  private bob = 0;
  private titleT = 0;
  private lastResult: RunResult | null = null;
  private lastWasBest = false;
  private sessionTutorialDone = false;
  private usingTouch = false;
  private contextLost = false;
  private settingsReturn: 'title' | 'pause' = 'title';
  private lastCanvasSize = '';
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private resultsTimer: ReturnType<typeof setTimeout> | null = null;
  private lastFocus: HTMLElement | null = null;
  runCount = 0;

  constructor(renderer: THREE.WebGLRenderer, game: Game, storage: SafeStorage, settings: SettingsStore, progress: ProgressStore) {
    this.renderer = renderer;
    this.game = game;
    this.storage = storage;
    this.settings = settings;
    this.progress = progress;
    const stage = $('stage');
    stage.appendChild(renderer.domElement);
    renderer.domElement.tabIndex = -1;
    renderer.info.autoReset = false;
    renderer.domElement.setAttribute('aria-hidden', 'true');

    this.camera = new THREE.PerspectiveCamera(74, 1, 0.08, 220);
    this.camera.rotation.order = 'YXZ';
    this.vmCamera = new THREE.PerspectiveCamera(62, 1, 0.01, 20);
    this.vmScene.add(new THREE.HemisphereLight(0xffe7c4, 0x7a4a5a, 2.2));
    const vmSun = new THREE.DirectionalLight(0xffd29a, 2.4);
    vmSun.position.set(-1, 2, 1.5);
    this.vmScene.add(vmSun);
    this.hand = buildHand();
    this.vmScene.add(this.hand.root);
    this.goldHand = buildSandal(GOLD_SKIN, true);
    this.goldHand.scale.setScalar(0.78);
    this.goldHand.position.copy(this.hand.sandal.position);
    this.goldHand.rotation.copy(this.hand.sandal.rotation);
    this.goldHand.visible = false;
    this.hand.arm.add(this.goldHand);
    this.heroSandal = buildSandal();
    this.heroSandal.scale.setScalar(5.2);
    this.vmScene.add(this.heroSandal);

    this.input = new InputManager(renderer.domElement);
    this.touch = new TouchControls(this.input);
    this.hud = new Hud();
    this.callouts = new Callouts($('callouts'));
    this.loop = new FixedLoop({
      begin: () => this.beginFrame(),
      step: (dt, first) => this.step(dt, first),
      render: (dt, alpha) => this.render(dt, alpha),
    });

    this.paintArt();
    this.bindUi();
    this.bindGame();
    this.bindSystem();
    this.applySettings(this.settings.value, true);
    this.detectTouch(matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0);
    this.resize();
    this.showTitle();
    this.loop.start();
  }

  // ---------- art ----------
  private paintArt(): void {
    $('rosa-portrait').innerHTML = rosaSVG('smirk');
  }

  // ---------- settings ----------
  applySettings(s: Settings, initial = false): void {
    if (s.lang !== getLang() || initial) setLang(s.lang);
    audio.setVolume(s.volume);
    audio.setMuted(s.muted);
    audio.setMusic(s.music);
    this.input.sensitivity = s.sensitivity;
    this.input.invertY = s.invertY;
    this.game.aimAssist = s.aimAssist;
    document.body.classList.toggle('reduced-motion', s.reducedMotion);
    this.callouts.reducedMotion = s.reducedMotion;
    this.game.hazards.reducedMotion = s.reducedMotion;
    const q = QUALITY[s.quality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pr));
    this.renderer.shadowMap.enabled = q.shadows;
    this.game.arena.setShadows(q.shadows, q.shadowSize);
    this.game.particles.density = q.particles;
    this.renderer.shadowMap.needsUpdate = true;
    this.lastCanvasSize = '';
    this.resize();
    this.syncSettingsUi();
    this.updateMuteButton();
  }

  private updateSettings(patch: Partial<Settings>): void {
    const s = this.settings.update(patch);
    this.applySettings(s);
  }

  private syncSettingsUi(): void {
    const s = this.settings.value;
    ($('set-volume') as HTMLInputElement).value = String(Math.round(s.volume * 100));
    ($('set-mute') as HTMLInputElement).checked = s.muted;
    ($('set-music') as HTMLInputElement).checked = s.music;
    ($('set-sens') as HTMLInputElement).value = String(Math.round(s.sensitivity * 100));
    $('out-sens').textContent = `${s.sensitivity.toFixed(2)}×`;
    ($('set-invert') as HTMLInputElement).checked = s.invertY;
    ($('set-assist') as HTMLInputElement).checked = s.aimAssist;
    ($('set-motion') as HTMLInputElement).checked = s.reducedMotion;
    ($('set-fps') as HTMLInputElement).checked = s.showFps;
    document.querySelectorAll<HTMLElement>('[data-lang]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.lang === s.lang)));
    document.querySelectorAll<HTMLElement>('[data-quality]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.quality === s.quality)));
  }

  private updateMuteButton(): void {
    const m = this.settings.value.muted;
    const b = $('btn-mute');
    b.textContent = m ? '🔇' : '🔊';
    b.setAttribute('aria-pressed', String(m));
    b.setAttribute('aria-label', t(m ? 'sound.off' : 'sound.on'));
  }

  // ---------- UI bindings ----------
  private click(id: string, fn: () => void, sound: 'ui' | 'uiBack' | null = 'ui'): void {
    this.bag.on($(id), 'click', () => {
      audio.unlock();
      if (sound) audio.play(sound);
      fn();
    });
  }

  private bindUi(): void {
    this.click('btn-play', () => this.play(!this.shouldTutorial()));
    this.click('btn-howto', () => {
      this.lastFocus = $('btn-howto');
      $('modal-howto').hidden = false;
      this.focusFirst('modal-howto');
    });
    this.click('btn-howto-close', () => this.closeHowto(), 'uiBack');
    this.click('btn-settings', () => this.openSettings('title'));
    this.click('btn-lang', () => this.updateSettings({ lang: getLang() === 'en' ? 'es' : 'en' }));
    this.click('btn-mute', () => this.updateSettings({ muted: !this.settings.value.muted }));
    this.click('btn-pause', () => this.pause(), 'uiBack');
    this.click('btn-resume', () => this.resume());
    this.click('btn-restart', () => this.restart());
    this.click('btn-pause-settings', () => this.openSettings('pause'));
    this.click('btn-to-title', () => this.toTitle(), 'uiBack');
    this.click('btn-skip-tutorial', () => this.game.skipTutorial());
    this.click('btn-again', () => this.restart());
    this.click('btn-results-title', () => this.toTitle(), 'uiBack');
    this.click('btn-share', () => void this.share());
    this.click('btn-copy', () => void this.copy());
    this.click('btn-download', () => void this.download());
    this.click('btn-settings-close', () => this.closeSettings(), 'uiBack');
    this.click('btn-reset', () => this.openConfirm());
    this.click('btn-confirm-no', () => this.closeConfirm(), 'uiBack');
    this.click('btn-confirm-yes', () => {
      this.progress.reset();
      this.sessionTutorialDone = false;
      this.closeConfirm();
      this.refreshBest();
      this.toast(t('settings.resetDone'));
    });
    this.click('btn-ctx-reload', () => location.reload());
    document.querySelectorAll<HTMLElement>('[data-lang]').forEach((b) => {
      this.bag.on(b, 'click', () => { audio.unlock(); audio.play('ui'); this.updateSettings({ lang: b.dataset.lang as Lang }); });
    });
    document.querySelectorAll<HTMLElement>('[data-quality]').forEach((b) => {
      this.bag.on(b, 'click', () => { audio.play('ui'); this.updateSettings({ quality: b.dataset.quality as Quality }); });
    });
    const range = (id: string, fn: (v: number) => void): void => {
      this.bag.on<Event>($(id), 'input', (e) => fn(Number((e.target as HTMLInputElement).value)));
    };
    range('set-volume', (v) => this.updateSettings({ volume: v / 100 }));
    range('set-sens', (v) => this.updateSettings({ sensitivity: v / 100 }));
    const check = (id: string, fn: (v: boolean) => void): void => {
      this.bag.on<Event>($(id), 'change', (e) => { audio.play('ui'); fn((e.target as HTMLInputElement).checked); });
    };
    check('set-mute', (v) => this.updateSettings({ muted: v }));
    check('set-music', (v) => this.updateSettings({ music: v }));
    check('set-invert', (v) => this.updateSettings({ invertY: v }));
    check('set-assist', (v) => this.updateSettings({ aimAssist: v }));
    check('set-motion', (v) => this.updateSettings({ reducedMotion: v }));
    check('set-fps', (v) => this.updateSettings({ showFps: v }));
    // Keep Tab inside whichever dialog is on top.
    this.bag.on<KeyboardEvent>(document, 'keydown', (e) => {
      if (e.key !== 'Tab') return;
      const open = ['modal-confirm', 'modal-settings', 'modal-howto', 'screen-results', 'screen-pause', 'screen-ctx']
        .map((id) => $(id))
        .find((el) => !el.hidden);
      if (!open) return;
      const items = Array.from(open.querySelectorAll<HTMLElement>('button, input, textarea, [tabindex]:not([tabindex="-1"])'))
        .filter((el) => !el.hidden && el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0]!, last = items[items.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || !open.contains(active))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (active === last || !open.contains(active))) { e.preventDefault(); first.focus(); }
    });
    // Escape closes dialogs.
    this.bag.on<KeyboardEvent>(window, 'keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!$('modal-howto').hidden) this.closeHowto();
      else if (!$('modal-confirm').hidden) this.closeConfirm();
      else if (!$('modal-settings').hidden) this.closeSettings();
      else if (this.state === 'paused' && $('modal-settings').hidden) { /* stay paused: Resume is explicit */ }
    });
    onLangChange(() => {
      applyDom(document);
      this.hud.invalidate();
      this.refreshBest();
      this.updateMuteButton();
      if (this.lastResult && this.state === 'results') this.fillResults(this.lastResult, this.lastWasBest);
    });
  }

  private shouldTutorial(): boolean {
    return !this.sessionTutorialDone && this.progress.value.runs === 0;
  }

  private bindSystem(): void {
    this.input.onPause = () => {
      if (this.state === 'playing') this.pause();
    };
    this.input.onTutorialSkip = () => this.game.skipTutorial();
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing' && !this.usingTouch) {
        this.pause();
        this.toast(t('toast.lockLost'));
      }
    };
    this.input.onLockError = () => {
      if (this.state === 'playing') this.toast(t('toast.lockFailed'));
    };
    this.bag.on(document, 'visibilitychange', () => {
      if (document.hidden) {
        this.input.clear();
        if (this.state === 'playing') this.pause();
        audio.suspend();
      } else if (this.state !== 'paused') {
        audio.resume();
      }
    });
    this.bag.on(window, 'blur', () => {
      this.input.clear();
      this.touch.reset();
    });
    this.bag.on(window, 'resize', () => this.resize());
    this.bag.on(window, 'orientationchange', () => setTimeout(() => this.resize(), 120));
    if (window.visualViewport) this.bag.on(window.visualViewport, 'resize', () => this.resize());
    this.bag.on<PointerEvent>(window, 'pointerdown', (e) => {
      if (e.pointerType === 'touch' && !this.usingTouch) this.detectTouch(true);
      else if (e.pointerType === 'mouse' && this.usingTouch) this.detectTouch(false);
    }, { capture: true });
    const canvas = this.renderer.domElement;
    this.bag.on(canvas, 'webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      if (this.state === 'playing') this.pause();
      $('screen-ctx').hidden = false;
    });
    this.bag.on(canvas, 'webglcontextrestored', () => {
      this.contextLost = false;
      $('screen-ctx').hidden = true;
      this.applySettings(this.settings.value);
    });
  }

  private detectTouch(on: boolean): void {
    this.usingTouch = on;
    this.input.usingTouch = on;
    this.hud.touch = on;
    document.body.classList.toggle('touch-mode', on);
    if (on && !this.settings.value.aimAssist && this.progress.value.runs === 0 && this.state === 'title') {
      // Aim assist on by default for first-time touch players.
      this.updateSettings({ aimAssist: true });
    }
    this.syncTouchVisibility();
  }

  private syncTouchVisibility(): void {
    const show = this.usingTouch && this.state === 'playing';
    $('touch').hidden = !show;
    $('rotate-hint').hidden = !(this.usingTouch && window.innerHeight > window.innerWidth && this.state === 'playing');
  }

  // ---------- game events -> audio, HUD, callouts ----------
  private bindGame(): void {
    const ev = this.game.events;
    ev.on('throw', (e) => {
      audio.play(e.golden ? 'throwGold' : e.charge >= 0.5 ? 'throwCharged' : 'throw');
      this.throwAnim = 1;
    });
    ev.on('emptyHand', () => audio.play('empty'));
    ev.on('hit', (e) => {
      if (e.kind === 'boss') audio.play('bossHit');
      audio.play(e.kill || e.bonuses.includes('charged') ? 'thwapBig' : 'thwap');
      if (e.kill && e.kind === 'enemy') audio.play('pratfall');
      this.hud.hitMarker(e.kill);
      if (e.points > 0) {
        const txt = e.multiplier > 1 ? `+${formatNumber(e.points)} ×${e.multiplier}` : `+${formatNumber(e.points)}`;
        this.callouts.spawn(txt, e.x, e.y + 0.2, e.z, 'points', 0.8, 1.2);
      }
    });
    ev.on('shout', (e) => this.callouts.spawn(e.text, e.x, e.y, e.z, e.tone, e.tone === 'kill' || e.tone === 'bonus' ? 1.1 : 0.85));
    ev.on('bounce', () => audio.play('ricochet'));
    ev.on('blocked', () => audio.play('blocked'));
    ev.on('land', () => audio.play('land'));
    ev.on('catch', () => audio.play('catch'));
    ev.on('recall', (e) => { if (e.count > 0) audio.play('recall'); });
    ev.on('splash', () => audio.play('splash'));
    ev.on('hurt', () => {
      audio.play('hurt');
      this.hud.hurt();
      if (!this.settings.value.reducedMotion) this.shake = Math.min(1, this.shake + 0.6);
    });
    ev.on('heal', () => audio.play('pickup'));
    ev.on('quip', (e) => {
      const q = quip(e.key);
      this.hud.showQuip(q.es, q.sub);
    });
    ev.on('speech', (e) => this.callouts.spawn(e.text, e.x, e.y, e.z, 'speech', 1.8, 0.15));
    ev.on('attack', (e) => {
      if (e.kind === 'heart') audio.play('heart');
      else if (e.kind === 'vinyl') audio.play('scratch');
      else audio.play('telegraph');
    });
    ev.on('hazardFire', (e) => {
      if (e.kind === 'ring') audio.play('bassDrop');
      else if (e.source === 'soplador') audio.play('gust');
      else audio.play('blast');
    });
    ev.on('legendary', (e) => {
      if (e.active) audio.play('legendary');
      this.hud.setGold(e.active);
    });
    ev.on('meterFull', () => {
      audio.play('meterFull');
      this.toast(t(this.usingTouch ? 'meter.tipTouch' : 'meter.tip'));
    });
    ev.on('wave', (e) => {
      if (e.state === 'intro') {
        audio.play('waveStart');
        const n = e.index + 1;
        this.hud.showBanner(t(`wave.${n}` as StringKey), t(`wave.${n}sub` as StringKey), 2.6);
      } else {
        audio.play('waveClear');
        this.hud.showBanner(t('wave.clear'), t('wave.clearSub'), 2.4);
      }
    });
    ev.on('bossState', (e) => {
      if (e.state === 'intro') {
        audio.setMusicMode('boss');
        this.hud.showBanner(t('boss.name'), `${t('boss.sub')} ${t('boss.tip')}`, 3.4);
      } else if (e.state === 'dying') {
        audio.setMusicMode('off');
      }
    });
    ev.on('tutorial', (e) => {
      this.hud.tutorialStep = e.step;
      if (e.step !== 'move') audio.play('meterFull');
      if (e.step === 'done') this.sessionTutorialDone = true;
    });
    ev.on('hitstop', (e) => {
      if (!this.settings.value.reducedMotion) {
        this.fovPunch = Math.min(1.5, this.fovPunch + e.strength * 0.6);
        this.shake = Math.min(1, this.shake + e.strength * 0.12);
      }
    });
    ev.on('phase', (e) => {
      if (e.phase === 'victory') { audio.setMusicMode('off'); audio.play('victory'); }
      if (e.phase === 'defeat') { audio.setMusicMode('off'); audio.play('defeat'); }
      if (e.phase === 'wave' && audio.musicMode !== 'game') audio.setMusicMode('game');
    });
    ev.on('runEnd', (r) => this.onRunEnd(r));
  }

  // ---------- state transitions ----------
  private hideAllScreens(): void {
    for (const id of ['screen-title', 'screen-pause', 'screen-results', 'modal-settings', 'modal-confirm', 'modal-howto']) $(id).hidden = true;
  }

  private focusFirst(id: string): void {
    const el = $(id).querySelector<HTMLElement>('button, input, [tabindex]');
    el?.focus({ preventScroll: true });
  }

  showTitle(): void {
    this.state = 'title';
    this.hideAllScreens();
    $('hud').hidden = true;
    $('screen-title').hidden = false;
    this.input.enabled = false;
    this.input.clear();
    this.input.exitLock();
    this.syncTouchVisibility();
    this.refreshBest();
    audio.setMusicMode('title');
    this.titleT = 0;
  }

  private refreshBest(): void {
    const best = this.progress.value.bestScore;
    $('title-best').textContent = best > 0 ? t('title.best', { score: formatNumber(best) }) : t('title.bestNone');
    $('title-storage').hidden = this.progress.persistent;
  }

  play(skipTutorial: boolean): void {
    audio.unlock();
    this.clearTimers();
    this.game.startRun(skipTutorial);
    this.enterPlaying();
    audio.setMusicMode(skipTutorial ? 'game' : 'title');
    this.runCount++;
    if (!this.storage.persistent && this.runCount === 1) this.toast(t('toast.storageOff'));
  }

  private enterPlaying(): void {
    this.hideAllScreens();
    (document.activeElement as HTMLElement | null)?.blur?.();
    this.renderer.domElement.focus({ preventScroll: true });
    $('hud').hidden = false;
    this.hud.reset();
    this.hud.tutorialStep = this.game.phase === 'tutorial' ? this.game.tutorial.step : null;
    this.callouts.clear();
    this.state = 'playing';
    this.input.clear();
    this.input.consume(this.frame);
    this.frame.cancelCharge = false;
    this.input.enabled = true;
    this.touch.reset();
    this.syncTouchVisibility();
    this.shake = 0;
    this.fovPunch = 0;
    if (!this.usingTouch) this.input.requestLock();
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.enabled = false;
    this.input.clear();
    this.touch.reset();
    this.input.exitLock();
    $('screen-pause').hidden = false;
    $('pause-lock-note').hidden = this.usingTouch;
    this.syncTouchVisibility();
    audio.suspend();
    this.focusFirst('screen-pause');
  }

  resume(): void {
    if (this.state !== 'paused' || this.contextLost) return;
    $('screen-pause').hidden = true;
    $('modal-settings').hidden = true;
    this.state = 'playing';
    this.input.clear();
    this.input.enabled = true;
    (document.activeElement as HTMLElement | null)?.blur?.();
    this.syncTouchVisibility();
    audio.resume();
    if (!this.usingTouch) this.input.requestLock();
  }

  restart(): void {
    audio.unlock();
    this.clearTimers();
    this.game.startRun(true);
    this.enterPlaying();
    audio.setMusicMode('game');
  }

  toTitle(): void {
    this.clearTimers();
    this.game.toTitle();
    this.callouts.clear();
    this.hud.reset();
    this.showTitle();
    this.focusFirst('screen-title');
  }

  private clearTimers(): void {
    if (this.resultsTimer) { clearTimeout(this.resultsTimer); this.resultsTimer = null; }
  }

  private openSettings(from: 'title' | 'pause'): void {
    this.settingsReturn = from;
    this.lastFocus = document.activeElement as HTMLElement | null;
    this.syncSettingsUi();
    $('modal-settings').hidden = false;
    if (from === 'pause') $('screen-pause').hidden = true;
    this.focusFirst('modal-settings');
  }

  private closeSettings(): void {
    $('modal-settings').hidden = true;
    if (this.settingsReturn === 'pause' && this.state === 'paused') {
      $('screen-pause').hidden = false;
      this.focusFirst('screen-pause');
    } else {
      this.lastFocus?.focus?.();
    }
  }

  private closeHowto(): void {
    $('modal-howto').hidden = true;
    $('btn-howto').focus();
  }

  private openConfirm(): void {
    $('modal-confirm').hidden = false;
    $('btn-confirm-no').focus();
  }

  private closeConfirm(): void {
    $('modal-confirm').hidden = true;
    $('btn-reset').focus();
  }

  private onRunEnd(r: RunResult): void {
    const best = this.progress.record({ score: r.score, bestCombo: r.bestCombo, accuracy: r.accuracy, victory: r.victory });
    this.sessionTutorialDone = true;
    this.lastResult = r;
    this.lastWasBest = best;
    // Leave the playing state first so releasing the pointer lock below is
    // not mistaken for the player pausing.
    this.state = 'results';
    this.input.enabled = false;
    this.input.clear();
    this.touch.reset();
    this.input.exitLock();
    this.syncTouchVisibility();
    this.resultsTimer = setTimeout(() => {
      this.resultsTimer = null;
      this.syncTouchVisibility();
      this.fillResults(r, best);
      $('screen-results').hidden = false;
      $('share-fallback').hidden = true;
      this.focusFirst('screen-results');
    }, 900);
  }

  private fillResults(r: RunResult, isBest: boolean): void {
    $('results-title').textContent = t(r.victory ? 'results.victory' : 'results.defeat');
    $('results-sub').textContent = t(r.victory ? 'results.victorySub' : 'results.defeatSub');
    $('results-face').style.backgroundImage = svgUrl(rosaSVG(r.victory ? 'happy' : 'sad', 'face'));
    $('r-score').textContent = formatNumber(r.score);
    $('r-combo').textContent = String(r.bestCombo);
    $('r-acc').textContent = `${Math.round(r.accuracy * 100)}%`;
    $('r-rico').textContent = String(r.ricochetHits);
    const m = Math.floor(r.time / 60), s = Math.floor(r.time % 60);
    $('r-time').textContent = `${m}:${String(s).padStart(2, '0')}`;
    $('r-wave').textContent = r.victory || r.reached >= 3 ? t('results.reachedBoss') : t('results.reachedWave', { n: r.reached + 1 });
    $('r-best').textContent = formatNumber(this.progress.value.bestScore);
    $('r-best-note').textContent = this.progress.persistent ? `(${t('results.savedNote')})` : `(${t('results.notSavedNote')})`;
    $('new-best').hidden = !isBest;
    $('btn-share').hidden = false;
  }

  private async share(): Promise<void> {
    if (!this.lastResult) return;
    const out = await shareScore(this.lastResult);
    if (out === 'shared') this.toast(t('share.shared'));
    else if (out === 'copied') this.toast(t('share.copied'));
    else if (out === 'manual') this.showManualShare();
  }

  private async copy(): Promise<void> {
    if (!this.lastResult) return;
    const out = await copyText(`${shareText(this.lastResult)} ${shareUrl()}`);
    if (out === 'copied') this.toast(t('share.copied'));
    else this.showManualShare();
  }

  private showManualShare(): void {
    if (!this.lastResult) return;
    const ta = $('share-fallback') as HTMLTextAreaElement;
    ta.value = `${shareText(this.lastResult)} ${shareUrl()}`;
    ta.hidden = false;
    ta.focus();
    ta.select();
    this.toast(t('share.copyFailed'));
  }

  private async download(): Promise<void> {
    if (!this.lastResult) return;
    try {
      const ok = await downloadScoreCard(this.lastResult, this.progress.value.bestScore);
      if (ok) this.toast(t('share.downloaded'));
    } catch {
      this.toast(t('share.copyFailed'));
    }
  }

  toast(msg: string, ms = 2600): void {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      el.hidden = true;
      this.toastTimer = null;
    }, ms);
  }

  // ---------- frame ----------
  private step(dt: number, _first: boolean): void {
    if (this.contextLost) return;
    if (this.state === 'playing') {
      this.game.update(dt, this.frame);
      const p = this.frame;
      p.throwDown = p.throwUp = p.recall = p.special = p.cancelCharge = false;
    } else if (this.state === 'title' || this.state === 'results') {
      // Ambient animation (and the end-of-run beat) keep the world alive behind menus.
      this.game.update(dt, this.blank);
    }
  }

  // Input is sampled once per frame, before the simulation steps. Edges
  // (press, release, recall, special) stay latched until a simulation step
  // actually consumes them, so a click is never lost on a frame that runs
  // zero steps (high refresh displays) or several.
  private beginFrame(): void {
    if (this.state !== 'playing') return;
    this.input.tick();
    const f = this.input.consume(this.sample);
    const p = this.frame;
    p.moveX = f.moveX;
    p.moveZ = f.moveZ;
    p.throwHeld = f.throwHeld;
    p.throwDown ||= f.throwDown;
    p.throwUp ||= f.throwUp;
    p.recall ||= f.recall;
    p.special ||= f.special;
    p.cancelCharge ||= f.cancelCharge;
    const look = this.input.consumeLook();
    if (this.game.player.alive) this.game.player.look(look.dx, look.dy);
  }

  private render(frameDt: number, alpha: number): void {
    if (this.contextLost) return;
    this.resizeIfNeeded();
    const w = this.renderer.domElement.clientWidth, h = this.renderer.domElement.clientHeight;
    this.updateCamera(frameDt);
    this.game.chanclas.render(frameDt, this.camera, this.state === 'playing' ? alpha : 1);
    this.updateViewmodel(frameDt);
    this.renderer.info.reset();
    this.renderer.autoClear = true;
    this.renderer.render(this.game.scene, this.camera);
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    this.renderer.render(this.vmScene, this.vmCamera);
    if (this.state === 'playing' || this.state === 'paused' || this.state === 'results') {
      this.callouts.update(this.state === 'paused' ? 0 : frameDt, this.camera, w, h);
      if (this.state === 'playing') this.hud.update(frameDt, this.game, this.loop.fps, this.settings.value.showFps);
    }
  }

  private updateCamera(dt: number): void {
    const cam = this.camera;
    const reduced = this.settings.value.reducedMotion;
    if (this.state === 'title') {
      this.titleT += dt;
      const a = this.titleT * 0.05 + 0.6;
      cam.position.set(Math.sin(a) * 15, 4.2, Math.cos(a) * 15);
      cam.lookAt(0, 2.6, 0);
      cam.fov = 60;
      cam.updateProjectionMatrix();
      return;
    }
    const p = this.game.player;
    const moving = Math.hypot(p.vel.x, p.vel.z) > 0.5 && this.state === 'playing';
    if (moving && !reduced) this.bob += dt * 9;
    const bobY = reduced ? 0 : Math.sin(this.bob) * 0.04 * (moving ? 1 : 0);
    let eyeY = PLAYER.eye + bobY;
    let roll = 0;
    if (!p.alive) {
      // Rosa sits down hard.
      eyeY = PLAYER.eye - 0.8;
      roll = reduced ? 0 : 0.25;
    }
    cam.position.set(p.pos.x, eyeY, p.pos.z);
    cam.rotation.set(p.pitch, p.yaw, roll);
    if (this.shake > 0 && !reduced) {
      const s = this.shake * 0.05;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.rotation.z += (Math.random() - 0.5) * s * 0.5;
    }
    this.shake = Math.max(0, this.shake - dt * 3.5);
    this.fovPunch = Math.max(0, this.fovPunch - dt * 6);
    const targetFov = 74 + this.fovPunch * 1.6 + (this.game.legendaryActive && !reduced ? 4 : 0);
    if (Math.abs(cam.fov - targetFov) > 0.01) {
      cam.fov = damp(cam.fov, targetFov, 12, dt);
      cam.updateProjectionMatrix();
    }
  }

  private updateViewmodel(dt: number): void {
    const inGame = this.state !== 'title';
    this.hand.root.visible = inGame && this.game.player.alive;
    this.heroSandal.visible = !inGame;
    if (!inGame) {
      const fov = THREE.MathUtils.degToRad(this.vmCamera.fov);
      const dist = 3.2;
      const halfH = Math.tan(fov / 2) * dist;
      const halfW = halfH * this.vmCamera.aspect;
      const narrow = this.vmCamera.aspect < 1.15 || window.innerWidth < 560;
      this.heroSandal.position.set(narrow ? halfW * 0.5 : halfW * 0.22, narrow ? halfH * 0.5 : halfH * 0.5, -dist);
      this.heroSandal.scale.setScalar(narrow ? 2.6 : 3.6);
      this.heroSandal.rotation.set(0.9 + Math.sin(this.titleT * 0.8) * 0.15, this.titleT * 1.4, 0.35);
      return;
    }
    const held = this.game.chanclas.heldCount();
    const gold = this.game.legendaryActive;
    this.hand.sandal.visible = held > 0 && !gold;
    this.goldHand.visible = gold;
    this.hand.leftHand.visible = held > 1 && !gold;
    const charge = this.game.chargeAmount;
    this.throwAnim = Math.max(0, this.throwAnim - dt * 6);
    const reduced = this.settings.value.reducedMotion;
    const moving = Math.hypot(this.game.player.vel.x, this.game.player.vel.z) > 0.5;
    const sway = reduced ? 0 : Math.sin(this.bob) * 0.012 * (moving ? 1 : 0);
    const k = this.throwAnim;
    const arm = this.hand.root;
    arm.position.set(0.36 + sway, -0.36 + Math.abs(sway) * 0.6 - charge * 0.03 + k * 0.08, -0.62 + charge * 0.14 - k * 0.22);
    arm.rotation.set(0.15 + charge * 0.55 - k * 0.9, -0.1 + charge * 0.1, -0.08 + (charge > 0 && !reduced ? Math.sin(performance.now() * 0.05) * 0.02 * charge : 0));
    this.hand.leftHand.position.set(-0.66, -0.16, 0.0);
    this.hand.leftHand.rotation.set(0.25, 0.35, 0.25);
    if (gold) this.goldHand.rotation.z = performance.now() * 0.004;
  }

  private resizeIfNeeded(): void {
    const c = this.renderer.domElement.parentElement!;
    const key = `${c.clientWidth}x${c.clientHeight}x${window.devicePixelRatio}`;
    if (key !== this.lastCanvasSize) this.resize();
  }

  resize(): void {
    const c = this.renderer.domElement.parentElement;
    if (!c) return;
    const w = Math.max(1, c.clientWidth || window.innerWidth);
    const h = Math.max(1, c.clientHeight || window.innerHeight);
    this.lastCanvasSize = `${c.clientWidth}x${c.clientHeight}x${window.devicePixelRatio}`;
    const q = QUALITY[this.settings.value.quality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pr));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = w / h;
    this.vmCamera.updateProjectionMatrix();
    this.syncTouchVisibility();
  }

  // Verification hooks for automated checks.
  debugSnapshot(): Record<string, unknown> {
    return {
      state: this.state,
      phase: this.game.phase,
      loops: activeLoopCount(),
      listeners: liveListenerCount(),
      audioVoices: audio.voices,
      audioContexts: audio.contextCount,
      musicTimer: audio.musicTimerRunning,
      callouts: this.callouts.activeCount,
      heldInputs: this.input.heldKeys,
      lock: this.input.lock,
      touch: this.usingTouch,
      fps: Math.round(this.loop.fps),
      score: this.game.scoring.score,
      hp: this.game.player.hp,
      wave: this.game.director.index,
      bossHp: this.game.boss.hp,
      ...this.game.debugCounts(),
    };
  }

  setPaused(p: boolean): void {
    if (p) this.pause();
    else this.resume();
  }

  clampSensitivity(v: number): number {
    return clamp(v, 0.2, 3);
  }
}
