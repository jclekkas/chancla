import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAPS } from '../shared/maps';

const map = (id: string) => MAPS.find((entry) => entry.id === id)!.data;

describe('high tier keeps the original landmarks', () => {
  it('plaza still names Casa Sol and Casa Luna and keeps trees, awnings, and lights', () => {
    const plaza = map('plaza');
    const signs = plaza.boxes.map((box) => box.sign).filter(Boolean);
    expect(signs).toContain('CASA SOL');
    expect(signs).toContain('CASA LUNA');
    expect(plaza.decor?.trees?.length ?? 0).toBeGreaterThan(0);
    expect(plaza.decor?.awnings?.length ?? 0).toBeGreaterThan(0);
    expect(plaza.decor?.lights?.length ?? 0).toBeGreaterThan(0);
    expect(plaza.boxes.some((box) => box.mat === 'stall')).toBe(true);
  });

  it('patio and fiesta still carry lights or papel so the wires have something to hang', () => {
    for (const id of ['patio', 'fiesta']) {
      const decor = map(id).decor;
      expect((decor?.lights?.length ?? 0) + (decor?.papel?.length ?? 0) + (decor?.laundry?.length ?? 0)).toBeGreaterThan(0);
    }
  });

  it('patio keeps its fountain and fiesta keeps party tables', () => {
    expect(map('patio').boxes.some((box) => box.mat === 'fountain')).toBe(true);
    expect(map('patio').boxes.map((box) => box.sign).filter(Boolean)).toContain('CASA SOL');
    expect(map('fiesta').boxes.some((box) => box.mat === 'table')).toBe(true);
    expect(map('fiesta').decor?.pinata ?? map('fiesta').decor?.danceFloor).toBeTruthy();
  });

  it('ships non-null plaster and cobble PBR maps and the palette hook', () => {
    for (const file of [
      'public/chancla-duty/cc0/tex/plaster/diff.jpg',
      'public/chancla-duty/cc0/tex/plaster/nor.jpg',
      'public/chancla-duty/cc0/tex/plaster/rough.jpg',
      'public/chancla-duty/cc0/tex/cobble/diff.jpg',
      'public/chancla-duty/cc0/tex/cobble/nor.jpg',
      'public/chancla-duty/cc0/tex/cobble/rough.jpg',
    ]) {
      expect(statSync(file).size).toBeGreaterThan(1000);
    }
    const look = readFileSync('chancla-duty/src/cc0.ts', 'utf8');
    expect(look).toContain('mix(0.82, 1.18, paletteLuma)');
    expect(look).toContain('tex/cobble/diff.jpg');
  });
});
