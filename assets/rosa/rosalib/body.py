"""The body: torso, neck, arms and hands as ONE connected surface.

A Skin modifier over a vertex skeleton gives one quad cage with clean
branches at the shoulders; a Subdivision smooths it. The result is then
shaped toward analytic profiles (the bodice's bust, back and cinched
waist; the gathered sleeve puffs; the fist), painted by region (marigold
bodice and sleeves, terracotta sash, cream cuffs, gold bangles, skin) and
weighted along the chains with smooth blends at the shoulders, elbows,
wrists, waist and neck.
"""
import math

import numpy as np

from . import blend
from .mesh import Part, gauss, sstep
from .rig import J, arm_chain, blend2, mix, spine

# Torso skeleton (centre line), three space: (y, half-width, half-depth, z).
TORSO = [
    (0.79, 0.130, 0.118, 0.004),
    (0.88, 0.140, 0.124, 0.004),
    (0.955, 0.130, 0.114, 0.0),
    (1.05, 0.160, 0.140, -0.004),
    (1.15, 0.182, 0.158, -0.010),
    (1.245, 0.168, 0.132, 0.000),
    (1.325, 0.118, 0.104, 0.006),
    (1.395, 0.060, 0.058, 0.010),
    (1.47, 0.054, 0.054, 0.014),
    (1.53, 0.048, 0.048, 0.016),
]
SHOULDER_NODE = 6
# The arm, offset outward of the joint line so it hangs clear of the bodice: (x, y, z, r, rz).
ARM = [
    (0.150, 1.338, 0.006, 0.070, 0.068),
    (0.214, 1.318, 0.006, 0.084, 0.080),
    (0.252, 1.225, 0.006, 0.094, 0.090),
    (0.260, 1.138, 0.004, 0.074, 0.072),
    (0.260, 1.090, 0.002, 0.054, 0.054),
    (0.256, 0.980, 0.000, 0.048, 0.048),
    (0.252, 0.900, -0.004, 0.052, 0.051),
    (0.240, 0.705, -0.008, 0.035, 0.034),
]
# Hands (absolute x for the right side, mirrored for the left): (x, y, z, r, rz).
RHAND = [
    (0.224, 0.606, -0.020, 0.054, 0.058),
]
RTHUMB = [(0.190, 0.622, -0.066, 0.018, 0.017)]
LHAND = [
    (0.238, 0.600, -0.010, 0.032, 0.046),
]
LTHUMB = [(0.214, 0.616, -0.050, 0.015, 0.014)]

# Bodice target (y, half-width, front depth, back depth, centre z), waist to chest.
BODICE = [
    (0.78, 0.128, 0.116, 0.116, 0.004),
    (0.88, 0.138, 0.122, 0.122, 0.004),
    (0.95, 0.126, 0.112, 0.112, 0.002),
    (1.00, 0.136, 0.124, 0.116, 0.0),
    (1.06, 0.156, 0.146, 0.122, -0.002),
    (1.12, 0.172, 0.170, 0.128, -0.004),
    (1.17, 0.178, 0.176, 0.132, -0.004),
    (1.22, 0.176, 0.156, 0.136, -0.002),
    (1.27, 0.168, 0.128, 0.134, 0.002),
]
SASH = (0.918, 0.992)
NECKLINE = 1.352  # front; the back sits a little higher


def _interp(table, y):
    if y <= table[0][0]:
        return table[0][1:]
    for a, b in zip(table, table[1:]):
        if y <= b[0]:
            t = (y - a[0]) / (b[0] - a[0])
            t = t * t * (3 - 2 * t)
            return tuple(a[k] + (b[k] - a[k]) * t for k in range(1, len(a)))
    return table[-1][1:]


def skeleton(lite=False):
    verts, edges, radii = [], [], []

    def add(p, r):
        verts.append(p)
        radii.append(r)
        return len(verts) - 1

    torso = [t for i, t in enumerate(TORSO) if not (lite and i in (1, 8))]
    arm_nodes = [a for i, a in enumerate(ARM) if not (lite and i in (4, 6))]
    tid = [add((0.0, y, z), (r, rz)) for y, r, rz, z in torso]
    edges += list(zip(tid, tid[1:]))
    for side in (1, -1):
        prev = tid[SHOULDER_NODE - (1 if lite else 0)]
        for x, y, z, r, rz in arm_nodes:
            i = add((side * x, y, z), (r, rz))
            edges.append((prev, i))
            prev = i
        hand = RHAND if side > 0 else LHAND
        thumb = RTHUMB if side > 0 else LTHUMB
        first = None
        for x, y, z, r, rz in hand:
            i = add((side * x, y, z), (r, rz))
            edges.append((prev, i))
            prev = i
            first = first if first is not None else i
        tp = first
        for x, y, z, r, rz in thumb:
            i = add((side * x, y, z), (r, rz))
            edges.append((tp, i))
            tp = i
    return verts, edges, radii


def _arm_polyline(side):
    pts = [np.array([side * x, y, z]) for x, y, z, _, _ in ARM]
    hand = RHAND if side > 0 else LHAND
    pts += [np.array([side * x, y, z]) for x, y, z, _, _ in hand]
    return pts


def _nearest_on_polyline(p, pts):
    best = (1e9, 0, 0.0)
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        ab = b - a
        t = float(np.clip(np.dot(p - a, ab) / np.dot(ab, ab), 0, 1))
        d = float(np.linalg.norm(p - (a + ab * t)))
        if d < best[0]:
            best = (d, i, t)
    return best


def armness(p):
    """0 on the torso and neck, 1 on an arm, blended over the shoulder."""
    x, y = abs(p[0]), p[1]
    if y < 1.08:
        return 1.0 if x > 0.165 else 0.0
    if y < 1.20:
        return 1.0 if x > 0.19 else 0.0
    # Over the shoulder: a smooth ramp outward from the neck to the shoulder's end.
    k = sstep(0.12, 0.25, x)
    # Below the armpit, the arm is separate from the side of the bodice.
    if y < 1.27 and x > 0.185:
        k = max(k, sstep(1.27, 1.21, y))
    return k


def shape(v):
    """Pull the cage toward the bodice and sleeve profiles (rest pose)."""
    out = v.copy()
    polys = {1: _arm_polyline(1), -1: _arm_polyline(-1)}
    for i, p in enumerate(v):
        x, y, z = p
        am = armness(p)
        # ---- bodice
        tw = (1 - am) * sstep(1.30, 1.24, y) * sstep(0.74, 0.80, y)
        if tw > 0:
            W, Df, Db, z0 = _interp(BODICE, y)
            a = math.atan2(x, -(z - z0))
            co = math.cos(a)
            k = 1.0
            # The bust: two soft swells on the front.
            k += 0.07 * gauss((y - 1.150) / 0.055) * gauss((abs(a) - 0.6) / 0.38) * max(0.0, co) ** 0.5
            # A sturdy, rounded belly under the bust.
            k += 0.03 * gauss((y - 1.03) / 0.05) * max(0.0, co) ** 2
            # The sash: a gathered band standing off the waist.
            if SASH[0] - 0.01 < y < SASH[1] + 0.01:
                k += 0.05 * sstep(SASH[0] - 0.012, SASH[0] + 0.006, y) * sstep(SASH[1] + 0.012, SASH[1] - 0.006, y)
            tgt = np.array([W * k * math.sin(a), y, z0 - co * (Df if co > 0 else Db) * k])
            out[i] = p + (tgt - p) * tw
        # ---- sleeves: gathered pleats on the puff, a rolled edge on the cuff
        if am > 0:
            side = 1 if x > 0 else -1
            d, seg, t = _nearest_on_polyline(p, polys[side])
            if seg <= 2:
                pts = polys[side]
                c = pts[seg] + (pts[seg + 1] - pts[seg]) * t
                rv = p - c
                ax = pts[seg + 1] - pts[seg]
                ax /= np.linalg.norm(ax)
                rv -= ax * np.dot(rv, ax)
                ang = math.atan2(rv[2], rv[0] * side)
                s = seg + t  # 0 .. 3 along the puff
                pleat = 0.07 * math.cos(9 * ang) * sstep(0.3, 1.0, s) * sstep(2.9, 2.3, s)
                out[i] = out[i] + rv * pleat * am
    return out


def colour(c, p):
    x, y, z = p
    am = armness(p)
    if am > 0.5 and y < 1.25:
        side = 1 if x > 0 else -1
        if y > 1.118:
            return 'dress'
        if y > 1.088:
            return 'button'  # the cream cuff
        if 0.665 < y < 0.705:
            return 'bangle'
        return 'skin'
    # Torso and neck.
    front = max(0.0, -z / max(1e-6, math.hypot(x, z)))
    if y > NECKLINE + 0.03 * (1 - front) - 0.02 * front ** 3:
        return 'skin'
    if y < SASH[0] - 0.002:
        return 'skirtDeep'
    if y < SASH[1]:
        return 'sash'
    return 'dress'


def weights(p):
    am = armness(p)
    w_t = spine(p)
    if am <= 0:
        return w_t
    side = 1 if p[0] > 0 else -1
    w_a = arm_chain(side)(p)
    if am >= 1:
        return w_a
    return mix(w_t, w_a, am)


def _thin_region(p):
    x, y = abs(p[0]), p[1]
    if 0.55 < y < 1.215:
        return True
    return 1.40 < y < 1.55 and x < 0.09


KEEP_Y = (SASH[0], SASH[1], 1.088, 1.118, 0.665, 0.705, 0.80)


def build(levels=2, thin=False, lite=False):
    v, e, r = skeleton(lite)
    v, f = blend.skin_cage('body', v, e, r, root=0, levels=levels)
    if thin:
        v, f = blend.thin_rings(v, f, KEEP_Y, _thin_region)
        # A second pass on the straight forearms (the elbow and wrist keep their rings).
        v, f = blend.thin_rings(v, f, KEEP_Y, lambda p: abs(p[0]) > 0.19 and 0.74 < p[1] < 0.92)
    return v, f


def make_part(levels=2, hull_levels=1, hull=0.010, thin=False, lite=False):
    v, f = build(levels, thin, lite)
    v = shape(v)
    fc = [colour(None, v[list(face)].mean(axis=0)) for face in f]
    p = Part('body', v, f, fc, hull=hull, weights=weights)
    if hull_levels is not None and hull_levels != levels:
        hv, hf = build(hull_levels, thin, lite)
        p.hull_src = (shape(hv), hf)
    return p
