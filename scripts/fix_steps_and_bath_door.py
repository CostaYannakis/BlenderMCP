"""Two fixes in the family room and bathroom.

1. STEP RISERS. Going north off the upper slab into the sunken family room, the
   first riser is only part closed. The slab occupies z -0.06..0 and the first
   tread tops out at -0.17, which leaves an 110 mm band open along the whole
   step run - you see straight through, under the floor. Confirmed by probing
   horizontally: open at z -0.09 through -0.15, solid at -0.20 and below.
   Both runs need a riser panel across that band. The riser between the first
   and second treads is already closed by the tread box itself.

2. BATH DOORWAY. BATH_TILE_E_001 runs y -2.169..-1.020 in one unbroken strip,
   and the D06 doorway is y -1.70..-1.07 - entirely inside it. The tiling was
   laid straight across the opening, so the doorway reads as a tiled wall.
   Split it either side of the opening.

Idempotent: rebuilds its own objects each run.
"""
import bmesh
import bpy

MAT_TILE = "MAT_BATH_WALL_TILE"
COLL_FLOORS = "ARCH_Level_Changes"
COLL_BATH = "FIT_Bathroom"


def coll(name):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
    return c


def box(name, x0, y0, x1, y1, z0, z1, c, material):
    old = bpy.data.objects.get(name)
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(abs(x1 - x0), abs(y1 - y0), abs(z1 - z0)), verts=bm.verts)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    ob.location = ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
    c.objects.link(ob)
    if material:
        me.materials.append(material)
    uv = me.uv_layers.new(name="UVMap")
    mw = ob.matrix_world
    for p in me.polygons:
        n = p.normal
        for li in p.loop_indices:
            co = mw @ me.vertices[me.loops[li].vertex_index].co
            uv.data[li].uv = ((co.x, co.y) if abs(n.z) >= max(abs(n.x), abs(n.y))
                              else ((co.y, co.z) if abs(n.x) >= abs(n.y) else (co.x, co.z)))
    return ob


report = {}

# ---- 1. close the open band in the first riser of each step run -----------
steps = coll(COLL_FLOORS)
riser_mat = None
src = bpy.data.objects.get("STEP_FAMILY_LONG_01")
if src and src.data.materials:
    riser_mat = src.data.materials[0]

SLAB_UNDER, TREAD_TOP = -0.06, -0.17
box("STEP_FAMILY_LONG_RISER_FILL", 2.72, 3.235, 5.75, 3.295,
    TREAD_TOP, SLAB_UNDER, steps, riser_mat)
box("STEP_FAMILY_HALL_RISER_FILL", 0.055, 3.27, 0.115, 4.34,
    TREAD_TOP, SLAB_UNDER, steps, riser_mat)
report["risers_filled"] = ["STEP_FAMILY_LONG_RISER_FILL", "STEP_FAMILY_HALL_RISER_FILL"]

# the drop patch stopped 10 mm short of the hall steps; close that hairline too
patch = bpy.data.objects.get("FLOOR_GROUND_FAMILY_DROP_PATCH_001")
if patch:
    patch.scale.x = 1.0
    sx = patch.dimensions.x
    if sx < 2.20:
        patch.dimensions = (2.23, patch.dimensions.y, patch.dimensions.z)
        patch.location.x = (0.575 + 2.805) / 2
    report["drop_patch_x"] = [round(patch.location.x - patch.dimensions.x / 2, 3),
                              round(patch.location.x + patch.dimensions.x / 2, 3)]

# ---- 2. open the bathroom doorway in the tiling ---------------------------
tile_mat = bpy.data.materials.get(MAT_TILE)
bath = coll(COLL_BATH)
old = bpy.data.objects.get("BATH_TILE_E_001")
if old:
    bpy.data.objects.remove(old, do_unlink=True)

# original strip: x -1.362..-1.354, y -2.169..-1.020, z 0.012..1.050
# D06 opening:                      y -1.700..-1.070
box("BATH_TILE_E_S_001", -1.362, -2.169, -1.354, -1.700, 0.012, 1.050, bath, tile_mat)
box("BATH_TILE_E_N_001", -1.362, -1.070, -1.354, -1.020, 0.012, 1.050, bath, tile_mat)
report["bath_tile_split"] = ["BATH_TILE_E_S_001 (y -2.169..-1.700)",
                             "BATH_TILE_E_N_001 (y -1.070..-1.020)",
                             "opening left clear y -1.700..-1.070"]

bpy.context.view_layer.update()
result = report
