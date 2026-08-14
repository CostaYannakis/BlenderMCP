/**
 * Other people in the house.
 *
 * Deliberately cheap: a capsule body, a sphere head and a name label, about
 * 250 triangles each. Geometry and materials are shared across every avatar so
 * six people cost six draw calls for the bodies plus six for the labels, not
 * sixty. That matters here — the whole house renders in 27 batches, so careless
 * avatars would be the most expensive thing on screen.
 *
 * Poses arrive at 12 Hz and are interpolated, otherwise everyone else would
 * move like a stop-motion puppet.
 */
import * as THREE from 'three';

export const AVATARS = [
  { key: 'rose',   label: 'Rose',   color: 0xc4626e },
  { key: 'ochre',  label: 'Ochre',  color: 0xc98f4a },
  { key: 'olive',  label: 'Olive',  color: 0x7d8f52 },
  { key: 'teal',   label: 'Teal',   color: 0x4a8f8a },
  { key: 'indigo', label: 'Indigo', color: 0x5d6aa8 },
  { key: 'plum',   label: 'Plum',   color: 0x8a5f93 },
];

const EYE = 1.58;            // matches Player.eyeStand, so heads line up
const BODY_H = 1.05;
const HEAD_R = 0.155;

// One geometry each, reused by every avatar.
const bodyGeo = new THREE.CapsuleGeometry(0.21, BODY_H - 0.42, 4, 10);
const headGeo = new THREE.SphereGeometry(HEAD_R, 12, 8);
const noseGeo = new THREE.ConeGeometry(0.05, 0.13, 6);

function labelSprite(text, color) {
  const pad = 12, font = 34;
  const c = document.createElement('canvas');
  const g = c.getContext('2d');
  g.font = `500 ${font}px ui-sans-serif, system-ui, sans-serif`;
  const w = Math.ceil(g.measureText(text).width) + pad * 2;
  c.width = w; c.height = font + pad * 2;
  const g2 = c.getContext('2d');
  g2.font = `500 ${font}px ui-sans-serif, system-ui, sans-serif`;
  g2.fillStyle = 'rgba(12,14,19,.72)';
  g2.roundRect?.(0, 0, c.width, c.height, 10);
  g2.fill();
  g2.fillStyle = '#' + color.toString(16).padStart(6, '0');
  g2.textBaseline = 'middle';
  g2.fillText(text, pad, c.height / 2);

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthTest: false, depthWrite: false,
  }));
  spr.scale.set(c.width / 260, c.height / 260, 1);
  spr.position.y = EYE + 0.34;
  spr.renderOrder = 10;
  return spr;
}

export class RemotePlayer {
  constructor(player) {
    const spec = AVATARS[player.avatar % AVATARS.length];
    const mat = new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.75 });

    this.group = new THREE.Group();
    this.group.name = `AVATAR_${player.id}`;

    const body = new THREE.Mesh(bodyGeo, mat);
    body.position.y = BODY_H / 2 + 0.02;
    body.castShadow = true;

    const head = new THREE.Mesh(headGeo, mat);
    head.position.y = BODY_H + HEAD_R + 0.04;
    head.castShadow = true;

    // A small nose so you can tell which way someone is facing across a room.
    const nose = new THREE.Mesh(noseGeo, mat);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, head.position.y, -HEAD_R - 0.03);

    this.group.add(body, head, nose, labelSprite(player.name, spec.color));

    this.target = new THREE.Vector3();
    this.targetYaw = 0;
    this.hasTarget = false;
  }

  setPose(pose) {
    this.target.set(pose.p[0], pose.p[1], pose.p[2]);
    this.targetYaw = pose.y;
    if (!this.hasTarget) {
      this.group.position.copy(this.target);
      this.group.rotation.y = this.targetYaw;
      this.hasTarget = true;
    }
  }

  update(dt) {
    if (!this.hasTarget) return;
    // Exponential ease, framed in seconds so it is frame-rate independent.
    const k = 1 - Math.exp(-dt / 0.08);
    this.group.position.lerp(this.target, k);
    let d = this.targetYaw - this.group.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.group.rotation.y += d * k;
  }

  dispose() {
    this.group.traverse(o => {
      if (o.isSprite) { o.material.map?.dispose(); o.material.dispose(); }
      else if (o.isMesh) o.material.dispose();     // geometry is shared
    });
    this.group.removeFromParent();
  }
}
