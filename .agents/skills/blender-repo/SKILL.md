---
name: blender-repo
description: Build and refine floor-plan-based residential architecture in this Blender repository through Blender MCP. Use for plan calibration, axis alignment, wall blockouts, non-destructive door or window openings, architectural object naming, manifest-driven dimensions, and Blender scene verification.
---

# Blender House Architecture

Use Blender MCP for scene inspection, editing, screenshots, and verification. Treat `blenderhousearchitect.manifest.yaml` as the project source of truth for dimensions, source-plan calibration, naming, assumptions, and unresolved inputs.

## Work In Phases

1. Inspect the scene and manifest.
2. Back up the active `.blend` file before each structural phase.
3. Align and calibrate the floor-plan reference on the XY plane.
4. Build exterior walls, then internal walls.
5. Verify wall placement and dimensions before adding openings.
6. Cut windows and doors non-destructively.
7. Add assemblies, floors, ceilings, and roofs only after their preceding phase is verified.

Do not infer missing construction dimensions silently. Record provisional choices in the manifest with a status or confidence value.

## Keep Walls Editable

- Create one Blender object per logical straight wall section.
- Store walls in `ARCH_Walls` and follow the manifest naming pattern.
- Keep origins, transforms, normals, and topology clean.
- Do not join separate wall sections.

## Cut Openings Non-Destructively

- Keep each host wall as one object.
- Create one cutter object per window or door in `ARCH_Opening_Cutters`.
- Name cutters `CUT_WINDOW_<ID>` or `CUT_DOOR_<ID>`.
- Recalculate cutter face normals outward and verify a ray passes through the opening center.
- Add an Exact Boolean Difference modifier named `BOOL_WINDOW_<ID>` or `BOOL_DOOR_<ID>` to the host wall.
- Do not parent a cutter directly to the wall it modifies; that creates a Blender dependency cycle.
- Link the cutter to its host with a `host_wall` custom property and keep both objects in their named architecture collections.
- Display cutters as wireframe and keep them available for editing. While a Boolean is live, do not disable the cutter's dependency-graph evaluation merely to hide it.
- Prefer live Boolean modifiers. If Blender cannot display or render them reliably and the user has asked for implemented openings, duplicate every affected uncut host into hidden `ARCH_Wall_Bases`, preserve cutters and manifest records, apply the modifiers only to the visible working walls, and record the recoverable-bake mode.
- Never apply a Boolean without either a recovery base or a phase backup.
- Create frames, glazing, and door assemblies as separate objects in `ARCH_Windows` or `ARCH_Doors`.

Read horizontal opening locations and widths from the floor plan. Read sill and head heights from confirmed elevations or the manifest's explicitly provisional defaults.

## Verify Every Phase

After each phase:

- Confirm object counts, unique names, collection membership, dimensions, and applied transforms.
- Capture top and perspective viewport screenshots.
- Save the `.blend` file and confirm it is not dirty.
- Report assumptions and unresolved inputs separately from verified geometry.
