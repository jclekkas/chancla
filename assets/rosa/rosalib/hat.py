"""Sol's straw sun hat: a domed crown with a terracotta band and a pink flower, a wide wavy brim.

Tipped back a little so the face and the two front rollers show under the
brim. The crown rides the head; the brim blends onto the optional hatBrim
bone toward its edge, so the animation can let it flex.
"""
import math

import numpy as np

from .mesh import Part, ellipsoid, frame, loft, sstep, trs, apply
from .rig import J

SEAT_Y = 1.706       # the crown's opening
TILT = 0.15          # tipped back (the front rises)
PIVOT = np.array([0.0, 1.734, 0.0])
CROWN_R = (0.166, 0.174)  # opening half-width, half-depth
BRIM_R = 0.405


def tilt_m():
    return trs(*PIVOT) @ trs(rx=TILT) @ trs(*(-PIVOT))


def brim_y(r):
    """The brim's top surface: rising off the crown, drooping to the edge."""
    return SEAT_Y + 0.020 - 0.55 * max(0.0, r - 0.17) ** 2


def hat_weights(p):
    # Undo the tilt to read the radius off the crown's axis.
    q = apply(np.linalg.inv(tilt_m()), np.array([p]))[0]
    r = math.hypot(q[0], q[2])
    t = sstep(0.19, 0.27, r)
    if t <= 0:
        return {'head': 1.0}
    return {'head': 1.0 - t, 'hatBrim': t} if t < 1 else {'hatBrim': 1.0}


RES = {
    'high': dict(brim=28, crown=22, bands=[0.17, 0.215, 0.26, 0.305, 0.35], flower=5, crown_rows=1, wave=True),
    'medium': dict(brim=26, crown=16, bands=[0.17, 0.235, 0.30, 0.35], flower=5, crown_rows=0, wave=True),
    'low': dict(brim=18, crown=12, bands=[0.17, 0.30], flower=4, crown_rows=0, wave=True),
}


def build(tier):
    R = RES[tier]
    parts = []
    wave = (lambda a, i, r: 1 + 0.035 * math.cos(5 * a + 0.6) * max(0.0, (r['r'] - 0.2) / 0.2)) if R['wave'] else None

    def wave_y(p, a, i):
        # The brim's wave lifts and drops its edge too.
        r = math.hypot(p[0], p[2])
        if r > 0.22:
            p = p.copy()
            p[1] += 0.012 * math.cos(5 * a + 0.6) * (r - 0.22) / 0.18
        return p

    # ---- brim: woven rings on top, the rolled edge, the shaded underside back to the crown
    top = []
    bands = R['bands']
    for i, r in enumerate(bands):
        top.append({'y': brim_y(r), 'r': r, 'rz': r * 1.03, 'c': 'straw' if i % 2 == 0 else 'strawDeep'})
    top.append({'y': brim_y(BRIM_R) + 0.002, 'r': BRIM_R, 'rz': BRIM_R * 1.03, 'c': 'straw'})
    top.append({'y': brim_y(BRIM_R) - 0.010, 'r': BRIM_R + 0.004, 'rz': (BRIM_R + 0.004) * 1.03, 'c': 'straw'})
    top.append({'y': brim_y(BRIM_R) - 0.016, 'r': BRIM_R - 0.012, 'rz': (BRIM_R - 0.012) * 1.03, 'c': 'strawDeep'})
    top.append({'y': brim_y(0.26) - 0.014, 'r': 0.26, 'rz': 0.26 * 1.03, 'c': 'strawDeep'})
    top.append({'y': SEAT_Y + 0.004, 'r': 0.172, 'rz': 0.172 * 1.03, 'c': 'strawDeep'})
    # Close the ring band (top inner edge to underside inner edge) inside the crown.
    top.append({'y': SEAT_Y + 0.010, 'r': 0.168, 'rz': 0.168 * 1.03, 'c': 'strawDeep'})
    bv, bf, bfc = loft(top, R['brim'], mod=wave, sculpt=wave_y)
    # Seal: connect last ring to first (a closed torus-like band).
    n = R['brim']
    last = len(bv) - n
    for j in range(n):
        j1 = (j + 1) % n
        bf.append((last + j, last + j1, j1, j))
        bfc.append('strawDeep')
    brim = Part('brim', bv, bf, bfc, hull=0.010, weights=hat_weights)
    # Hull on a lighter copy (top and edge only matter for the silhouette).
    hv, hf, _ = loft(top[:-3], max(16, n * 2 // 3), mod=wave, sculpt=wave_y)
    m = max(16, n * 2 // 3)
    lh = len(hv) - m
    for j in range(m):
        hf.append((lh + j, lh + (j + 1) % m, (j + 1) % m, j))
    brim.hull_src = (hv, hf)
    parts.append(brim)
    # ---- crown: a soft dome, the terracotta band round its base
    cr = []
    prof = [(1.858, 0.0), (1.855, 0.05), (1.845, 0.10), (1.828, 0.135), (1.802, 0.156), (1.772, 0.163)]
    for y, r in prof:
        cr.append({'y': y, 'r': r, 'rz': r * 1.05, 'c': 'straw'})
    cr.append({'y': 1.772, 'r': 0.165, 'rz': 0.165 * 1.05, 'c': 'band'})
    cr.append({'y': 1.732, 'r': 0.170, 'rz': 0.170 * 1.05, 'c': 'band'})
    cr.append({'y': 1.732, 'r': 0.168, 'rz': 0.168 * 1.05, 'c': 'straw'})
    cr.append({'y': SEAT_Y + 0.012, 'r': 0.170, 'rz': 0.170 * 1.05, 'c': 'strawDeep'})
    cr.append({'y': SEAT_Y + 0.012, 'r': 0.0, 'c': 'strawDeep'})
    cv, cf, cfc = loft(cr, R['crown'])
    crown = Part('crown', cv, cf, cfc, hull=0.010, weights=hat_weights)
    hv2, hf2, _ = loft([r for r in cr if r['c'] != 'strawDeep'] + [{'y': 1.732, 'r': 0.0, 'c': 'straw'}], max(8, R['crown'] * 2 // 3))
    crown.hull_src = (hv2, hf2)
    parts.append(crown)
    # ---- the flower on her right front: pink petals round a yellow heart
    fa = 1.0
    fp = np.array([math.sin(fa) * 0.172, 1.754, -math.cos(fa) * 0.180])
    fm = frame(fp, (math.sin(fa), 0.2, -math.cos(fa)))
    for i in range(R['flower']):
        t = 2 * math.pi * i / R['flower']
        pv, pf, pfc = ellipsoid(0.026, 0.016, 0.009, 6 if tier == 'high' else 5, 4 if tier != 'low' else 3, 'flower')
        pt = Part('petal', pv, pf, pfc, weights=hat_weights).transform(fm @ trs(math.cos(t) * 0.023, math.sin(t) * 0.023, -0.004, 0, 0, t))
        parts.append(pt)
    hv, hf, hfc = ellipsoid(0.012, 0.012, 0.009, 6, 4, 'flowerHeart')
    parts.append(Part('heart', hv, hf, hfc, weights=hat_weights).transform(fm @ trs(0, 0, -0.011)))
    T = tilt_m()
    for p in parts:
        p.transform(T)
    return parts
