import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

/**
 * Final grade. This pass owns tone mapping and the sRGB encode as well as the
 * look, so the renderer itself stays linear and nothing gets converted twice.
 */
export const LiminalShader = {
  uniforms: {
    tDiffuse:    { value: null },
    uTime:       { value: 0 },
    uExposure:   { value: 0.92 },
    uAberration: { value: 0.0016 },
    uVignette:   { value: 1.05 },
    uGrain:      { value: 0.06 },
    uDesat:      { value: 0.40 },
    uInvert:     { value: 0.0 },
    uMirror:     { value: 0.0 },
    uWarp:       { value: 0.08 },
    uTint:       { value: new THREE.Vector3(0.92, 0.97, 1.12) },
    uFade:       { value: 0.0 },
    uPulse:      { value: 0.0 },
    uScan:       { value: 0.02 },
  },

  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,

  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uTime, uExposure, uAberration, uVignette, uGrain;
    uniform float uDesat, uInvert, uMirror, uWarp, uFade, uPulse, uScan;
    uniform vec3  uTint;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(443.897, 441.423));
      p += dot(p, p.yx + 19.19);
      return fract((p.x + p.y) * p.x);
    }

    // Narkowicz ACES approximation.
    vec3 aces(vec3 x) {
      const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
      return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
    }

    void main() {
      vec2 uv = vUv;

      // The house can turn itself around.
      uv.x = mix(uv.x, 1.0 - uv.x, uMirror);

      // Gentle barrel warp, breathing with the pulse.
      vec2 c = uv - 0.5;
      float r2 = dot(c, c);
      uv = 0.5 + c * (1.0 + uWarp * r2 + uPulse * 0.05 * sin(uTime * 0.7) * r2);

      // Radial chromatic aberration, strongest at the edges.
      float ab = uAberration * (0.35 + r2 * 3.0);
      vec2 dir = normalize(c + 1e-6);
      vec3 col;
      col.r = texture2D(tDiffuse, uv + dir * ab).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - dir * ab).b;

      col *= uExposure;
      col = aces(col);
      col *= uTint;

      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(col, vec3(lum), uDesat);
      col = mix(col, 1.0 - col, uInvert);

      // Vignette — the main reason the corners feel like they are closing in.
      float vig = 1.0 - uVignette * dot(c, c) * (1.2 - 0.35 * lum);
      col *= clamp(vig, 0.0, 1.0);

      // Drifting horizontal banding, very low amplitude.
      float band = sin((uv.y + uTime * 0.013) * 620.0) * uScan;
      col *= 1.0 - band * 0.5;

      // Film grain, heavier in the shadows where the eye hunts for detail.
      float g = hash(uv * 812.0 + fract(uTime) * 71.0) - 0.5;
      col += g * uGrain * (1.25 - lum);

      col *= 1.0 - uFade;
      col = max(col, 0.0);

      // Linear -> sRGB.
      vec3 srgb = mix(col * 12.92,
                      1.055 * pow(max(col, 1e-5), vec3(1.0 / 2.4)) - 0.055,
                      step(0.0031308, col));

      gl_FragColor = vec4(srgb, 1.0);
    }
  `,
};

export function buildComposer(renderer, scene, camera) {
  const size = renderer.getSize(new THREE.Vector2());

  const composer = new EffectComposer(renderer);
  composer.setSize(size.x, size.y);
  composer.setPixelRatio(renderer.getPixelRatio());

  composer.addPass(new RenderPass(scene, camera));

  // Tight, bright-only bloom so lamps glow without washing the rooms out.
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.5, 0.7, 0.85);
  composer.addPass(bloom);

  const liminal = new ShaderPass(LiminalShader);
  liminal.renderToScreen = true;
  composer.addPass(liminal);

  return { composer, bloom, liminal };
}
