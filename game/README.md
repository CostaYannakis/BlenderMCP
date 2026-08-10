# BALMORAL — 3:33

A first-person walkthrough built from the Balmoral house model — the real
architecture, at real metric scale.

**Live: https://balmoral-walkthrough.vercel.app**

```
cd game
npm start        # http://localhost:5173
```

No build step. The libraries are vendored into `vendor/`, so the game runs from
a plain static server and works offline.

## Two modes

**WALKTHROUGH** (default) — daylight, full material colour, nothing happening.
For looking at the building: the brickwork, the blue bathroom tiling, the
kitchen splashback and joinery. You can walk out and around the outside.

**AFTER DARK** — the other one. See below.

`M` switches between them at any time, mid-walk.

Both are defined in `src/modes.js`. Nothing there touches material colour —
brightness is entirely lighting and exposure, so the authored albedo survives in
both and switching is instant and lossless.

## Controls

| | |
|---|---|
| `W A S D` | move |
| mouse | look (click to lock the pointer) |
| `Shift` | run |
| `C` | crouch |
| `F` | torch |
| `M` | switch mode |
| `E` | take the light you are looking at (after dark) |
| `Esc` | release the pointer / pause |

## After dark

Eleven lamps are burning. Look up at one and press `E` to take it. Every lamp
you take advances a **cycle**, and every cycle the house gets a little further
from the plan: the air thickens, the colour drains, furniture is not where you
left it, cupboards are ajar, and something tall is standing at the end of a room
that was empty a moment ago. It will not be looked at directly.

Past halfway the house starts putting lights back on behind you.

Walk too far from the building and it returns you to a room you did not walk to.
When the last lamp is out, the front door means something again.

## How it is built

```
bake/bake_house.py     Blender -> GLB + level.json  (headless)
bake/materials.py      rebuilds procedural materials as real textures
assets/balmoral.glb    371 meshes, ~107k triangles, 2K textures
assets/level.json      lamp positions, room markers, door/window openings
src/modes.js           the two lighting/behaviour presets
src/level.js           GLB load, material setup, collision BVH, lamp rig
src/player.js          capsule controller, gravity, step-up, head bob
src/surreal.js         cycles, mutations, the watcher, the ending
src/audio.js           all sound, synthesised at runtime (no audio files)
src/post.js            tone map + grain, vignette, aberration, warp, mirror
```

### Procedural materials

This is the part worth knowing about. glTF carries image textures, not shader
graphs, and several of the scene's best materials are procedural:

- the blue bathroom tiling, the bath feature tile and the kitchen splashback are
  **Brick Texture** nodes;
- the exterior brickwork is an image driven through a **Hue/Saturation** node and
  an object-space box projection built from Separate/Combine XYZ;
- the timber floor, benchtop laminate, carpet, paving and foliage are **ColorRamp
  and Mix** chains over noise.

The exporter silently flattens every one of them to a single colour. That is why
an early build had no tiles and no brickwork — grey mush where the detail should
be. On top of that, **252 of the 395 meshes had no UV layer at all**, because
they were mapped from object coordinates.

`bake/materials.py` fixes both. It walks each material's Base Color sub-graph and
evaluates it into a real image — reproducing Blender's Brick Texture exactly,
including the per-brick hash that varies the tint — then wires that image
straight to Base Color. Meshes without UVs get a world-space box projection,
which is what the object-coordinate mapping was doing anyway and which keeps the
brick coursing aligned across separate wall objects.

Two details that matter if you touch it:

- Tile sheets cover exactly one UV unit and the brick size is snapped to the
  nearest whole divisor. The mesh UVs are in metres and run well past 0..1, so
  the sheet has to wrap; at 152 mm that snap is a few millimetres, invisible, and
  it avoids depending on a UV-transform extension.
- Every array in that module is top-down. `_new_image` is the single place the
  flip to Blender's bottom-up buffer happens.

### The bake

`bake/bake_house.py` runs headless against `../balmoral_house_architect.blend`
and never saves it:

```
npm run bake
```

It drops boolean cutters, the floor-plan and photo reference planes, and the
render-only set dressing (backdrops, still-render lights); applies modifiers so
the door and window openings become real geometry; rebuilds the procedural
materials as textures (above); and writes `assets/balmoral.glb` plus
`assets/level.json`.

Re-run it after changing the model. Nothing else needs to change — rooms, lamps
and openings are all read from `level.json`, so a new lamp in Blender becomes a
new objective in the game.

Note that the GLB is Y-up while the manifest and Blender are Z-up. Everything
read from `level.json` goes through `fromBlender()` in `src/level.js`, which
maps Blender `(x, y, z)` to `(x, z, -y)`.

### Collision

Every solid triangle is merged into one geometry wrapped in a `MeshBVH`. The
player is a capsule resolved against it with five substeps per frame, which is
what stops a run from tunnelling through a 100 mm stud wall. The capsule's
rounded base rides the 170 mm risers into the sunken family room without any
special stair handling.

Foliage is excluded from the collider; glazing is not, because windows should
stop you.

### Lighting

Daylight is a hemisphere light plus a shadow-casting sun. The hemisphere does the
heavy lifting because it is not occluded by the roof, which is what makes
enclosed interiors readable without lighting every room by hand — but its colour
is kept near neutral, since a saturated sky at that strength tints white plaster
solid blue and reads as a hole in the wall.

There is also an environment map (`RoomEnvironment` through `PMREMGenerator`).
Without it every metal in the house — the chrome tap, the steel appliances, the
bathroom mirror — renders black, because metals have no diffuse term and nothing
to reflect. Its strength is set per mode via `scene.environmentIntensity`.

The lamps are the `DUSK_INT_*` lights from the blend file, in their modelled
positions. They do **not** cast shadows — see the performance notes below for
why. Instead their falloff radius is kept short (3.2 m), so a lamp at ceiling
height reaches about 2.4 m across the floor and cannot throw light through a
wall into the next room.

The sun is the only shadow caster. The architecture never moves, so its map is
rendered once at load and the whole shadow system is then frozen with
`renderer.shadowMap.autoUpdate = false`.

The torch uses `decay = 1` rather than physical inverse-square. With decay 2 a
torch either blows the near wall to white or dies before it crosses a room.

The night mode's numbers are tuned against the authored albedo. An earlier build
darkened every material to 42% and balanced the lights against that; removing the
crush to get the detail back meant roughly halving every light in that mode.

### Performance

Boot is about 4 s and frames run around 5 ms. Getting there meant fixing three
things, and the first is the interesting one.

**Shader recompiles while walking.** The lamps used to cast shadows, and since
each shadow-casting light costs a fragment texture unit against WebGL's
guaranteed sixteen, only the nearest few could be enabled at once. That meant a
nearest-N visibility cull every frame — and changing the set of visible lights
changes the shader permutation. Walking around the house recompiled shaders
continuously (`renderer.info.programs` climbed 48 → 51 over a short walk), which
showed up as constant stutter, and the reshuffled shadow uniform slots made whole
surfaces flash black for a frame. Dropping point-light shadows removed the cull,
the recompiles and the black flashes together; the program count is now flat
while walking.

If you ever reintroduce a light whose `visible` flag changes at runtime, expect
both symptoms back.

**Draw calls.** The GLB arrives as 412 separate objects — 772 draw calls a frame
looking at the house from outside. `_mergeStatic` batches everything that never
moves into one mesh per material: 296 meshes become 38 batches, and draw calls
drop to 292 outdoors and 153 inside. It trades per-object frustum culling for a
tenth of the draw calls, which is the right way round when the whole level is
only ~107k triangles.

**Shader compilation on first sight.** Three compiles a material the first time
it is actually drawn, so walking into an unseen room cost a compile stall
mid-stride. `precompile()` pays for all of it behind the loading screen, for
both modes — each mode has a different light set and therefore its own
permutation, so compiling only the starting one left a freeze on the first `M`.

Textures are 1K rather than 2K, which took the GLB from 30.9 MB to 6.4 MB. At
1024 px the brick veneer still gets ~680 px per metre of wall, since it repeats
every 1.5 m.

One caveat on measuring any of this: `requestAnimationFrame` is throttled in a
background tab, and Chrome progressively deprioritises backgrounded tabs, so
frame timings taken from a detached console are unreliable — they will get worse
the longer the script runs, regardless of what the renderer is doing. Draw-call
and program counts stay trustworthy.

### Deploying

The site is a Vercel project, `balmoral-walkthrough`, deployed from this
directory:

```
cd game
npx vercel deploy --prod
```

There is no build step — Vercel serves these files as they are.

The model lives in `assets/`, not `public/`. That matters: for a project with no
framework Vercel uses `public` as the output directory if it exists, so a folder
by that name would have been published *as* the site root and everything else
would have 404'd. `vercel.json` caches `assets/` and `vendor/` as immutable for
a year and holds the entry point and scripts to must-revalidate, so re-deploys
take effect immediately while the 6 MB model is fetched once.

`.vercel/` and `.env.local` are generated by the CLI and gitignored — the latter
holds an OIDC token and must not be committed.

### Debugging

`window.__balmoral` exposes `{ THREE, renderer, scene, camera, level, player,
surreal, sound, ui, liminal, torch }`. Useful things:

```js
const b = window.__balmoral;
b.player.enabled = true;                       // run without pointer lock
b.surreal.dread = 0.8;                         // jump to the deep end
b.surreal.takeLamp(b.surreal.targets[0]);      // advance a cycle
b.player.placeAt(new b.THREE.Vector3(x, 0.3, z), yaw);
```

Note that `requestAnimationFrame` is throttled while the tab is in the
background, so the frame loop — and therefore the torch ramp — stalls if you
drive the game from a detached console.

## Caveats

- Collision is baked from the model's original positions, so props the house
  moves keep their original collision. At the small offsets used this reads as
  part of the effect rather than a fault.
- Without shadows on the practicals, a lamp can bleed slightly through a thin
  wall at very close range. The short falloff radius keeps this rare, and it is
  a far better trade than the stutter that shadowed point lights cost.
- The house has no interior doors. Every internal opening in the model is a bare
  doorway, so all rooms are always reachable; the only door leaves are the two
  exterior sliding doors on the family room.
