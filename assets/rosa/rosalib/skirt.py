"""The skirt: a bell over round hips, folds deepening to the hem, a ruffled marigold flounce,
a cream petticoat edge and a dark lining. One closed shell on the `skirt` bone.

The hem's front and back take a little of each thigh (more toward the
hem, only on that leg's side) so a stride or a crouch pushes the cloth
ahead of the knee instead of the knee coming through it.
"""
import math

import numpy as np

from .mesh import Part, ellipsoid, frame, gauss, loft, sstep

# (y, half-width, half-depth), root space: waist (inside the sash) to the hem.
PROFILE = [
    (0.958, 0.128, 0.114),
    (0.925, 0.150, 0.134),
    (0.870, 0.198, 0.180),
    (0.810, 0.232, 0.214),
    (0.730, 0.258, 0.242),
    (0.640, 0.274, 0.260),
    (0.550, 0.287, 0.273),
    (0.465, 0.298, 0.284),
]
FLOUNCE_Y, HEM_Y = 0.425, 0.300
FOLD = 0.068


def fold_amp(y):
    return FOLD * min(1.0, max(0.0, (0.93 - y) / 0.62)) ** 1.25


def skirt_weights(p):
    x, y, z = p
    # The waistband stays snug on the hips; below it the cloth hangs from the skirt bone.
    t = sstep(0.958, 0.875, y)
    if t < 1:
        return {'hips': 1.0 - t, 'skirt': t} if t > 0 else {'hips': 1.0}
    w = {'skirt': 1.0}
    k = 0.42 * sstep(0.66, 0.36, y)
    if k <= 0:
        return w
    r = math.hypot(x, z)
    fb = abs(z) / max(1e-6, r)  # front and back, not the sides
    k *= sstep(0.35, 0.85, fb)
    if k <= 0:
        return w
    sr = sstep(-0.10, 0.10, x)
    out = {'skirt': 1.0 - k}
    if sr > 0:
        out['legR'] = k * sr
    if sr < 1:
        out['legL'] = k * (1 - sr)
    return out


RES = {
    'high': dict(cols=49, folds=7, ruffle=14, hull_cols=28, blossoms=7),
    'medium': dict(cols=35, folds=7, ruffle=14, hull_cols=21, blossoms=7),
    'low': dict(cols=18, folds=6, ruffle=0, hull_cols=10, blossoms=0),
}


def rings_for(ruffle, lite=False):
    out = [{'y': y, 'r': r, 'rz': rz, 'c': 'skirt'} for i, (y, r, rz) in enumerate(PROFILE) if not (lite and i in (1, 4, 6))]
    out.append({'y': FLOUNCE_Y, 'r': 0.304, 'rz': 0.290, 'c': 'dress'})
    out.append({'y': 0.370, 'r': 0.318, 'rz': 0.304, 'c': 'dress'})
    out.append({'y': HEM_Y + 0.016, 'r': 0.330, 'rz': 0.316, 'c': 'blossom'})
    out.append({'y': HEM_Y, 'r': 0.328, 'rz': 0.314, 'c': 'blossom'})
    out.append({'y': HEM_Y - 0.004, 'r': 0.316, 'rz': 0.302, 'c': 'skirtDeep'})
    out.append({'y': 0.42, 'r': 0.272, 'rz': 0.258, 'c': 'skirtDeep'})
    out.append({'y': 0.62, 'r': 0.232, 'rz': 0.22, 'c': 'skirtDeep'})
    out.append({'y': 0.76, 'r': 0.0, 'c': 'skirtDeep'})
    return out


def build(tier):
    R = RES[tier]
    folds, ruffle = R['folds'], R['ruffle']
    lite = tier == 'low'
    rings = rings_for(ruffle, lite)
    # The overskirt's own top ring is index 0; the flounce starts after the profile rings.
    fl0 = len(PROFILE) - (3 if lite else 0)

    def fl(y):
        return min(1.0, max(0.0, (FLOUNCE_Y + 0.004 - y) / 0.05))

    def mod(a, i, r):
        k = 1 + fold_amp(r['y']) * math.cos(folds * a)
        if ruffle and i >= fl0:
            k *= 1 + 0.024 * fl(r['y']) * math.cos(ruffle * a)
        return k

    def color(a, i, r):
        if r['c'] == 'skirt' and i < fl0 - 1:
            # The fold valleys a shade deeper (palette colour skirtDeep).
            if -math.cos(folds * a) * fold_amp(r['y']) / FOLD > 0.55:
                return 'skirtDeep'
        if r['c'] == 'skirt' and i == fl0 - 1:
            return 'trim'  # a terracotta band where the flounce is stitched on
        return None

    def sculpt(p, a, i):
        if ruffle and i >= fl0 and p[1] < FLOUNCE_Y - 0.06:
            p = p.copy()
            p[1] += 0.009 * math.cos(ruffle * a) * min(1.0, (FLOUNCE_Y - 0.06 - p[1]) / 0.06)
        return p

    # A band ring just above the flounce seam (terracotta stitch line).
    rings.insert(fl0, {'y': FLOUNCE_Y + 0.016, 'r': 0.302, 'rz': 0.288, 'c': 'skirt'})
    fl0 += 1
    v, f, fc = loft(rings, R['cols'], mod=mod, color=color, sculpt=sculpt)
    sk = Part('skirt', v, f, fc, hull=0.011, weights=skirt_weights)
    if R['hull_cols']:
        hull_rings = [r for r in rings if r['c'] != 'skirtDeep'] + [{'y': HEM_Y - 0.002, 'r': 0.0, 'c': 'skirt'}]
        hv, hf, _ = loft(hull_rings, R['hull_cols'], mod=lambda a, i, r: 1 + fold_amp(r['y']) * math.cos(folds * a))
        sk.hull_src = (hv, hf)
    parts = [sk]
    # Little cream and pink flowers on the flounce, on the fold crests.
    n = R['blossoms']
    for i in range(n):
        a = 2 * math.pi * (i + 0.5 * (n == folds)) / n
        y = 0.362
        k = (1 + fold_amp(y) * math.cos(folds * a)) * (1 + (0.024 * math.cos(ruffle * a) if ruffle else 0)) + 0.012
        pos = np.array([math.sin(a) * 0.318 * k, y, -math.cos(a) * 0.304 * k])
        bv, bf, bfc = ellipsoid(0.022, 0.022, 0.006, 6, 3, 'blossom' if i % 2 else 'blossom2')
        parts.append(Part('blossom', bv, bf, bfc, weights=skirt_weights).transform(frame(pos, (math.sin(a), 0, -math.cos(a)))))
        if False:
            cv, cf, cfc = ellipsoid(0.007, 0.007, 0.004, 5, 3, 'emblem')
            parts.append(Part('blossomHeart', cv, cf, cfc, weights=skirt_weights).transform(frame(pos + np.array([math.sin(a), 0, -math.cos(a)]) * 0.005, (math.sin(a), 0, -math.cos(a)))))
    return parts
