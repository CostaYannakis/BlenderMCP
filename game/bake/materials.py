"""Make the scene's procedural materials survive a glTF export.

glTF carries image textures, not shader graphs. Several of this scene's most
characterful materials are procedural — the blue bathroom tiling and the
kitchen splashback are Brick Texture nodes, and the exterior brickwork is an
image driven through a Hue/Saturation node and an object-space box projection.
The exporter silently flattens all of them to a single colour, which is how the
tiles and the brickwork went missing.

This module rebuilds them as real, tiling image textures wired straight to Base
Color, and generates the box-projected UVs the brick meshes never had.
"""

import numpy as np

import bpy

TILE_PX = 1024      # generated tile/brick sheets
BRICK_UV_SCALE = 0.6667   # matches the Mapping node the brickwork used


# --------------------------------------------------------------- colour utils

def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def rgb_to_hsv(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = np.max(rgb, axis=-1)
    mn = np.min(rgb, axis=-1)
    d = mx - mn
    h = np.zeros_like(mx)
    nz = d > 1e-12
    rm = nz & (mx == r)
    gm = nz & (mx == g) & ~rm
    bm = nz & (mx == b) & ~rm & ~gm
    h[rm] = ((g[rm] - b[rm]) / d[rm]) % 6
    h[gm] = ((b[gm] - r[gm]) / d[gm]) + 2
    h[bm] = ((r[bm] - g[bm]) / d[bm]) + 4
    h = h / 6.0
    s = np.zeros_like(mx)
    s[mx > 1e-12] = d[mx > 1e-12] / mx[mx > 1e-12]
    return np.stack([h, s, mx], axis=-1)


def hsv_to_rgb(hsv):
    h, s, v = hsv[..., 0] % 1.0, hsv[..., 1], hsv[..., 2]
    i = np.floor(h * 6.0)
    f = h * 6.0 - i
    p = v * (1 - s)
    q = v * (1 - f * s)
    t = v * (1 - (1 - f) * s)
    i = (i % 6).astype(int)
    r = np.choose(i, [v, q, p, p, t, v])
    g = np.choose(i, [t, v, v, q, p, p])
    b = np.choose(i, [p, p, t, v, v, q])
    return np.stack([r, g, b], axis=-1)


def _new_image(name, arr_linear):
    """Store a top-down linear RGB array as an 8-bit sRGB image.

    Blender's pixel buffer runs bottom-up, so this is the single place the
    vertical flip happens; every array produced in this module is top-down.
    """
    h, w, _ = arr_linear.shape
    img = bpy.data.images.get(name)
    if img:
        bpy.data.images.remove(img)
    img = bpy.data.images.new(name, w, h, alpha=False, float_buffer=False)
    img.colorspace_settings.name = 'sRGB'

    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[..., :3] = linear_to_srgb(arr_linear)
    # Blender's pixel buffer starts at the bottom row.
    img.pixels.foreach_set(rgba[::-1].ravel())
    img.pack()
    return img


# ------------------------------------------------------------- brick texture

def _brick_noise(n):
    """Blender's per-brick hash, in uint32 arithmetic."""
    n = (n.astype(np.uint64) + np.uint64(1013)) & np.uint64(0x7FFFFFFF)
    n = (n >> np.uint64(13)) ^ n
    a = (n * n) & np.uint64(0xFFFFFFFF)
    a = (a * np.uint64(60493)) & np.uint64(0xFFFFFFFF)
    a = (a + np.uint64(19990303)) & np.uint64(0xFFFFFFFF)
    a = (n * a) & np.uint64(0xFFFFFFFF)
    a = (a + np.uint64(1376312589)) & np.uint64(0xFFFFFFFF)
    nn = a & np.uint64(0x7FFFFFFF)
    return nn.astype(np.float64) / 1073741824.0


def _brick_params(node):
    return {
        'color1': [v for v in node.inputs['Color1'].default_value[:3]],
        'color2': [v for v in node.inputs['Color2'].default_value[:3]],
        'mortar': [v for v in node.inputs['Mortar'].default_value[:3]],
        'mortar_size': node.inputs['Mortar Size'].default_value,
        'mortar_smooth': node.inputs['Mortar Smooth'].default_value,
        'bias': node.inputs['Bias'].default_value,
        'brick_width': node.inputs['Brick Width'].default_value,
        'row_height': node.inputs['Row Height'].default_value,
        'offset': node.offset,
        'offset_freq': max(1, node.offset_frequency),
        'squash': node.squash,
        'squash_freq': max(1, node.squash_frequency),
    }


def _brick_array(p, px=TILE_PX):
    """Reproduce a Brick Texture node over exactly one UV unit.

    The mesh UVs are in metres and run well past 0..1, so the sheet has to tile
    seamlessly. That needs a whole number of bricks per unit, so the brick size
    is snapped to the nearest exact divisor — at 152 mm that is a shift of a few
    millimetres, which no one will see, and it buys perfect wrapping without
    relying on a UV-transform extension.
    """
    cols = max(1, round(1.0 / p['brick_width']))
    rows = max(1, round(1.0 / p['row_height']))
    bw, rh = 1.0 / cols, 1.0 / rows

    u = (np.arange(px) + 0.5) / px
    v = (np.arange(px) + 0.5) / px
    uu, vv = np.meshgrid(u, v)

    rownum = np.floor(vv / rh)
    squash = np.where(rownum % p['squash_freq'] != 0, 1.0, p['squash'])
    bw_row = bw * squash
    offset = np.where(rownum % p['offset_freq'] != 0, 0.0, bw_row * p['offset'])

    bricknum = np.floor((uu + offset) / bw_row)
    x = (uu + offset) - bw_row * bricknum
    y = vv - rh * rownum

    key = ((rownum.astype(np.int64) << 16) + (bricknum.astype(np.int64) & 0xFFFF))
    tint = np.clip(_brick_noise(key) + p['bias'], 0.0, 1.0)

    min_dist = np.minimum(np.minimum(x, y), np.minimum(bw_row - x, rh - y))
    ms, smooth = p['mortar_size'], p['mortar_smooth']
    if ms <= 0:
        mortar_f = np.zeros_like(min_dist)
    elif smooth <= 0:
        mortar_f = (min_dist < ms).astype(np.float64)
    else:
        d = np.clip(1.0 - min_dist / ms, 0.0, 1.0)
        t = np.clip(d / smooth, 0.0, 1.0)
        mortar_f = np.where(min_dist >= ms, 0.0, t * t * (3 - 2 * t))

    c1 = np.array(p['color1'])
    c2 = np.array(p['color2'])
    mortar = np.array(p['mortar'])

    col = c1[None, None, :] + (c2 - c1)[None, None, :] * tint[..., None]
    col = col + (mortar[None, None, :] - col) * mortar_f[..., None]
    # Every array in this module is top-down; _new_image flips once on write.
    return col[::-1]


# ------------------------------------------------------- hue/sat over an image

def build_hue_sat_image(name, src_img, hue, sat, val):
    """Bake a Hue/Saturation node into a copy of its source image."""
    w, h = src_img.size
    buf = np.empty(w * h * src_img.channels, dtype=np.float32)
    src_img.pixels.foreach_get(buf)
    px = buf.reshape(h, w, src_img.channels)[..., :3]

    lin = srgb_to_linear(px.astype(np.float64))
    hsv = rgb_to_hsv(lin)
    hsv[..., 0] = (hsv[..., 0] + hue - 0.5) % 1.0
    hsv[..., 1] = np.clip(hsv[..., 1] * sat, 0.0, 1.0)
    hsv[..., 2] = hsv[..., 2] * val
    out = hsv_to_rgb(hsv)

    # foreach_get already handed us bottom-up rows; _new_image flips again.
    return _new_image(name, out[::-1].astype(np.float32))


# ------------------------------------------------------------- noise + ramp

def _noise_ramp_array(stops, px=TILE_PX, scale=6.0, seed=7):
    """Stand-in for a ColorRamp driven by a Noise Texture."""
    rng = np.random.default_rng(seed)
    n = max(2, int(scale))
    grid = rng.random((n + 1, n + 1))
    grid[-1, :] = grid[0, :]
    grid[:, -1] = grid[:, 0]          # wrap so the sheet tiles

    t = np.linspace(0, n, px, endpoint=False)
    i = np.floor(t).astype(int)
    f = t - i
    f = f * f * (3 - 2 * f)

    def lerp(a, b, w):
        return a + (b - a) * w

    top = lerp(grid[i][:, i], grid[i][:, i + 1], f[None, :])
    bot = lerp(grid[i + 1][:, i], grid[i + 1][:, i + 1], f[None, :])
    noise = lerp(top, bot, f[:, None])

    stops = sorted(stops, key=lambda s: s[0])
    pos = np.array([s[0] for s in stops])
    cols = np.array([s[1] for s in stops])
    out = np.empty(noise.shape + (3,))
    for c in range(3):
        out[..., c] = np.interp(noise, pos, cols[:, c])
    return out[::-1]


# ------------------------------------------------------------------ rewiring

def _wire_image(mat, img):
    """Replace whatever feeds Base Color with a plain image texture."""
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if not bsdf:
        return False

    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    tex.location = (bsdf.location.x - 400, bsdf.location.y)
    tex.interpolation = 'Smart'

    bc = bsdf.inputs['Base Color']
    for link in list(bc.links):
        nt.links.remove(link)
    nt.links.new(tex.outputs['Color'], bc)
    return True


def _color_socket(node, name):
    """The RGBA socket called `name` — Mix nodes carry one per data type."""
    for s in node.inputs:
        if s.name == name and s.type == 'RGBA':
            return s
    return None


def _resample(arr, px):
    h, w = arr.shape[:2]
    yi = (np.arange(px) * h // px).clip(0, h - 1)
    xi = (np.arange(px) * w // px).clip(0, w - 1)
    return arr[yi][:, xi]


def _resolve(socket, px=TILE_PX, depth=0):
    """Evaluate a Base Color sub-graph into a linear RGB array, or None."""
    if depth > 4:
        return None

    if not socket.is_linked:
        c = np.array(socket.default_value[:3], dtype=np.float64)
        return np.broadcast_to(c, (px, px, 3)).copy()

    node = socket.links[0].from_node

    if node.type == 'TEX_BRICK':
        p = _brick_params(node)
        return _brick_array(p, px)

    if node.type == 'VALTORGB':
        stops = [(e.position, list(e.color[:3])) for e in node.color_ramp.elements]
        return _noise_ramp_array(stops, px) if len(stops) >= 2 else None

    if node.type == 'HUE_SAT':
        base = _resolve(node.inputs['Color'], px, depth + 1)
        if base is None:
            return None
        hsv = rgb_to_hsv(base)
        hsv[..., 0] = (hsv[..., 0] + node.inputs['Hue'].default_value - 0.5) % 1.0
        hsv[..., 1] = np.clip(hsv[..., 1] * node.inputs['Saturation'].default_value, 0, 1)
        hsv[..., 2] = hsv[..., 2] * node.inputs['Value'].default_value
        return hsv_to_rgb(hsv)

    if node.type == 'TEX_IMAGE' and node.image:
        img = node.image
        w, h = img.size
        buf = np.empty(w * h * img.channels, dtype=np.float32)
        img.pixels.foreach_get(buf)
        px_arr = buf.reshape(h, w, img.channels)[..., :3][::-1]
        return _resample(srgb_to_linear(px_arr.astype(np.float64)), px)

    if node.type == 'MIX' and node.data_type == 'RGBA':
        a = _color_socket(node, 'A')
        bsock = _color_socket(node, 'B')
        if a is None or bsock is None:
            return None
        ca = _resolve(a, px, depth + 1)
        cb = _resolve(bsock, px, depth + 1)
        if ca is None or cb is None:
            return None
        f = node.inputs[0].default_value
        return ca + (cb - ca) * f

    return None


def convert(log=print):
    """Rebuild every unsupported Base Color chain as an image texture."""
    converted = {}

    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        nt = mat.node_tree
        bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if not bsdf:
            continue
        bc = bsdf.inputs['Base Color']
        if not bc.is_linked:
            continue

        src = bc.links[0].from_node

        # A plain image already exports correctly; leave it alone.
        if src.type == 'TEX_IMAGE':
            continue

        # Brickwork keeps the source photo's full resolution rather than going
        # through the generic resolver, which works at the generated tile size.
        if src.type == 'HUE_SAT':
            ci = src.inputs['Color']
            tex = ci.links[0].from_node if ci.is_linked else None
            if tex and tex.type == 'TEX_IMAGE' and tex.image:
                img = build_hue_sat_image(
                    'BAKED_' + mat.name, tex.image,
                    src.inputs['Hue'].default_value,
                    src.inputs['Saturation'].default_value,
                    src.inputs['Value'].default_value)
                if _wire_image(mat, img):
                    converted[mat.name] = 'hue_sat'
                continue

        arr = _resolve(bc)
        if arr is not None:
            img = _new_image('BAKED_' + mat.name, np.clip(arr, 0, 1).astype(np.float32))
            if _wire_image(mat, img):
                converted[mat.name] = src.type.lower()

    for name, kind in sorted(converted.items()):
        log('rebuilt %s (%s)' % (name, kind))
    return converted


# ----------------------------------------------------------------- box UVs

def ensure_uvs(objects, converted, log=print):
    """Box-project UVs onto meshes that have none.

    The brickwork was mapped from object coordinates, which glTF cannot express
    and which left 252 of the scene's meshes with no UV layer at all. Projecting
    per face along its dominant world axis reproduces exactly what that setup
    was doing, and doing it in world space keeps the brick coursing lined up
    across separate wall objects.
    """
    made = 0
    brick_mats = {n for n, k in converted.items() if k == 'hue_sat'}

    for ob in objects:
        if ob.type != 'MESH':
            continue
        me = ob.data
        mats = {s.name for s in ob.material_slots if s.name}
        is_brick = bool(mats & brick_mats)

        if me.uv_layers and not is_brick:
            continue
        # Brick meshes are re-projected even if they carry a stale UV layer, so
        # every wall shares one consistent scale.
        if me.uv_layers and is_brick:
            while me.uv_layers:
                me.uv_layers.remove(me.uv_layers[0])

        uv_layer = me.uv_layers.new(name='UVMap')
        scale = BRICK_UV_SCALE if is_brick else 1.0
        mw = ob.matrix_world

        for poly in me.polygons:
            n = (mw.to_3x3() @ poly.normal)
            ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
            for li in poly.loop_indices:
                co = mw @ me.vertices[me.loops[li].vertex_index].co
                if az >= ax and az >= ay:
                    u, v = co.x, co.y      # floors and ceilings
                elif ax >= ay:
                    u, v = co.y, co.z      # walls facing X
                else:
                    u, v = co.x, co.z      # walls facing Y
                uv_layer.data[li].uv = (u * scale, v * scale)
        made += 1

    log('generated UVs for %d meshes' % made)
    return made
