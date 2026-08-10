import * as THREE from 'three';

/**
 * Two ways to be in the house.
 *
 * WALKTHROUGH is the default: daylight, full material colour, no events. It is
 * for looking at the building — the brickwork, the blue bathroom tiling, the
 * kitchen splashback — and it is what you want if you just came to walk around.
 *
 * NIGHT is the other one.
 *
 * Nothing here touches material colours. Brightness is entirely a function of
 * lighting and exposure, so the authored albedo survives in both modes and
 * switching is instant and lossless.
 */

export const MODES = {
  walkthrough: {
    label: 'WALKTHROUGH',
    hint: 'daylight · explore freely',
    background: 0x9fb6d4,
    fog: 0.009,

    environment: 0.30,
    ambient: 0.10,
    hemisphere: 0.32,
    sun: 1.5,
    lamp: 0.9,
    torch: 1.6,

    // Off in daylight: the bloom mip chain costs several passes and at this
    // strength there is nothing bright enough to bloom anyway.
    bloom: { enabled: false, strength: 0.22, threshold: 1.0, radius: 0.6 },

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

    surreal: false,
    leash: false,
    flicker: false,
  },

  night: {
    label: 'AFTER DARK',
    hint: 'the lights are going out',
    background: 0x03040a,
    fog: 0.085,

    // Tuned against the authored albedo. When surfaces were being crushed to
    // 42% these numbers were roughly double.
    environment: 0.05,
    ambient: 0.055,
    hemisphere: 0.05,
    sun: 0.0,
    lamp: 0.65,
    torch: 2.2,

    bloom: { enabled: true, strength: 0.5, threshold: 0.85, radius: 0.7 },

    grade: {
      uExposure: 0.60,
      uGrain: 0.06,
      uVignette: 1.05,
      uDesat: 0.40,
      uAberration: 0.0016,
      uWarp: 0.08,
      uScan: 0.02,
      uPulse: 0,
      uFade: 0,
      uMirror: 0,
      tint: [0.92, 0.97, 1.12],
    },

    surreal: true,
    leash: true,
    flicker: true,
  },
};

/** Apply a mode to the live scene. Safe to call at any time. */
export function applyMode(key, ctx) {
  const m = MODES[key];
  if (!m) return null;

  const { scene, fog, ambient, hemi, sun, moon, level, bloom, liminal, surreal } = ctx;

  scene.background = new THREE.Color(m.background);
  scene.environmentIntensity = m.environment;
  fog.color.setHex(m.background);
  fog.density = m.fog;

  ambient.intensity = m.ambient;
  hemi.intensity = m.hemisphere;

  sun.intensity = m.sun;
  sun.visible = m.sun > 0;
  moon.intensity = m.sun > 0 ? 0 : 0.16;
  moon.visible = m.sun <= 0;

  for (const lamp of level.lamps) {
    lamp.baseIntensity = (lamp.exterior ? 1.4 : 1.5) * m.lamp;
    lamp.flicker = 1;
    lamp.light.intensity = lamp.baseIntensity;
    lamp.bulb.material.opacity = m.surreal ? 0.9 : 0.0;
  }

  bloom.enabled = m.bloom.enabled;
  bloom.strength = m.bloom.strength;
  bloom.threshold = m.bloom.threshold;
  bloom.radius = m.bloom.radius;

  const u = liminal.uniforms;
  for (const [k, v] of Object.entries(m.grade)) {
    if (k === 'tint') u.uTint.value.set(...v);
    else if (u[k]) u[k].value = v;
  }

  if (surreal) {
    surreal.active = m.surreal;
    surreal.leashOn = m.leash;
    surreal.flickerOn = m.flicker;
    if (!m.surreal) surreal.reset();
  }

  return m;
}
