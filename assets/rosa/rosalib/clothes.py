"""Pieces laid on the body surface: the scalloped cream collar, the sash bow and its tails,
the sun badge on the back and the embroidered flowers on the blouse front."""
import math

import numpy as np

from . import body
from .mesh import Part, ellipsoid, frame, trs, tube, vertex_normals
from .skirt import skirt_weights


def collar(S, cols, rows, scallops=9):
    C = np.array([0.0, 1.20, 0.004])
    e0 = math.radians(73)
    top, under = [], []
    for j in range(cols):
        a = 2 * math.pi * j / cols
        # The scalloped outer edge: a little lower at each scallop's middle; deeper at the front.
        sc = abs(math.cos(scallops * a / 2))
        e1 = math.radians(40 - 5.0 * sc - 3.0 * max(0.0, math.cos(a)))
        rt, ru = [], []
        for i in range(rows + 1):
            e = e0 + (e1 - e0) * i / rows
            d = np.array([math.sin(a) * math.cos(e), math.sin(e), -math.cos(a) * math.cos(e)])
            p, n = S.toward(C, d)
            lift = 0.0065 + 0.004 * i / rows  # the collar stands off a little more at its edge
            rt.append(p + n * lift)
            if i in (0, rows):
                ru.append(p + n * 0.0012)
        top.append(rt)
        under.append(ru)
    # Rows per column: top 0..rows, then the edge's underside, then the inner underside.
    nr = rows + 3
    v = []
    for j in range(cols):
        v += top[j] + [under[j][1], under[j][0]]
    v = np.array(v)
    f, fc = [], []
    for j in range(cols):
        j1 = (j + 1) % cols
        for i in range(nr):
            i1 = (i + 1) % nr
            f.append((j * nr + i, j1 * nr + i, j1 * nr + i1, j * nr + i1))
            fc.append('collar')
    p = Part('collar', v, f, fc, hull=0.006, weights=body.weights)
    n = vertex_normals(p.v, p.f)
    if np.mean(n[:, 1]) < 0:
        p.f = [tuple(reversed(x)) for x in p.f]
    return p


def on_back(S, x, y, lift):
    p, n = S.ray((x, y, 1.0), (0, 0, -1))
    if n[2] < 0:
        n = -n
    return p + n * lift, n


def disc(S, cx, cy, r, rings, seg, lift, c, back=True):
    v, f, fc = [], [], []
    v.append(on_back(S, cx, cy, lift)[0])
    for i in range(1, rings + 1):
        for j in range(seg):
            a = 2 * math.pi * j / seg
            v.append(on_back(S, cx + r * i / rings * math.cos(a), cy + r * i / rings * math.sin(a), lift)[0])
    for j in range(seg):
        f.append((0, 1 + (j + 1) % seg, 1 + j))
        fc.append(c)
    for i in range(1, rings):
        o0, o1 = 1 + (i - 1) * seg, 1 + i * seg
        for j in range(seg):
            j1 = (j + 1) % seg
            f.append((o0 + j, o0 + j1, o1 + j1, o1 + j))
            fc.append(c)
    p = Part('disc', np.array(v), f, fc, weights=body.weights)
    n = vertex_normals(p.v, p.f)
    if np.mean(n[:, 2]) < 0:
        p.f = [tuple(reversed(x)) for x in p.f]
    return p


def badge(S, tier):
    seg = {'high': 20, 'medium': 14, 'low': 10}[tier]
    parts = [disc(S, 0, 1.112, 0.094, 2 if tier != 'low' else 1, seg, 0.003, 'patch')]
    parts.append(disc(S, 0, 1.112, 0.042, 1, max(8, seg - 4), 0.0065, 'emblem'))
    for i in range(8 if tier != 'low' else 0):
        a = 2 * math.pi * i / 8
        tip = (math.sin(a) * 0.080, 1.112 + math.cos(a) * 0.080)
        b0 = (math.sin(a - 0.24) * 0.052, 1.112 + math.cos(a - 0.24) * 0.052)
        b1 = (math.sin(a + 0.24) * 0.052, 1.112 + math.cos(a + 0.24) * 0.052)
        v = np.array([on_back(S, *q, 0.0065)[0] for q in (b0, tip, b1)])
        p = Part('ray', v, [(0, 1, 2)], ['emblem'], weights=body.weights)
        n = vertex_normals(p.v, p.f)
        if n[0, 2] < 0:
            p.f = [(2, 1, 0)]
        parts.append(p)
    return parts


def bow(S, Sk, tier):
    parts = []
    sm = 6 if tier == 'high' else 5
    yb = 0.952
    c, n = on_back(S, 0, yb, 0.012)
    for side in (1, -1):
        bv, bf, bfc = ellipsoid(0.052, 0.033, 0.018, sm + 1, 4, 'sash')
        parts.append(Part('bow', bv, bf, bfc, hull=0.006 if tier != 'low' else 0, weights=body.weights).transform(
            trs(c[0] + side * 0.046, c[1] + 0.004, c[2] + 0.006, 0, 0, side * 0.35)))
    kv, kf, kfc = ellipsoid(0.019, 0.021, 0.017, sm, 4, 'sash')
    if tier != 'low':
        parts.append(Part('knot', kv, kf, kfc, weights=body.weights).transform(trs(c[0], c[1], c[2] + 0.012)))
    for side in (1, -1) if tier != 'low' else ():
        pts = []
        for k, (x, y) in enumerate(((0.012, 0.935), (0.03, 0.88), (0.045, 0.82), (0.056, 0.77))):
            p, nn = Sk.ray((side * x, y, 1.0), (0, 0, -1))
            if p is None:
                p, nn = on_back(S, side * x, y, 0)
            pts.append(p + np.array([0, 0, 0.011 + 0.004 * k]))
        tv, tf, tfc = tube(pts, [0.012, 0.013, 0.013, 0.011], 5, 'sash', up=(0, 0, 1), rz=[0.004] * 4)
        parts.append(Part('tail', tv, tf, tfc, weights=skirt_weights))
    return parts


def embroidery(S):
    parts = []
    for i, x in enumerate((-0.10, -0.05, 0.0, 0.05, 0.10)):
        y = 1.252 - abs(x) * 0.3
        p, n = S.front(x, y)
        bv, bf, bfc = ellipsoid(0.0125, 0.0125, 0.004, 6, 3, 'blossom2' if x == 0 else 'button')
        parts.append(Part('flower', bv, bf, bfc, weights=body.weights).transform(frame(p + n * 0.003, n)))
    return parts
