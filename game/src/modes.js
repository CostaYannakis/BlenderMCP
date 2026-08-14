import * as THREE from 'three';

/**
 * One way to be in the house: daylight, full material colour, nothing happening.
 *
 * This used to carry a second "after dark" mode with a light-collecting
 * mechanic. That layer is gone — this is a walkthrough of a building, so the
 * only job here is to light it honestly and keep the authored albedo intact.
 * Brightness is entirely lighting and exposure; nothing touches material colour.
 */

export const WALKTHROUGH = {
  label: 'WALKTHROUGH',
  background: 0x9fb6d4,
  fog: 0.009,

  environment: 0.30,
  ambient: 0.10,
  hemisphere: 0.32,
  sun: 1.5,
  lamp: 0.9,

  grade: {
    uExposure: 0.78,
    uGrain: 0.012,
    uVignette: 0.30,
    uDesat: 0.0,
    uAberration: 0.0003,
    uWarp: 0.02,
    uScan: 0.0,
    uPulse: 0,
    uFade: 0,
    uMirror: 0,
    tint: [1.0, 1.0, 1.0],
  },
};

/** Apply the walkthrough look to the live scene. */
export function applyMode(ctx) {
  const m = WALKTHROUGH;
  const { scene, fog, ambient, hemi, sun, level, bloom, liminal } = ctx;

  scene.background = new THREE.Color(m.background);
  scene.environmentIntensity = m.environment;
  fog.color.setHex(m.background);
  fog.density = m.fog;

  ambient.intensity = m.ambient;
  hemi.intensity = m.hemisphere;
  sun.intensity = m.sun;
  sun.visible = true;

  // Interior practicals stay simply on. They are room lighting now, not
  // something to interact with, so the bulbs stay invisible.
  for (const lamp of level.lamps) {
    lamp.baseIntensity = (lamp.exterior ? 1.4 : 1.5) * m.lamp;
    lamp.flicker = 1;
    lamp.light.intensity = lamp.baseIntensity;
    lamp.bulb.material.opacity = 0;
  }

  // The bloom mip chain costs several passes and in daylight there is nothing
  // bright enough to bloom.
  bloom.enabled = false;

  const u = liminal.uniforms;
  for (const [k, v] of Object.entries(m.grade)) {
    if (k === 'tint') u.uTint.value.set(...v);
    else if (u[k]) u[k].value = v;
  }

  return m;
}
