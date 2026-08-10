import * as THREE from 'three';
import { Level, fromBlender } from './level.js';
import { Player } from './player.js';
import { Sound } from './audio.js';
import { Surreal } from './surreal.js';
import { buildComposer } from './post.js';
import { MODES, applyMode } from './modes.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// Inside the entry, a step clear of the front door (D10) so the capsule is not
// clipping the jambs, angled at the longest interior sightline — a doorway
// opening onto nothing. Spawning indoors also keeps the drop onto the floor
// unambiguous: the site slopes away outside and the porch sits a metre above
// the front path.
const SPAWN_BLENDER = [1.5, -4.0, 0.15];
const SPAWN_YAW = 2.09;

// ---------------------------------------------------------------------- ui

const $ = id => document.getElementById(id);

const ui = {
  loading: $('loading'), loadBar: $('loadBar'), loadMsg: $('loadMsg'),
  title: $('title'), pause: $('pause'), ending: $('ending'),
  crosshair: $('crosshair'), meta: $('meta'), stats: $('stats'),
  // Element handles are suffixed because `room`, `whisper` and `flash` are
  // also method names on this object.
  roomEl: $('room'), promptEl: $('prompt'), whisperEl: $('whisper'), flashEl: $('flash'),

  show(el) { el.classList.remove('hidden'); },
  hide(el) { el.classList.add('hidden'); },

  progress(t, msg) {
    this.loadBar.style.width = `${Math.round(t * 100)}%`;
    if (msg) this.loadMsg.textContent = msg;
  },

  flash(strength = 0.6, ms = 120) {
    this.flashEl.style.transition = 'none';
    this.flashEl.style.opacity = String(strength);
    requestAnimationFrame(() => {
      this.flashEl.style.transition = `opacity ${ms}ms ease-out`;
      this.flashEl.style.opacity = '0';
    });
  },

  room(label, wrong = false) {
    if (!label) { this.roomEl.classList.remove('show'); return; }
    this.roomEl.textContent = label;
    this.roomEl.classList.toggle('wrong', wrong);
    this.roomEl.classList.add('show');
    clearTimeout(this._roomT);
    this._roomT = setTimeout(() => this.roomEl.classList.remove('show'), 3400);
  },

  whisper(text) {
    this.whisperEl.textContent = text;
    this.whisperEl.classList.add('show');
    clearTimeout(this._whT);
    this._whT = setTimeout(() => this.whisperEl.classList.remove('show'), 5200);
  },

  setPrompt(text) {
    if (text) {
      this.promptEl.textContent = text;
      this.promptEl.classList.add('show');
    } else {
      this.promptEl.classList.remove('show');
    }
  },

  end(title, text) {
    $('endTitle').textContent = title;
    $('endText').textContent = text;
    this.show(this.ending);
  },
};
// ------------------------------------------------------------------ engine

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// The final grade pass owns tone mapping and the sRGB encode.
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x03040a);
const fog = new THREE.FogExp2(0x05070d, 0.085);
scene.fog = fog;

const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 120);
scene.add(camera);

// Image-based lighting. Without it every metal in the house — the chrome tap,
// the steel appliances, the bathroom mirror — renders black, because metals
// have no diffuse term and nothing to reflect. Its strength is set per mode.
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
}

const ambient = new THREE.AmbientLight(0xf0f2f5, 0.10);
scene.add(ambient);

// The workhorse of the daylight mode. A hemisphere light is not occluded by the
// roof, which is exactly what makes enclosed interiors readable without lighting
// every room individually.
// Kept close to neutral on purpose: a saturated sky colour at this strength
// tints white plaster to solid blue and reads as a hole in the wall.
const hemi = new THREE.HemisphereLight(0xdce6f0, 0x9a8f80, 0.32);
scene.add(hemi);

// Sun: the only shadow-caster that shapes the exterior and throws window light
// across the floors.
const sun = new THREE.DirectionalLight(0xfff2e0, 1.5);
sun.position.set(-16, 22, 14);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.04;
{
  const c = sun.shadow.camera;
  c.left = -26; c.right = 26; c.top = 26; c.bottom = -26;
  c.near = 1; c.far = 70;
  c.updateProjectionMatrix();
}
scene.add(sun);

// Moonlight, cold and directional, for the night mode only.
const moon = new THREE.DirectionalLight(0x8fb0e8, 0.0);
moon.position.set(-14, 18, -10);
moon.visible = false;
scene.add(moon);

// Torch. Deliberately shadowless: eleven shadow-casting practicals already
// carry the occlusion, and a twelfth dynamic cube pass would halve the frame
// rate for light that only ever falls on what you are looking at.
// Near-linear falloff (decay 1) rather than physical inverse-square. A torch
// needs a usable 1-10 m range; with decay 2 it either blows the near wall to
// white or dies before it reaches the far side of a room.
const torch = new THREE.SpotLight(0xffe2bc, 0, 22, 0.55, 0.85, 1.0);
torch.position.set(0, 0, 0.1);
torch.target.position.set(0, 0, -1);
camera.add(torch, torch.target);

const { composer, bloom, liminal } = buildComposer(renderer, scene, camera);

// ------------------------------------------------------------------- state

const sound = new Sound();
let level, player, surreal;
let running = false, started = false;
let torchOn = false, torchLevel = 0;
let mode = 'walkthrough';
const clock = new THREE.Clock();

function setMode(key) {
  mode = key;
  const m = applyMode(key, {
    scene, fog, ambient, hemi, sun, moon, level, bloom, liminal, surreal,
  });
  torchOn = key === 'night';
  document.body.dataset.mode = key;
  ui.whisper(`${m.label} — ${m.hint}`);
  return m;
}

// ------------------------------------------------------------------ shadows

/**
 * Each shadow-casting point light costs one fragment texture unit, and WebGL
 * only guarantees 16 of them — eleven at once fails to link against a material
 * that also carries colour, normal and roughness maps.
 *
 * The house is static, so shadow maps only ever need rendering once. Bake them
 * a few lights at a time to stay under the limit, freeze the shadow system,
 * then keep only the nearest handful of lamps visible at runtime. The baked
 * maps survive a light being hidden and reused later.
 */
/**
 * The sun is the only shadow caster, and the house never moves, so its map is
 * rendered once and then the whole shadow system is frozen.
 */
function bakeSunShadow() {
  const wasVisible = sun.visible;
  sun.visible = true;
  renderer.shadowMap.needsUpdate = true;
  renderer.render(scene, camera);
  sun.visible = wasVisible;
  renderer.shadowMap.autoUpdate = false;
}

/**
 * Compile every material up front.
 *
 * Three compiles a shader the first time a material is actually drawn, so
 * walking into a room you have not seen yet costs a compile stall mid-stride.
 * Paying for all of them behind the loading screen keeps the walk smooth.
 */
async function precompile() {
  if (renderer.compileAsync) {
    await renderer.compileAsync(scene, camera);
  } else {
    renderer.compile(scene, camera);
  }
}

// -------------------------------------------------------------------- boot

async function boot() {
  const t0 = performance.now();
  const marks = {};
  const mark = name => { marks[name] = Math.round(performance.now() - t0); };

  ui.progress(0.02, 'opening the house');

  level = new Level();
  await level.load(t => ui.progress(0.02 + t * 0.75, 'walking the rooms'), mark);
  mark('total_load');

  scene.add(level.root);
  // The collider stays out of the scene graph deliberately: its geometry is
  // already in world space, so an identity matrix is correct, and keeping it
  // unparented means it costs nothing at render time while still raycasting.

  ui.progress(0.85, 'setting the lights');

  player = new Player(level.collider, camera);
  player.placeAt(fromBlender(SPAWN_BLENDER), SPAWN_YAW);
  player.onFootstep = i => sound.footstep(i);

  surreal = new Surreal({
    level, player, sound, scene, fog, liminal, moon, ambient, ui,
  });

  setMode('walkthrough');

  // Compile before the shadow bake, not after: whichever runs first pays for
  // every shader and texture upload in the scene, and compileAsync can do that
  // work off the critical path where the driver supports it.
  // Compile both modes now. Each has a different light set and therefore a
  // different shader permutation, so compiling only the starting mode leaves a
  // visible freeze the first time someone presses M.
  ui.progress(0.88, 'compiling shaders');
  await precompile();
  setMode('night');
  await precompile();
  setMode('walkthrough');
  mark('precompile');

  bakeSunShadow();
  mark('sun_shadow');

  window.__bootMarks = marks;
  console.log('[boot] ms:', JSON.stringify(marks));

  // Handle for debugging from the console: positions, teleports, dread.
  window.__balmoral = {
    THREE, renderer, scene, camera, level, player, surreal, sound, ui,
    liminal, torch, sun, moon, hemi, ambient, bloom, composer, setMode, MODES,
  };

  ui.progress(1, 'ready');
  ui.stats.textContent =
    `${level.triangleCount.toLocaleString()} tris · ${level.lamps.length} lamps · ${level.rooms.length} rooms`;

  setTimeout(() => {
    ui.hide(ui.loading);
    ui.show(ui.title);
  }, 500);
}

// ------------------------------------------------------------------ session

/**
 * Pointer lock can be refused — most often by the browser's short cooldown
 * after Esc. Fall back to the pause card so there is always a way back in
 * rather than a dead title-less screen.
 */
function grabPointer() {
  const res = renderer.domElement.requestPointerLock();
  if (res && typeof res.catch === 'function') {
    res.catch(() => { if (started) ui.show(ui.pause); });
  }
}

function enter(which) {
  ui.hide(ui.title);
  ui.hide(ui.ending);
  started = true;
  if (which && which !== mode) setMode(which);
  sound.start();
  grabPointer();
}

$('enterWalkBtn').addEventListener('click', () => enter('walkthrough'));
$('enterNightBtn').addEventListener('click', () => enter('night'));
$('againBtn').addEventListener('click', () => location.reload());

const resume = () => {
  if (started && !running && !surreal?.finished) grabPointer();
};
renderer.domElement.addEventListener('click', resume);
// The pause card sits above the canvas and would otherwise swallow the click
// that is meant to dismiss it.
ui.pause.addEventListener('click', resume);

// An AudioContext created from a synthetic or blocked gesture starts
// suspended; nudge it on the first genuine interaction.
const wake = () => sound.resume();
window.addEventListener('pointerdown', wake);
window.addEventListener('keydown', wake);

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === renderer.domElement;
  running = locked;
  if (player) player.enabled = locked;

  if (locked) {
    started = true;
    ui.hide(ui.pause);
    sound.resume();
    clock.getDelta();          // drop the paused interval
    player?.clearLook();       // and any movement reported while unlocking
  } else if (started && !surreal?.finished) {
    ui.show(ui.pause);
  }
});

window.addEventListener('keydown', e => {
  if (!player?.enabled) return;
  if (e.code === 'KeyF') torchOn = !torchOn;
  if (e.code === 'KeyM') setMode(mode === 'night' ? 'walkthrough' : 'night');
  if (e.code === 'KeyE' && surreal.active) {
    const lamp = surreal.lampInReach(camera);
    if (lamp) surreal.takeLamp(lamp);
  }
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  bloom.setSize(innerWidth, innerHeight);
});

// --------------------------------------------------------------------- loop

let fpsAccum = 0, fpsFrames = 0;

function frame() {
  requestAnimationFrame(frame);

  const dt = Math.min(clock.getDelta(), 0.05);
  if (!level) return;


  // Simulation is driven by the player being enabled rather than by pointer
  // lock directly, so the world can also be stepped from the console.
  if (player.enabled) {
    player.update(dt);
    surreal.update(dt, camera);
    sound.update(dt, surreal.dread);

    // Torch: fades rather than snaps, and stutters as the house takes hold.
    const cfg = MODES[mode];
    const want = torchOn ? 1 : 0;
    torchLevel += (want - torchLevel) * Math.min(1, dt * 7);
    const stutter = cfg.flicker && surreal.dread > 0.3 &&
      Math.random() < dt * surreal.dread * 2.5 ? 0.15 : 1;
    torch.intensity = torchLevel * cfg.torch * stutter;

    const lamp = surreal.active ? surreal.lampInReach(camera) : null;
    ui.crosshair.classList.toggle('active', !!lamp);
    ui.setPrompt(lamp ? 'E — take the light' : null);

    if (!surreal.active) {
      const room = level.roomAt(player.position);
      ui.meta.innerHTML =
        `<span class="n">${cfg.label}</span><br>${room ? room.label.toLowerCase() : 'outside'}` +
        `<br>M — after dark`;
    } else {
      const left = surreal.total - surreal.taken;
      ui.meta.innerHTML = surreal.ending
        ? 'the door is open'
        : `lights burning <span class="n">${left}</span> / ${surreal.total}<br>cycle <span class="n">${surreal.cycle}</span>`;
    }

    fpsAccum += dt; fpsFrames++;
    if (fpsAccum > 0.5) {
      const fps = Math.round(fpsFrames / fpsAccum);
      ui.stats.textContent =
        `${fps} fps · ${level.triangleCount.toLocaleString()} tris · dread ${surreal.dread.toFixed(2)}`;
      fpsAccum = 0; fpsFrames = 0;
    }
  } else {
    // The title and pause screens still render the house behind them.
    liminal.uniforms.uTime.value += dt;
  }

  composer.render();
}

boot().then(frame).catch(err => {
  console.error(err);
  ui.progress(1, 'the house did not open');
  ui.loadMsg.textContent = `error: ${err.message}`;
});
