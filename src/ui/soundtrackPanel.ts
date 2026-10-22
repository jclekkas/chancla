// The Soundtrack section of Settings (main page and Arcade): mode, song
// choice, Next, and what is playing. It only changes which song plays;
// volume and mute stay with the page's own settings and are never touched.
import { music } from '../audio/music';
import { SONGS, type MusicMode } from '../audio/library';
import { saveMusicPrefs } from '../audio/prefs';

type Lang = 'en' | 'es';
const S = {
  en: {
    heading: 'Soundtrack', auto: 'Automatic', shuffle: 'Shuffle all', one: 'One song',
    song: 'Song', next: 'Next song', earlier: 'earlier version',
    playing: 'Now playing:', builtIn: 'The built-in score is playing while the song loads.',
    silent: 'No music in this screen.', muted: '(music is muted)',
    help: { auto: 'Each part of the game picks from its own songs.', shuffle: 'All eleven songs, in random order, everywhere.', one: 'The chosen song repeats.' },
  },
  es: {
    heading: 'Banda sonora', auto: 'Automática', shuffle: 'Todas al azar', one: 'Una canción',
    song: 'Canción', next: 'Siguiente canción', earlier: 'versión anterior',
    playing: 'Suena:', builtIn: 'Suena la música integrada mientras carga la canción.',
    silent: 'Sin música en esta pantalla.', muted: '(música silenciada)',
    help: { auto: 'Cada parte del juego elige entre sus propias canciones.', shuffle: 'Las once canciones, al azar, en todo el juego.', one: 'La canción elegida se repite.' },
  },
} as const;

export interface SoundtrackPanelOptions {
  lang: () => Lang;
  /** True while the music level is zero or all sound is muted. */
  musicSilenced: () => boolean;
  onUi?: () => void;
}

export class SoundtrackPanel {
  private root: HTMLElement;
  private seg: HTMLElement;
  private select: HTMLSelectElement;
  private nextBtn: HTMLButtonElement;
  private now: HTMLElement;
  private help: HTMLElement;
  private heading: HTMLElement;
  private songLabel: HTMLElement;
  private off: () => void;

  constructor(host: HTMLElement, private opts: SoundtrackPanelOptions) {
    this.root = host;
    host.classList.add('soundtrack');
    host.innerHTML = `
      <span class="st-heading" id="st-heading"></span>
      <div class="seg st-mode" role="radiogroup" aria-labelledby="st-heading">
        <button type="button" role="radio" data-st-mode="auto"></button>
        <button type="button" role="radio" data-st-mode="shuffle"></button>
        <button type="button" role="radio" data-st-mode="one"></button>
      </div>
      <p class="note st-help" id="st-help"></p>
      <div class="st-row">
        <label class="st-song"><span class="st-song-label"></span><select id="st-song"></select></label>
        <button type="button" class="st-next" id="st-next"></button>
      </div>
      <p class="note st-now" id="st-now" role="status" aria-live="polite"></p>`;
    this.seg = host.querySelector('.st-mode')!;
    this.select = host.querySelector('#st-song')!;
    this.nextBtn = host.querySelector('#st-next')!;
    this.now = host.querySelector('#st-now')!;
    this.help = host.querySelector('#st-help')!;
    this.heading = host.querySelector('#st-heading')!;
    this.songLabel = host.querySelector('.st-song-label')!;
    this.seg.querySelectorAll<HTMLButtonElement>('[data-st-mode]').forEach((b) => {
      b.addEventListener('click', () => { this.opts.onUi?.(); this.update({ mode: b.dataset.stMode as MusicMode }); });
    });
    // Picking a song means "play this one": it switches to One song.
    this.select.addEventListener('change', () => { this.opts.onUi?.(); this.update({ mode: 'one', song: this.select.value }); });
    this.nextBtn.addEventListener('click', () => {
      this.opts.onUi?.();
      const p = music.getPrefs();
      if (p.mode === 'one') {
        const i = SONGS.findIndex((s) => s.id === p.song);
        this.update({ song: SONGS[(i + 1) % SONGS.length]!.id });
      } else music.next();
    });
    this.off = music.onChange(() => this.render());
    this.render();
  }

  private update(patch: Partial<{ mode: MusicMode; song: string }>): void {
    const p = { ...music.getPrefs(), ...patch };
    music.setPrefs(p);
    saveMusicPrefs(p);
    this.render();
  }

  /** Redraws labels and state (call on language change and when Settings opens). */
  render(): void {
    const s = S[this.opts.lang()];
    const p = music.getPrefs();
    this.heading.textContent = s.heading;
    this.songLabel.textContent = s.song;
    this.nextBtn.textContent = s.next;
    this.seg.querySelectorAll<HTMLButtonElement>('[data-st-mode]').forEach((b) => {
      const m = b.dataset.stMode as MusicMode;
      b.textContent = s[m];
      b.setAttribute('aria-checked', String(m === p.mode));
    });
    this.help.textContent = s.help[p.mode];
    if (this.select.options.length !== SONGS.length || this.select.dataset.lang !== this.opts.lang()) {
      this.select.innerHTML = '';
      for (const song of SONGS) {
        const o = document.createElement('option');
        o.value = song.id;
        o.textContent = song.earlier ? `${song.title} (${s.earlier})` : song.title;
        this.select.append(o);
      }
      this.select.dataset.lang = this.opts.lang();
    }
    const np = music.nowPlaying();
    // The selector shows the chosen song, or in the other modes what's playing.
    this.select.value = p.mode === 'one' ? p.song : np?.id ?? p.song;
    const st = music.state();
    let line: string;
    if (np) line = `${s.playing} ${np.earlier ? `${np.title} (${s.earlier})` : np.title}`;
    else if (st.want === 'off' || st.program === null) line = s.silent;
    else line = s.builtIn;
    this.now.textContent = this.opts.musicSilenced() ? `${line} ${s.muted}` : line;
  }

  dispose(): void { this.off(); this.root.innerHTML = ''; }
}
