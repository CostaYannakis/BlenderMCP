"""A ginger cat, in the house's own low-poly language.

Built rather than downloaded: it has to match the flat-shaded, box-modelled
style of everything else, stay inside the web triangle budget, and - most
importantly - have named parts whose ORIGINS sit at the right pivots, so the
browser can animate it for nothing. Legs pivot at the hip, tail segments at
their base, head at the neck. Rotate those in JS and it walks.

"Fluffy" is done with silhouette, not fur: a deep chest, a thick brush of a
tail, and ear tufts. Real fur (hair particles, alpha cards) is not affordable
in a 6 MB web scene and would not match the house anyway.

Idempotent - wipes and rebuilds its own collection, so it is safe to re-run on
top of another agent's save.
"""
import math

import bpy
import bmesh
from mathutils import Matrix, Vector

COLL = "CRITTER_Cat"

# Dropped in the lounge; the walk path in the browser takes it from here.
HOME = Vector((2.00, -1.50, 0.0))

# Base Color is LINEAR. (0.62,0.24,0.05) looked right as a number but resolves
# to a pale tan on screen; these land on a proper ginger once sRGB-encoded.
GINGER = (0.46, 0.125, 0.022)
GINGER_DK = (0.30, 0.070, 0.012)
CREAM = (0.86, 0.76, 0.60)
NOSE = (0.72, 0.36, 0.38)
EYE = (0.13, 0.26, 0.12)


def mat(name, rgb, rough=0.85):
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF")
    b.inputs["Base Color"].default_value = (*rgb, 1.0)
    b.inputs["Roughness"].default_value = rough
    return m


M_FUR = mat("MAT_CAT_GINGER", GINGER, 0.92)
M_FUR_DK = mat("MAT_CAT_GINGER_DARK", GINGER_DK, 0.92)
M_CREAM = mat("MAT_CAT_CREAM", CREAM, 0.90)
M_NOSE = mat("MAT_CAT_NOSE", NOSE, 0.55)
M_EYE = mat("MAT_CAT_EYE", EYE, 0.25)


def get_coll():
    c = bpy.data.collections.get(COLL)
    if c is None:
        c = bpy.data.collections.new(COLL)
        bpy.context.scene.collection.children.link(c)
    for ob in list(c.all_objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    return c


coll = get_coll()


def finish(name, bm, origin, material, rot=None):
    """Bake a bmesh into an object whose ORIGIN is `origin` (world).

    Geometry is authored around the origin on purpose: that is the pivot the
    browser animates about.
    """
    me = bpy.data.meshes.new(name)
    if rot:
        bmesh.ops.rotate(bm, verts=bm.verts, matrix=rot)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    ob.location = origin
    coll.objects.link(ob)
    me.materials.append(material)
    for p in me.polygons:
        p.use_smooth = False
    uv = me.uv_layers.new(name="UVMap")
    for p in me.polygons:
        n = p.normal
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uv.data[li].uv = ((co.x, co.y) if abs(n.z) >= max(abs(n.x), abs(n.y))
                              else ((co.y, co.z) if abs(n.x) >= abs(n.y) else (co.x, co.z)))
    return ob


def sphere(name, at, scale, material, u=10, v=6):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=0.5)
    bmesh.ops.scale(bm, vec=scale, verts=bm.verts)
    return finish(name, bm, HOME + Vector(at), material)


def cone(name, at, r1, r2, depth, material, rot=None, seg=6, shift=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg,
                          radius1=r1, radius2=r2, depth=depth)
    if shift:
        bmesh.ops.translate(bm, vec=shift, verts=bm.verts)
    return finish(name, bm, HOME + Vector(at), material, rot)


# ---------------------------------------------------------------- the cat
# Body: long axis along +X, which is the direction it faces. Kept low and long;
# the first attempt stood too tall on stilt legs and read as a small dog.
sphere("CAT_BODY", (0.0, 0.0, 0.195), (0.40, 0.185, 0.165), M_FUR, u=12, v=7)
sphere("CAT_CHEST", (0.14, 0.0, 0.190), (0.20, 0.165, 0.160), M_FUR, u=10, v=6)
sphere("CAT_BELLY", (0.0, 0.0, 0.145), (0.30, 0.140, 0.090), M_CREAM, u=10, v=5)

# Head pivots at the neck so it can turn and dip while walking.
sphere("CAT_HEAD", (0.275, 0.0, 0.275), (0.175, 0.165, 0.155), M_FUR, u=10, v=6)
sphere("CAT_MUZZLE", (0.345, 0.0, 0.250), (0.085, 0.090, 0.060), M_CREAM, u=8, v=5)
cone("CAT_NOSE", (0.385, 0.0, 0.262), 0.014, 0.003, 0.016, M_NOSE,
     rot=Matrix.Rotation(math.radians(90), 3, 'Y'))
for s, tag in ((1, "L"), (-1, "R")):
    cone("CAT_EAR_%s" % tag, (0.250, 0.058 * s, 0.345), 0.042, 0.004, 0.075, M_FUR_DK,
         rot=Matrix.Rotation(math.radians(13) * -s, 3, 'X'))
    sphere("CAT_EYE_%s" % tag, (0.335, 0.052 * s, 0.292), (0.026, 0.020, 0.026), M_EYE, u=6, v=4)

# Legs: origin at the hip, geometry hanging below, so a rotation about Y swings
# the leg the way a leg swings. Short, and tucked in under the body.
# The hip must sit INSIDE the body, not just below it. The body is a sphere, so
# at x = +-0.165 it has already tapered to z 0.148 and a 0.135 hip left the legs
# visibly floating. Tucked inward and raised slightly, they overlap properly.
LEG_H = 0.150
for x, s, tag in ((0.140, 1, "FL"), (0.140, -1, "FR"), (-0.140, 1, "BL"), (-0.140, -1, "BR")):
    cone("CAT_LEG_%s" % tag, (x, 0.070 * s, LEG_H), 0.030, 0.034, LEG_H, M_FUR,
         shift=(0, 0, -LEG_H / 2), seg=8)
    sphere("CAT_PAW_%s" % tag, (x, 0.070 * s, 0.022), (0.072, 0.060, 0.044), M_CREAM, u=6, v=4)

# Tail: ONE curved object with its origin at the base, not a parented chain.
# The chain version came out as a broken broom handle - the segments did not
# meet, because chaining pivots through matrix_parent_inverse is fiddly and buys
# nothing here. Swaying the whole tail from its base looks the same at this size.
bm = bmesh.new()
SEGN, TAIL_LEN = 7, 0.300
prev = None
for i in range(SEGN + 1):
    t = i / SEGN
    ang = math.radians(30 + 55 * t)                 # sweeps up as it goes back
    dist = TAIL_LEN * t
    cx = -dist * math.cos(ang) * 0.85
    cz = dist * math.sin(ang) * 1.05
    r = 0.052 * (1.0 - 0.55 * t)                    # tapers, but stays brushy
    ring = []
    for k in range(6):
        a = 2 * math.pi * k / 6
        ring.append(bm.verts.new((cx, math.cos(a) * r, cz + math.sin(a) * r)))
    if prev:
        for k in range(6):
            bm.faces.new((prev[k], prev[(k + 1) % 6], ring[(k + 1) % 6], ring[k]))
    prev = ring
bm.faces.new(prev)
# Base tucked into the rump, not hanging off behind it - at -0.345 it floated
# clear of the body, which ends at -0.20.
finish("CAT_TAIL", bm, HOME + Vector((-0.180, 0.0, 0.225)), M_FUR)

bpy.context.view_layer.update()

objs = [o for o in coll.all_objects if o.type == 'MESH']
tris = sum(len(p.vertices) - 2 for o in objs for p in o.data.polygons)
lo = Vector((1e9, 1e9, 1e9)); hi = Vector((-1e9, -1e9, -1e9))
for o in objs:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        lo = Vector((min(lo.x, w.x), min(lo.y, w.y), min(lo.z, w.z)))
        hi = Vector((max(hi.x, w.x), max(hi.y, w.y), max(hi.z, w.z)))

result = {
    "objects": len(objs),
    "tris": tris,
    "materials": sorted({m.name for o in objs for m in o.data.materials if m}),
    "size_m": {"length_x": round(hi.x - lo.x, 3), "width_y": round(hi.y - lo.y, 3),
               "height_z": round(hi.z - lo.z, 3)},
    "stands_on_z": round(lo.z, 3),
    "named_parts": sorted(o.name for o in objs),
}
