import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { PLAYLIST } from '../src/audio/playlist-data';
import { ALL, CUE_POOL, POOLS, SONGS, song } from '../src/audio/library';
import { ShuffleBag } from '../src/audio/shuffle';

const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/music/playlist.json'), 'utf8')) as { tracks: Array<{ id: string; sunoId: string; title: string; file: string; sha256: string }> };

// The playlist as supplied (tracks.json): Suno id -> title.
const SUPPLIED: Record<string, string> = {
  '36b2c7ad-07a0-44c9-b6d7-40b6bfbacae2': 'Guerra de Vecinos',
  'd4b3fb6f-7fa4-4288-ad0a-4ef7d3cc801b': 'Festive Boss Battle',
  'b5a37a72-67db-4727-a6fd-be82f595b350': 'No Manches',
  '72898684-09f7-48a5-b202-3c92bd744ad5': 'Fricas y Fricas',
  'd5ece162-af0a-4862-baf8-21dce344ce03': 'Bounce y Joke',
  '4c389fba-99c3-45b8-a395-5c5ebfe99afd': 'Juego de Barrio',
  '66be822e-f9ac-4f5e-8751-44dbed98eb54': 'Ruleros',
  '91dee4c5-77f5-4f4a-9d4f-870a127a297a': 'Sueño de Cumbia',
  'a5773b78-e8e7-425e-861f-82fc7069e2e6': 'Sobrescuro',
  '6265def8-8c65-4395-91aa-e4aea42e651d': 'Grojo Curioso',
  '036c0292-dc76-4cae-82a9-a384997af10e': 'Groquo de diversión',
};

describe('playlist assets', () => {
  it('has all eleven supplied songs, by Suno id, each once', () => {
    expect(PLAYLIST.map((p) => p.sunoId).sort()).toEqual(Object.keys(SUPPLIED).sort());
    for (const p of PLAYLIST) expect(p.title, p.sunoId).toBe(SUPPLIED[p.sunoId]);
    expect(new Set(PLAYLIST.map((p) => p.id)).size).toBe(11);
  });

  it('ships every song byte for byte as supplied (checksums from the supplier\'s tracks.json)', () => {
    let total = 0;
    for (const t of manifest.tracks) {
      const f = path.join(ROOT, 'public', t.file);
      const bytes = fs.readFileSync(f);
      total += bytes.length;
      expect(crypto.createHash('sha256').update(bytes).digest('hex'), t.title).toBe(t.sha256);
      expect(PLAYLIST.find((p) => p.sunoId === t.sunoId)!.file).toBe(t.file);
    }
    expect(total).toBeLessThan(22 * 1024 * 1024);
  });

  it('keeps the earlier Guerra de Vecinos and Fricas y Fricas as their own songs, not duplicates', () => {
    const earlier = SONGS.filter((s) => s.earlier);
    expect(earlier.map((s) => s.title).sort()).toEqual(['Fricas y Fricas', 'Guerra de Vecinos']);
    for (const e of earlier) {
      expect(e.sunoId).toBeNull();
      expect(SONGS.filter((s) => s.title === e.title).length).toBe(2); // the earlier and the playlist recording
      expect(ALL).not.toContain(e.id); // "all eleven" counts the playlist only
    }
    expect(SONGS.length).toBe(13);
    expect(new Set(SONGS.map((s) => s.id)).size).toBe(13);
  });
});

describe('pools', () => {
  it('every supplied song is in the selector and in at least one automatic pool', () => {
    for (const p of PLAYLIST) {
      expect(song(p.id), p.title).toBeDefined();
      const pools = Object.entries(POOLS).filter(([k, v]) => k !== 'action' && v.songs.includes(p.id)).map(([k]) => k);
      expect(pools.length, p.title).toBeGreaterThan(0);
    }
    expect(POOLS.action.songs.length).toBe(11);
    expect(ALL.length).toBe(11);
  });

  it('follows the suggested assignments', () => {
    const titles = (pool: keyof typeof POOLS) => POOLS[pool].songs.map((id) => song(id)!.title).sort();
    expect(titles('menu')).toEqual(['Grojo Curioso', 'Groquo de diversión', 'Sueño de Cumbia']);
    expect(song(POOLS.menu.lead!)!.title).toBe('Groquo de diversión');
    expect(titles('explore')).toEqual(['Grojo Curioso', 'Ruleros', 'Sobrescuro', 'Sueño de Cumbia']);
    expect(titles('chores')).toEqual(['Bounce y Joke', 'Fricas y Fricas', 'Juego de Barrio']);
    expect(titles('intense')).toEqual(['Festive Boss Battle', 'Guerra de Vecinos', 'No Manches']);
    // The intense and chores pools use the new recordings, by id.
    expect(POOLS.intense.songs).toContain('36b2c7ad');
    expect(POOLS.chores.songs).toContain('72898684');
    expect(CUE_POOL).toMatchObject({ menu: 'menu', select: 'menu', results: 'menu', ruleros: 'explore', cocina: 'chores', patio: 'chores', combat: 'action', arcade: 'action', pinata: 'intense', boss: 'intense' });
  });

  it('pool entries all exist', () => {
    for (const [k, v] of Object.entries(POOLS)) for (const id of v.songs) expect(song(id), `${k}:${id}`).toBeDefined();
  });
});

describe('shuffle bag', () => {
  const seeded = (seed: number) => () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };

  it('plays the whole pool before any repeat, and never repeats across a reshuffle', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const bag = new ShuffleBag(['a', 'b', 'c', 'd', 'e'], seeded(seed));
      const out = Array.from({ length: 50 }, () => bag.next()!);
      for (let r = 0; r < 10; r++) expect(new Set(out.slice(r * 5, r * 5 + 5)).size).toBe(5);
      for (let i = 1; i < out.length; i++) expect(out[i]).not.toBe(out[i - 1]);
    }
  });

  it('a two-song pool alternates', () => {
    const bag = new ShuffleBag(['x', 'y'], seeded(7));
    const out = Array.from({ length: 20 }, () => bag.next());
    for (let i = 1; i < out.length; i++) expect(out[i]).not.toBe(out[i - 1]);
  });

  it('starts with the lead, then the rest of its round', () => {
    const bag = new ShuffleBag(['a', 'b', 'c'], seeded(3));
    bag.lead('b');
    const first = [bag.next(), bag.next(), bag.next()];
    expect(first[0]).toBe('b');
    expect(new Set(first).size).toBe(3);
  });

  it('a song drawn but not played goes back on top; unavailable songs are skipped', () => {
    const bag = new ShuffleBag(['a', 'b', 'c'], seeded(5));
    const x = bag.next()!;
    bag.putBack(x);
    expect(bag.next()).toBe(x);
    const y = bag.next((i) => i === 'c' || i === 'a');
    expect(y).toBe('b');
  });
});
