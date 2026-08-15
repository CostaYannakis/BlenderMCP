import bpy
import math
import os
from mathutils import Vector


BLEND_PATH = r"C:\Workspace\blender\balmoral_house_architect.blend"
OUTPUT_DIR = r"C:\Workspace\blender\renders\meals"
COLLECTION_NAME = "FIT_Meals_Round_Table"
EAST_WALL = "WALL_GROUND_EXT_EAST_FAMILY_MEALS_004"
SOUTH_WALL = "WALL_GROUND_EXT_STEP_MEALS_005"


def remove_existing_collection():
    collection = bpy.data.collections.get(COLLECTION_NAME)
    if not collection:
        return
    for obj in list(collection.all_objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.data.collections.remove(collection)


def timber_material():
    name = "MAT_MEALS_TABLE_WALNUT"
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.diffuse_color = (0.23, 0.085, 0.032, 1.0)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    noise = nodes.new("ShaderNodeTexNoise")
    ramp = nodes.new("ShaderNodeValToRGB")
    bump = nodes.new("ShaderNodeBump")
    texcoord = nodes.new("ShaderNodeTexCoord")
    mapping = nodes.new("ShaderNodeMapping")
    noise.inputs["Scale"].default_value = 4.2
    noise.inputs["Detail"].default_value = 4.0
    noise.inputs["Roughness"].default_value = 0.62
    ramp.color_ramp.elements[0].position = 0.25
    ramp.color_ramp.elements[0].color = (0.055, 0.012, 0.004, 1)
    ramp.color_ramp.elements[1].position = 0.78
    ramp.color_ramp.elements[1].color = (0.34, 0.105, 0.026, 1)
    bump.inputs["Strength"].default_value = 0.16
    bump.inputs["Distance"].default_value = 0.025
    bsdf.inputs["Roughness"].default_value = 0.34
    links.new(texcoord.outputs["Generated"], mapping.inputs["Vector"])
    links.new(mapping.outputs["Vector"], noise.inputs["Vector"])
    links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(noise.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    return mat


def dark_timber_material():
    name = "MAT_MEALS_TABLE_WALNUT_EDGE"
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.diffuse_color = (0.09, 0.022, 0.008, 1.0)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = mat.diffuse_color
        bsdf.inputs["Roughness"].default_value = 0.30
    return mat


def metal_base_material():
    name = "MAT_MEALS_TABLE_METAL_BASE"
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.diffuse_color = (0.055, 0.060, 0.065, 1.0)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = mat.diffuse_color
        bsdf.inputs["Metallic"].default_value = 0.82
        bsdf.inputs["Roughness"].default_value = 0.27
    return mat


def link_only(obj, collection):
    for current in list(obj.users_collection):
        current.objects.unlink(obj)
    collection.objects.link(obj)


def add_cylinder(name, collection, root, radius, depth, z, material, bevel=0.01, vertices=96):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=(0, 0, z))
    obj = bpy.context.object
    obj.name = name
    link_only(obj, collection)
    obj.parent = root
    if material:
        obj.data.materials.append(material)
    for polygon in obj.data.polygons:
        polygon.use_smooth = abs(polygon.normal.z) < 0.5
    if bevel:
        mod = obj.modifiers.new("ROUNDED_EDGE", "BEVEL")
        mod.width = bevel
        mod.segments = 3
    return obj


def object_bounds(obj):
    points = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    return {
        "min_x": min(p.x for p in points), "max_x": max(p.x for p in points),
        "min_y": min(p.y for p in points), "max_y": max(p.y for p in points),
        "min_z": min(p.z for p in points), "max_z": max(p.z for p in points),
    }


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def render_checks(scene, collection, target):
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    camera_data = bpy.data.cameras.new("CAM_VERIFY_MEALS_TABLE_DATA")
    camera = bpy.data.objects.new("CAM_VERIFY_MEALS_TABLE", camera_data)
    collection.objects.link(camera)
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
    scene.render.resolution_x = 900
    scene.render.resolution_y = 700

    hidden = []
    for obj in bpy.data.objects:
        if any(token in obj.name.upper() for token in ("ROOF", "CEILING")) and not obj.hide_render:
            obj.hide_render = True
            hidden.append(obj)

    camera.data.type = "PERSP"
    camera.data.lens = 43
    camera.location = (3.02, 2.94, 1.36)
    look_at(camera, (target[0], target[1], 0.43))
    scene.render.filepath = os.path.join(OUTPUT_DIR, "round_brown_table_perspective.png")
    bpy.ops.render.render(write_still=True)

    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 4.2
    camera.location = (4.15, 1.75, 6.0)
    look_at(camera, (4.15, 1.75, 0.0))
    scene.render.filepath = os.path.join(OUTPUT_DIR, "round_brown_table_top.png")
    bpy.ops.render.render(write_still=True)

    for obj in hidden:
        obj.hide_render = False
    bpy.data.objects.remove(camera, do_unlink=True)
    bpy.data.cameras.remove(camera_data)


def main():
    scene = bpy.context.scene
    east_wall = bpy.data.objects.get(EAST_WALL)
    south_wall = bpy.data.objects.get(SOUTH_WALL)
    floor = bpy.data.objects.get("FLOOR_GROUND_SLAB_001")
    if not east_wall or not south_wall or not floor:
        raise RuntimeError("Meals-area wall or floor geometry is missing")

    remove_existing_collection()
    collection = bpy.data.collections.new(COLLECTION_NAME)
    scene.collection.children.link(collection)

    east_bounds = object_bounds(east_wall)
    south_bounds = object_bounds(south_wall)
    floor_bounds = object_bounds(floor)
    east_inner_x = east_bounds["min_x"]
    south_inner_y = south_bounds["max_y"]
    floor_top = floor_bounds["max_z"]

    tabletop_radius = 0.55
    chair_clearance = 0.65
    clearance_radius = tabletop_radius + chair_clearance
    center_x = east_inner_x - clearance_radius
    center_y = south_inner_y + clearance_radius

    root = bpy.data.objects.new("MEALS_ROUND_TABLE_ROOT", None)
    collection.objects.link(root)
    root.empty_display_type = "CIRCLE"
    root.empty_display_size = 0.20
    root.location = (center_x, center_y, floor_top)
    root["tabletop_diameter_m"] = tabletop_radius * 2
    root["chair_clearance_beyond_edge_m"] = chair_clearance
    root["placement_corner"] = "W05 east window meets W14 south window"
    root["placement_status"] = "user_refined_closer_to_corner_with_compact_metal_base"

    walnut = timber_material()
    dark_walnut = dark_timber_material()
    metal = metal_base_material()
    add_cylinder("MEALS_TABLE_TOP", collection, root, tabletop_radius, 0.060, 0.720, walnut, 0.018)
    add_cylinder("MEALS_TABLE_EDGE_BAND", collection, root, 0.558, 0.028, 0.712, dark_walnut, 0.010)
    add_cylinder("MEALS_TABLE_APRON", collection, root, 0.365, 0.055, 0.6625, metal, 0.010)
    add_cylinder("MEALS_TABLE_PEDESTAL_COLLAR_TOP", collection, root, 0.120, 0.045, 0.6125, metal, 0.009)
    add_cylinder("MEALS_TABLE_PEDESTAL_COLUMN", collection, root, 0.065, 0.530, 0.325, metal, 0.012)
    add_cylinder("MEALS_TABLE_PEDESTAL_COLLAR_BASE", collection, root, 0.110, 0.040, 0.047, metal, 0.008)
    add_cylinder("MEALS_TABLE_PEDESTAL_FOOT", collection, root, 0.220, 0.028, 0.014, metal, 0.010)

    clearance = bpy.data.objects.new("MEALS_TABLE_CHAIR_CLEARANCE", None)
    collection.objects.link(clearance)
    clearance.parent = root
    clearance.empty_display_type = "CIRCLE"
    clearance.empty_display_size = clearance_radius
    clearance["radius_m"] = clearance_radius
    clearance["purpose"] = "reserved footprint for future dining chairs"

    collection["room"] = "meals"
    collection["opposite"] = "kitchen_peninsula"
    collection["window_corner"] = ["W05", "W14"]
    collection["center_xy_m"] = [center_x, center_y]
    collection["tabletop_diameter_m"] = tabletop_radius * 2
    collection["chair_clearance_m"] = chair_clearance
    collection["pedestal_material"] = "MAT_MEALS_TABLE_METAL_BASE"
    collection["pedestal_foot_diameter_m"] = 0.44
    collection["east_wall_clearance_from_table_edge_m"] = east_inner_x - (center_x + tabletop_radius)
    collection["south_wall_clearance_from_table_edge_m"] = (center_y - tabletop_radius) - south_inner_y

    render_checks(scene, collection, (center_x, center_y, floor_top))
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
    print("MEALS_TABLE_RESULT", {
        "collection": COLLECTION_NAME,
        "objects": len(collection.objects),
        "center_xy": [round(center_x, 3), round(center_y, 3)],
        "diameter_m": tabletop_radius * 2,
        "height_m": 0.75,
        "chair_clearance_m": chair_clearance,
        "east_table_edge_clearance_m": round(east_inner_x - (center_x + tabletop_radius), 3),
        "south_table_edge_clearance_m": round((center_y - tabletop_radius) - south_inner_y, 3),
        "floor_top_z": round(floor_top, 3),
    })


if __name__ == "__main__":
    main()
