"""Family room: a second Marantz cabinet, flanked by two black speakers.

Layout along the east wall, south to north:

    [ speaker ][ cabinet ][ cabinet ][ speaker ]

Speakers match one cabinet exactly in height and width (1.080 x 0.720) and
share its depth and its setback from the wall, so the four units read as one
run. The whole group is centred on the clear stretch of the family room's east
wall, which moves the original cabinet slightly south.

Idempotent: the duplicate and the speakers are rebuilt from scratch each run,
and the original cabinet is positioned to an absolute target rather than nudged
by a delta, so running this twice gives the same result as running it once.
That matters because another agent is working in this file, and this may need
re-applying on top of their save.
"""
import math

import bpy
import bmesh
from mathutils import Matrix, Vector

SRC_COLL = "FIT_Family_Marantz"
DUP_COLL = "FIT_Family_Marantz_B"
SPK_COLL = "FIT_Family_Speakers"

UNIT_W = 0.720          # along Y, across the wall
UNIT_H = 1.080          # cabinet body height
UNIT_D = 0.440          # along X, into the room
GAP = 0.050
FLOOR_Z = -0.340
BACK_X = 5.608          # cabinet back face; wall inner face is 5.623

# Group centred on the clear east wall of the family room (y 3.80 - 8.09).
GROUP_CENTRE_Y = 5.945
TOTAL = 4 * UNIT_W + 3 * GAP
START = GROUP_CENTRE_Y - TOTAL / 2.0
CENTRES = [START + UNIT_W / 2 + i * (UNIT_W + GAP) for i in range(4)]
SPK_A_Y, CAB_1_Y, CAB_2_Y, SPK_B_Y = CENTRES


def bbox(objs):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for ob in objs:
        for c in ob.bound_box:
            w = ob.matrix_world @ Vector(c)
            lo = Vector((min(lo.x, w.x), min(lo.y, w.y), min(lo.z, w.z)))
            hi = Vector((max(hi.x, w.x), max(hi.y, w.y), max(hi.z, w.z)))
    return lo, hi


def get_coll(name):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
    return c


def wipe(name):
    c = bpy.data.collections.get(name)
    if not c:
        return
    for ob in list(c.all_objects):
        bpy.data.objects.remove(ob, do_unlink=True)


def mat(name, rgb, rough, metallic=0.0):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metallic
    return m


def project_uvs(ob):
    me = ob.data
    while me.uv_layers:
        me.uv_layers.remove(me.uv_layers[0])
    uv = me.uv_layers.new(name="UVMap")
    mw, rot = ob.matrix_world, ob.matrix_world.to_3x3()
    for p in me.polygons:
        n = rot @ p.normal
        ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
        for li in p.loop_indices:
            co = mw @ me.vertices[me.loops[li].vertex_index].co
            uv.data[li].uv = ((co.x, co.y) if (az >= ax and az >= ay)
                              else ((co.y, co.z) if ax >= ay else (co.x, co.z)))


src = bpy.data.collections.get(SRC_COLL)
if src is None:
    raise RuntimeError("%s not found - run the Marantz script first" % SRC_COLL)

# ---- 1. move the original cabinet onto its slot (absolute, so re-runnable)
originals = [o for o in src.all_objects]
lo, hi = bbox(originals)
dy = CAB_1_Y - (lo.y + hi.y) / 2.0
if abs(dy) > 1e-6:
    roots = [o for o in originals if o.parent not in originals]
    for ob in roots:
        ob.location.y += dy
bpy.context.view_layer.update()

# ---- 2. the second cabinet
wipe(DUP_COLL)
dup = get_coll(DUP_COLL)
offset = CAB_2_Y - CAB_1_Y
copies = {}
for ob in originals:
    c = ob.copy()
    if ob.data:
        c.data = ob.data          # shared mesh: a duplicate costs no new geometry
    c.name = ob.name.replace("MARANTZ", "MARANTZ_B") if "MARANTZ" in ob.name else ob.name + "_B"
    dup.objects.link(c)
    copies[ob] = c
for ob, c in copies.items():
    c.parent = copies.get(ob.parent, None) if ob.parent in copies else None
    if c.parent is None:
        c.location = ob.location.copy()
        c.location.y += offset
    else:
        c.matrix_parent_inverse = ob.matrix_parent_inverse.copy()
bpy.context.view_layer.update()

# ---- 3. the speakers
wipe(SPK_COLL)
spk = get_coll(SPK_COLL)
BLACK = bpy.data.materials.get("MAT_MARANTZ_CABINET_BLACK") or mat(
    "MAT_SPEAKER_BLACK", (0.02, 0.02, 0.02), 0.45)
CONE = mat("MAT_SPEAKER_DRIVER", (0.055, 0.055, 0.06), 0.75)


def box(name, cx, cy, cz, sx, sy, sz, material):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    ob.location = (cx, cy, cz)
    spk.objects.link(ob)
    me.materials.append(material)
    project_uvs(ob)
    return ob


def driver(name, cy, cz, radius, depth):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=16,
                          radius1=radius, radius2=radius * 0.55, depth=depth)
    # cones are built along Z; face them out of the front baffle, along -X
    bmesh.ops.rotate(bm, verts=bm.verts, matrix=Matrix.Rotation(math.radians(90), 3, 'Y'))
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    front = BACK_X - UNIT_D
    ob.location = (front + depth / 2 - 0.004, cy, cz)
    spk.objects.link(ob)
    me.materials.append(CONE)
    project_uvs(ob)
    return ob


for tag, cy in (("L", SPK_A_Y), ("R", SPK_B_Y)):
    box("SPEAKER_FAMILY_%s_BODY" % tag,
        BACK_X - UNIT_D / 2, cy, FLOOR_Z + UNIT_H / 2,
        UNIT_D, UNIT_W, UNIT_H, BLACK)
    driver("SPEAKER_FAMILY_%s_WOOFER" % tag, cy, FLOOR_Z + 0.34, 0.135, 0.05)
    driver("SPEAKER_FAMILY_%s_MID" % tag, cy, FLOOR_Z + 0.70, 0.085, 0.045)
    driver("SPEAKER_FAMILY_%s_TWEETER" % tag, cy, FLOOR_Z + 0.90, 0.038, 0.04)

bpy.context.view_layer.update()

allobs = list(src.all_objects) + list(dup.all_objects) + list(spk.all_objects)
lo2, hi2 = bbox(allobs)
result = {
    "slots_y": [round(v, 3) for v in CENTRES],
    "moved_original_by_y": round(dy, 3),
    "objects": {"cabinet_a": len(src.all_objects), "cabinet_b": len(dup.all_objects),
                "speakers": len(spk.all_objects)},
    "group_bbox": [round(v, 3) for v in (*lo2, *hi2)],
    "tris_added": sum(len(p.vertices) - 2 for o in list(spk.all_objects)
                      if o.type == 'MESH' for p in o.data.polygons),
}
