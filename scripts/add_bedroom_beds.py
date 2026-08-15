import bpy
import math
import os
from mathutils import Matrix, Vector


BLEND_PATH = r"C:\Workspace\blender\balmoral_house_architect.blend"
OUTPUT_DIR = r"C:\Workspace\blender\renders\bedrooms"
ROOT_COLLECTION = "FIT_Bedrooms"


def ensure_material(name, color, roughness=0.45, metallic=0.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.diffuse_color = color
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Roughness"].default_value = roughness
        bsdf.inputs["Metallic"].default_value = metallic
    return mat


def remove_collection_tree(name):
    root = bpy.data.collections.get(name)
    if not root:
        return
    for obj in list(root.all_objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    def remove_children(collection):
        for child in list(collection.children):
            remove_children(child)
            bpy.data.collections.remove(child)
    remove_children(root)
    bpy.data.collections.remove(root)


def link_only(obj, collection):
    for current in list(obj.users_collection):
        current.objects.unlink(obj)
    collection.objects.link(obj)


def add_local_box(name, parent, collection, location, dimensions, material, bevel=0.015):
    bpy.ops.mesh.primitive_cube_add(location=(0, 0, 0))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    link_only(obj, collection)
    obj.parent = parent
    obj.location = location
    if material:
        obj.data.materials.append(material)
    if bevel:
        mod = obj.modifiers.new("SOFT_EDGES", "BEVEL")
        mod.width = bevel
        mod.segments = 3
    return obj


def floor_bounds(name):
    obj = bpy.data.objects.get(name)
    if obj is None:
        raise RuntimeError(f"Missing floor zone: {name}")
    points = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    return {
        "min_x": min(p.x for p in points), "max_x": max(p.x for p in points),
        "min_y": min(p.y for p in points), "max_y": max(p.y for p in points),
        "top_z": max(p.z for p in points),
    }


def create_bed(spec, parent_collection, materials):
    room = spec["room"]
    width = spec["width"]
    length = spec["length"]
    base_z = spec["floor"]["top_z"]
    room_collection = bpy.data.collections.new(f"FIT_{room}_Bed")
    parent_collection.children.link(room_collection)

    root = bpy.data.objects.new(f"BED_{room}_ROOT", None)
    room_collection.objects.link(root)
    root.empty_display_type = "CUBE"
    root.empty_display_size = 0.18
    root.location = (spec["center_x"], spec["center_y"], base_z)
    root.rotation_euler[2] = spec["rotation_z"]
    root["room"] = room
    root["bed_size"] = spec["bed_size"]
    root["nominal_mattress_m"] = [width, length]
    root["placement_status"] = "provisional_floor_plan_clearance_layout"

    prefix = f"BED_{room}"
    add_local_box(prefix + "_FRAME", root, room_collection, (0, 0, 0.17),
                  (width + 0.08, length + 0.08, 0.18), materials["wood"], 0.025)
    add_local_box(prefix + "_HEADBOARD", root, room_collection, (0, length/2 + 0.035, 0.46),
                  (width + 0.14, 0.07, 0.90), materials["wood"], 0.025)
    add_local_box(prefix + "_MATTRESS", root, room_collection, (0, 0, 0.38),
                  (width, length, 0.24), materials["mattress"], 0.055)
    add_local_box(prefix + "_DUVET", root, room_collection, (0, -0.06, 0.525),
                  (width - 0.05, length - 0.22, 0.075), materials[spec["linen"]], 0.035)
    add_local_box(prefix + "_FOOT_RUNNER", root, room_collection, (0, -length/2 + 0.32, 0.573),
                  (width - 0.04, 0.44, 0.035), materials[spec["runner"]], 0.018)

    if spec["bed_size"] == "queen":
        pillow_positions = (-width * 0.255, width * 0.255)
        pillow_width = width * 0.44
    else:
        pillow_positions = (0.0,)
        pillow_width = width * 0.64
    for index, pillow_x in enumerate(pillow_positions, 1):
        add_local_box(f"{prefix}_PILLOW_{index:02d}", root, room_collection,
                      (pillow_x, length/2 - 0.25, 0.615),
                      (pillow_width, 0.34, 0.13), materials["pillow"], 0.060)

    for index, (leg_x, leg_y) in enumerate((
        (-width/2 + 0.07, -length/2 + 0.09),
        ( width/2 - 0.07, -length/2 + 0.09),
        (-width/2 + 0.07,  length/2 - 0.09),
        ( width/2 - 0.07,  length/2 - 0.09),
    ), 1):
        add_local_box(f"{prefix}_LEG_{index:02d}", root, room_collection,
                      (leg_x, leg_y, 0.07), (0.06, 0.06, 0.14), materials["leg"], 0.006)

    room_collection["room"] = room
    room_collection["bed_size"] = spec["bed_size"]
    room_collection["floor_zone"] = spec["floor_name"]
    room_collection["headboard_wall"] = spec["headboard_wall"]
    room_collection["center_xy_m"] = [spec["center_x"], spec["center_y"]]
    room_collection["rotation_z_deg"] = math.degrees(spec["rotation_z"])
    return root, room_collection


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def render_checks(scene, root_collection, bed_results, specs):
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    camera_data = bpy.data.cameras.new("CAM_VERIFY_BEDS_DATA")
    camera = bpy.data.objects.new("CAM_VERIFY_BEDS", camera_data)
    root_collection.objects.link(camera)
    scene.camera = camera
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.studio_light = "paint.sl"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "BOTH"
    scene.render.image_settings.file_format = "PNG"
    scene.render.resolution_percentage = 100

    hidden = []
    for obj in bpy.data.objects:
        if any(token in obj.name.upper() for token in ("ROOF", "CEILING")) and not obj.hide_render:
            obj.hide_render = True
            hidden.append(obj)

    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 18.6
    camera.location = (-0.8, -0.65, 15.0)
    look_at(camera, (-0.8, -0.65, 0.0))
    scene.render.resolution_x = 800
    scene.render.resolution_y = 1100
    scene.render.filepath = os.path.join(OUTPUT_DIR, "beds_top_all_rooms.png")
    bpy.ops.render.render(write_still=True)

    scene.render.resolution_x = 800
    scene.render.resolution_y = 650
    camera.data.type = "PERSP"
    camera.data.lens = 47
    for spec, (root, _) in zip(specs, bed_results):
        transform = Matrix.Translation(root.location) @ Matrix.Rotation(spec["rotation_z"], 4, "Z")
        local_camera = Vector((-spec["width"] * 0.85, -spec["length"] / 2 - 1.0, 1.05))
        camera.location = transform @ local_camera
        target = transform @ Vector((0, 0.10, 0.44))
        look_at(camera, target)
        scene.render.filepath = os.path.join(OUTPUT_DIR, f"{spec['room'].lower()}_bed_perspective.png")
        bpy.ops.render.render(write_still=True)

    for obj in hidden:
        obj.hide_render = False
    bpy.data.objects.remove(camera, do_unlink=True)
    bpy.data.cameras.remove(camera_data)


def main():
    scene = bpy.context.scene
    remove_collection_tree(ROOT_COLLECTION)
    root_collection = bpy.data.collections.new(ROOT_COLLECTION)
    scene.collection.children.link(root_collection)

    materials = {
        "wood": ensure_material("MAT_BED_FRAME_WALNUT", (0.13, 0.065, 0.035, 1), 0.34),
        "leg": ensure_material("MAT_BED_LEG_DARK", (0.025, 0.022, 0.020, 1), 0.30, 0.15),
        "mattress": ensure_material("MAT_BED_MATTRESS_WHITE", (0.78, 0.76, 0.70, 1), 0.75),
        "pillow": ensure_material("MAT_BED_PILLOW_IVORY", (0.91, 0.87, 0.78, 1), 0.78),
        "blue": ensure_material("MAT_BED_LINEN_BLUE", (0.19, 0.34, 0.47, 1), 0.82),
        "sage": ensure_material("MAT_BED_LINEN_SAGE", (0.34, 0.43, 0.32, 1), 0.84),
        "sand": ensure_material("MAT_BED_LINEN_SAND", (0.56, 0.43, 0.29, 1), 0.84),
        "charcoal": ensure_material("MAT_BED_RUNNER_CHARCOAL", (0.10, 0.115, 0.12, 1), 0.78),
        "rust": ensure_material("MAT_BED_RUNNER_RUST", (0.43, 0.16, 0.08, 1), 0.80),
    }

    floors = {room: floor_bounds(f"FLOOR_ZONE_{room}_001") for room in ("BED1", "BED2", "BED3", "BED4")}
    single_w, single_l = 0.92, 1.88
    queen_w, queen_l = 1.53, 2.03
    headboard_t = 0.07
    clearance = 0.03

    # Local +Y is the headboard direction. Positions use clear wall faces where
    # available and maintain the door/wardrobe circulation shown on the plan.
    bed1_head_outer_x = floors["BED1"]["max_x"] - 0.055 - clearance
    bed2_head_outer_y = floors["BED2"]["max_y"] - 0.055 - clearance
    bed3_head_outer_x = floors["BED3"]["min_x"] + clearance
    bed4_head_outer_y = floors["BED4"]["max_y"] - 0.055 - clearance

    specs = [
        {
            "room": "BED1", "bed_size": "single", "width": single_w, "length": single_l,
            "center_x": bed1_head_outer_x - (single_l/2 + headboard_t), "center_y": 6.20,
            "rotation_z": -math.pi/2, "floor": floors["BED1"], "floor_name": "FLOOR_ZONE_BED1_001",
            "headboard_wall": "WALL_GROUND_INT_BED1_FAMILY_003", "linen": "blue", "runner": "charcoal",
        },
        {
            "room": "BED2", "bed_size": "single", "width": single_w, "length": single_l,
            "center_x": -3.43, "center_y": bed2_head_outer_y - (single_l/2 + headboard_t),
            "rotation_z": 0.0, "floor": floors["BED2"], "floor_name": "FLOOR_ZONE_BED2_001",
            "headboard_wall": "bedroom_2_north_wall", "linen": "sand", "runner": "charcoal",
        },
        {
            "room": "BED3", "bed_size": "queen", "width": queen_w, "length": queen_l,
            "center_x": bed3_head_outer_x + (queen_l/2 + headboard_t), "center_y": -7.32,
            "rotation_z": math.pi/2, "floor": floors["BED3"], "floor_name": "FLOOR_ZONE_BED3_001",
            "headboard_wall": "WALL_GROUND_EXT_WEST_BEDS_014", "linen": "sage", "runner": "rust",
        },
        {
            "room": "BED4", "bed_size": "single", "width": single_w, "length": single_l,
            "center_x": 1.55, "center_y": bed4_head_outer_y - (single_l/2 + headboard_t),
            "rotation_z": 0.0, "floor": floors["BED4"], "floor_name": "FLOOR_ZONE_BED4_001",
            "headboard_wall": "WALL_GROUND_INT_ENTRY_BED4_017", "linen": "blue", "runner": "rust",
        },
    ]

    results = [create_bed(spec, root_collection, materials) for spec in specs]
    root_collection["bed_count"] = 4
    root_collection["allocation"] = "BED3 queen; BED1, BED2, BED4 single"
    root_collection["queen_selection_reason"] = "BED3 has W10, the largest south-wall bedroom window"
    root_collection["placement_status"] = "provisional_plan_based_clearance_layout"

    render_checks(scene, root_collection, results, specs)
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)

    print("BEDS_RESULT", {
        "collection": ROOT_COLLECTION,
        "beds": [(s["room"], s["bed_size"], round(s["center_x"], 3), round(s["center_y"], 3),
                  round(math.degrees(s["rotation_z"]), 1)) for s in specs],
        "objects": len(root_collection.all_objects),
        "floor_tops": {room: round(bounds["top_z"], 3) for room, bounds in floors.items()},
    })


if __name__ == "__main__":
    main()
