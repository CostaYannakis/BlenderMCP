"""Headless render of the cat, for eyeballing proportions."""
import bpy
from mathutils import Vector

scene = bpy.context.scene
HOME = Vector((2.00, -1.50, 0.0))

cd = bpy.data.cameras.new("CAM_CAT_TMP")
cam = bpy.data.objects.new("CAM_CAT_TMP", cd)
scene.collection.objects.link(cam)
cam.data.lens = 50.0
cam.location = HOME + Vector((1.35, -1.05, 0.62))
cam.rotation_euler = ((HOME + Vector((0, 0, 0.22))) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam

ld = bpy.data.lights.new("PT_CAT_TMP", type='POINT')
ld.energy = 300.0
ld.shadow_soft_size = 0.6
lt = bpy.data.objects.new("PT_CAT_TMP", ld)
scene.collection.objects.link(lt)
lt.location = HOME + Vector((0.9, -0.7, 1.7))

scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 1000, 640
scene.render.filepath = r"C:/Workspace/Blender/renders/cat_v1.png"
scene.render.image_settings.file_format = 'PNG'
if scene.world and scene.world.use_nodes:
    bg = scene.world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.42, 0.46, 0.52, 1.0)

bpy.ops.render.render(write_still=True)
print("RENDERED", scene.render.filepath)
