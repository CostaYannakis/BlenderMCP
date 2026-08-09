# Balmoral House Architect

Blender project for reconstructing the Balmoral house from a floor plan and exterior references. The scene is built around individually named architectural objects so walls, openings, floors, steps, materials, and room details can be found and revised quickly through Blender MCP.

## Project files

- `balmoral_house_architect.blend` — current working scene
- `blenderhousearchitect.manifest.yaml` — metric dimensions, plan calibration, object inventory, and modeling assumptions
- `.codex/agents/blenderhousearchitect.toml` — repository agent configuration
- `.agents/skills/blender-repo/` — Blender architecture workflow skill
- `Image/` — source floor plan and visual references
- `assets/` — textures and HDRIs used by the scene

## Opening the project

Open `balmoral_house_architect.blend` in Blender. Keep relative asset paths enabled so the checked-in `Image` and `assets` directories resolve from the repository root.

The manifest contains modeling defaults and provisional Australian residential assumptions. It is not engineering, certification, or regulatory approval; confirm the applicable jurisdiction and surveyed dimensions before relying on it for construction.

## Working conventions

Preserve meaningful object names and keep wall sections as separate objects. Make door and window openings non-destructively where practical, and update the manifest when dimensions, openings, levels, or authoritative object names change.
