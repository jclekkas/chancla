"""Hair and ruleros: one hair mass with seats for the four rollers, a low bun, and the rulero placements.

The hair is the skull's own surface lifted by a thickness that varies
around the head (a rolled front where the two front rollers sit, fuller
temples where the side rollers sit, volume low at the back), ending at a
hairline that tucks into the skin. The rollers are the game's instanced
pieces: rulero_0..3 give their rest placement (root space), found along
the same directions as the current arena layout and seated on this hair.
"""
import math

import numpy as np

from .head import KEYS, prof
from .mesh import Part, ellipsoid, gauss, sstep, tube, vertex_normals, trs

ROLLER_R, ROLLER_LEN = 0.034, 0.1
SINK = 0.012


def u_at_y(y):
    lo, hi = 0.0, 1.0
    for _ in range(50):
        m = 0.5 * (lo + hi)
        if prof(m)[0] > y:
            lo = m
        else:
            hi = m
    return 0.5 * (lo + hi)


def head_point(a, u):
    y, r, rz, rzB, z = prof(u)
    co = math.cos(a)
    return np.array([r * math.sin(a), y, z - co * (rz if co > 0 else rzB)])


def hairline_y(a):
    """Front (a = 0) high on the forehead, over the ears, down to the nape."""
    w = abs(math.atan2(math.sin(a), math.cos(a)))
    pts = [(0.0, 1.680), (0.45, 1.669), (0.95, 1.624), (1.35, 1.598), (1.62, 1.592), (2.0, 1.52), (2.5, 1.468), (math.pi, 1.452)]
    for (a0, y0), (a1, y1) in zip(pts, pts[1:]):
        if w <= a1:
            t = (w - a0) / (a1 - a0)
            t = t * t * (3 - 2 * t)
            return y0 + (y1 - y0) * t
    return pts[-1][1]


def thickness(a, y, v):
    w = abs(math.atan2(math.sin(a), math.cos(a)))
    t = 0.013
    # The rolled front, swept back from the forehead.
    t += 0.016 * gauss(w / 0.75) * gauss((y - 1.69) / 0.035)
    # Full temples over the ears.
    t += 0.012 * gauss((w - 1.35) / 0.4) * gauss((y - 1.625) / 0.04)
    # Volume low at the back of the head, gathered into the bun.
    t += 0.02 * gauss((w - math.pi) / 0.9) * gauss((y - 1.54) / 0.07)
    # Tuck the edge into the skin.
    t *= 1.0 - sstep(0.80, 1.0, v) * 1.25
    return t


def hair_mass(cols, rows):
    us = []
    angles = [2 * math.pi * j / cols for j in range(cols)]
    verts = [head_point(0, 0) + np.array([0, 0.013, 0])]
    grid = []
    hl = [u_at_y(hairline_y(a)) for a in angles]
    for i in range(1, rows + 1):
        v = i / rows
        row = []
        for j, a in enumerate(angles):
            u = hl[j] * (v ** 0.92)
            p = head_point(a, u)
            # Outward: from the head's centre line, mostly horizontal low down.
            c = np.array([0.0, 1.56, 0.0])
            d = p - c
            d /= np.linalg.norm(d)
            t = thickness(a, p[1], v)
            row.append(len(verts))
            verts.append(p + d * t)
        grid.append(row)
    f, fc = [], []
    for j in range(cols):
        j1 = (j + 1) % cols
        f.append((0, grid[0][j1], grid[0][j]))
    for i in range(rows - 1):
        for j in range(cols):
            j1 = (j + 1) % cols
            f.append((grid[i][j], grid[i][j1], grid[i + 1][j1], grid[i + 1][j]))
    v = np.array(verts)
    fc = []
    for face in f:
        q = v[list(face)].mean(axis=0)
        a = math.atan2(q[0], -q[2])
        # A sheen along the rolled front.
        sheen = abs(a) < 0.9 and 1.70 < q[1] < 1.735 and -q[2] > 0.10
        fc.append('hairHi' if sheen else 'hair')
    # Winding: outward.
    n = vertex_normals(v, f)
    if np.mean(np.einsum('ij,ij->i', n, v - np.array([0, 1.56, 0]))) < 0:
        f = [tuple(reversed(x)) for x in f]
    return v, f, fc


# Current layout (rosa-model.ts rulSpots, team Sol): directions from the old hair ellipsoid's centre.
OLD_HAIR_C = np.array([0.0, 0.122, 0.008])
OLD_HAIR_R = np.array([0.155, 0.163, 0.158])
HEAD_SCALE = 1.12
SPOTS = [
    ((-0.3, 0.62, -0.75), (1, 0, 0)),
    ((0.3, 0.62, -0.75), (1, 0, 0)),
    ((-0.95, 0.42, -0.02), (0, 0.55, 0.84)),
    ((0.95, 0.42, -0.02), (0, 0.55, 0.84)),
]


def _quat_from_units(a, b):
    a = a / np.linalg.norm(a)
    b = b / np.linalg.norm(b)
    v = np.cross(a, b)
    c = float(np.dot(a, b))
    if c < -0.999999:
        return np.array([1.0, 0, 0, 0])  # x, y, z, w (180 about x)
    s = math.sqrt((1 + c) * 2)
    return np.array([v[0] / s, v[1] / s, v[2] / s, s / 2])


def _qmat(q):
    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def old_spots():
    """The current arena placements (head-local scaled by 1.12, then root space)."""
    out = []
    for d, axis in SPOTS:
        u = np.array(d, dtype=float)
        u /= np.linalg.norm(u)
        t = 1 / math.sqrt(np.sum((u / OLD_HAIR_R) ** 2))
        q = u * t
        n = q / OLD_HAIR_R ** 2
        n /= np.linalg.norm(n)
        p = q + OLD_HAIR_C
        ax = np.array(axis, dtype=float)
        ax = ax - n * np.dot(ax, n)
        ax /= np.linalg.norm(ax)
        pos = (p + n * (ROLLER_R - SINK)) * HEAD_SCALE + np.array([0, 1.44, 0])
        m = np.eye(4)
        m[:3, :3] = _qmat(_quat_from_units(np.array([0, 1.0, 0]), ax))
        m[:3, 3] = pos
        out.append((m, n))
    return out


def seat_spots(S):
    """The same layout, each roller sunk SINK into this hair along the old direction."""
    out = []
    c = OLD_HAIR_C * HEAD_SCALE + np.array([0, 1.44, 0])
    for k, (m, n) in enumerate(old_spots()):
        pos = m[:3, 3].copy()
        if k < 2:
            # The front pair rides up onto the rolled front (clear of the brows, under the brim).
            pos += np.array([0.0, 0.015, 0.020])
        d = pos - c
        hit, hn = S.toward(c, d)
        if hit is None or np.dot(hit - c, d) <= 0:
            raise RuntimeError('rulero %d found no seat on the hair' % k)
        mm = m.copy()
        mm[:3, 3] = hit + hn * (ROLLER_R - SINK)
        out.append(mm)
    return out


def hair_weights(p):
    return {'head': 1.0}


RES = {
    'high': dict(cols=26, rows=11, bun=(10, 7), hull=(16, 7)),
    'medium': dict(cols=22, rows=9, bun=(8, 6), hull=(14, 6)),
    'low': dict(cols=14, rows=6, bun=(7, 5), hull=(10, 4)),
}


def build(tier):
    R = RES[tier]
    parts = []
    v, f, fc = hair_mass(R['cols'], R['rows'])
    h = Part('hair', v, f, fc, hull=0.010, weights=hair_weights)
    if R['hull']:
        hv, hf, _ = hair_mass(*R['hull'])
        h.hull_src = (hv, hf)
    parts.append(h)
    # The low bun, wrapped by a ribbon in the team trim.
    bv, bf, bfc = ellipsoid(0.084, 0.072, 0.068, R['bun'][0], R['bun'][1], 'hair')
    bun = Part('bun', bv, bf, bfc, hull=0.009 if tier != 'low' else 0.0, weights=hair_weights).transform(trs(0, 1.512, 0.196, 0.25, 0, 0))
    parts.append(bun)
    nr = 13 if tier != 'low' else 9
    ring = [np.array([0.064 * math.cos(t), 1.512 + 0.056 * math.sin(t) + 0.0, 0.160 + 0.012 * math.sin(t)]) for t in np.linspace(0, 2 * math.pi, nr)]
    rv, rf, rfc = tube(ring + [ring[1]], [0.0095] * (nr + 1), 4 if tier != 'low' else 3, 'trim', cap=False, up=(0, 0, 1))
    parts.append(Part('ribbon', rv, rf, rfc, weights=hair_weights))
    return parts
