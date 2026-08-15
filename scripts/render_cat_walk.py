"""Render the walk cycle as frames, using the same maths as src/cat.js.

The animation lives in the browser, not in Blender, so to show it we replay the
identical pose function here. Axis mapping, because glTF export is Y-up while
Blender is Z-up:

    three X  =  Blender  X        (the way the cat faces)
    three Y  =  Blender  Z        (up)
    three Z  = -Blender  Y        (lateral)

So a leg swing that is rotation.z in the browser is rotation about -Y here.

Everything except the cat is hidden: this is about reading the gait, and the
full house takes a minute a frame.
"""
import math
import os

import bpy

STRIDE_STEPS = 16
SWING = 0.42
OUT = r"C:/Workspace/Blender/renders/cat_walk"
os.makedirs(OUT, exist_ok=True)

cat = bpy.data.collections.get("CRITTER_Cat")
if cat is None:
    raise RuntimeError("CRITTER_Cat missing")
parts = {o.name.upper(): o for o in cat.all_objects}
keep = set(cat.all_objects)

# hide everything else
for ob in bpy.data.objects:
    if ob.type == 'MESH' and ob not in keep:
        ob.hide_render = True

# a plain floor under it
me = bpy.data.meshes.new("WALK_FLOOR")
import bmesh
bm = bmesh.new()
bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=6.0)
bm.to_mesh(me); bm.free()
floor = bpy.data.objects.new("WALK_FLOOR", me)
bpy.context.scene.collection.objects.link(floor)
floor.location = (2.0, -1.5, 0.0)
fm = bpy.data.materials.new("MAT_WALK_FLOOR")
fm.use_nodes = True
fm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.20, 0.20, 0.22, 1)
fm.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.9
me.materials.append(fm)

scene = bpy.context.scene
cd = bpy.data.cameras.new("CAM_WALK")
cam = bpy.data.objects.new("CAM_WALK", cd)
scene.collection.objects.link(cam)
cam.data.lens = 55.0
scene.camera = cam

for nm, loc, energy in (("KEY", (3.4, -2.9, 2.2), 320.0), ("FILL", (0.7, -0.4, 1.6), 90.0)):
    ld = bpy.data.lights.new("L_" + nm, type='POINT')
    ld.energy = energy
    ld.shadow_soft_size = 0.8
    lo = bpy.data.objects.new("L_" + nm, ld)
    scene.collection.objects.link(lo)
    lo.location = loc

scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 520, 380
scene.render.image_settings.file_format = 'PNG'
if scene.world and scene.world.use_nodes:
    bg = scene.world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.10, 0.11, 0.13, 1.0)

rest = {n: o.location.copy() for n, o in parts.items()}
BASE_X = 2.0

for f in range(STRIDE_STEPS):
    phase = 2.0 * math.pi * f / STRIDE_STEPS
    s, c = math.sin(phase), math.cos(phase)

    # two full strides of travel across the loop, so it reads as walking
    travel = 0.62 * (f / STRIDE_STEPS) * 1.6
    for n, o in parts.items():
        o.location.x = rest[n].x + travel
        o.location.z = rest[n].z + abs(s) * 0.012

    for n, sign in (("CAT_LEG_FL", 1), ("CAT_LEG_FR", -1),
                    ("CAT_LEG_BL", -0.9), ("CAT_LEG_BR", 0.9)):
        if n in parts:
            parts[n].rotation_euler = (0.0, -s * SWING * sign, 0.0)
    for i, (n, sign) in enumerate((("CAT_PAW_FL", 1), ("CAT_PAW_FR", -1),
                                   ("CAT_PAW_BL", -1), ("CAT_PAW_BR", 1))):
        if n in parts:
            p = parts[n]
            p.location.x = rest[n].x + travel + math.sin(phase) * sign * 0.035
            p.location.z = rest[n].z + max(0.0, math.sin(phase) * sign) * 0.02
    if "CAT_TAIL" in parts:
        parts["CAT_TAIL"].rotation_euler = (0.0, -c * 0.10, s * 0.22)
    for n in ("CAT_HEAD", "CAT_MUZZLE", "CAT_NOSE", "CAT_EAR_L", "CAT_EAR_R",
              "CAT_EYE_L", "CAT_EYE_R"):
        if n in parts:
            parts[n].rotation_euler = (0.0, -c * 0.05, 0.0)

    cam.location = (BASE_X + travel + 1.30, -1.5 - 1.15, 0.55)
    cam.rotation_euler = (
        (bpy.data.objects[list(parts.values())[0].name].location.copy())
    ) and cam.rotation_euler
    # aim at the cat
    from mathutils import Vector
    tgt = Vector((BASE_X + travel, -1.5, 0.22))
    cam.rotation_euler = (tgt - cam.location).to_track_quat('-Z', 'Y').to_euler()

    bpy.context.view_layer.update()
    scene.render.filepath = os.path.join(OUT, "frame_%02d.png" % f)
    bpy.ops.render.render(write_still=True)
    print("FRAME", f)

print("WALKDONE", OUT)
