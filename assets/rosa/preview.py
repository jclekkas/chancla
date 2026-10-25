"""Preview renders of the built asset (Cycles CPU, emission toon look with the ink hull).

    /home/user/bpyenv/bin/python assets/rosa/preview.py --tier high --out <dir> [--set views,poses] [--prefix p]

Views: front and three-quarter at 1.5 m (face, upper body) and 5 m (full),
side and back. Poses: the animation's range (arms raised forward and to
the side, elbows bent, legs forward and back, crouch with the skirt bone
tilted and scaled as CROUCH_SKIRT does), to catch tearing, candy-wrapping
or legs coming through the skirt. Writes one PNG per shot and a contact
sheet per set (ImageMagick montage).
"""
import argparse
import math
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402

import build  # noqa: E402
from rosalib import blend, render  # noqa: E402

VIEWS = [
    ('face_front', 1.5, 0, 1.45, 50),
    ('face_34', 1.5, 35, 1.45, 50),
    ('full_front', 5.0, 0, 0.95, 28),
    ('full_34', 5.0, 35, 0.95, 28),
    ('full_side', 5.0, 90, 0.95, 28),
    ('full_back', 5.0, 180, 0.95, 28),
    ('close_face', 0.75, 0, 1.56, 40),
    ('close_face_34', 0.75, 40, 1.56, 40),
]

D = math.radians
POSES = [
    ('arms_forward', {'armR': (D(100), 0, 0), 'armL': (D(100), 0, 0)}, 0, 2.6, 1.1),
    ('arms_forward_side', {'armR': (D(100), 0, 0), 'armL': (D(100), 0, 0)}, 90, 2.6, 1.1),
    ('arms_side', {'armR': (0, 0, D(100)), 'armL': (0, 0, -D(100))}, 0, 2.6, 1.1),
    ('arms_side_34', {'armR': (0, 0, D(100)), 'armL': (0, 0, -D(100))}, 30, 2.6, 1.1),
    ('elbows', {'foreR': (D(120), 0, 0), 'foreL': (D(120), 0, 0), 'armR': (D(20), 0, D(10)), 'armL': (D(-10), 0, D(-15))}, 60, 2.6, 1.0),
    ('throw', {'armR': (D(150), D(10), D(30)), 'foreR': (D(60), 0, 0), 'armL': (D(-30), 0, D(-30)), 'torso': (D(-10), D(25), 0)}, 40, 2.6, 1.1),
    ('stride', {'legR': (D(40), 0, 0), 'legL': (D(-40), 0, 0)}, 90, 2.6, 0.8),
    ('stride_front', {'legR': (D(40), 0, 0), 'legL': (D(-40), 0, 0)}, 25, 2.6, 0.8),
    ('crouch_side', 'crouch', 90, 2.6, 0.8),
    ('crouch_front', 'crouch', 20, 2.6, 0.8),
    ('crouch_back', 'crouch', 150, 2.6, 0.8),
    ('look_turn', {'head': (D(-25), D(40), D(10)), 'torso': (D(10), D(-20), 0)}, 0, 1.6, 1.4),
]
# CROUCH_SKIRT (rosa-anim.ts): tilt 0.34 rad, wide +0.36, deep +0.72, drop -0.1; knees splay 0.22.
CROUCH = {'legR': (D(70), -0.22, 0), 'legL': (D(70), 0.22, 0), 'shinR': (-D(100), 0, 0), 'shinL': (-D(100), 0, 0),
          'skirt': (0.34, 0, 0), 'torso': (0.2, 0, 0)}


def montage(files, out, tile):
    try:
        subprocess.run(['montage'] + files + ['-tile', tile, '-geometry', '+3+3', '-background', '#30303a', out], check=True)
    except Exception as e:  # noqa: BLE001
        print('montage failed:', e)


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument('--tier', default='high')
    ap.add_argument('--out', required=True)
    ap.add_argument('--set', default='views,poses')
    ap.add_argument('--prefix', default='')
    ap.add_argument('--samples', type=int, default=8)
    a = ap.parse_args(argv)
    os.makedirs(a.out, exist_ok=True)
    blend.reset()
    arm, ob, empties, face_rig, tris = build.build_tier(a.tier, None)
    ob.data.materials.append(render.toon_material())
    # Show the ruleros as the game does (the instanced cylinder r 0.034, length 0.1), and a stand-in sandal in the fist.
    cols = [(0.91, 0.47, 0.6), (0.31, 0.7, 0.66), (0.95, 0.64, 0.23), (0.54, 0.35, 0.72)]
    for i, e in enumerate(empties):
        mw = e.matrix_world.copy()
        e.parent = arm
        e.parent_type = 'BONE'
        e.parent_bone = 'head'
        bpy.context.view_layer.update()
        e.matrix_world = mw
        # The roller's axis (three local +y) is the empty's Blender local +Z: the default cylinder.
        bpy.ops.mesh.primitive_cylinder_add(vertices=10, radius=0.034, depth=0.1)
        c = bpy.context.active_object
        c.parent = e
        c.matrix_parent_inverse.identity()
        c.location = (0, 0, 0)
        m = bpy.data.materials.new('rul%d' % i)
        m.use_nodes = True
        em = m.node_tree.nodes.new('ShaderNodeEmission')
        em.inputs['Color'].default_value = cols[i] + (1,)
        m.node_tree.links.new(em.outputs[0], m.node_tree.nodes['Material Output'].inputs[0])
        c.data.materials.append(m)
    bpy.context.view_layer.update()
    render.setup((420, 520), a.samples)
    shots = []
    if 'views' in a.set:
        render.pose(arm, {})
        for name, dist, yaw, ty, fov in VIEWS:
            render.view(dist, yaw, ty, fov_deg=fov)
            p = os.path.join(a.out, '%sview_%s.png' % (a.prefix, name))
            render.shoot(p)
            shots.append(p)
        montage(shots, os.path.join(a.out, '%ssheet_views.png' % a.prefix), '4x')
    if 'poses' in a.set:
        ps = []
        for name, rot, yaw, dist, ty in POSES:
            render.pose(arm, CROUCH if rot == 'crouch' else rot)
            if rot == 'crouch':
                render.skirt_scale(arm, 1.36, 0.9, 1.72)
            render.view(dist, yaw, ty, fov_deg=45)
            p = os.path.join(a.out, '%spose_%s.png' % (a.prefix, name))
            render.shoot(p)
            ps.append(p)
        render.pose(arm, {})
        montage(ps, os.path.join(a.out, '%ssheet_poses.png' % a.prefix), '4x')
    print('tris', tris)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    main(argv)
