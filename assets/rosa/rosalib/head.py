"""The head as one shaped form, and the face laid on it.

The skull, cheeks, jaw, chin, muzzle and nose are a single lofted surface:
a profile (crown to under the chin; half-width, front and back depth) with
its columns and rows packed toward the face, then sculpted by smooth
displacements (a round grandmother's nose with its bridge and wings, the
muzzle, apple cheeks, eye sockets, a brow ridge, a small chin). The eyes
and brows are small separate shells tagged for the blink and brow shader;
the lips, ears and the cat-eye glasses sit on the surface (ray cast).
"""
import math

import numpy as np

from .mesh import Part, ellipsoid, frame, gauss, loft, sstep, tube, apply, trs
from .surf import Surface

HEAD_Y = 1.44
# (y, half-width, front depth, back depth, centre z), root space (the old arena profile at 1.12, refined).
KEYS = [
    (1.742, 0.0, 0.0, 0.0, 0.007),
    (1.728, 0.080, 0.074, 0.090, 0.007),
    (1.698, 0.124, 0.118, 0.140, 0.007),
    (1.655, 0.148, 0.144, 0.164, 0.006),
    (1.607, 0.157, 0.158, 0.170, 0.003),
    (1.562, 0.160, 0.163, 0.166, 0.0),
    (1.518, 0.166, 0.160, 0.152, -0.002),
    (1.478, 0.160, 0.156, 0.130, -0.004),
    (1.443, 0.136, 0.146, 0.100, -0.007),
    (1.412, 0.094, 0.130, 0.070, -0.009),
    (1.393, 0.046, 0.104, 0.038, -0.013),
    (1.385, 0.0, 0.0, 0.0, -0.05),
]
EYE = (0.057, 1.579)
BROW = {'in': (0.022, 1.630), 'top': (0.064, 1.659), 'out': (0.109, 1.645)}
NOSE_Y = 1.522
MOUTH_Y = 1.479


def _cr(p0, p1, p2, p3, t):
    t2, t3 = t * t, t * t * t
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)


def prof(u):
    n = len(KEYS) - 1
    f = min(n - 1e-9, max(0.0, u * n))
    i = int(f)
    t = f - i
    k = lambda j: KEYS[min(n, max(0, j))]
    out = [_cr(k(i - 1)[c], k(i)[c], k(i + 1)[c], k(i + 2)[c], t) for c in range(5)]
    for c in (1, 2, 3):
        out[c] = max(0.0, out[c])
    return out


def sculpt(p, a):
    x, y, z = p
    co = math.cos(a)
    if co <= -0.2:
        return p
    fr = max(0.0, co)
    ax = abs(x)
    fwd = 0.0
    # The nose: a round tip, its bridge rising to the brow, soft wings.
    fwd += 0.037 * gauss(x / 0.023) * gauss((y - NOSE_Y) / 0.021)
    fwd += 0.014 * gauss(x / 0.0125) * sstep(1.600, 1.555, y) * sstep(1.505, 1.530, y)
    fwd += 0.009 * gauss((ax - 0.0205) / 0.0105) * gauss((y - (NOSE_Y - 0.006)) / 0.0105)
    # The muzzle round the mouth, a small chin, the brow ridge.
    fwd += 0.013 * gauss(x / 0.052) * gauss((y - MOUTH_Y) / 0.030)
    fwd += 0.010 * gauss(x / 0.030) * gauss((y - 1.414) / 0.016)
    fwd += 0.006 * gauss((y - 1.617) / 0.014) * gauss(x / 0.095)
    # Eye sockets, so the eyes sit into the face under the brow.
    fwd -= 0.009 * gauss((ax - EYE[0]) / 0.026) * gauss((y - EYE[1]) / 0.020)
    # A soft groove under the lower lip.
    fwd -= 0.004 * gauss(x / 0.03) * gauss((y - 1.452) / 0.008)
    q = np.array([x, y, z - fwd * fr])
    # Apple cheeks: a swell out to the front-sides.
    ch = 0.017 * gauss((ax - 0.090) / 0.036) * gauss((y - 1.512) / 0.030) * fr
    rad = np.array([x, 0.0, z])
    ln = np.linalg.norm(rad)
    if ln > 1e-6:
        q += rad / ln * ch
    return q


def skull(cols, rows, c_warp=0.6, r_warp=0.55):
    angles = []
    for j in range(cols):
        s = 2 * math.pi * j / cols
        angles.append(s - c_warp * math.sin(s))
    rings = []
    for k in range(rows + 1):
        t = k / rows
        g = lambda q: q - r_warp * math.sin(2 * math.pi * (q - 0.62)) / (2 * math.pi)
        u = g(t) - g(0.0)
        y, r, rz, rzB, z = prof(min(1.0, max(0.0, u)))
        if k in (0, rows):
            r = rz = rzB = 0.0
        rings.append({'y': y, 'r': r, 'rz': rz, 'rzB': rzB, 'z': z, 'c': 'skin'})
    v, f, fc = loft(rings, angles, sculpt=lambda p, a, i: sculpt(p, a))
    return v, f, fc


def head_weights(p):
    return {'head': 1.0}


RES = {
    'high': dict(cols=34, rows=24, hull=(22, 14), eye=(9, 6), iris=(8, 5), brow=7, brow_seg=6, lip=9, frame=18, ears=True, hoops=True, hilite=True),
    'medium': dict(cols=26, rows=18, hull=(16, 11), eye=(8, 5), iris=(6, 4), brow=5, brow_seg=5, lip=7, frame=16, ears=True, hoops=False, hilite=True),
    'low': dict(cols=18, rows=13, hull=(12, 9), eye=(6, 4), iris=(5, 3), brow=4, brow_seg=4, lip=5, frame=9, ears=False, hoops=False, hilite=False),
}


def _cat_eye_outline(n):
    """The bold cat-eye frame (old arena shape at 1.12): outer and inner contours, polar about its centre."""
    def quad(p0, p1, p2, k=12):
        return [((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1]) for t in np.linspace(0, 1, k, endpoint=False)]
    s = 1.12
    o = []
    o += quad((-0.043, -0.004), (-0.042, -0.033), (-0.004, -0.031))
    o += quad((-0.004, -0.031), (0.039, -0.029), (0.047, 0.004))
    o += quad((0.047, 0.004), (0.056, 0.03), (0.068, 0.043))
    o += quad((0.068, 0.043), (0.022, 0.034), (-0.006, 0.03))
    o += quad((-0.006, 0.03), (-0.045, 0.026), (-0.043, -0.004))
    h = []
    h += quad((-0.034, -0.003), (-0.033, -0.024), (-0.003, -0.023))
    h += quad((-0.003, -0.023), (0.033, -0.022), (0.038, 0.003))
    h += quad((0.038, 0.003), (0.033, 0.023), (-0.004, 0.022))
    h += quad((-0.004, 0.022), (-0.035, 0.02), (-0.034, -0.003))
    o = np.array(o) * s
    h = np.array(h) * s
    c = np.array([0.002, 0.0])

    def polar(poly, th):
        # Intersect a ray from c at angle th with the polygon (farthest hit).
        d = np.array([math.cos(th), math.sin(th)])
        best = 0.0
        for i in range(len(poly)):
            a, b = poly[i], poly[(i + 1) % len(poly)]
            e = b - a
            m = np.array([[d[0], -e[0]], [d[1], -e[1]]])
            if abs(np.linalg.det(m)) < 1e-12:
                continue
            tt, ss = np.linalg.solve(m, a - c)
            if tt > 0 and 0 <= ss <= 1:
                best = max(best, tt)
        return c + d * best
    ths = [2 * math.pi * i / n for i in range(n)]
    return np.array([polar(o, t) for t in ths]), np.array([polar(h, t) for t in ths])


def glasses(S, side, n, ey):
    """One frame (side +1 her right, +x), wrapped a little to the face, `lift` in front of it."""
    outer, inner = _cat_eye_outline(n)
    if side < 0:
        outer[:, 0] *= -1
        inner[:, 0] *= -1
    ex = side * EYE[0]
    pc, _ = S.front(ex, ey)
    zc = pc[2] - 0.024

    def place(uv, dz):
        X, Y = ex + uv[0], ey + 0.001 + uv[1]
        ps, _ = S.front(X, Y)
        zs = ps[2] if ps is not None else pc[2] + 0.04
        return np.array([X, Y, zc + 0.30 * (zs - pc[2]) + dz])
    rows = [[place(p, -0.0045) for p in outer], [place(p, -0.0045) for p in inner],
            [place(p, 0.0045) for p in inner], [place(p, 0.0045) for p in outer]]
    v = np.array([q for r in rows for q in r])
    f = []
    for r in range(4):
        r1 = (r + 1) % 4
        for j in range(n):
            j1 = (j + 1) % n
            f.append((r * n + j, r * n + j1, r1 * n + j1, r1 * n + j))
    if side < 0:
        f = [tuple(reversed(x)) for x in f]
    p = Part('frame', v, f, ['frames'] * len(f), weights=head_weights)
    # Orient outward: the front strip must face -z.
    from .mesh import vertex_normals
    nrm = vertex_normals(p.v, p.f)
    if nrm[:n, 2].mean() > 0:
        p.f = [tuple(reversed(x)) for x in p.f]
    return p, outer, inner


def build(tier):
    R = RES[tier]
    parts = []
    v, f, fc = skull(R['cols'], R['rows'])
    hd = Part('head', v, f, fc, hull=0.010, weights=head_weights)
    hv, hf, _ = skull(*R['hull'])
    hd.hull_src = (hv, hf)
    parts.append(hd)
    S = Surface(v, f)

    def on(x, y, lift):
        p, n = S.front(x, y)
        return p + n * lift, n

    # ---- eyes (tag -1): whites sunk in the sockets, dark irises looking a touch inward, a highlight
    for side in (1, -1):
        ex, ey = side * EYE[0], EYE[1]
        p, n = on(ex, ey, 0.0005)
        ev, ef, efc = ellipsoid(0.031, 0.0235, 0.0125, R['eye'][0], R['eye'][1], 'eyeWhite')
        e = Part('eye', ev, ef, efc, tag=-1, weights=head_weights).transform(frame(p, n))
        parts.append(e)
        p2, n2 = on(ex - side * 0.004, ey - 0.002, 0.0)
        iv, i_f, ifc = ellipsoid(0.0158, 0.0192, 0.006, R['iris'][0], R['iris'][1], 'iris')
        parts.append(Part('iris', iv, i_f, ifc, tag=-1, weights=head_weights).transform(frame(p2 + n2 * 0.0108, n2)))
        if R['hilite']:
            p3, n3 = on(ex - side * 0.009, ey + 0.006, 0.0)
            gv, gf, gfc = ellipsoid(0.0048, 0.0048, 0.002, 5, 3, 'eyeWhite')
            parts.append(Part('glint', gv, gf, gfc, tag=-1, weights=head_weights).transform(frame(p3 + n3 * 0.0168, n3)))
    # ---- brows (her left -2 at -x, right -3): bold arches, inner ends low
    for side in (1, -1):
        pts = []
        for t in np.linspace(0, 1, R['brow']):
            a, b, c = BROW['in'], BROW['top'], BROW['out']
            x = (1 - t) ** 2 * a[0] + 2 * (1 - t) * t * b[0] + t * t * c[0]
            y = (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * b[1] + t * t * c[1]
            q, nn = on(side * x, y, 0.0045)
            pts.append(q)
        if side < 0:
            pts = pts[::-1]
        ts = np.linspace(0, 1, R['brow'])
        thick = [0.0105 * (1 - 0.45 * (tt if side > 0 else 1 - tt)) for tt in ts]
        bv, bf, bfc = tube(pts, thick, R['brow_seg'], 'hair', up=(0, 0, -1), rz=[0.0045] * len(pts))
        parts.append(Part('brow', bv, bf, bfc, tag=-2 if side < 0 else -3, weights=head_weights))
    # ---- lips: a full red upper and lower lip, the corners up in a knowing smirk
    def ym(x):
        return MOUTH_Y + 2.6 * x * x - 0.05 * x
    for (y0, w, th, dep) in ((0.0055, 0.034, 0.0080, 0.0068), (-0.0052, 0.028, 0.0088, 0.0072)):
        xs = np.linspace(-w, w, R['lip'])
        pts = [on(x, ym(x) + y0 * (1 - 0.6 * (x / w) ** 2), 0.0012)[0] for x in xs]
        rad = [th * (0.35 + 0.65 * math.sqrt(max(0.0, 1 - (x / w) ** 2))) for x in xs]
        lv, lf, lfc = tube(pts, rad, 5 if tier != 'low' else 4, 'lips', up=(0, 0, -1), rz=[dep * (0.4 + 0.6 * math.sqrt(max(0.0, 1 - (x / w) ** 2))) for x in xs])
        parts.append(Part('lip', lv, lf, lfc, weights=head_weights))
    # ---- blush on the cheeks (High, Medium)
    if tier != 'low':
        for side in (1, -1):
            p, n = on(side * 0.098, 1.512, 0.0)
            bv, bf, bfc = ellipsoid(0.026, 0.015, 0.0035, 8, 4, 'blush')
            parts.append(Part('blush', bv, bf, bfc, weights=head_weights).transform(frame(p - n * 0.0005, n)))
    # ---- ears with gold hoops
    if R['ears']:
        for side in (1, -1):
            ev, ef, efc = ellipsoid(0.017, 0.033, 0.024, 8, 6, 'skin')
            ear = Part('ear', ev, ef, efc, hull=0.0, weights=head_weights)
            ear.transform(trs(side * 0.160, 1.552, 0.016, 0, 0, -side * 0.15))
            parts.append(ear)
            if R['hoops']:
                ring = [(side * 0.168, 1.513 + 0.0145 * math.cos(t), 0.016 + 0.0145 * math.sin(t)) for t in np.linspace(0, 2 * math.pi, 11)[:-1]]
                ring.append(ring[0])
                rv, rf, rfc = tube(ring + [ring[1]], [0.0038] * (len(ring) + 1), 3, 'gold', cap=False, up=(1, 0, 0))
                parts.append(Part('hoop', rv, rf, rfc, weights=head_weights))
    # ---- cat-eye glasses: two frames, a bridge over the nose, temples back to the ears
    ey = EYE[1]
    for side in (1, -1):
        fp, outer, inner = glasses(S, side, R['frame'], ey)
        parts.append(fp)
    zb = on(0, ey + 0.004, 0)[0][2] - 0.012
    bp = [np.array([-0.019, ey + 0.004, zb + 0.004]), np.array([0, ey + 0.007, zb]), np.array([0.019, ey + 0.004, zb + 0.004])]
    bv, bf, bfc = tube(bp, [0.0042] * 3, 5, 'frames', up=(0, 0, -1))
    parts.append(Part('bridge', bv, bf, bfc, weights=head_weights))
    if tier != 'low':
        for side in (1, -1):
            a = on(side * 0.108, ey + 0.016, 0.0)[0]
            a = np.array([side * 0.110, ey + 0.016, a[2] - 0.016])
            b = np.array([side * 0.160, ey + 0.006, -0.03])
            c = np.array([side * 0.163, ey - 0.004, 0.012])
            tv, tf, tfc = tube([a, b, c], [0.0032, 0.003, 0.0028], 4, 'frames', up=(0, 1, 0))
            parts.append(Part('temple', tv, tf, tfc, weights=head_weights))
    lid = EYE[1] - 0.003
    face_rig = {'lidY': round(lid, 4), 'browIn': BROW['in'][0], 'browOut': BROW['out'][0]}
    return parts, S, face_rig
