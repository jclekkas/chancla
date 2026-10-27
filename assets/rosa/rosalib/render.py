"""Preview renders (Cycles, emission-only toon look with the ink hull), for checking the asset."""
import math

import bpy
import mathutils

from . import palette

LIGHT = mathutils.Vector((0.45, 0.55, 0.7)).normalized()  # Blender space: from front-right-above


def toon_material():
    m = bpy.data.materials.get('preview_toon')
    if m:
        return m
    m = bpy.data.materials.new('preview_toon')
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    N = nt.nodes.new
    L = nt.links.new
    out = N('ShaderNodeOutputMaterial')
    col = N('ShaderNodeAttribute'); col.attribute_name = 'Color'
    ink = N('ShaderNodeAttribute'); ink.attribute_name = '_INK'
    geo = N('ShaderNodeNewGeometry')
    dot = N('ShaderNodeVectorMath'); dot.operation = 'DOT_PRODUCT'
    dot.inputs[1].default_value = LIGHT
    L(geo.outputs['Normal'], dot.inputs[0])
    ramp = N('ShaderNodeValToRGB')
    ramp.color_ramp.interpolation = 'CONSTANT'
    e = ramp.color_ramp.elements
    e[0].position = 0.0; e[0].color = (0.5, 0.5, 0.52, 1)
    e[1].position = 0.45; e[1].color = (0.76, 0.76, 0.77, 1)
    e3 = e.new(0.72); e3.color = (1, 1, 1, 1)
    mr = N('ShaderNodeMapRange')
    mr.inputs['From Min'].default_value = -1.0
    mr.inputs['From Max'].default_value = 1.0
    L(dot.outputs['Value'], mr.inputs['Value'])
    L(mr.outputs['Result'], ramp.inputs['Fac'])
    mul = N('ShaderNodeMix'); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'
    mul.inputs['Factor'].default_value = 1.0
    L(col.outputs['Color'], mul.inputs[6])
    L(ramp.outputs['Color'], mul.inputs[7])
    em = N('ShaderNodeEmission')
    L(mul.outputs[2], em.inputs['Color'])
    inkem = N('ShaderNodeEmission')
    r, g, b = palette.rgb('ink')
    inkem.inputs['Color'].default_value = (r ** 2.2, g ** 2.2, b ** 2.2, 1)
    tr = N('ShaderNodeBsdfTransparent')
    back = N('ShaderNodeMix'); back.data_type = 'FLOAT'
    mixb = N('ShaderNodeMixShader')
    L(geo.outputs['Backfacing'], mixb.inputs['Fac'])
    L(inkem.outputs[0], mixb.inputs[1])
    L(tr.outputs[0], mixb.inputs[2])
    gt = N('ShaderNodeMath'); gt.operation = 'GREATER_THAN'; gt.inputs[1].default_value = 0.5
    L(ink.outputs['Fac'], gt.inputs[0])
    mix = N('ShaderNodeMixShader')
    L(gt.outputs[0], mix.inputs['Fac'])
    L(em.outputs[0], mix.inputs[1])
    L(mixb.outputs[0], mix.inputs[2])
    L(mix.outputs[0], out.inputs['Surface'])
    return m


def setup(res=(480, 600), samples=8):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    sc.cycles.max_bounces = 0
    sc.cycles.transparent_max_bounces = 8
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.view_settings.view_transform = 'Standard'
    w = bpy.data.worlds.new('w') if not sc.world else sc.world
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get('Background')
    bg.inputs[0].default_value = (0.62, 0.66, 0.7, 1)
    bg.inputs[1].default_value = 1.0
    if 'ground' not in bpy.data.objects:
        me = bpy.data.meshes.new('ground')
        me.from_pydata([(-3, -3, 0), (3, -3, 0), (3, 3, 0), (-3, 3, 0)], [], [(0, 1, 2, 3)])
        g = bpy.data.objects.new('ground', me)
        sc.collection.objects.link(g)
        gm = bpy.data.materials.new('groundmat')
        gm.use_nodes = True
        nt = gm.node_tree
        for n in list(nt.nodes):
            nt.nodes.remove(n)
        o = nt.nodes.new('ShaderNodeOutputMaterial'); e = nt.nodes.new('ShaderNodeEmission')
        e.inputs['Color'].default_value = (0.42, 0.38, 0.33, 1)
        nt.links.new(e.outputs[0], o.inputs[0])
        me.materials.append(gm)


def camera(eye3, target3, lens=50.0):
    """Camera at a three-space eye looking at a three-space target."""
    sc = bpy.context.scene
    cam = bpy.data.objects.get('cam')
    if not cam:
        cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
        sc.collection.objects.link(cam)
    cam.data.lens = lens
    cam.data.clip_start = 0.05
    e = mathutils.Vector((eye3[0], -eye3[2], eye3[1]))
    t = mathutils.Vector((target3[0], -target3[2], target3[1]))
    cam.location = e
    cam.rotation_euler = (t - e).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    return cam


def view(dist, yaw_deg, target_y, fov_deg=60.0, aspect=0.8):
    """Rosa seen from `dist` m at a yaw (0: from the front), at roughly the game's vertical FOV."""
    a = math.radians(yaw_deg)
    eye = (dist * math.sin(a), target_y, -dist * math.cos(a))
    # 60 degree vertical FOV on a portrait frame: lens from the sensor width.
    sensor = 36.0
    vf = math.radians(fov_deg)
    lens = (sensor / aspect) / 2 / math.tan(vf / 2) if aspect < 1 else sensor / 2 / math.tan(vf / 2)
    cam = camera(eye, (0, target_y, 0), lens)
    cam.data.sensor_fit = 'VERTICAL'
    cam.data.sensor_height = 24.0
    cam.data.lens = 12.0 / math.tan(vf / 2)
    return cam


def shoot(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def pose(arm, rot):
    """rot: bone -> three-space Euler (x, y, z) (XYZ order as three.js); unlisted bones at rest."""
    for pb in arm.pose.bones:
        pb.rotation_mode = 'ZYX'
        pb.rotation_euler = rot.get(pb.name, (0, 0, 0))
        pb.scale = (1, 1, 1)
        pb.location = (0, 0, 0)
    bpy.context.view_layer.update()


def skirt_scale(arm, sx, sy, sz):
    pb = arm.pose.bones['skirt']
    # three (x, y, z) scale -> bone local (X, Y, Z) = three (x, y, z) for an upward bone.
    pb.scale = (sx, sy, sz)
    bpy.context.view_layer.update()
