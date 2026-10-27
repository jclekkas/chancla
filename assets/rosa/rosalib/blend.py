"""Blender side: the armature, the one skinned mesh, empties, extras and the glTF export."""
import bpy
import numpy as np

from . import palette
from .mesh import make_hull, three_to_blender, vertex_normals
from .rig import BONES, J, PARENT, normalize


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = 'METRIC'
    return sc


def link(ob, coll=None):
    (coll or bpy.context.scene.collection).objects.link(ob)
    return ob


def make_armature(name='rosa_rig', coll=None):
    ad = bpy.data.armatures.new(name)
    ob = link(bpy.data.objects.new(name, ad), coll)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for b in BONES:
        x, y, z = J[b]
        e = ad.edit_bones.new(b)
        # Every bone points straight up (Blender +Z) with no roll: the glTF
        # export then carries an identity rest rotation, as the rig expects.
        e.head = (x, -z, y)
        e.tail = (x, -z, y + 0.06)
        e.roll = 0.0
        eb[b] = e
    for b in BONES:
        if PARENT[b]:
            eb[b].parent = eb[PARENT[b]]
            eb[b].use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')
    for b in ad.bones:
        b.use_deform = True
    return ob


def skin_cage(name, verts, edges, radii, root=0, levels=2, branch_smooth=0.0):
    """
    A Skin modifier over a vertex skeleton (three space) and a Subdivision
    on top, evaluated to (v, f) in three space. radii: (rx, ry) per vertex.
    """
    me = bpy.data.meshes.new(name + '_skel')
    bv = three_to_blender(np.asarray(verts))
    me.from_pydata([tuple(p) for p in bv], [tuple(e) for e in edges], [])
    ob = link(bpy.data.objects.new(name + '_skel', me))
    sk = ob.modifiers.new('skin', 'SKIN')
    sk.branch_smoothing = branch_smooth
    sk.use_smooth_shade = True
    for i, r in enumerate(radii):
        d = me.skin_vertices[0].data[i]
        d.radius = r
        d.use_root = (i == root)
    if levels:
        ss = ob.modifiers.new('sub', 'SUBSURF')
        ss.levels = levels
        ss.render_levels = levels
        ss.quality = 3
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    m = ev.to_mesh()
    v = np.array([vv.co[:] for vv in m.vertices])
    f = [tuple(p.vertices) for p in m.polygons]
    ev.to_mesh_clear()
    bpy.data.objects.remove(ob)
    bpy.data.meshes.remove(me)
    v3 = np.stack([v[:, 0], v[:, 2], -v[:, 1]], axis=1)
    return v3, f


def assemble(parts, arm, name='rosa', coll=None, ink_color='ink'):
    """All parts (and their hulls) into one mesh object, skinned to `arm`."""
    V, F, FC, INK, W, FS = [], [], [], [], [], []
    o = 0
    for p in parts:
        n = len(p.v)
        if n == 0:
            continue
        ws = [normalize(p.weights(q)) for q in p.v]
        V.append(p.v)
        F += [tuple(i + o for i in f) for f in p.f]
        FC += [palette.check(c) for c in p.fc]
        FS += p.fsmooth if p.fsmooth is not None else [p.smooth] * len(p.f)
        INK += [float(p.tag)] * n
        W += ws
        o += n
        if p.hull and p.tag == 0:
            hv0, hf0 = p.hull_src if p.hull_src is not None else (p.v, p.f)
            if p.hull_mask is not None:
                keep = [face for face in hf0 if p.hull_mask(np.asarray(hv0)[list(face)].mean(axis=0))]
                used = sorted({i for face in keep for i in face})
                remap = {o2: n2 for n2, o2 in enumerate(used)}
                hv0 = np.asarray(hv0)[used]
                hf0 = [tuple(remap[i] for i in face) for face in keep]
            hv, hf = make_hull(hv0, hf0, p.hull)
            V.append(hv)
            F += [tuple(i + o for i in f) for f in hf]
            FC += [ink_color] * len(hf)
            FS += [True] * len(hf)
            INK += [1.0] * len(hv)
            W += [normalize(p.weights(q)) for q in hv0]
            o += len(hv)
    V = np.vstack(V)
    bv = three_to_blender(V)
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(p) for p in bv], [], F)
    me.validate(clean_customdata=False)
    ob = link(bpy.data.objects.new(name, me), coll)
    for poly, s in zip(me.polygons, FS):
        poly.use_smooth = s
    ca = me.color_attributes.new('Color', 'BYTE_COLOR', 'CORNER')
    cols = [palette.rgb(c) + (1.0,) for c in FC]
    flat = []
    for poly in me.polygons:
        c = cols[poly.index]
        for _ in range(poly.loop_total):
            flat.extend(c)
    ca.data.foreach_set('color_srgb', flat)
    me.color_attributes.active_color = ca
    me.color_attributes.render_color_index = 0
    ia = me.attributes.new('_INK', 'FLOAT', 'POINT')
    ia.data.foreach_set('value', INK)
    groups = {b: ob.vertex_groups.new(name=b) for b in BONES}
    by_bone = {}
    for i, w in enumerate(W):
        for b, x in w.items():
            by_bone.setdefault(b, {}).setdefault(round(x, 5), []).append(i)
    for b, d in by_bone.items():
        for x, ids in d.items():
            groups[b].add(ids, x, 'REPLACE')
    ob.parent = arm
    md = ob.modifiers.new('rig', 'ARMATURE')
    md.object = arm
    return ob, len(F), sum(len(f) - 2 for f in F)


def add_empty(name, m3, coll=None, size=0.05):
    """An empty at a three-space matrix (converted to Blender's axes)."""
    import mathutils
    C = mathutils.Matrix(((1, 0, 0, 0), (0, 0, -1, 0), (0, 1, 0, 0), (0, 0, 0, 1)))
    M = mathutils.Matrix([list(r) for r in m3])
    e = link(bpy.data.objects.new(name, None), coll)
    e.empty_display_type = 'CUBE'
    e.empty_display_size = size
    e.matrix_world = C @ M @ C.inverted()
    return e


def export(path, objs):
    for o in bpy.context.scene.objects:
        o.select_set(o in objs)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True,
        export_attributes=True, export_extras=True, export_vertex_color='ACTIVE',
        export_all_vertex_colors=False, export_materials='NONE', export_animations=False,
        export_yup=True, export_skins=True, export_influence_nb=4, export_texcoords=False,
        export_normals=True, export_morph=False, export_def_bones=False, export_rest_position_armature=True)


def thin_rings(v, f, keep_y=(), region=None, every=2):
    """
    Dissolve alternate horizontal edge rings (rest pose: the torso, neck and
    hanging arms are vertical) so density along a limb halves while the
    surface stays quads. A ring is a closed loop of near-horizontal edges;
    rings nearest each y in keep_y (colour boundaries) are always kept.
    region(p) -> bool limits which vertices may be on a dissolved ring.
    """
    import bmesh
    bm = bmesh.new()
    vs = [bm.verts.new(tuple(p)) for p in v]
    for face in f:
        bm.faces.new([vs[i] for i in face])
    bm.verts.index_update()
    bm.edges.index_update()
    bm.edges.ensure_lookup_table()
    around = set()
    for e in bm.edges:
        a, b = e.verts[0].co, e.verts[1].co
        d = b - a
        if d.length > 0 and abs(d.y) < 0.3 * d.length:
            if region is None or (region(np.array(a[:])) and region(np.array(b[:]))):
                around.add(e.index)
    adj = {}
    for ei in around:
        e = bm.edges[ei]
        for vv in e.verts:
            adj.setdefault(vv.index, []).append(ei)
    seen, rings = set(), []
    for ei in sorted(around):
        if ei in seen:
            continue
        comp, stack = [], [ei]
        seen.add(ei)
        while stack:
            k = stack.pop()
            comp.append(k)
            for vv in bm.edges[k].verts:
                for k2 in adj[vv.index]:
                    if k2 not in seen:
                        seen.add(k2)
                        stack.append(k2)
        verts = {vv.index for k in comp for vv in bm.edges[k].verts}
        if len(verts) >= 8 and all(len(adj[i]) == 2 for i in verts) and len(comp) == len(verts):
            pts = np.array([bm.verts[i].co[:] for i in verts]) if False else np.array([v[i] for i in verts])
            rings.append((comp, pts[:, 1].mean(), pts[:, 0].mean()))
    # Group rings into columns (torso, left arm, right arm) by mean x, then thin each by height.
    cols = {}
    for r in rings:
        key = 0 if abs(r[2]) < 0.1 else (1 if r[2] > 0 else -1)
        cols.setdefault(key, []).append(r)
    kill = []
    for key, rs in cols.items():
        rs.sort(key=lambda r: -r[1])
        protect = set()
        for y in keep_y:
            if rs:
                j = min(range(len(rs)), key=lambda i: abs(rs[i][1] - y))
                if abs(rs[j][1] - y) < 0.03:
                    protect.add(j)
        last_kept = True
        for i, r in enumerate(rs):
            if last_kept and i not in protect and 0 < i < len(rs) - 1:
                kill += r[0]
                last_kept = False
            else:
                last_kept = True
    if kill:
        bmesh.ops.dissolve_edges(bm, edges=[bm.edges[i] for i in kill], use_verts=True)
    bm.verts.index_update()
    nv = np.array([vv.co[:] for vv in bm.verts])
    nf = [tuple(vv.index for vv in fc.verts) for fc in bm.faces]
    bm.free()
    return nv, nf
