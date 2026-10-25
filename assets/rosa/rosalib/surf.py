"""Surface queries (BVH ray casts) for laying pieces on the head, hair and body."""
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree


class Surface:
    def __init__(self, v, f):
        self.v = np.asarray(v)
        self.tree = BVHTree.FromPolygons([Vector(p) for p in self.v], [tuple(x) for x in f], all_triangles=False)

    def ray(self, origin, direction, dist=10.0):
        loc, n, _, d = self.tree.ray_cast(Vector(origin), Vector(direction).normalized(), dist)
        if loc is None:
            return None, None
        return np.array(loc[:]), np.array(n[:])

    def front(self, x, y, from_z=-1.0):
        """The surface point seen from the front (-z) at (x, y), and its outward normal."""
        p, n = self.ray((x, y, from_z), (0, 0, 1))
        if p is not None and n[2] > 0:
            n = -n
        return p, n

    def toward(self, centre, direction):
        """Cast from far out along `direction` back toward `centre`: the outermost hit."""
        d = np.asarray(direction, dtype=np.float64)
        d /= np.linalg.norm(d)
        o = np.asarray(centre) + d * 1.0
        p, n = self.ray(o, -d)
        if p is not None and np.dot(n, d) < 0:
            n = -n
        return p, n

    def nearest(self, p):
        loc, n, _, _ = self.tree.find_nearest(Vector(p))
        return np.array(loc[:]), np.array(n[:])
