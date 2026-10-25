"""Geometry core: parts in three.js space, lofts, hulls, and the Blender assembly.

Every part is built in the game's space (metres, y up, Rosa faces -z, her
right is +x) and converted to Blender (x, -z, y) only when it is turned into
a Blender mesh. A part carries its faces' palette colours, its feature tag
(0, or a negative face tag), how thick its ink hull is (0: none) and a
weight function that maps a rest position to bone influences.
"""
import math

import numpy as np

from . import palette


def three_to_blender(v):
    v = np.asarray(v, dtype=np.float64)
    return np.stack([v[:, 0], -v[:, 2], v[:, 1]], axis=1)


def smoothstep(e0, e1, x):
    t = np.clip((np.asarray(x, dtype=np.float64) - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


def sstep(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3.0 - 2.0 * t)


def gauss(x):
    return math.exp(-x * x)


class Part:
    """One shell of the mesh: vertices, faces, a colour per face."""

    def __init__(self, name, v=None, f=None, fc=None, tag=0, hull=0.0, weights=None, smooth=True):
        self.name = name
        self.v = np.zeros((0, 3)) if v is None else np.asarray(v, dtype=np.float64)
        self.f = [] if f is None else list(f)
        self.fc = [] if fc is None else list(fc)
        self.tag = tag
        self.hull = hull
        # Optional lower-resolution source for the hull: (v, f).
        self.hull_src = None
        self.weights = weights
        self.smooth = smooth
        # Optional hull_mask(centroid) -> bool: hull faces kept (None: all).
        self.hull_mask = None
        # Optional per-face smooth flags (None: all self.smooth).
        self.fsmooth = None

    @property
    def tris(self):
        return sum(len(f) - 2 for f in self.f)

    def transform(self, m):
        self.v = apply(m, self.v)
        if self.hull_src is not None:
            self.hull_src = (apply(m, self.hull_src[0]), self.hull_src[1])
        return self

    def copy(self, name=None):
        p = Part(name or self.name, self.v.copy(), [tuple(f) for f in self.f], list(self.fc), self.tag, self.hull, self.weights, self.smooth)
        if self.hull_src is not None:
            p.hull_src = (self.hull_src[0].copy(), list(self.hull_src[1]))
        p.fsmooth = None if self.fsmooth is None else list(self.fsmooth)
        return p

    def mirrored(self, name=None):
        """Mirror across x = 0 (faces flipped so they stay outward)."""
        p = self.copy(name)
        p.v[:, 0] *= -1
        p.f = [tuple(reversed(f)) for f in p.f]
        if p.hull_src is not None:
            hv = p.hull_src[0].copy()
            hv[:, 0] *= -1
            p.hull_src = (hv, [tuple(reversed(f)) for f in p.hull_src[1]])
        return p

    def append(self, other):
        o = len(self.v)
        self.v = np.vstack([self.v, other.v]) if len(self.v) else other.v.copy()
        self.f += [tuple(i + o for i in f) for f in other.f]
        self.fc += list(other.fc)
        if self.fsmooth is not None or other.fsmooth is not None:
            a = self.fsmooth if self.fsmooth is not None else [self.smooth] * (len(self.f) - len(other.f))
            b = other.fsmooth if other.fsmooth is not None else [other.smooth] * len(other.f)
            self.fsmooth = list(a) + list(b)
        return self


def apply(m, v):
    v = np.asarray(v, dtype=np.float64)
    if len(v) == 0:
        return v
    h = np.hstack([v, np.ones((len(v), 1))])
    return (h @ np.asarray(m).T)[:, :3]


def trs(x=0.0, y=0.0, z=0.0, rx=0.0, ry=0.0, rz=0.0, s=1.0):
    """Translate, then Euler XYZ (three.js order: R = Rx Ry Rz), then scale."""
    cx, sx = math.cos(rx), math.sin(rx)
    cy, sy = math.cos(ry), math.sin(ry)
    cz, sz = math.cos(rz), math.sin(rz)
    RX = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    RY = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    RZ = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    m = np.eye(4)
    sc = np.diag(s if isinstance(s, (tuple, list)) else (s, s, s))
    m[:3, :3] = RX @ RY @ RZ @ sc
    m[:3, 3] = (x, y, z)
    return m


def frame(origin, normal, up=(0.0, 1.0, 0.0)):
    """A matrix whose -z points along `normal` (out of a surface), +y as close to `up` as allowed."""
    n = np.asarray(normal, dtype=np.float64)
    n = n / np.linalg.norm(n)
    zax = -n
    u = np.asarray(up, dtype=np.float64)
    xax = np.cross(u, zax)
    if np.linalg.norm(xax) < 1e-6:
        xax = np.array([1.0, 0, 0])
    xax /= np.linalg.norm(xax)
    yax = np.cross(zax, xax)
    m = np.eye(4)
    m[:3, 0], m[:3, 1], m[:3, 2], m[:3, 3] = xax, yax, zax, origin
    return m


def vertex_normals(v, f):
    v = np.asarray(v, dtype=np.float64)
    n = np.zeros_like(v)
    for face in f:
        p = v[list(face)]
        c = np.zeros(3)
        for i in range(len(face)):
            c += np.cross(p[i], p[(i + 1) % len(face)])
        for i in face:
            n[i] += c
    # Coincident vertices (seams, poles) share a normal so a hull never tears.
    key = {}
    for i, p in enumerate(np.round(v, 6)):
        key.setdefault(tuple(p), []).append(i)
    for ids in key.values():
        if len(ids) > 1:
            s = n[ids].sum(axis=0)
            n[ids] = s
    ln = np.linalg.norm(n, axis=1)
    ln[ln < 1e-12] = 1.0
    return n / ln[:, None]


def loft(rings, angles, mod=None, color=None, closed_top=True, closed_bottom=True, sculpt=None):
    """
    Rings top to bottom, each a dict(y, r, rz, rzB, z, c, x): half-width r,
    front depth rz (toward -z), back depth rzB, centre z. Angle 0 is the
    front, increasing toward +x. A ring with r == 0 is a pole (one vertex).
    `angles`: a column count or an explicit increasing list in [0, 2pi).
    mod(a, i, ring) scales the radius; color(a, i, ring) overrides the
    face colour of the band below ring i; sculpt(p, a, i) moves a point.
    """
    if isinstance(angles, int):
        angles = [2 * math.pi * j / angles for j in range(angles)]
    n = len(angles)
    verts, faces, fcol = [], [], []
    idx = []
    for i, r in enumerate(rings):
        rz, rzB = r.get('rz', r['r']), r.get('rzB', r.get('rz', r['r']))
        cz, cx = r.get('z', 0.0), r.get('x', 0.0)
        if r['r'] <= 1e-9 and rz <= 1e-9:
            idx.append([len(verts)] * n)
            p = np.array([cx, r['y'], cz])
            if sculpt is not None:
                p = sculpt(p, 0.0, i)
            verts.append(p)
            continue
        row = []
        for a in angles:
            k = mod(a, i, r) if mod else 1.0
            co = math.cos(a)
            p = np.array([cx + r['r'] * k * math.sin(a), r['y'], cz - co * (rz if co > 0 else rzB) * k])
            if sculpt is not None:
                p = sculpt(p, a, i)
            row.append(len(verts))
            verts.append(p)
        idx.append(row)
    for i in range(len(rings) - 1):
        top, bot = idx[i], idx[i + 1]
        for j in range(n):
            j1 = (j + 1) % n
            a0, a1 = angles[j], angles[j1] if j1 else angles[0] + 2 * math.pi
            col = rings[i]['c']
            if color is not None:
                cc = color(0.5 * (a0 + a1), i, rings[i])
                if cc is not None:
                    col = cc
            q = [top[j], top[j1], bot[j1], bot[j]]
            # Collapse pole duplicates into a triangle.
            uq = []
            for k in q:
                if k not in uq:
                    uq.append(k)
            if len(uq) < 3:
                continue
            faces.append(tuple(uq))
            fcol.append(col)
    return np.array(verts), faces, fcol


def grid_faces(rows, cols, wrap=False, offset=0):
    f = []
    cc = cols if wrap else cols - 1
    for i in range(rows - 1):
        for j in range(cc):
            j1 = (j + 1) % cols
            f.append((offset + i * cols + j, offset + i * cols + j1, offset + (i + 1) * cols + j1, offset + (i + 1) * cols + j))
    return f


def ellipsoid(rx, ry, rz, seg, rows, c, mod=None):
    rings = []
    for k in range(rows + 1):
        t = math.pi * k / rows
        rings.append({'y': ry * math.cos(t), 'r': rx * math.sin(t), 'rz': rz * math.sin(t), 'c': c})
    return loft(rings, seg, mod=mod)


def tube(path, radii, seg, c, cap=True, up=(0.0, 0.0, -1.0), color=None, rz=None):
    """A swept tube along points `path` (rest frames by a fixed up hint), radii per point."""
    path = np.asarray(path, dtype=np.float64)
    m = len(path)
    verts, faces, fc = [], [], []
    for i in range(m):
        t = path[min(i + 1, m - 1)] - path[max(i - 1, 0)]
        t /= np.linalg.norm(t)
        u = np.asarray(up, dtype=np.float64)
        b = np.cross(t, u)
        if np.linalg.norm(b) < 1e-6:
            b = np.cross(t, [1.0, 0, 0])
        b /= np.linalg.norm(b)
        nn = np.cross(b, t)
        r = radii[i]
        r2 = rz[i] if rz is not None else r
        for j in range(seg):
            a = 2 * math.pi * j / seg
            verts.append(path[i] + b * math.cos(a) * r + nn * math.sin(a) * r2)
    for i in range(m - 1):
        for j in range(seg):
            j1 = (j + 1) % seg
            faces.append((i * seg + j, (i + 1) * seg + j, (i + 1) * seg + j1, i * seg + j1))
            fc.append(c if color is None else color(i, j))
    if cap:
        for end, sign in ((0, -1), (m - 1, 1)):
            t = path[end] - path[end - sign] if end else path[0] - path[1]
            t = t / np.linalg.norm(t)
            ci = len(verts)
            verts.append(path[end] + t * min(radii[end], (rz[end] if rz is not None else radii[end])) * 0.6)
            for j in range(seg):
                j1 = (j + 1) % seg
                a, b2 = end * seg + j, end * seg + j1
                faces.append((a, b2, ci) if sign > 0 else (b2, a, ci))
                fc.append(c)
    v = np.array(verts)
    # Fix winding so normals point away from the path.
    p = Part('t', v, faces, fc)
    _orient_outward(p, path)
    return p.v, p.f, p.fc


def _orient_outward(p, centre_path):
    n = vertex_normals(p.v, p.f)
    cen = np.asarray(centre_path).mean(axis=0)
    score = np.sum(np.einsum('ij,ij->i', n, p.v - cen))
    if score < 0:
        p.f = [tuple(reversed(f)) for f in p.f]


def make_hull(v, f, thick, normals=None):
    n = vertex_normals(v, f) if normals is None else normals
    if np.isscalar(thick):
        hv = v + n * thick
    else:
        hv = v + n * np.asarray(thick)[:, None]
    hf = [tuple(reversed(face)) for face in f]
    return hv, hf


def color_rgb(c):
    return palette.rgb(c)
