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
});
