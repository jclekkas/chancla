"""Legs and feet: a soft leg (thigh and knee in the skirt's lining colour, a bare calf below the
hem) and a bare foot in a flip-flop (violet sole, turquoise footbed, terracotta V strap)."""
import math

import numpy as np

from .mesh import Part, ellipsoid, loft, trs, tube
from .rig import J, leg_chain, rigid

LEG = [
    (0.875, 0.0), (0.865, 0.060), (0.80, 0.078), (0.70, 0.074), (0.60, 0.066), (0.50, 0.058),
    (0.41, 0.054), (0.35, 0.056), (0.27, 0.058), (0.18, 0.050), (0.10, 0.041), (0.055, 0.036), (0.030, 0.030), (0.020, 0.0),
]

RES = {
    'high': dict(cols=8, foot=8, hull_cols=6, toes=False, ink=0.009),
    'medium': dict(cols=7, foot=6, hull_cols=5, toes=False, ink=0.009),
    'low': dict(cols=6, foot=5, hull_cols=None, toes=False, ink=0.0),
}


def build(tier):
    R = RES[tier]
    parts = []
    for side in (1, -1):
        s = 'R' if side > 0 else 'L'
        lx = J['leg' + s][0]
        leg = LEG if tier != 'low' else [LEG[i] for i in (0, 2, 4, 6, 8, 9, 11, 13)]
        rings = [{'y': y, 'r': r, 'rz': r * 0.96, 'x': lx, 'z': 0.004, 'c': 'skirtDeep' if y > 0.37 else 'skin'} for y, r in leg]
        v, f, fc = loft(rings, R['cols'])
        leg = Part('leg', v, f, fc, hull=R['ink'], weights=leg_chain(side))
        leg.hull_mask = lambda c: c[1] < 0.46  # the thigh never shows outside the skirt
        if R['hull_cols']:
            hv, hf, _ = loft(rings, R['hull_cols'])
            leg.hull_src = (hv, hf)
        parts.append(leg)
        # The foot (lofted along it: loft y -> forward, loft z -> up), in root space at the ankle.
        fy = J['foot' + s][1]
        to_out = trs(lx, fy, 0) @ trs(ry=-side * 0.08) @ trs(rx=-math.pi / 2)

        def sec(y, w, cz, down, up, c):
            return {'y': y, 'r': w, 'z': cz, 'rz': down, 'rzB': up, 'c': c}
        k = 'skin'
        foot = [sec(0.15, 0, 0.052, 0, 0, k), sec(0.14, 0.03, 0.052, 0.012, 0.012, k), sec(0.11, 0.044, 0.054, 0.014, 0.017, k), sec(0.06, 0.047, 0.056, 0.016, 0.023, k),
                sec(0.0, 0.043, 0.060, 0.020, 0.032, k), sec(-0.04, 0.040, 0.065, 0.025, 0.036, k), sec(-0.06, 0.032, 0.065, 0.025, 0.030, k), sec(-0.07, 0, 0.065, 0, 0, k)]
        fv, ff, ffc = loft(foot, R['foot'])
        fp = Part('foot', fv, ff, ffc, hull=R['ink'], weights=rigid('foot' + s)).transform(to_out)
        parts.append(fp)
        so = 'flipSole'
        sole = [sec(0.178, 0, 0.03, 0, 0, so), sec(0.165, 0.035, 0.03, 0.011, 0.011, so), sec(0.125, 0.054, 0.03, 0.011, 0.011, so), sec(0.07, 0.057, 0.03, 0.011, 0.011, so),
                sec(0.0, 0.050, 0.03, 0.011, 0.011, so), sec(-0.05, 0.047, 0.03, 0.011, 0.011, so), sec(-0.078, 0, 0.03, 0, 0, so)]
        sv, sf, sfc = loft(sole, R['foot'], color=lambda a, i, r: 'flipBed' if math.cos(a) < -0.3 else None)
        sp = Part('sole', sv, sf, sfc, hull=R['ink'], weights=rigid('foot' + s)).transform(to_out)
        parts.append(sp)
        for x in (-0.047, 0.047):
            pts = [np.array([0.006 * side, 0.058, -0.115]), np.array([x * 0.6, 0.062, -0.07]), np.array([x, 0.046, -0.02])]
            tv, tf, tfc = tube(pts, [0.0068] * 3, 4 if tier != 'low' else 3, 'flipStrap', up=(0, 1, 0))
            parts.append(Part('strap', tv, tf, tfc, weights=rigid('foot' + s)).transform(trs(lx, fy, 0) @ trs(ry=-side * 0.08)))
        if R['toes']:
            for i in range(4):
                tv, tf, tfc = ellipsoid(0.011, 0.009, 0.012, 5, 3, 'skin')
                parts.append(Part('toe', tv, tf, tfc, weights=rigid('foot' + s)).transform(
                    trs(lx, fy, 0) @ trs(ry=-side * 0.08) @ trs(-side * (0.026 - i * 0.017), 0.05 - i * 0.002, -0.143 + i * i * 0.004, s=(1.3, 1, 1) if i == 0 else 1.0)))
    return parts
