// Campaign screens: mission select, intro, in-mission pause actions,
// results. The mission code itself (runtime, view, missions) is loaded
// only when a mission starts.
import { MISSIONS } from '../../shared/campaign/missions';
import type { MissionDef } from '../../shared/campaign/types';
import type { MissionResult } from '../../shared/campaign/mission';
import { CampaignProgress } from './progress';
import { t, type Key } from '../fps/strings';
import { rosaSVG, svgUrl } from '../ui/art';
import { audio } from '../audio/audio';
import { music } from '../audio/music';
import { LINES } from '../audio/lines';
import type { Dialogue } from '../audio/dialogue';
import type { Engine } from '../fps/engine';
import type { FpsInput } from '../fps/input';
import type { SafeStorage } from '../persistence/storage';
import type { MissionRuntime } from './runtime';

const $ = (id: string) => document.getElementById(id) as HTMLElement;

export interface UiCtx {
  engine(): Engine | null;
  input(): FpsInput | null;
  dialogue: Dialogue;
  base: string;
  show(id: string): void;
  confirm(title: string, body: string, yes: string, action: () => void): void;
  toast(text: string, ms?: number): void;
  setActive(on: boolean): void; // the page treats a mission like a match (HUD, pointer lock)
  render(): void;
  baseUrl: string;
}

export function fmtTime(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export class CampaignUi {
  readonly progress: CampaignProgress;
  runtime: MissionRuntime | null = null;
  private current: MissionDef | null = null;
  private loadingMod: Promise<typeof import('./runtime')> | null = null;
  private skipBound = false;

  constructor(private ctx: UiCtx, storage: SafeStorage) {
    this.progress = new CampaignProgress(storage);
    this.bind();
  }

  get active(): boolean { return !!this.runtime; }

  // ---------------------------------------------------- mission select

  openSelect(): void {
    this.renderSelect();
    this.ctx.show('campaign');
    music.play('select');
  }

  renderSelect(): void {
    $('camp-storage').hidden = this.progress.persistent;
    $('camp-all').hidden = !this.progress.allDone;
    const cards = MISSIONS.map((m, i) => {
      const rec = this.progress.get(m.id);
      const open = this.progress.unlocked(m.id);
      const card = document.createElement('article');
      card.className = `mcard${open ? '' : ' locked'}${rec.completed ? ' done' : ''}`;
      card.dataset.mission = m.id;
      const n = document.createElement('span'); n.className = 'n'; n.textContent = t('camp.mission', { n: i + 1 });
      const h = document.createElement('h3'); h.textContent = t(m.title as Key);
      const p = document.createElement('p'); p.textContent = t(m.premise as Key);
      const obj = document.createElement('p'); obj.innerHTML = ''; const ob = document.createElement('b'); ob.textContent = `${t('camp.objective')}: `; obj.append(ob, document.createTextNode(t(m.objective as Key)));
      const meta = document.createElement('div'); meta.className = 'meta';
      const dur = document.createElement('span'); dur.textContent = t('camp.duration', { a: m.minutes[0], b: m.minutes[1] });
      const best = document.createElement('span'); best.textContent = rec.bestMs ? t('camp.best', { time: fmtTime(rec.bestMs) }) : rec.completed ? t('camp.done') : t('camp.noBest');
      const stars = document.createElement('span'); stars.className = 'stars';
      const got = [rec.challenges.complete, rec.challenges.time, rec.challenges.skill];
      stars.textContent = got.map((g) => (g ? '★' : '☆')).join('');
      stars.setAttribute('aria-label', `${got.filter(Boolean).length}/3 ${t('camp.challenges')}`);
      meta.append(dur, best, stars);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `btn ${open ? 'primary' : ''}`;
      btn.textContent = open ? (rec.completed ? t('camp.replay') : t('camp.play')) : t('camp.locked');
      btn.disabled = !open;
      btn.addEventListener('click', () => { audio.unlock(); audio.play('ui'); this.openIntro(m); });
      card.append(n, h, p, obj, meta, btn);
      return card;
    });
    $('camp-missions').replaceChildren(...cards);
  }

  // ------------------------------------------------------------ intro

  openIntro(m: MissionDef): void {
    this.current = m;
    const i = MISSIONS.indexOf(m);
    $('mi-num').textContent = t('camp.mission', { n: i + 1 });
    $('mi-title').textContent = t(m.title as Key);
    $('mi-premise').textContent = t(m.premise as Key);
    $('mi-objective').textContent = t(m.objective as Key);
    $('mi-est').textContent = t('mi.est', { a: m.minutes[0], b: m.minutes[1] });
    this.renderChallenges($('mi-ch'), m, this.progress.get(m.id).challenges, []);
    $('mi-status').textContent = '';
    ($('btn-mi-start') as HTMLButtonElement).disabled = false;
    this.ctx.show('mintro');
    // Warm the mission code, its music and its voice lines while the player reads.
    this.loadingMod ??= import('./runtime');
    music.preload(m.music);
    void this.ctx.dialogue.loadManifest(this.ctx.baseUrl).then(() => this.ctx.dialogue.preload(linesFor(m)));
  }

  private renderChallenges(ul: HTMLElement, m: MissionDef, got: { complete: boolean; time: boolean; skill: boolean }, fresh: string[]): void {
    const rows = m.challenges.map((c) => {
      const li = document.createElement('li');
      li.className = got[c.id] ? 'got' : '';
      li.textContent = c.id === 'time' ? t('ch.time', { time: fmtTime(m.timeTargetMs) }) : t(c.label as Key);
      if (fresh.includes(c.id)) { const s = document.createElement('span'); s.className = 'new'; s.textContent = t('mr.earned'); li.appendChild(s); }
      return li;
    });
    ul.replaceChildren(...rows);
  }

  async start(m: MissionDef = this.current!): Promise<void> {
    const engine = this.ctx.engine();
    if (!engine) return;
    $('mi-status').textContent = t('mi.loading');
    ($('btn-mi-start') as HTMLButtonElement).disabled = true;
    let mod: typeof import('./runtime');
    try {
      mod = await (this.loadingMod ??= import('./runtime'));
    } catch {
      // A failed chunk load leaves the menus usable; offer to try again.
      this.loadingMod = null;
      $('mi-status').textContent = t('lost.generic');
      ($('btn-mi-start') as HTMLButtonElement).disabled = false;
      return;
    }
    if (this.ctx.dialogue.voiceFailed) this.ctx.toast(t('mi.voiceFail'), 4000);
    this.stopRuntime();
    this.current = m;
    this.progress.started(m.id);
    const rt = new mod.MissionRuntime(engine, m, this.ctx.dialogue, {
      complete: (res) => this.finished(res),
      ko: (on) => { $('m-ko').hidden = !on; },
    });
    this.runtime = rt;
    engine.enterController(rt);
    this.ctx.setActive(true);
    this.ctx.show('none');
    this.ctx.input()?.requestLock();
  }

  private stopRuntime(): void {
    if (!this.runtime) return;
    this.runtime = null;
    this.ctx.engine()?.enterMenu();
    $('m-ko').hidden = true;
    $('m-skip').hidden = true;
  }

  // ------------------------------------------------- pause actions

  setPaused(p: boolean): void {
    if (this.runtime) this.runtime.paused = p;
  }

  retryCheckpoint(): void {
    this.runtime?.retryCheckpoint();
    this.ctx.show('none');
    this.ctx.input()?.requestLock();
  }

  restart(): void {
    this.ctx.confirm(t('confirm.restartTitle'), t('confirm.restartBody'), t('confirm.restartYes'), () => {
      this.runtime?.restart();
      this.ctx.show('none');
      this.ctx.input()?.requestLock();
    });
  }

  leave(): void {
    this.ctx.confirm(t('confirm.leaveTitle'), t('confirm.leaveMission'), t('confirm.yes'), () => this.toSelect());
  }

  toSelect(): void {
    this.stopRuntime();
    this.ctx.setActive(false);
    this.ctx.input()?.exitLock();
    this.openSelect();
  }

  // -------------------------------------------------------- victory

  tick(): void {
    // Called every animation frame by main: victory presentation controls.
    const rt = this.runtime;
    const v = !!rt?.inVictory;
    if ($('m-skip').hidden === v) $('m-skip').hidden = !v;
    if (v && this.ctx.input()?.locked) this.ctx.input()?.exitLock();
  }

  private finished(res: MissionResult): void {
    const m = this.current!;
    const { newBest, newChallenges } = this.progress.record(m.id, res);
    this.stopRuntime();
    this.ctx.setActive(false);
    $('mr-name').textContent = t(m.title as Key);
    const rec = this.progress.get(m.id);
    $('mr-best').textContent = newBest ? t('mr.newBest') : rec.bestMs ? `${t('mr.best')}: ${fmtTime(rec.bestMs)}` : '';
    const stats: Array<[Key, string]> = [['mr.time', fmtTime(res.timeMs)], ['mr.kos', String(res.kos)], ['mr.acc', `${Math.round(res.accuracy * 100)}%`]];
    $('mr-stats').replaceChildren(...stats.map(([k, v]) => { const d = document.createElement('div'); const dt = document.createElement('dt'); dt.textContent = t(k); const dd = document.createElement('dd'); dd.textContent = v; d.append(dt, dd); return d; }));
    this.renderChallenges($('mr-ch'), m, rec.challenges, newChallenges);
    $('mr-portrait').style.backgroundImage = svgUrl(rosaSVG('happy', 'face'));
    const next = this.progress.next(m.id);
    ($('btn-mr-next') as HTMLButtonElement).hidden = !next;
    $('mr-final').hidden = !!next;
    music.play('results');
    this.ctx.show('mresults');
  }

  // ------------------------------------------------------------ wiring

  private bind(): void {
    const on = (id: string, f: () => void) => $(id).addEventListener('click', () => { audio.unlock(); audio.play('ui'); f(); });
    on('btn-camp-back', () => this.ctx.show('title'));
    on('btn-camp-reset', () => this.ctx.confirm(t('camp.resetTitle'), t('camp.resetBody'), t('camp.resetYes'), () => {
      this.progress.reset();
      this.ctx.toast(t('camp.resetDone'));
      this.openSelect();
    }));
    on('btn-mi-start', () => void this.start());
    on('btn-mi-back', () => this.openSelect());
    on('btn-mr-next', () => { const n = this.progress.next(this.current!.id); const m = MISSIONS.find((x) => x.id === n); if (m) this.openIntro(m); });
    on('btn-mr-retry', () => this.openIntro(this.current!));
    on('btn-mr-select', () => this.openSelect());
    on('btn-mr-home', () => { this.ctx.show('title'); music.play('menu'); });
    on('btn-pause-retrycp', () => this.retryCheckpoint());
    if (!this.skipBound) {
      this.skipBound = true;
      const skip = (e: Event) => { if (this.runtime?.inVictory) { e.preventDefault(); this.runtime.skipVictory(); } };
      window.addEventListener('keydown', (e) => { if (e.code === 'Space' || e.code === 'Enter' || e.code === 'Escape') skip(e); });
      $('stage').addEventListener('click', skip);
    }
  }
}

// Line ids a mission may use: its own, plus shared reactions and opponents.
export function linesFor(m: MissionDef): string[] {
  const prefix = `m${m.order}_`;
  return LINES.filter((l) => l.id.startsWith(prefix) || !/^m\d_/.test(l.id)).map((l) => l.id);
}
