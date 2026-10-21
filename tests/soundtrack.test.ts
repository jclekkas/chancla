import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { RECORDED, ASSIGN } from '../src/audio/soundtrack';

const ROOT = path.resolve(__dirname, '..');
const loops = JSON.parse(fs.readFileSync(path.join(ROOT, 'assets/music/loops.json'), 'utf8')) as { assign: Record<string, string>; tracks: Array<{ id: string; source: string }> };

describe('recorded soundtrack', () => {
  it('keeps the Suno originals byte for byte', () => {
    const sums = fs.readFileSync(path.join(ROOT, 'assets/music/originals/SHA256SUMS'), 'utf8').trim().split('\n');
    expect(sums.length).toBe(5);
    for (const line of sums) {
      const [hash, file] = line.split(/\s+/);
      const got = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'assets/music/originals', file!))).digest('hex');
      expect(got, file).toBe(hash);
    }
  });

  it('ships a prepared file for every recording, inside its size budget', () => {
    let total = 0;
    for (const t of RECORDED) {
      const f = path.join(ROOT, 'public', t.file);
      expect(fs.existsSync(f), t.file).toBe(true);
      total += fs.statSync(f).size;
      expect(t.file.endsWith('.mp3')).toBe(true); // decodes in every target browser
    }
    expect(total).toBeLessThan(12 * 1024 * 1024);
  });

  it('has sane loop points: whole file covers the loop, loop is long enough not to nag', () => {
    for (const t of RECORDED) {
      expect(t.loopStart).toBeGreaterThan(0);
      expect(t.loopEnd - t.loopStart, t.id).toBeGreaterThan(40);
      expect(t.loopEnd * 48000, t.id).toBeLessThan(t.samples); // the file runs past loopEnd
    }
  });

  it('follows the assignments that came with the tracks', () => {
    expect(ASSIGN).toEqual(loops.assign);
    expect(ASSIGN.menu).toBe('rosa-theme');
    expect(ASSIGN.ruleros).toBe('ruleros');
    expect(ASSIGN.cocina).toBe('fricas-y-fricas');
    expect(ASSIGN.patio).toBe('fricas-y-fricas');
    expect(ASSIGN.pinata).toBe('guerra-de-vecinos');
    expect(ASSIGN.combat).toBe('bounce-y-joke');
    for (const r of Object.values(ASSIGN)) expect(RECORDED.some((t) => t.id === r), r).toBe(true);
    // every recording is used somewhere
    for (const t of RECORDED) expect(Object.values(ASSIGN)).toContain(t.id);
  });

  it('keeps the synthesized score as the fallback for every assigned cue', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/audio/music.ts'), 'utf8');
    const body = src.slice(src.indexOf('const TRACKS'), src.indexOf('const mtof'));
    for (const cue of Object.keys(ASSIGN)) expect(body, cue).toMatch(new RegExp(`\\b${cue}: \\{ bpm`));
  });
});
