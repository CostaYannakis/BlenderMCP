# BALMORAL — walkthrough

A first-person walkthrough of the Balmoral house — the real architecture, at
real metric scale, built from the floor plan.

```
cd game
npm start        # http://localhost:5173
```

No build step. The libraries are vendored into `vendor/`, so it runs from a
plain static server and works offline.

## Controls

| | |
|---|---|
| `W A S D` | move |
| mouse | look (click to lock the pointer) |
| `Shift` | run |
| `C` | crouch |
| `Esc` | release the pointer / pause |

That is all of it. There are no objectives, no items and no events — you walk
around a building and look at it. The room name appears as you enter each one.

## Source model

Baked from **`../balmoral_house_build2.blend`**, a rebuild of the house traced
directly from `Image/floorplan1.jpg` at 25.4 px/m. Walls are separate segments
split at every opening rather than boolean-cut, so openings are real gaps with
head and sill infills.

```
assets/balmoral.glb    326 meshes, ~4,000 triangles, 1K textures, 0.7 MB
assets/level.json      lamp positions and room markers
bake/bake_house.py     Blender -> GLB + level.json  (headless)
bake/materials.py      rebuilds procedural materials as real textures
src/modes.js           the walkthrough lighting preset
src/level.js           GLB load, material setup, collision BVH, lamp rig
src/player.js          capsule controller, gravity, step-up, head bob
src/audio.js           footsteps and reverb, synthesised at runtime
src/post.js            tone map + grain, vignette, aberration
```

## Procedural materials

This is the part worth knowing about. glTF carries image textures, not shader
graphs, and the scene's patterned materials are procedural **Brick Texture**
nodes: the exterior brickwork, the cream bathroom wall tile, the blue bathroom
floor tile and the kitchen splashback. The exporter silently flattens every one
of them to a single colour.

`bake/materials.py` fixes that. It walks each material's Base Color sub-graph
and evaluates it into a real image — reproducing Blender's Brick Texture
exactly, including the per-brick hash that varies the tint — then wires that
image straight to Base Color.

Two details that matter if you touch it:

- Tile sheets cover exactly one UV unit and the brick size is snapped to the
  nearest whole divisor. Mesh UVs are in metres and run well past 0..1, so the
  sheet has to wrap; that snap is a few millimetres, invisible, and it avoids
  depending on a UV-transform extension.
- Every array in that module is top-down. `_new_image` is the single place the
  flip to Blender's bottom-up buffer happens.

The source .blend carries **world-space box-projected UVs on every mesh** (1 UV
unit = 1 metre), generated with the same projection `ensure_uvs()` uses. That
keeps brick coursing aligned across separate wall objects and means what you see
in Blender is what the GLB shows. `ensure_uvs()` therefore reports 0 meshes on a
clean bake — that is correct, not a failure.

Brickwork is applied as **a second material slot with per-face indices**, not as
veneer geometry: brick on the outward face, plaster inside, no extra polygons.
The outward face is chosen by probing 180 mm off each face and testing it
against the building footprint polygon, so it is correct on every jog.

## The bake

Runs headless against the .blend and never saves it:

```
npm run bake          # balmoral_house_build2.blend  (current)
npm run bake:legacy   # balmoral_house_architect.blend  (the original scene)
```

On Windows, `npm run` can mangle the quoted path to `blender.exe`. If it fails
with `'C:/Program' is not recognized`, run it directly:

```powershell
& "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe" `
  --background ..\balmoral_house_build2.blend --python bake\bake_house.py
```

It drops reference planes and anything hidden from render, applies modifiers,
rebuilds the procedural materials as textures, and writes `assets/balmoral.glb`
plus `assets/level.json`. Re-run after changing the model.

Note the GLB is Y-up while Blender is Z-up. Everything read from `level.json`
goes through `fromBlender()` in `src/level.js`, mapping Blender `(x, y, z)` to
`(x, z, -y)`.

### Lights and rooms

`level.json` rooms come from lights named `DUSK_INT_<ROOM>` in the .blend, plus
`BATH_LIGHT_CEILING`. The room key is the name with that prefix stripped and
lowercased, and it must match a key in `ROOM_LABELS` in `src/level.js` to
produce a label. Eleven are placed, one per named room. Add a light in Blender
with a matching name and it becomes a lit, labelled room with no code change.

## Collision

Every solid triangle is merged into one geometry wrapped in a `MeshBVH`. The
player is a capsule resolved against it with five substeps per frame, which is
what stops a run from tunnelling through a 110 mm stud wall. The floor slab and
ceiling are modelled as solids rather than single faces, so they are watertight
from both sides and the capsule cannot pass through them.

Glazing is included in the collider, because windows should stop you.
