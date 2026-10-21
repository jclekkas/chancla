// The recorded soundtrack as the game sees it: every song, and which songs
// can play automatically in each scene.
//
// Songs are identified by Suno id (the first 8 hex digits), never by title:
// two titles exist in two different recordings. The full playlist plays each
// song whole; songs that also have a curated seamless loop (the first five
// recordings, prepared by scripts/music/prepare.py) use that loop when the
// player picks one song to repeat.
import { PLAYLIST } from './playlist-data';
import { RECORDED } from './soundtrack';

export interface Song {
  /** Short Suno id (8 hex digits), or the prepared loop's id for earlier recordings without one on file. */
  id: string;
  sunoId: string | null;
  title: string;
  /** An earlier, different recording of a title that is also in the playlist. */
  earlier?: true;
  /** Played whole, start to finish (the earlier recordings: up to their loop end). */
  file: string;
  /** Where playback hands over to the next song, in seconds of `file`. */
  end: number;
  /** Playback gain that matches loudness across songs (no re-encoding). */
  gainDb: number;
  key: { root: number; minor: boolean };
  /** A curated seamless loop, used when this one song repeats. */
  loop?: { file: string; start: number; end: number };
}

// The prepared loops are already at -16 LUFS: no extra gain.
const loopOf = (id: string) => {
  const r = RECORDED.find((t) => t.id === id)!;
  return { file: r.file, start: r.loopStart, end: r.loopEnd, key: r.key };
};

// Three playlist songs are the same recordings as prepared loops (checked by
// waveform correlation, 0.99 at zero offset; docs/AUDIO.md).
const SAME_AS_LOOP: Record<string, string> = { '036c0292': 'rosa-theme', '66be822e': 'ruleros', d5ece162: 'bounce-y-joke' };

export const SONGS: readonly Song[] = [
  ...PLAYLIST.map((p): Song => {
    const l = SAME_AS_LOOP[p.id];
    return { id: p.id, sunoId: p.sunoId, title: p.title, file: p.file, end: p.duration, gainDb: p.gainDb, key: p.key, ...(l ? { loop: (({ file, start, end }) => ({ file, start, end }))(loopOf(l)) } : {}) };
  }),
  // The earlier Guerra de Vecinos and Fricas y Fricas, as first integrated.
  ...(['guerra-de-vecinos', 'fricas-y-fricas'] as const).map((id): Song => {
    const l = loopOf(id);
    return { id, sunoId: null, title: RECORDED.find((t) => t.id === id)!.title, earlier: true, file: l.file, end: l.end, gainDb: 0, key: l.key, loop: { file: l.file, start: l.start, end: l.end } };
  }),
];

export const song = (id: string): Song | undefined => SONGS.find((s) => s.id === id);

export type PoolId = 'menu' | 'explore' | 'chores' | 'action' | 'intense';

/**
 * Automatic mode. Editorial starting points (not chosen by listening); `lead`
 * plays first the first time a scene's pool starts in a session.
 */
export const POOLS: Readonly<Record<PoolId, { lead?: string; songs: readonly string[] }>> = {
  // Menus and mission select: Groquo de diversión is the familiar opening theme.
  menu: { lead: '036c0292', songs: ['036c0292', '91dee4c5', '6265def8'] },
  // Exploration, Operación Ruleros: Ruleros, Sueño de Cumbia, Sobrescuro, Grojo Curioso.
  explore: { lead: '66be822e', songs: ['66be822e', '91dee4c5', 'a5773b78', '6265def8'] },
  // Cooking and cleaning: Fricas y Fricas, Juego de Barrio, Bounce y Joke.
  chores: { lead: '72898684', songs: ['72898684', '4c389fba', 'd5ece162'] },
  // Arcade and Practice: all eleven.
  action: { songs: PLAYLIST.map((p) => p.id) },
  // The piñata finale and intense encounters: Guerra de Vecinos, Festive Boss Battle, No Manches.
  intense: { lead: '36b2c7ad', songs: ['36b2c7ad', 'd4b3fb6f', 'b5a37a72'] },
};

/** "Shuffle all": the eleven playlist songs, whatever the scene. */
export const ALL: readonly string[] = PLAYLIST.map((p) => p.id);

/** Which pool each music cue draws from. Cues not listed keep the synthesized score. */
export const CUE_POOL: Readonly<Record<string, PoolId>> = {
  menu: 'menu', select: 'menu', lobby: 'menu', results: 'menu',
  ruleros: 'explore',
  cocina: 'chores', patio: 'chores',
  combat: 'action', arcade: 'action',
  pinata: 'intense', boss: 'intense',
};

export type MusicMode = 'auto' | 'shuffle' | 'one';
export interface MusicPrefs { mode: MusicMode; song: string }
export const DEFAULT_PREFS: MusicPrefs = { mode: 'auto', song: '036c0292' };
export const isMusicMode = (m: unknown): m is MusicMode => m === 'auto' || m === 'shuffle' || m === 'one';
