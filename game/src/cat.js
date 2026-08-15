/**
 * The cat.
 *
 * The GLB carries the cat as loose CAT_* nodes rather than a rig, because a
 * skeleton and baked clips would cost more to export, load and play than this
 * whole animal is worth. Instead the parts are re-parented into one group at
 * load and driven procedurally: legs swing from the hip, the tail sways, the
 * head bobs. Total cost is a handful of quaternion writes a frame.
 *
 * It walks a fixed round of the house. Height is not scripted - it raycasts
 * onto the level collider each step, so it drops into the sunken family room
 * and climbs back out without anyone telling it the floor moved.
 *
 * Blender Z-up becomes glTF Y-up, so the cat models facing Blender +X, which
 * is still +X here, and its left-right axis (Blender Y) becomes Z. That is why
 * the legs swing about Z and the tail sways about Y.
 */
import * as THREE from 'three';

const WALK = 0.62;             // m/s, an unhurried indoor cat
const TURN = 2.6;              // rad/s
const ARRIVE = 0.22;           // m, close enough to a waypoint
const STRIDE = 7.5;            // leg swing rate, scaled by speed
const SWING = 0.42;            // rad, max leg swing

// A round of the house, in Blender coordinates for readability - these came off
// the floor plan. Converted to three's axes on construction.
const ROUND_BLENDER = [
  [2.00, -1.50], [3.60, -1.20], [3.90, 0.90],          // lounge -> meals
  [4.20, 2.60], [2.95, 5.20], [4.60, 6.80],            // down into the family room
  [2.20, 7.20], [0.90, 5.40], [0.70, 2.60],            // back through family/kitchen
  [-0.80, 1.20], [-1.60, -0.40], [-2.60, -3.60],       // hall -> bedroom 2
  [-1.00, -4.60], [1.00, -4.40], [1.90, -3.00],        // hall -> entry -> lounge
];

const toThree = (bx, by) => new THREE.Vector3(bx, 0, -by);

export class Cat {
  /**
   * @param {THREE.Object3D[]} parts  the CAT_* nodes from the GLB
   * @param {THREE.Object3D} root     scene node to attach the cat group to
   * @param {THREE.Mesh} collider     level collider, for finding the floor
   */
  constructor(parts, root, collider) {
    this.ok = parts && parts.length > 0;
    if (!this.ok) return;

    this.collider = collider;
    this.group = new THREE.Group();
    this.group.name = 'CAT';
    root.add(this.group);

    // The parts sit in world space. Re-parent them around a pivot at the cat's
    // footprint centre so the group can be driven as one animal.
    const box = new THREE.Box3();
    for (const p of parts) box.expandByObject(p);
    const pivot = new THREE.Vector3(
      (box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);

    this.parts = new Map();
    for (const p of parts) {
      p.updateMatrixWorld(true);
      const wp = new THREE.Vector3();
      p.getWorldPosition(wp);
      p.removeFromParent();
      this.group.add(p);
      p.position.copy(wp.sub(pivot));
      p.rotation.set(0, 0, 0);
      this.parts.set(p.name.toUpperCase(), p);
      p.castShadow = true;
      // Remember the rest pose; every frame is applied as a delta from it.
      p.userData.rest = p.position.clone();
    }
    this.group.position.copy(pivot);

    this.legs = ['CAT_LEG_FL', 'CAT_LEG_FR', 'CAT_LEG_BL', 'CAT_LEG_BR']
      .map(n => this.parts.get(n)).filter(Boolean);
    this.paws = ['CAT_PAW_FL', 'CAT_PAW_FR', 'CAT_PAW_BL', 'CAT_PAW_BR']
      .map(n => this.parts.get(n)).filter(Boolean);
    this.tail = this.parts.get('CAT_TAIL');
    this.head = this.parts.get('CAT_HEAD');
    this.headKit = ['CAT_MUZZLE', 'CAT_NOSE', 'CAT_EAR_L', 'CAT_EAR_R',
                    'CAT_EYE_L', 'CAT_EYE_R']
      .map(n => this.parts.get(n)).filter(Boolean);

    this.path = ROUND_BLENDER.map(([bx, by]) => toThree(bx, by));
    this.target = 0;
    this.phase = 0;
    this.pause = 0;
    this.yaw = 0;
    this._ray = new THREE.Raycaster();
    this._down = new THREE.Vector3(0, -1, 0);

    // Start on the floor rather than wherever Blender left it.
    this.group.position.copy(this.path[0]);
    this.group.position.y = this._floorAt(this.path[0]) ?? 0;
  }

  _floorAt(p) {
    if (!this.collider) return null;
    this._ray.set(new THREE.Vector3(p.x, (p.y || 0) + 1.5, p.z), this._down);
    this._ray.far = 4.0;
    const hit = this._ray.intersectObject(this.collider, true);
    return hit.length ? hit[0].point.y : null;
  }

  update(dt) {
    if (!this.ok) return;
    const g = this.group;

    // --- pause now and then, and have a look around ------------------------
    if (this.pause > 0) {
      this.pause -= dt;
      this.phase += dt * 1.2;
      const look = Math.sin(this.phase * 0.7) * 0.5;
      if (this.head) this.head.rotation.y = look;
      for (const h of this.headKit) h.rotation.y = look;
      if (this.tail) this.tail.rotation.y = Math.sin(this.phase * 1.6) * 0.30;
      for (const l of this.legs) l.rotation.z = 0;
      return;
    }

    const goal = this.path[this.target];
    const dx = goal.x - g.position.x;
    const dz = goal.z - g.position.z;
    const dist = Math.hypot(dx, dz);

    if (dist < ARRIVE) {
      this.target = (this.target + 1) % this.path.length;
      if (Math.random() < 0.35) this.pause = 1.5 + Math.random() * 3.0;
      return;
    }

    // turn toward the goal, then walk
    const want = Math.atan2(dx, dz) - Math.PI / 2;   // model faces +X
    let d = want - this.yaw;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    const turn = Math.min(Math.abs(d), TURN * dt) * Math.sign(d);
    this.yaw += turn;
    g.rotation.y = -this.yaw;

    // slow down while turning hard, the way an animal does
    const speed = WALK * Math.max(0.25, 1 - Math.abs(d) * 0.8);
    const step = Math.min(speed * dt, dist);
    g.position.x += Math.cos(this.yaw) * step;
    g.position.z -= Math.sin(this.yaw) * step;

    const floor = this._floorAt(g.position);
    if (floor !== null) {
      // ease onto the new height so the step into the family room is a step,
      // not a teleport
      g.position.y += (floor - g.position.y) * Math.min(1, dt * 8);
    }

    // --- gait ---------------------------------------------------------------
    this.phase += dt * STRIDE * (speed / WALK);
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);
    if (this.legs[0]) this.legs[0].rotation.z = s * SWING;        // front left
    if (this.legs[1]) this.legs[1].rotation.z = -s * SWING;       // front right
    if (this.legs[2]) this.legs[2].rotation.z = -s * SWING * 0.9; // back left
    if (this.legs[3]) this.legs[3].rotation.z = s * SWING * 0.9;  // back right
    for (let i = 0; i < this.paws.length; i++) {
      const p = this.paws[i];
      const sign = (i === 0 || i === 3) ? 1 : -1;
      p.position.x = p.userData.rest.x + Math.sin(this.phase) * sign * 0.035;
      p.position.y = p.userData.rest.y + Math.max(0, Math.sin(this.phase) * sign) * 0.02;
    }
    if (this.tail) {
      this.tail.rotation.y = s * 0.22;
      this.tail.rotation.z = c * 0.10;
    }
    if (this.head) {
      this.head.rotation.z = c * 0.05;
      this.head.rotation.y = 0;
    }
    for (const h of this.headKit) { h.rotation.y = 0; h.rotation.z = c * 0.05; }

    // a little body bob, in step with the stride
    g.position.y += Math.abs(s) * 0.012;
  }
}
