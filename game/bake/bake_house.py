"""Bake the Balmoral house scene into a game-ready GLB.

Run headless:
    blender --background balmoral_house_architect.blend --python game/bake/bake_house.py

Strips boolean cutters, reference planes and render-only set dressing, applies
modifiers so window/door openings are real geometry, then exports GLB plus a
level.json of light positions, room markers and spawn data for the web game.
"""

import json
import math
import os
import sys

import bpy
import mathutils

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import materials  # noqa: E402  (needs the path above)

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT_DIR = os.path.join(REPO, "game", "public")
GLB_PATH = os.path.join(OUT_DIR, "balmoral.glb")
LEVEL_PATH = os.path.join(OUT_DIR, "level.json")

# Collections whose contents never belong in the playable level.
DROP_COLLECTIONS = {
    "00_REFERENCE",           # floor plan / photo reference planes
    "ARCH_Opening_Cutters",   # boolean cutters for doors and windows
    "ARCH_Floor_Cutters",
    "FIT_Kitchen_Cutters",
    "RENDER_Exterior",        # backdrop cards and set decks for stills
    "RENDER_ThroughView",
    "RENDER_Bathroom",
    "RENDER_Kitchen_Photoreal",
    "RENDER_Dusk_Lights",
}

DROP_NAME_PREFIXES = ("CUT_", "REF_", "SET_", "BACKDROP_")

# Objects hidden from render are superseded base geometry (pre-boolean walls,
# recovery slabs). Keep them out but remember the openings they imply.
DROP_MATERIALS = {"MAT_BOOLEAN_CUTTER_TRANSPARENT", "MAT_REF_FLOORPLAN", "MAT_REF_EXTERIOR"}

# 1K is the sweet spot. The brick veneer repeats every 1.5 m, so 1024 px still
# gives ~680 px per metre of wall — 2K quadrupled the payload to 30 MB and cost
# four seconds of load for detail no one can resolve at walking pace.
MAX_TEXTURE = 1024


def log(msg):
    print("[bake] %s" % msg, file=sys.stderr)


def collections_of(ob):
    return {c.name for c in ob.users_collection}


def should_drop(ob):
    if ob.type not in {"MESH", "CURVE"}:
        return True
    if ob.hide_render:
        return True
    if collections_of(ob) & DROP_COLLECTIONS:
        return True
    if ob.name.startswith(DROP_NAME_PREFIXES):
        return True
    mats = {m.name for m in ob.material_slots if m.name}
    if mats and mats <= DROP_MATERIALS:
        return True
    return False


def world_aabb(ob, depsgraph):
    ev = ob.evaluated_get(depsgraph)
    mn = [1e9] * 3
    mx = [-1e9] * 3
    for corner in ev.bound_box:
        w = ev.matrix_world @ mathutils.Vector(corner)
        for i in range(3):
            mn[i] = min(mn[i], w[i])
            mx[i] = max(mx[i], w[i])
    return [round(v, 4) for v in mn], [round(v, 4) for v in mx]


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    scene = bpy.context.scene
    depsgraph = bpy.context.evaluated_depsgraph_get()

    level = {
        "name": "Balmoral",
        "source": os.path.basename(bpy.data.filepath),
        "up": "Y_after_gltf_conversion",
        "lights": [],
        "openings": [],
        "cameras": {},
        "rooms": [],
    }

    # --- Capture door/window openings before the cutters are deleted ---------
    for ob in bpy.data.objects:
        if not ob.name.startswith("CUT_") or ob.type != "MESH":
            continue
        mn, mx = world_aabb(ob, depsgraph)
        level["openings"].append({
            "name": ob.name,
            "min": mn,
            "max": mx,
            "kind": "floor" if "FLOOR" in ob.name else "wall",
        })
    log("captured %d opening cutters" % len(level["openings"]))

    # --- Capture the artist-placed interior lights --------------------------
    for ob in bpy.data.objects:
        if ob.type != "LIGHT":
            continue
        # DUSK_INT_* are the room lamps, DUSK_LIGHT_* the two exterior
        # fittings. BATH_LIGHT_W15/W16 are window fill for stills, not
        # practicals, so they are deliberately left behind.
        if not ob.name.startswith(("DUSK_INT_", "DUSK_LIGHT_")) and ob.name != "BATH_LIGHT_CEILING":
            continue
        # These live in a view-layer-excluded collection, so matrix_world is
        # never evaluated in background mode. They are unparented, so the local
        # location is the world position.
        w = ob.matrix_world.translation
        if w.length < 1e-6 and ob.parent is None:
            w = ob.location
        level["lights"].append({
            "name": ob.name,
            "pos": [round(w.x, 3), round(w.y, 3), round(w.z, 3)],
            "type": ob.data.type,
            "energy": round(ob.data.energy, 2),
            "color": [round(c, 3) for c in ob.data.color],
            "room": ob.name.replace("DUSK_INT_", "").replace("BATH_LIGHT_", "BATH_").lower(),
        })
    log("captured %d practical lights" % len(level["lights"]))

    # --- Capture camera placements as spawn candidates ----------------------
    for ob in bpy.data.objects:
        if ob.type != "CAMERA":
            continue
        w = ob.matrix_world.translation
        fwd = ob.matrix_world.to_quaternion() @ mathutils.Vector((0.0, 0.0, -1.0))
        level["cameras"][ob.name] = {
            "pos": [round(w.x, 3), round(w.y, 3), round(w.z, 3)],
            "yaw": round(math.atan2(fwd.y, fwd.x), 4),
        }

    # --- Strip everything that is not playable geometry ---------------------
    bpy.ops.object.select_all(action="DESELECT")
    doomed = [ob for ob in bpy.data.objects if should_drop(ob)]
    for ob in doomed:
        bpy.data.objects.remove(ob, do_unlink=True)
    log("removed %d non-playable objects" % len(doomed))

    keep = [ob for ob in bpy.data.objects if ob.type == "MESH"]
    log("keeping %d meshes" % len(keep))

    # Un-hide everything that survived; viewport hiding is a modelling
    # convenience (WALKTHROUGH fast mode) and would otherwise skip the export.
    for coll in bpy.data.collections:
        coll.hide_viewport = False
        coll.hide_render = False
    for layer_coll in bpy.context.view_layer.layer_collection.children:
        def unhide(lc):
            lc.exclude = False
            lc.hide_viewport = False
            for child in lc.children:
                unhide(child)
        unhide(layer_coll)
    for ob in keep:
        ob.hide_viewport = False
        ob.hide_set(False)
        ob.hide_render = False
        # Brick veneer displacement is render-only and would explode the export.
        for mod in list(ob.modifiers):
            if mod.type in {"SUBSURF", "DISPLACE", "MULTIRES"}:
                ob.modifiers.remove(mod)

    # --- Rebuild the procedural materials as real textures ------------------
    # Must run before the export and after the strip, so it only pays for
    # materials that survive into the level.
    converted = materials.convert(log)
    materials.ensure_uvs(keep, converted, log)

    for img in bpy.data.images:
        if img.size[0] > MAX_TEXTURE or img.size[1] > MAX_TEXTURE:
            w, h = img.size
            scale = MAX_TEXTURE / float(max(w, h))
            img.scale(max(1, int(w * scale)), max(1, int(h * scale)))
            log("downscaled %s to %dx%d" % (img.name, img.size[0], img.size[1]))

    depsgraph = bpy.context.evaluated_depsgraph_get()

    # --- Bounds + room sampling for the game --------------------------------
    mn = [1e9] * 3
    mx = [-1e9] * 3
    for ob in keep:
        a, b = world_aabb(ob, depsgraph)
        for i in range(3):
            mn[i] = min(mn[i], a[i])
            mx[i] = max(mx[i], b[i])
    level["bounds"] = {"min": [round(v, 2) for v in mn], "max": [round(v, 2) for v in mx]}

    tri_estimate = 0
    for ob in keep:
        ev = ob.evaluated_get(depsgraph)
        try:
            me = ev.to_mesh()
        except RuntimeError:
            continue
        tri_estimate += max(0, len(me.polygons) * 2)
        ev.to_mesh_clear()
    level["approx_tris"] = tri_estimate
    log("approx %d triangles" % tri_estimate)

    # --- Export -------------------------------------------------------------
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=GLB_PATH,
        export_format="GLB",
        export_apply=True,             # bakes the boolean openings
        use_selection=False,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_image_format="JPEG",
        export_jpeg_quality=85,
    )
    log("wrote %s (%.1f MB)" % (GLB_PATH, os.path.getsize(GLB_PATH) / 1e6))

    with open(LEVEL_PATH, "w", encoding="utf-8") as fh:
        json.dump(level, fh, indent=1)
    log("wrote %s" % LEVEL_PATH)


main()
