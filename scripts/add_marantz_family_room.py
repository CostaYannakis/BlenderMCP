import bpy
import math
from mathutils import Matrix, Vector


BLEND_PATH = r"C:\Workspace\blender\balmoral_house_architect.blend"
OUTPUT_DIR = r"C:\Workspace\blender\renders"
COLLECTION_NAME = "FIT_Family_Marantz"
WALL_NAME = "WALL_GROUND_EXT_EAST_FAMILY_MEALS_004"


def ensure_material(name, color, metallic=0.0, roughness=0.45, transmission=0.0):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.diffuse_color = color
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Metallic"].default_value = metallic
        bsdf.inputs["Roughness"].default_value = roughness
        if "Transmission Weight" in bsdf.inputs:
            bsdf.inputs["Transmission Weight"].default_value = transmission
        if "Alpha" in bsdf.inputs:
            bsdf.inputs["Alpha"].default_value = color[3]
    return mat


def link_to_collection(obj, collection):
    for current in list(obj.users_collection):
        current.objects.unlink(obj)
    collection.objects.link(obj)


def add_box(name, location, dimensions, material, collection, bevel=0.004, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    link_to_collection(obj, collection)
    if material:
        obj.data.materials.append(material)
    if bevel:
        mod = obj.modifiers.new("SOFT_EDGES", "BEVEL")
        mod.width = bevel
        mod.segments = 2
    return obj


def add_cylinder(name, location, radius, depth, material, collection, rotation=(0, 0, 0), vertices=32):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth,
                                       location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    link_to_collection(obj, collection)
    if material:
        obj.data.materials.append(material)
    bevel = obj.modifiers.new("SOFT_EDGES", "BEVEL")
    bevel.width = min(0.003, radius * 0.18)
    bevel.segments = 2
    return obj


def add_rod(name, start, end, radius, material, collection):
    start = Vector(start)
    end = Vector(end)
    direction = end - start
    obj = add_cylinder(name, (start + end) * 0.5, radius, direction.length,
                       material, collection, vertices=20)
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = direction.to_track_quat("Z", "Y")
    return obj


def add_text(name, body, location, size, material, collection):
    curve = bpy.data.curves.new(name + "_CURVE", "FONT")
    curve.body = body
    curve.align_x = "CENTER"
    curve.align_y = "CENTER"
    curve.size = size
    curve.extrude = 0.0006
    curve.bevel_depth = 0.00025
    obj = bpy.data.objects.new(name, curve)
    collection.objects.link(obj)
    obj.location = location
    # Text's local X runs toward world -Y and local Y runs upward in world Z;
    # its front therefore faces west, into the family room.
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Matrix(((0, 0, -1), (-1, 0, 0), (0, 1, 0))).to_quaternion()
    curve.materials.append(material)
    return obj


def look_at(obj, target):
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def remove_existing_collection():
    existing = bpy.data.collections.get(COLLECTION_NAME)
    if not existing:
        return
    for obj in list(existing.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.collections.remove(existing)


def render_verification(scene, collection, target):
    import os
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    camera_data = bpy.data.cameras.new("CAM_VERIFY_MARANTZ_DATA")
    camera = bpy.data.objects.new("CAM_VERIFY_MARANTZ", camera_data)
    collection.objects.link(camera)
    scene.camera = camera
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.studio_light = "paint.sl"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "BOTH"
    scene.render.resolution_x = 900
    scene.render.resolution_y = 700
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"

    camera.data.type = "PERSP"
    camera.data.lens = 50
    camera.location = (2.75, 5.05, 0.82)
    look_at(camera, target)
    scene.render.filepath = os.path.join(OUTPUT_DIR, "marantz_family_perspective.png")
    bpy.ops.render.render(write_still=True)

    # A close overhead view verifies the cabinet is against the inner east wall.
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 3.3
    camera.location = (5.0, 5.95, 4.0)
    look_at(camera, (5.0, 5.95, -0.34))
    hidden = []
    for obj in bpy.data.objects:
        if any(token in obj.name.upper() for token in ("ROOF", "CEILING")) and not obj.hide_render:
            obj.hide_render = True
            hidden.append(obj)
    scene.render.filepath = os.path.join(OUTPUT_DIR, "marantz_family_top.png")
    bpy.ops.render.render(write_still=True)
    for obj in hidden:
        obj.hide_render = False

    bpy.data.objects.remove(camera, do_unlink=True)
    bpy.data.cameras.remove(camera_data)


def main():
    scene = bpy.context.scene
    wall = bpy.data.objects.get(WALL_NAME)
    floor = bpy.data.objects.get("FLOOR_GROUND_FAMILY_DROPPED_001")
    if wall is None or floor is None:
        raise RuntimeError("Required family-room wall or floor is missing")

    remove_existing_collection()
    collection = bpy.data.collections.new(COLLECTION_NAME)
    scene.collection.children.link(collection)

    black = ensure_material("MAT_MARANTZ_CABINET_BLACK", (0.012, 0.014, 0.016, 1), roughness=0.32)
    silver = ensure_material("MAT_MARANTZ_BRUSHED_SILVER", (0.56, 0.52, 0.43, 1), metallic=0.72, roughness=0.28)
    dark_silver = ensure_material("MAT_MARANTZ_DARK_TRIM", (0.045, 0.05, 0.055, 1), metallic=0.28, roughness=0.30)
    display = ensure_material("MAT_MARANTZ_DISPLAY", (0.025, 0.032, 0.028, 1), roughness=0.18)
    amber = ensure_material("MAT_MARANTZ_DIAL_AMBER", (0.38, 0.25, 0.08, 1), metallic=0.05, roughness=0.22)
    vinyl = ensure_material("MAT_MARANTZ_VINYL", (0.008, 0.009, 0.010, 1), roughness=0.24)
    label = ensure_material("MAT_MARANTZ_LABEL", (0.82, 0.79, 0.67, 1), metallic=0.35, roughness=0.25)
    glass = ensure_material("MAT_MARANTZ_DUST_COVER", (0.22, 0.16, 0.12, 0.24), roughness=0.12, transmission=0.82)

    wall_corners = [wall.matrix_world @ Vector(corner) for corner in wall.bound_box]
    inward_wall_x = min(v.x for v in wall_corners)
    floor_corners = [floor.matrix_world @ Vector(corner) for corner in floor.bound_box]
    floor_top = max(v.z for v in floor_corners)

    width, depth, height = 0.72, 0.44, 1.08
    center_y = 5.95
    gap = 0.015
    back_x = inward_wall_x - gap
    front_x = back_x - depth
    center_x = (front_x + back_x) * 0.5
    top_z = floor_top + height
    side_t = 0.034
    shelf_t = 0.032

    # Black open-front cabinet.
    add_box("MARANTZ_CABINET_SIDE_N", (center_x, center_y + width/2 - side_t/2, floor_top + height/2),
            (depth, side_t, height), black, collection, 0.006)
    add_box("MARANTZ_CABINET_SIDE_S", (center_x, center_y - width/2 + side_t/2, floor_top + height/2),
            (depth, side_t, height), black, collection, 0.006)
    add_box("MARANTZ_CABINET_BACK", (back_x - 0.009, center_y, floor_top + height/2),
            (0.018, width - side_t*2, height - shelf_t), black, collection, 0.002)
    for suffix, z in (("BASE", floor_top + shelf_t/2), ("MID", floor_top + 0.455), ("TOP", top_z - shelf_t/2)):
        add_box(f"MARANTZ_CABINET_{suffix}", (center_x, center_y, z),
                (depth, width - side_t*2, shelf_t), black, collection, 0.004)

    # Two stacked classic silver Marantz components, front-facing west.
    component_front = front_x - 0.025
    component_depth = 0.355
    component_center_x = component_front + component_depth/2
    component_specs = (
        ("AMP", floor_top + 0.575, 0.215),
        ("RECEIVER", floor_top + 0.825, 0.225),
    )
    for idx, (kind, z, h) in enumerate(component_specs):
        add_box(f"MARANTZ_{kind}_BODY", (component_center_x, center_y, z),
                (component_depth, 0.635, h), dark_silver, collection, 0.007)
        face_x = component_front - 0.008
        add_box(f"MARANTZ_{kind}_FACE", (face_x, center_y, z),
                (0.016, 0.615, h - 0.018), silver, collection, 0.004)
        add_box(f"MARANTZ_{kind}_DISPLAY", (face_x - 0.011, center_y + 0.095, z + 0.035),
                (0.010, 0.235, 0.068), display, collection, 0.002)
        if kind == "RECEIVER":
            add_box("MARANTZ_RECEIVER_DIAL_GLOW", (face_x - 0.017, center_y + 0.095, z + 0.035),
                    (0.006, 0.215, 0.050), amber, collection, 0.001)
        for n, y_offset in enumerate((-0.245, -0.165, -0.075, 0.175, 0.250)):
            radius = 0.031 if n in (0, 4) else 0.019
            add_cylinder(f"MARANTZ_{kind}_KNOB_{n+1:02d}",
                         (face_x - 0.022, center_y + y_offset, z - 0.040),
                         radius, 0.028, silver, collection, rotation=(0, math.pi/2, 0))
        for n, y_offset in enumerate((-0.105, -0.055, -0.005, 0.045)):
            add_box(f"MARANTZ_{kind}_BUTTON_{n+1:02d}",
                    (face_x - 0.019, center_y + y_offset, z - 0.075),
                    (0.018, 0.025, 0.015), dark_silver, collection, 0.002)
        add_text(f"MARANTZ_{kind}_LABEL", "MARANTZ", (face_x - 0.019, center_y - 0.155, z + h*0.28),
                 0.030, label, collection)

    # Turntable and open smoke-tinted dust cover.
    plinth_z = top_z + 0.042
    add_box("MARANTZ_TURNTABLE_PLINTH", (center_x - 0.010, center_y, plinth_z),
            (0.365, 0.620, 0.074), dark_silver, collection, 0.012)
    add_cylinder("MARANTZ_TURNTABLE_PLATTER", (center_x - 0.025, center_y + 0.050, plinth_z + 0.050),
                 0.145, 0.026, vinyl, collection)
    add_cylinder("MARANTZ_TURNTABLE_LABEL", (center_x - 0.025, center_y + 0.050, plinth_z + 0.065),
                 0.042, 0.006, amber, collection)
    add_cylinder("MARANTZ_TURNTABLE_SPINDLE", (center_x - 0.025, center_y + 0.050, plinth_z + 0.078),
                 0.004, 0.030, silver, collection, vertices=20)
    pivot = (center_x + 0.095, center_y - 0.225, plinth_z + 0.083)
    stylus = (center_x - 0.055, center_y - 0.060, plinth_z + 0.088)
    add_cylinder("MARANTZ_TONEARM_PIVOT", pivot, 0.026, 0.045, silver, collection)
    add_rod("MARANTZ_TONEARM", pivot, stylus, 0.006, silver, collection)
    add_box("MARANTZ_TONEARM_HEAD", stylus, (0.040, 0.026, 0.015), black, collection, 0.003, rotation=(0, 0, -0.55))

    cover_depth = 0.375
    cover_angle = math.radians(67)
    hinge_x = back_x - 0.055
    hinge_z = plinth_z + 0.055
    cover_center = (hinge_x - cover_depth*0.5*math.cos(cover_angle), center_y,
                    hinge_z + cover_depth*0.5*math.sin(cover_angle))
    add_box("MARANTZ_DUST_COVER_OPEN", cover_center, (cover_depth, 0.625, 0.020),
            glass, collection, 0.008, rotation=(0, cover_angle, 0))

    collection["source_reference"] = "Image/MArantzcabinet.jfif"
    collection["placement_room"] = "family_room"
    collection["placement_wall"] = WALL_NAME
    collection["placement_status"] = "provisional_centered_on_clear_family_room_east_wall"
    collection["cabinet_dimensions_m"] = [depth, width, height]

    target = (front_x, center_y, floor_top + 0.64)
    render_verification(scene, collection, target)

    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
    print("MARANTZ_RESULT", {
        "collection": COLLECTION_NAME,
        "objects": len(collection.objects),
        "wall_inner_x": round(inward_wall_x, 4),
        "cabinet_back_x": round(back_x, 4),
        "wall_gap_m": round(inward_wall_x - back_x, 4),
        "center_y": center_y,
        "floor_top_z": round(floor_top, 4),
        "overall_bounds_x": [round(front_x - 0.04, 4), round(back_x, 4)],
        "overall_bounds_y": [round(center_y - width/2, 4), round(center_y + width/2, 4)],
    })


if __name__ == "__main__":
    main()
