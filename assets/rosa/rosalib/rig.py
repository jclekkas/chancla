"""The joints (rosa-rig.ts RIG, root space) and the scripted skin weights."""
import math

import numpy as np

from .mesh import sstep

J = {
    'hips': (0.0, 0.86, 0.0),
    'torso': (0.0, 0.86, 0.0),
    'head': (0.0, 1.44, 0.0),
    'armR': (0.22, 1.30, 0.0), 'foreR': (0.22, 0.98, 0.0), 'wristR': (0.22, 0.67, 0.0),
    'armL': (-0.22, 1.30, 0.0), 'foreL': (-0.22, 0.98, 0.0), 'wristL': (-0.22, 0.67, 0.0),
    'legR': (0.10, 0.81, 0.0), 'shinR': (0.10, 0.41, 0.0), 'footR': (0.10, -0.02, 0.0),
    'legL': (-0.10, 0.81, 0.0), 'shinL': (-0.10, 0.41, 0.0), 'footL': (-0.10, -0.02, 0.0),
    # Secondary motion: the skirt hangs from the waist (hips + SKIRT_PIVOT 0.08).
    'skirt': (0.0, 0.94, 0.0),
    # The hat's brim flexes about the crown's seat on the head.
    'hatBrim': (0.0, 1.734, 0.0),
}
PARENT = {
    'hips': None, 'torso': 'hips', 'head': 'torso',
    'armR': 'torso', 'foreR': 'armR', 'wristR': 'foreR',
    'armL': 'torso', 'foreL': 'armL', 'wristL': 'foreL',
    'legR': 'hips', 'shinR': 'legR', 'footR': 'shinR',
    'legL': 'hips', 'shinL': 'legL', 'footL': 'shinL',
    'skirt': 'hips', 'hatBrim': 'head',
}
BONES = list(J.keys())


def rigid(bone):
    return lambda p: {bone: 1.0}


def normalize(w, maxn=4, floor=0.02):
    items = sorted(((k, v) for k, v in w.items() if v > 1e-6), key=lambda kv: (-kv[1], kv[0]))[:maxn]
    items = [(k, v) for k, v in items if v >= floor] or items[:1]
    s = sum(v for _, v in items)
    return {k: v / s for k, v in items}


def blend2(a, b, t):
    """Weights a -> b by t (0..1)."""
    if t <= 0:
        return {a: 1.0}
    if t >= 1:
        return {b: 1.0}
    return {a: 1.0 - t, b: t}


def mix(w1, w2, t):
    out = {}
    for k, v in w1.items():
        out[k] = out.get(k, 0.0) + v * (1 - t)
    for k, v in w2.items():
        out[k] = out.get(k, 0.0) + v * t
    return out


def arm_chain(side):
    """Upper arm -> forearm -> wrist by height along the hanging arm (rest), smooth at the elbow and wrist."""
    s = 'R' if side > 0 else 'L'

    def w(p):
        y = p[1]
        e = J['fore' + s][1]
        wr = J['wrist' + s][1]
        if y > e + 0.045:
            return {'arm' + s: 1.0}
        if y > e - 0.045:
            return blend2('arm' + s, 'fore' + s, sstep(e + 0.045, e - 0.045, y))
        if y > wr + 0.03:
            return {'fore' + s: 1.0}
        return blend2('fore' + s, 'wrist' + s, sstep(wr + 0.03, wr - 0.02, y))
    return w


def leg_chain(side):
    s = 'R' if side > 0 else 'L'

    def w(p):
        y = p[1]
        k = J['shin' + s][1]
        a = J['foot' + s][1]
        if y > k + 0.05:
            return {'leg' + s: 1.0}
        if y > k - 0.05:
            return blend2('leg' + s, 'shin' + s, sstep(k + 0.05, k - 0.05, y))
        if y > a + 0.07:
            return {'shin' + s: 1.0}
        return blend2('shin' + s, 'foot' + s, sstep(a + 0.07, a + 0.02, y))
    return w


def spine(p):
    """Pelvis -> torso at the waist pivot, torso -> head along the neck."""
    y = p[1]
    if y < 0.95:
        return blend2('hips', 'torso', sstep(0.80, 0.93, y))
    if y < 1.38:
        return {'torso': 1.0}
    return blend2('torso', 'head', sstep(1.40, 1.50, y))


def seg_dist(p, a, b):
    a, b, p = np.asarray(a), np.asarray(b), np.asarray(p)
    ab = b - a
    t = float(np.clip(np.dot(p - a, ab) / np.dot(ab, ab), 0, 1))
    return float(np.linalg.norm(p - (a + ab * t))), t
