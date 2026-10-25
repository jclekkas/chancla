"""Build Sol Rosa: public/models/rosa-sol-{high,medium,low}.glb and assets/rosa/rosa-sol.blend.

    /home/user/bpyenv/bin/python assets/rosa/build.py [--tiers high,medium,low] [--no-blend]

Deterministic: everything is generated from the scripts and palette.json.
See README.md and docs/rosa-asset/CONTRACT.md.
"""
import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402

from rosalib import blend, body, clothes, glbpack, hair, hat, head, legs, skirt  # noqa: E402
from rosalib.surf import Surface  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = os.path.join(ROOT, 'public', 'models')

BODY = {
    'high': dict(levels=2, hull_levels=1, hull=0.010, thin=True),
    'medium': dict(levels=1, hull_levels=1, hull=0.010, thin=True),
    'low': dict(levels=1, hull_levels=1, hull=0.011, thin=True, lite=True),
}


def build_parts(tier):
    parts = []
    b = body.make_part(**BODY[tier])
    if tier == 'low':
        # Low: the outline on the torso, shoulders and upper arms; none on the forearms and hands.
        b.hull_mask = lambda c: (c[1] > 1.0 or abs(c[0]) < 0.17) and not (c[1] > 1.31 and abs(c[0]) < 0.15)
    else:
        # Under the collar (which has its own outline) the body's hull never shows.
        b.hull_mask = lambda c: not (c[1] > 1.31 and abs(c[0]) < 0.15 and c[1] < 1.40)
    parts.append(b)
    SB = Surface(b.v, b.f)
    hp, SH, face_rig = head.build(tier)
    parts += hp
    hr = hair.build(tier)
    parts += hr
    # Seats from the High hair in every tier, so the rollers sit in the same place on all of them.
    hv, hf, _ = hair.hair_mass(hair.RES['high']['cols'], hair.RES['high']['rows'])
    SHair = Surface(hv, hf)
    spots = hair.seat_spots(SHair)
    parts += hat.build(tier)
    sk = skirt.build(tier)
    parts += sk
    SK = Surface(sk[0].v, sk[0].f)
    parts += legs.build(tier)
    cr = {'high': (30, 3), 'medium': (22, 3), 'low': (14, 2)}[tier]
    col = clothes.collar(SB, *cr, scallops=9, lift0={'high': 0.0065, 'medium': 0.009, 'low': 0.011}[tier])
    lo = clothes.collar(SB, max(18, cr[0] * 2 // 3), 1, scallops=9)
    col.hull_src = (lo.v, lo.f)
    if tier == 'low':
        col.hull = 0.0
    parts.append(col)
    parts += clothes.bow(SB, SK, tier)
    parts += clothes.badge(SB, tier)
    if tier == 'high':
        parts += clothes.embroidery(SB)
    return parts, spots, face_rig


def build_tier(tier, coll):
    arm = blend.make_armature('rosa_rig_' + tier, coll)
    arm['tier'] = tier
    parts, spots, face_rig = build_parts(tier)
    ob, nf, tris = blend.assemble(parts, arm, 'rosa', coll)
    ob.name = 'rosa_' + tier
    ob.data.name = 'rosa'
    empties = []
    for i, m in enumerate(spots):
        e = blend.add_empty('rulero_%d_%s' % (i, tier), m, coll, size=0.04)
        e.parent = arm
        e['rulero'] = i
        empties.append(e)
    return arm, ob, empties, face_rig, tris


def export_tier(tier, arm, ob, empties, face_rig):
    # The GLB names: the mesh 'rosa', the empties rulero_0..3 (the .blend keeps per-tier names).
    names = {o: o.name for o in [ob] + empties}
    ob.name = 'rosa'
    for i, e in enumerate(empties):
        e.name = 'rulero_%d' % i
    sc = bpy.context.scene
    sc['faceRig'] = face_rig
    sc['rosa'] = {'team': 'sol', 'tier': tier, 'contract': 'docs/rosa-asset/CONTRACT.md'}
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, 'rosa-sol-%s.glb' % tier)
    blend.export(path, [arm, ob] + empties)
    glbpack.pack(path)
    for o, n in names.items():
        o.name = n
    return path


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument('--tiers', default='high,medium,low')
    ap.add_argument('--no-blend', action='store_true')
    a = ap.parse_args(argv)
    blend.reset()
    for tier in a.tiers.split(','):
        coll = bpy.data.collections.new('rosa_' + tier)
        bpy.context.scene.collection.children.link(coll)
        arm, ob, empties, face_rig, tris = build_tier(tier, coll)
        path = export_tier(tier, arm, ob, empties, face_rig)
        print('%s: %d triangles -> %s (%d bytes)' % (tier, tris, os.path.relpath(path, ROOT), os.path.getsize(path)))
        if tier != 'high':
            coll.hide_viewport = True
            coll.hide_render = True
    if not a.no_blend:
        bpy.context.preferences.filepaths.save_version = 0  # no .blend1 backups
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, 'rosa-sol.blend'), compress=True)


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
    main(argv)
