import * as THREE from 'three';
import { Level, fromBlender } from './level.js';
import { Player } from './player.js';
import { Sound } from './audio.js';
import { buildComposer } from './post.js';
import { WALKTHROUGH, applyMode } from './modes.js';
import { Net } from './net.js';
import { AVATARS, RemotePlayer } from './avatars.js';
import { Cat } from './cat.js';
import { PARTY_HOST, ROOM, MAX_PLAYERS } from './config.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// Inside the entry, a step clear of the front door (D10) so the capsule is not
// clipping the jambs, angled at the longest interior sightline. Spawning indoors
// keeps the drop onto the floor unambiguous.
const SPAWN_BLENDER = [1.5, -4.0, 0.15];
const SPAWN_YAW = 2.09;

// ---------------------------------------------------------------------- ui

const $ = id => document.getElementById(id);

const ui = {
  loading: $('loading'), loadBar: $('loadBar'), loadMsg: $('loadMsg'),
  title: $('title'), pause: $('pause'),
  meta: $('meta'), stats: $('stats'),
  roomEl: $('room'), noticeEl: $('notice'), presence: $('presence'),

  show(el) { el.classList.remove('hidden'); },
  hide(el) { el.classList.add('hidden'); },

  progress(t, msg) {
    this.loadBar.style.width = `${Math.round(t * 100)}%`;
    if (msg) this.loadMsg.textContent = msg;
  },

  room(label) {
    if (!label) { this.roomEl.classList.remove('show'); return; }
    if (this._last === label) return;
    this._last = label;
    this.roomEl.textContent = label;
    this.roomEl.classList.add('show');
    clearTimeout(this._roomT);
    this._roomT = setTimeout(() => this.roomEl.classList.remove('show'), 3000);
  },

  notice(text) {
    this.noticeEl.textContent = text;
    this.noticeEl.classList.add('show');
    clearTimeout(this._noticeT);
    this._noticeT = setTimeout(() => this.noticeEl.classList.remove('show'), 1600);
  },
};

// ------------------------------------------------------------------ engine

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance',
});
// 1.75 was too generous. On a 150%-scaled Windows display that renders 2.25x
// the pixels of the canvas, and every one of them goes through the full-screen
// grade pass as well. This is a walkthrough, not a shooter — 1.25 is plenty,
// and the adaptive scaler below drops it further if the frame rate asks.
const MAX_DPR = 1.25;
const MIN_DPR = 0.75;
let curDpr = Math.min(devicePixelRatio, MAX_DPR);
renderer.setPixelRatio(curDpr);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// The final grade pass owns tone mapping and the sRGB encode.
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(WALKTHROUGH.background);
const fog = new THREE.FogExp2(WALKTHROUGH.background, WALKTHROUGH.fog);
scene.fog = fog;

const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 120);
scene.add(camera);

// Image-based lighting. Without it every metal in the house — the chrome rail,
// the steel appliances — renders black, because metals have no diffuse term and
// nothing to reflect.
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
}

const ambient = new THREE.AmbientLight(0xf0f2f5, WALKTHROUGH.ambient);
scene.add(ambient);

// A hemisphere light is not occluded by the roof, which is what makes enclosed
// interiors readable without lighting every room individually. Kept close to
// neutral: a saturated sky colour at this strength tints white plaster solid
// blue and reads as a hole in the wall.
const hemi = new THREE.HemisphereLight(0xdce6f0, 0x9a8f80, WALKTHROUGH.hemisphere);
scene.add(hemi);

// Sun: the only shadow-caster, shaping the exterior and throwing window light
// across the floors.
const sun = new THREE.DirectionalLight(0xfff2e0, WALKTHROUGH.sun);
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

const { composer, bloom, liminal } = buildComposer(renderer, scene, camera);

// The composer renders several passes per frame and each render() resets the
// counters, so the default autoReset reports only the last full-screen quad.
// Reset once per frame instead, and the totals are the real per-frame cost.
renderer.info.autoReset = false;

// ------------------------------------------------------------------- state

const sound = new Sound();
let level, player, cat;
let running = false, started = false;
const clock = new THREE.Clock();

// ---------------------------------------------------------------- multiplayer
const net = new Net(PARTY_HOST, ROOM);
const remotes = new Map();                 // id -> RemotePlayer
const avatarRoot = new THREE.Group();
avatarRoot.name = 'AVATARS';
scene.add(avatarRoot);

net.onJoin = p => {
  if (remotes.has(p.id)) return;
  const r = new RemotePlayer(p);
  if (p.pose) r.setPose(p.pose);
  remotes.set(p.id, r);
  avatarRoot.add(r.group);
  ui.notice(`${p.name} arrived`);
};
net.onLeave = id => {
  const r = remotes.get(id);
  if (!r) return;
  r.dispose();
  remotes.delete(id);
};
net.onPose = (id, pose) => remotes.get(id)?.setPose(pose);
net.onStatus = text => { ui.presence.textContent = text; };

/**
 * The sun is the only shadow caster and the house never moves, so its map is
 * rendered once and then the whole shadow system is frozen.
 */
function bakeSunShadow() {
  renderer.shadowMap.needsUpdate = true;
  renderer.render(scene, camera);
  renderer.shadowMap.autoUpdate = false;
}

/**
 * Compile every material up front. Three compiles a shader the first time a
 * material is actually drawn, so walking into a room you have not seen yet
 * costs a compile stall mid-stride.
 */
async function precompile() {
  if (renderer.compileAsync) await renderer.compileAsync(scene, camera);
  else renderer.compile(scene, camera);
}

// -------------------------------------------------------------------- boot

async function boot() {
  ui.progress(0.02, 'opening the house');

  level = new Level();
  await level.load(t => ui.progress(0.02 + t * 0.75, 'walking the rooms'), () => {});

  scene.add(level.root);
  // The collider stays out of the scene graph deliberately: its geometry is
  // already in world space, so an identity matrix is correct.

  ui.progress(0.85, 'setting the lights');

  cat = new Cat(level.catParts, level.root, level.collider);

  player = new Player(level.collider, camera);
  player.placeAt(fromBlender(SPAWN_BLENDER), SPAWN_YAW);
  player.onFootstep = i => sound.footstep(i);

  applyMode({ scene, fog, ambient, hemi, sun, level, bloom, liminal });
  document.body.dataset.mode = 'walkthrough';

  ui.progress(0.9, 'compiling shaders');
  await precompile();
  bakeSunShadow();

  // Handle for debugging from the console.
  window.__balmoral = { THREE, renderer, scene, camera, level, player, sound, ui, cat };

  ui.progress(1, 'ready');
  ui.stats.textContent =
    `${level.triangleCount.toLocaleString()} tris · ${level.rooms.length} rooms`;

  setTimeout(() => {
    ui.hide(ui.loading);
    ui.show(ui.title);
  }, 400);
}

// ------------------------------------------------------------------ session

/**
 * Pointer lock can be refused — most often by the browser's short cooldown
 * after Esc. Fall back to the pause card so there is always a way back in.
 */
function grabPointer() {
  const res = renderer.domElement.requestPointerLock();
  if (res && typeof res.catch === 'function') {
    res.catch(() => { if (started) ui.show(ui.pause); });
  }
}

// --- no-login identity: a name and a colour, remembered locally -------------
let chosenAvatar = Number(localStorage.getItem('balmoral.avatar') || 0);

const swatchRow = $('swatches');
AVATARS.forEach((a, i) => {
  const b = document.createElement('button');
  b.className = 'swatch';
  b.style.background = '#' + a.color.toString(16).padStart(6, '0');
  b.title = a.label;
  b.setAttribute('aria-label', a.label);
  b.addEventListener('click', () => {
    chosenAvatar = i;
    localStorage.setItem('balmoral.avatar', String(i));
    [...swatchRow.children].forEach((c, j) => c.classList.toggle('on', j === i));
  });
  swatchRow.appendChild(b);
});
[...swatchRow.children].forEach((c, j) => c.classList.toggle('on', j === chosenAvatar));

const nameInput = $('nameInput');
nameInput.value = localStorage.getItem('balmoral.name') || '';

function enter() {
  const name = (nameInput.value || '').trim().slice(0, 18) || 'guest';
  localStorage.setItem('balmoral.name', name);

  ui.hide(ui.title);
  started = true;
  sound.start();
  net.connect(name, chosenAvatar, {
    p: [player.position.x, player.position.y, player.position.z],
    y: player.yaw,
  });
  grabPointer();
}

$('enterBtn').addEventListener('click', enter);
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') enter(); });

const resume = () => { if (started && !running) grabPointer(); };
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
  } else if (started) {
    ui.show(ui.pause);
  }
});

// Look speed is a matter of taste and of mouse DPI, so it is tunable in place
// and remembered. Shown as a 0-100 figure rather than radians per pixel.
window.addEventListener('keydown', e => {
  if (!player) return;
  if (e.code !== 'BracketLeft' && e.code !== 'BracketRight') return;
  const v = player.adjustSensitivity(e.code === 'BracketRight' ? 1 : -1);
  ui.notice(`look speed ${Math.round((v / 0.0050) * 100)}`);
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  bloom.setSize(innerWidth, innerHeight);
});

// --------------------------------------------------------------------- loop

let fpsAccum = 0, fpsFrames = 0, lastCalls = 0;

function frame() {
  requestAnimationFrame(frame);

  const dt = Math.min(clock.getDelta(), 0.05);
  if (!level) return;
  renderer.info.reset();

  // Other people keep moving whether or not our pointer is locked, so this
  // runs outside the enabled check — otherwise everyone freezes on pause.
  for (const r of remotes.values()) r.update(dt);
  // The cat keeps going whether or not the pointer is locked.
  cat?.update(dt);

  if (player.enabled) {
    player.update(dt);
    sound.update(dt, 0);
    net.sendPose(player.position, player.yaw);

    const room = level.roomAt(player.position);
    ui.room(room ? room.label : null);
    ui.meta.innerHTML =
      `<span class="n">${WALKTHROUGH.label}</span><br>${room ? room.label.toLowerCase() : 'outside'}`;

    fpsAccum += dt; fpsFrames++;
    if (fpsAccum > 0.5) {
      const fps = Math.round(fpsFrames / fpsAccum);

      // Adaptive resolution. Cheaper than dropping geometry and invisible at
      // walking pace: shave the render scale when we are missing frames, give
      // it back when there is headroom. Hysteresis so it cannot oscillate.
      if (fps < 50 && curDpr > MIN_DPR) {
        curDpr = Math.max(MIN_DPR, curDpr - 0.15);
        renderer.setPixelRatio(curDpr);
        composer.setSize(innerWidth, innerHeight);
      } else if (fps > 58 && curDpr < Math.min(devicePixelRatio, MAX_DPR)) {
        curDpr = Math.min(Math.min(devicePixelRatio, MAX_DPR), curDpr + 0.05);
        renderer.setPixelRatio(curDpr);
        composer.setSize(innerWidth, innerHeight);
      }

      ui.stats.textContent =
        `${fps} fps · ${lastCalls} draws · ` +
        `${level.triangleCount.toLocaleString()} tris · ${curDpr.toFixed(2)}x`;
      fpsAccum = 0; fpsFrames = 0;
    }
  } else {
    // The title and pause screens still render the house behind them.
    liminal.uniforms.uTime.value += dt;
  }

  composer.render();
  lastCalls = renderer.info.render.calls;
}

boot().then(frame).catch(err => {
  console.error(err);
  ui.progress(1, 'the house did not open');
  ui.loadMsg.textContent = `error: ${err.message}`;
});
