import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshBVH, acceleratedRaycast } from 'three-mesh-bvh';

THREE.Mesh.prototype.raycast = acceleratedRaycast;

// The GLB was exported Y-up, so Blender (x, y, z) became (x, z, -y).
// level.json still speaks Blender, hence every position from it goes through here.
export function fromBlender(p) {
  return new THREE.Vector3(p[0], p[2], -p[1]);
}

// Materials whose meshes should be seen but not collided with, or not lit normally.
const GLASS_MATERIALS = /GLASS/i;
const MIRROR_MATERIALS = /MIRROR/i;
const FOLIAGE_MATERIALS = /FOLIAGE|LAWN|GRASS/i;

/** Rooms the player can be "in", derived from the baked practical lights. */
const ROOM_LABELS = {
  entry: 'ENTRY',
  hall: 'HALL',
  kitchen: 'KITCHEN',
  meals: 'MEALS',
  family: 'FAMILY ROOM',
  lounge_a: 'LOUNGE',
  lounge_b: 'LOUNGE',
  bed1: 'BEDROOM 1',
  bed3: 'BEDROOM 3',
  bed4: 'BEDROOM 4',
  bath_ceiling: 'BATHROOM',
};

export class Level {
  constructor() {
    this.root = new THREE.Group();
    this.collider = null;      // single merged mesh carrying the BVH
    this.lamps = [];           // interactive practical lights
    this.rooms = [];           // { key, label, pos }
    this.doors = [];           // door leaves we can swing open
    this.movable = [];         // meshes the house is allowed to rearrange
    this.data = null;
  }

  async load(onProgress, mark = () => {}) {
    const loader = new GLTFLoader();

    const [gltf, data] = await Promise.all([
      new Promise((res, rej) =>
        loader.load('./public/balmoral.glb', res,
          e => onProgress?.(e.total ? e.loaded / e.total : 0), rej)),
      fetch('./public/level.json').then(r => r.json()),
    ]);
    mark('gltf_fetch_parse');

    this.data = data;
    this.root.add(gltf.scene);
    this._prepareMaterials(gltf.scene);
    mark('materials');
    this._buildCollider(gltf.scene);
    mark('collider_bvh');
    this._buildRooms(data);
    this._collectProps(gltf.scene);
    this._mergeStatic(gltf.scene);
    mark('merge_static');

    return this;
  }

  /**
   * Batch the static architecture into one mesh per material.
   *
   * The GLB arrives as 412 separate objects, which outdoors meant 772 draw
   * calls a frame. Nothing but the handful of props the night mode moves ever
   * changes transform, so everything else can be merged once at load. This
   * trades per-object frustum culling for roughly a tenth of the draw calls —
   * a good trade when the whole level is only ~107k triangles, which any GPU
   * will chew through without noticing.
   */
  _mergeStatic(scene) {
    const dynamic = new Set([
      ...this.movable.map(m => m.mesh),
      ...this.doors.map(d => d.mesh),
    ]);

    scene.updateMatrixWorld(true);

    const byMaterial = new Map();
    const originals = [];

    scene.traverse(o => {
      if (!o.isMesh || !o.geometry || dynamic.has(o)) return;
      // Multi-material meshes carry draw groups; leave those alone.
      if (Array.isArray(o.material)) return;

      const key = o.material.uuid;
      if (!byMaterial.has(key)) byMaterial.set(key, { material: o.material, geoms: [] });

      const g = o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      byMaterial.get(key).geoms.push(g);
      originals.push(o);
    });

    const batches = new THREE.Group();
    batches.name = 'STATIC_BATCHES';
    let made = 0;

    for (const { material, geoms } of byMaterial.values()) {
      // Merging needs a consistent attribute set across the group.
      const attrs = geoms.reduce(
        (acc, g) => acc.filter(a => g.attributes[a]),
        Object.keys(geoms[0].attributes)
      );
      const prepared = geoms.map(g => {
        const n = g.index ? g.toNonIndexed() : g;
        for (const a of Object.keys(n.attributes)) {
          if (!attrs.includes(a)) n.deleteAttribute(a);
        }
        n.morphAttributes = {};
        n.clearGroups();
        return n;
      });

      const merged = BufferGeometryUtils.mergeGeometries(prepared, false);
      for (const g of prepared) g.dispose();
      if (!merged) continue;

      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      batches.add(mesh);
      made++;
    }

    for (const o of originals) o.removeFromParent();
    for (const g of byMaterial.values()) for (const geo of g.geoms) geo.dispose();

    this.root.add(batches);
    this.batchCount = made;
    this.mergedFrom = originals.length;
  }

  /** Retune the architectural materials for a dark, damp, night-time house. */
  _prepareMaterials(scene) {
    const seen = new Set();
    scene.traverse(o => {
      if (!o.isMesh) return;

      const mats = Array.isArray(o.material) ? o.material : [o.material];

      // Decided per mesh, so it still applies when the material was already
      // retuned via another mesh that shares it.
      const isGlass = mats.some(m => m && GLASS_MATERIALS.test(m.name || ''));
      o.castShadow = !isGlass;
      o.receiveShadow = true;
      o.frustumCulled = true;

      for (const m of mats) {
        if (!m || seen.has(m.uuid)) continue;
        seen.add(m.uuid);

        const name = m.name || '';

        if (GLASS_MATERIALS.test(name)) {
          m.transparent = true;
          m.opacity = 0.16;
          m.roughness = 0.05;
          m.metalness = 0.0;
          m.color.setHex(0x2a3644);
          m.depthWrite = false;
        } else if (MIRROR_MATERIALS.test(name)) {
          // Without a reflection to show, a translucent mirror just reads as a
          // grey sheet taped to the wall. A polished metal surface at least
          // catches the lights and looks like glass.
          m.metalness = 1.0;
          m.roughness = 0.06;
          m.color.setHex(0xdfe4ea);
          m.transparent = false;
          m.opacity = 1;
        } else if (FOLIAGE_MATERIALS.test(name)) {
          m.roughness = 1.0;
        } else {
          // Albedo is left exactly as authored. Darkness is a lighting and
          // exposure decision, not a material one — crushing the colour here is
          // what flattened the tiling and the brickwork to grey mush.
          m.metalness = Math.min(m.metalness ?? 0, 0.35);
        }

        // Anisotropic filtering keeps the brick coursing and tile grout from
        // shimmering into porridge at a glancing angle.
        if (m.map) {
          m.map.anisotropy = 8;
          m.map.needsUpdate = true;
        }
        m.side = THREE.FrontSide;
        m.needsUpdate = true;
      }
    });
  }

  /**
   * Merge every solid triangle into one geometry and wrap it in a BVH. The
   * house never moves, so one static tree serves both movement and raycasts.
   */
  _buildCollider(scene) {
    const geoms = [];
    scene.updateMatrixWorld(true);

    scene.traverse(o => {
      if (!o.isMesh || !o.geometry) return;

      const matName = (Array.isArray(o.material) ? o.material[0] : o.material)?.name || '';
      // Glass panes still block you (they are windows), but leaves do not.
      if (FOLIAGE_MATERIALS.test(matName)) return;

      // De-indexing everything guarantees the uniform layout mergeGeometries
      // needs, whatever mix of indexed and non-indexed the GLB arrived with.
      const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone());
      g.applyMatrix4(o.matrixWorld);

      for (const key of Object.keys(g.attributes)) {
        if (key !== 'position') g.deleteAttribute(key);
      }
      g.morphAttributes = {};
      g.clearGroups();
      geoms.push(g);
    });

    const merged = BufferGeometryUtils.mergeGeometries(geoms, false);
    if (!merged) throw new Error('collider merge failed — mismatched geometry attributes');
    merged.boundsTree = new MeshBVH(merged, { maxLeafTris: 12 });

    this.collider = new THREE.Mesh(merged, new THREE.MeshBasicMaterial({ visible: false }));
    this.collider.name = 'COLLIDER';
    this.triangleCount = merged.attributes.position.count / 3;

    for (const g of geoms) g.dispose();
  }

  /** Turn the baked Blender lights into interactive lamps plus room markers. */
  _buildRooms(data) {
    for (const l of data.lights) {
      const pos = fromBlender(l.pos);
      const label = ROOM_LABELS[l.room];

      if (label) this.rooms.push({ key: l.room, label, pos: pos.clone() });

      const exterior = l.name.startsWith('DUSK_LIGHT_');

      // No shadows on the practicals, and a deliberately short reach.
      //
      // Shadow-casting point lights cost a texture unit each, which forced a
      // nearest-N visibility cull every frame. Changing the visible light set
      // changes the shader permutation, so walking around triggered constant
      // recompiles (visible as stutter) and reshuffled the shadow uniform
      // slots, which made whole surfaces flash black for a frame.
      //
      // Containment comes from the falloff radius instead: 3.2 m from a lamp
      // at 2.15 m reaches about 2.4 m across the floor, so a lamp cannot throw
      // light through a wall into the next room.
      const light = new THREE.PointLight(0xffb066, 0, exterior ? 4.5 : 3.2, 2);
      light.position.copy(pos);
      light.castShadow = false;
      this.root.add(light);

      // A small glowing bulb so the lamp reads as an object you can walk to.
      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0xffd2a0, transparent: true, opacity: 0 })
      );
      bulb.position.copy(pos);
      this.root.add(bulb);

      this.lamps.push({
        name: l.name,
        room: l.room,
        label: label || 'OUTSIDE',
        exterior,
        pos,
        light,
        bulb,
        baseIntensity: exterior ? 1.4 : 1.5,
        lit: true,
        taken: false,
        flicker: 1,
      });
    }
  }

  /**
   * Catalogue the props the house is permitted to rearrange behind your back.
   *
   * Only things that read as loose objects qualify. Carcasses, splashbacks,
   * benchtops and tile runs are fixed joinery — nudging those looks like a
   * broken mesh rather than a haunted one.
   */
  _collectProps(scene) {
    const LOOSE = /^(KIT_HANDLE|KIT_APPLIANCE|BATH_KNOB|BATH_WC|BATH_TOWEL|PLANT_)/i;
    const FIXED = /CARCASS|PANEL|SPLASHBACK|BENCHTOP|VANITY|TILE|SINK|COOKTOP|WALL|FLOOR|BRICK|CEILING/i;
    const CUPBOARD = /^KIT_DOOR_/i;

    scene.traverse(o => {
      if (!o.isMesh) return;
      const n = o.name || '';

      // Cabinet fronts get their own behaviour: they drift ajar.
      if (CUPBOARD.test(n)) {
        this.doors.push({ mesh: o, homeRot: o.rotation.clone() });
        return;
      }

      if (LOOSE.test(n) && !FIXED.test(n)) {
        this.movable.push({
          mesh: o,
          home: o.position.clone(),
          homeRot: o.rotation.clone(),
        });
      }
    });
  }

  /** Nearest room marker to a world position, for the caption line. */
  roomAt(pos) {
    let best = null, bestD = Infinity;
    for (const r of this.rooms) {
      const d = r.pos.distanceToSquared(pos);
      if (d < bestD) { bestD = d; best = r; }
    }
    // Beyond this the player is outdoors and the label would be a lie.
    return bestD < 36 ? best : null;
  }
}
