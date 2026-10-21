import { t, formatNumber } from '../i18n/i18n';
import type { StringKey } from '../i18n/strings';
import type { Game } from '../game/game';
import { BOSS_MAX_HP } from '../game/boss';
import { SCORE, PLAYER } from '../config';
import { chanclaSVG, rosaSVG, svgUrl } from './art';
import type { TutorialStep } from '../game/tutorial';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

// Heads-up display. Writes to the DOM only when a value changes.
export class Hud {
  private el = {
    root: $('hud'),
    hpMeter: $('hp-meter'), hpFill: $('hp-fill'), hpNum: $('hp-num'),
    slots: Array.from(document.querySelectorAll<HTMLElement>('#ammo .slot')),
    waveLabel: $('wave-label'),
    boss: $('boss-panel'), bossFill: $('boss-fill'), bossState: $('boss-state'),
    tutorial: $('tutorial'), tutorialText: $('tutorial-text'),
    score: $('score'), combo: $('combo'), mult: $('mult'), comboN: $('combo-n'), comboTimer: $('combo-timer'),
    fps: $('fps'),
    crosshair: $('crosshair'), ring: $('charge-ring'), hitmarker: $('hitmarker'),
    meter: $('meter'), meterFill: $('meter-fill'), meterHint: $('meter-hint'),
    quip: $('quip'), quipEs: $('quip-es'), quipSub: $('quip-sub'),
    banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
    vigHurt: $('vig-hurt'), vigGold: $('vig-gold'),
  };
  private cache = new Map<string, string>();
  private quipTimer = 0;
  private bannerTimer = 0;
  private hitTimer = 0;
  private hurtTimer = 0;
  tutorialStep: TutorialStep | null = null;
  bossOpen = false;
  touch = false;

  constructor() {
    const face = svgUrl(rosaSVG('smirk', 'face'));
    document.querySelectorAll<HTMLElement>('.hp-face, .quip-face').forEach((e) => (e.style.backgroundImage = face));
    const ch = svgUrl(chanclaSVG(-15));
    this.el.slots.forEach((s) => (s.style.backgroundImage = ch));
    const tc = document.querySelector<HTMLElement>('.tbtn-chancla');
    if (tc) tc.style.backgroundImage = svgUrl(chanclaSVG(-35));
  }

  private set(key: string, value: string, apply: () => void): void {
    if (this.cache.get(key) === value) return;
    this.cache.set(key, value);
    apply();
  }

  invalidate(): void {
    this.cache.clear();
  }

  reset(): void {
    this.invalidate();
    this.quipTimer = 0;
    this.bannerTimer = 0;
    this.hurtTimer = 0;
    this.el.quip.hidden = true;
    this.el.banner.hidden = true;
    this.el.vigHurt.classList.remove('on');
    this.el.vigGold.classList.remove('on');
    this.el.hitmarker.classList.remove('on', 'kill');
    this.tutorialStep = null;
    this.bossOpen = false;
  }

  showQuip(es: string, sub: string, seconds = 3.2): void {
    this.el.quipEs.textContent = es;
    this.el.quipSub.textContent = sub;
    this.el.quip.hidden = false;
    // Restart the entrance animation.
    this.el.quip.style.animation = 'none';
    void this.el.quip.offsetWidth;
    this.el.quip.style.animation = '';
    this.quipTimer = seconds;
  }

  showBanner(title: string, sub: string, seconds = 2.6): void {
    this.el.bannerTitle.textContent = title;
    this.el.bannerSub.textContent = sub;
    this.el.banner.hidden = false;
    this.el.banner.style.animation = 'none';
    void this.el.banner.offsetWidth;
    this.el.banner.style.animation = '';
    this.bannerTimer = seconds;
  }

  hitMarker(kill: boolean): void {
    const h = this.el.hitmarker;
    h.classList.remove('on');
    h.classList.toggle('kill', kill);
    void (h as unknown as SVGGElement).getBoundingClientRect();
    h.classList.add('on');
    this.hitTimer = 0.22;
  }

  hurt(): void {
    this.el.vigHurt.classList.add('on');
    this.hurtTimer = 0.18;
  }

  setGold(on: boolean): void {
    this.el.vigGold.classList.toggle('on', on);
  }

  update(dt: number, game: Game, fps: number, showFps: boolean): void {
    if (this.quipTimer > 0 && (this.quipTimer -= dt) <= 0) this.el.quip.hidden = true;
    if (this.bannerTimer > 0 && (this.bannerTimer -= dt) <= 0) this.el.banner.hidden = true;
    if (this.hitTimer > 0 && (this.hitTimer -= dt) <= 0) this.el.hitmarker.classList.remove('on');
    if (this.hurtTimer > 0 && (this.hurtTimer -= dt) <= 0) this.el.vigHurt.classList.remove('on');

    const hp = Math.ceil(game.player.hp);
    this.set('hp', String(hp), () => {
      this.el.hpFill.style.width = `${(hp / PLAYER.maxHp) * 100}%`;
      this.el.hpNum.textContent = String(hp);
      this.el.hpMeter.setAttribute('aria-valuenow', String(hp));
      this.el.hpMeter.classList.toggle('low', hp <= 30);
    });

    game.chanclas.real.forEach((c, i) => {
      const st = c.state === 'held' ? 'ready' : c.state === 'flying' ? 'flying' : 'returning';
      this.set(`slot${i}`, st, () => {
        const s = this.el.slots[i];
        if (!s) return;
        s.className = `slot ${st}`;
        const key: StringKey = st === 'ready' ? 'hud.chanclaReady' : st === 'flying' ? 'hud.chanclaFlying' : 'hud.chanclaReturning';
        s.setAttribute('aria-label', t(key));
        s.setAttribute('role', 'img');
      });
    });
    this.set('empty', String(game.chanclas.heldCount() === 0 && !game.legendaryActive), () => {
      this.el.crosshair.classList.toggle('empty', game.chanclas.heldCount() === 0 && !game.legendaryActive);
    });

    const sc = game.scoring;
    this.set('score', String(sc.score), () => (this.el.score.textContent = formatNumber(sc.score)));
    const comboOn = sc.combo >= 2;
    this.set('comboOn', String(comboOn), () => (this.el.combo.hidden = !comboOn));
    if (comboOn) {
      this.set('mult', String(sc.multiplier), () => (this.el.mult.textContent = `x${sc.multiplier}`));
      this.set('comboN', String(sc.combo), () => (this.el.comboN.textContent = `${t('hud.combo')} ${sc.combo}`));
      this.el.comboTimer.style.width = `${Math.max(0, (sc.comboTimer / SCORE.comboWindow) * 100).toFixed(1)}%`;
    }

    const charge = game.chargeAmount;
    const ringOff = 163.4 * (1 - (game.charging ? Math.max(0.04, charge) : 0));
    this.set('ring', ringOff.toFixed(1), () => {
      this.el.ring.style.strokeDashoffset = ringOff.toFixed(1);
      this.el.ring.classList.toggle('full', charge >= 1);
    });

    const meterPct = game.legendaryActive ? (game.legendaryT / 6) * 100 : game.meter * 100;
    this.set('meter', meterPct.toFixed(0), () => {
      this.el.meterFill.style.width = `${meterPct.toFixed(0)}%`;
      this.el.meter.setAttribute('aria-valuenow', meterPct.toFixed(0));
    });
    const meterState = game.legendaryActive ? 'active' : game.meter >= 1 ? 'full' : 'charging';
    this.set('meterState', meterState + this.touch, () => {
      this.el.meter.classList.toggle('full', meterState === 'full');
      this.el.meter.classList.toggle('active', meterState === 'active');
      this.el.meterHint.textContent = meterState === 'full' ? t(this.touch ? 'hud.meterReadyTouch' : 'hud.meterReady') : '';
      document.getElementById('t-special')?.classList.toggle('ready', meterState === 'full');
    });

    // Top centre: tutorial prompt, wave label or boss bar.
    const phase = game.phase;
    this.set('phase', phase, () => {
      this.el.boss.hidden = phase !== 'boss';
      this.el.tutorial.hidden = phase !== 'tutorial';
    });
    let label = '';
    if (phase === 'wave') label = t('hud.wave', { n: game.director.index + 1 });
    this.set('waveLabel', label, () => (this.el.waveLabel.textContent = label));
    if (phase === 'tutorial' && this.tutorialStep) {
      const step = this.tutorialStep;
      const key = (`tutorial.${step}${this.touch && step !== 'done' ? 'Touch' : ''}`) as StringKey;
      const text = t(key);
      this.set('tut', text, () => (this.el.tutorialText.textContent = text));
    }
    if (phase === 'boss') {
      const pct = (game.boss.hp / BOSS_MAX_HP) * 100;
      this.set('bossHp', pct.toFixed(1), () => (this.el.bossFill.style.width = `${pct}%`));
      const open = game.boss.state === 'vulnerable';
      const txt = open ? t('boss.open') : t('boss.shield');
      this.set('bossState', txt, () => {
        this.el.bossState.textContent = txt;
        this.el.boss.classList.toggle('open', open);
      });
    }
    this.set('fpsOn', String(showFps), () => (this.el.fps.hidden = !showFps));
    if (showFps) this.set('fps', String(Math.round(fps)), () => (this.el.fps.textContent = t('fps', { fps: Math.round(fps) })));
  }
}
