import * as THREE from 'three';
import { fromBlender } from './level.js';

const WHISPERS = [
  'you have been here for some time',
  'the hallway is longer at night',
  'nobody drew this room on the plan',
  'the kitchen remembers you',
  'do not count the doors',
  'it was 3:33 when you arrived. it is still 3:33',
  'someone set the table for one',
  'the windows face inward',
  'you left the light on in a room that is gone',
  'keep walking. it prefers movement',
  'this is not the house you were shown',
  'the measurements are correct. the house is not',
];

const WRONG_ROOMS = [
  'ROOM NOT ON PLAN',
  'ROOM 0',
  'HALL (AGAIN)',
  'THE SAME ROOM',
  'UNMEASURED',
  '—',
];

/** Front door of the real house, in Blender metres, converted on use. */
const FRONT_DOOR_BLENDER = [2.165, -4.49, 1.0];

export class Surreal {
  constructor({ level, player, sound, scene, fog, liminal, moon, ambient, ui }) {
    this.level = level;
    this.player = player;
    this.sound = sound;
    this.scene = scene;
    this.fog = fog;
    this.liminal = liminal;
    this.moon = moon;
    this.ambient = ambient;
    this.ui = ui;

    // Only interior practicals are objectives; the two exterior fittings stay.
    this.targets = level.lamps.filter(l => !l.exterior);
    this.total = this.targets.length;
    this.taken = 0;
    this.cycle = 0;
    this.dread = 0;
    this.finished = false;
    this.ending = false;

    // Set by the mode system. When inactive the house behaves itself: no
    // events, no flicker, no leash, honest room labels.
    this.active = true;
    this.leashOn = true;
    this.flickerOn = true;

    this.time = 0;
    this.nextWhisper = 25 + Math.random() * 25;
    this.nextMutation = 30;
    this.mirrorUntil = 0;
    this.currentRoom = null;
    this.roomShownAt = -99;

    this.doorPos = fromBlender(FRONT_DOOR_BLENDER);
    this.houseCentre = new THREE.Vector3(0, 1, 0);

    this._buildWatcher();
    this._buildExit();
  }

  // ------------------------------------------------------------------ setup

  /** A shape that is almost a person. Never lit, only ever a silhouette. */
  _buildWatcher() {
    const g = new THREE.Group();

    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.17, 1.25, 4, 10),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.94 })
    );
    body.position.y = 0.92;

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.115, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.94 })
    );
    head.position.y = 1.76;

    g.add(body, head);
    g.visible = false;
    g.renderOrder = 2;
    this.scene.add(g);

    this.watcher = g;
    this.watcherSeen = 0;
    this.watcherActive = false;
    this.nextWatcher = 55 + Math.random() * 45;
  }

  /** The way out only exists once the house is dark. */
  _buildExit() {
    const geo = new THREE.PlaneGeometry(0.95, 2.1);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xfff0d8, transparent: true, opacity: 0, side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(this.doorPos);
    m.rotation.y = Math.PI / 2;   // door faces +X
    m.visible = false;
    this.scene.add(m);

    const glow = new THREE.PointLight(0xffe6c0, 0, 9, 2);
    glow.position.copy(this.doorPos).add(new THREE.Vector3(0.6, 0, 0));
    this.scene.add(glow);

    this.exit = m;
    this.exitGlow = glow;
  }

  // ------------------------------------------------------------- interaction

  /** Nearest lamp the player could reach out and touch. */
  lampInReach(camera) {
    if (this.ending) return null;
    let best = null, bestD = Infinity;
    const eye = camera.position;

    for (const lamp of this.targets) {
      if (lamp.taken) continue;
      const d = lamp.pos.distanceTo(eye);
      if (d > 2.6 || d > bestD) continue;

      // Must be roughly in front of the player, so you reach for what you see.
      const to = lamp.pos.clone().sub(eye).normalize();
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      if (to.dot(fwd) < 0.55) continue;

      bestD = d;
      best = lamp;
    }
    return best;
  }

  takeLamp(lamp) {
    if (lamp.taken) return;
    lamp.taken = true;
    lamp.lit = false;
    this.taken++;
    this.cycle++;

    this.sound.extinguish();
    this.sound.stinger(this.cycle);
    this.ui.flash(0.5, 90);
    this.ui.whisper(WHISPERS[Math.floor(Math.random() * WHISPERS.length)]);

    this._mutate();

    if (this.taken >= this.total) this._beginEnding();
  }

  // ----------------------------------------------------------- house changes

  /** Each cycle the house is allowed to alter itself a little more. */
  _mutate() {
    const p = this.taken / this.total;

    // Shift some furniture. Never structure — the shell has to stay solid.
    const n = Math.min(this.level.movable.length, Math.floor(2 + p * 14));
    for (let i = 0; i < n; i++) {
      const item = this.level.movable[Math.floor(Math.random() * this.level.movable.length)];
      if (!item) continue;
      item.mesh.position.set(
        item.home.x + (Math.random() - 0.5) * 0.5 * p,
        item.home.y + (Math.random() - 0.5) * 0.28 * p,
        item.home.z + (Math.random() - 0.5) * 0.5 * p
      );
      item.mesh.rotation.y = item.homeRot.y + (Math.random() - 0.5) * 0.9 * p;
    }

    // Cupboards drift ajar. The house has no interior doors — every opening is
    // a bare doorway — so the kitchen fronts do this work instead.
    for (const d of this.level.doors) {
      if (Math.random() < 0.3 * p) {
        d.mesh.rotation.y = d.homeRot.y + (Math.random() - 0.5) * 0.7 * p;
      }
    }

    // Past the halfway mark the house starts putting a light back on.
    if (p > 0.5 && this.taken < this.total && Math.random() < 0.45) {
      const relightable = this.targets.filter(l => l.taken);
      const victim = relightable[Math.floor(Math.random() * relightable.length)];
      if (victim) {
        victim.taken = false;
        victim.lit = true;
        this.taken--;
        setTimeout(() => {
          this.ui.whisper('one of them is burning again');
          this.sound.thump();
        }, 2600);
      }
    }

    if (Math.random() < 0.4 + p * 0.4) this._showWatcher();
    if (p > 0.35 && Math.random() < p * 0.6) this.mirrorUntil = this.time + 3 + Math.random() * 4;
  }

  /** Place the figure somewhere it will be found rather than seen arriving. */
  _showWatcher() {
    const rooms = this.level.rooms;
    if (!rooms.length) return;

    const eye = this.player.camera.position;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.player.camera.quaternion);

    const candidates = rooms
      .map(r => {
        const to = r.pos.clone().sub(eye);
        const dist = to.length();
        return { r, dist, facing: to.normalize().dot(fwd) };
      })
      .filter(c => c.dist > 4.5 && c.dist < 16);

    if (!candidates.length) return;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];

    this.watcher.position.set(pick.r.pos.x, 0, pick.r.pos.z);
    this.watcher.position.y = this._groundAt(this.watcher.position);
    this.watcher.lookAt(eye.x, this.watcher.position.y + 1.5, eye.z);
    this.watcher.visible = true;
    this.watcherActive = true;
    this.watcherSeen = 0;
    this.sound.whisper();
  }

  /** Floor height under a point, probed from below ceiling level. */
  _groundAt(pos) {
    const ray = new THREE.Raycaster(
      new THREE.Vector3(pos.x, 1.2, pos.z),
      new THREE.Vector3(0, -1, 0), 0, 6
    );
    const hit = ray.intersectObject(this.level.collider, true)[0];
    return hit ? hit.point.y : 0;
  }

  _hideWatcher() {
    this.watcher.visible = false;
    this.watcherActive = false;
    this.nextWatcher = this.time + 40 + Math.random() * 60;
    this.dread = Math.min(1, this.dread + 0.12);
  }

  // ------------------------------------------------------------------ ending

  _beginEnding() {
    this.ending = true;
    this.exit.visible = true;
    this.ui.whisper('it is dark enough now. the door is where it always was');
    this.sound.stinger(this.cycle + 3);
  }

  _finish() {
    if (this.finished) return;
    this.finished = true;
    this.player.enabled = false;
    document.exitPointerLock?.();
    this.ui.end(
      'YOU STEP OUTSIDE',
      `Every light in the house is out. The street is exactly where the plan says it should be. ` +
      `You have been walking for ${Math.floor(this.time / 60)} minutes and ${Math.floor(this.time % 60)} seconds. ` +
      `The front door closes behind you at 3:33.`
    );
  }

  // ------------------------------------------------------------------- frame

  /** Put the house back the way it was found. */
  reset() {
    for (const lamp of this.targets) {
      lamp.taken = false;
      lamp.lit = true;
      lamp.flicker = 1;
    }
    for (const item of this.level.movable) {
      item.mesh.position.copy(item.home);
      item.mesh.rotation.copy(item.homeRot);
    }
    for (const d of this.level.doors) {
      d.mesh.rotation.copy(d.homeRot);
    }
    this.taken = 0;
    this.cycle = 0;
    this.dread = 0;
    this.ending = false;
    this.finished = false;
    this.mirrorUntil = 0;
    this.exit.visible = false;
    this.exitGlow.intensity = 0;
    this.watcher.visible = false;
    this.watcherActive = false;
    this.player.lookFlip = 1;
    this.liminal.uniforms.uMirror.value = 0;
  }

  update(dt, camera) {
    this.time += dt;

    // Walkthrough mode: the only thing still running is the room caption.
    if (!this.active) {
      this.dread = 0;
      this._updateRoomCaption();
      return;
    }

    const p = this.taken / this.total;

    // Dread rises with progress, then decays a little when nothing is happening.
    const target = Math.min(1, p * 0.85 + (this.ending ? 0.15 : 0));
    this.dread += (target - this.dread) * Math.min(1, dt * 0.35);

    this._updateLamps(dt);
    this._updateWatcher(dt, camera);
    this._updateLeash(dt);
    this._updateGrade(dt, p);
    this._updateRoomCaption();

    // Ambient whispers, quicker the further in you are.
    this.nextWhisper -= dt * (1 + this.dread * 1.8);
    if (this.nextWhisper <= 0) {
      this.nextWhisper = 30 + Math.random() * 40;
      this.ui.whisper(WHISPERS[Math.floor(Math.random() * WHISPERS.length)]);
      this.sound.whisper();
    }

    if (!this.watcherActive && this.time > this.nextWatcher) this._showWatcher();

    if (this.ending && !this.finished) {
      const d = camera.position.distanceTo(this.doorPos);
      this.exit.material.opacity = Math.min(0.9, this.exit.material.opacity + dt * 0.4);
      this.exitGlow.intensity = 3.5 + Math.sin(this.time * 2) * 0.6;
      if (d < 1.9) this._finish();
    }
  }

  _updateLamps(dt) {
    for (const lamp of this.level.lamps) {
      const isTarget = !lamp.exterior;
      const wantLit = isTarget ? !lamp.taken : !this.ending;

      // Mains hum made visible: irregular flicker that worsens with dread.
      const f = this.time * (3 + this.dread * 9) + lamp.pos.x * 3.1 + lamp.pos.z * 1.7;
      const noise = Math.sin(f) * Math.sin(f * 2.37) * Math.sin(f * 0.53);
      const depth = 0.10 + this.dread * 0.55;
      const target = wantLit ? Math.max(0, 1 - depth * (0.5 + 0.5 * noise)) : 0;

      lamp.flicker += (target - lamp.flicker) * Math.min(1, dt * 14);

      // Very occasional full dropout.
      if (wantLit && Math.random() < dt * this.dread * 0.6) lamp.flicker = 0.05;

      lamp.light.intensity = lamp.baseIntensity * lamp.flicker;
      lamp.bulb.material.opacity = Math.min(1, lamp.flicker * 0.9);
    }
  }

  _updateWatcher(dt, camera) {
    if (!this.watcherActive) return;

    const eye = camera.position;
    const to = this.watcher.position.clone().setY(eye.y).sub(eye);
    const dist = to.length();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const looking = to.normalize().dot(fwd) > 0.86;

    if (dist < 3.2) {
      this.sound.thump();
      this._hideWatcher();
      return;
    }

    if (looking) {
      this.watcherSeen += dt;
      this.dread = Math.min(1, this.dread + dt * 0.22);
      // It will not be stared at.
      if (this.watcherSeen > 0.8) {
        this.sound.whisper();
        this._hideWatcher();
      }
    } else {
      this.watcherSeen = Math.max(0, this.watcherSeen - dt * 0.5);
      // Drifts closer while unobserved.
      const step = dt * 0.55;
      this.watcher.position.addScaledVector(
        new THREE.Vector3(eye.x - this.watcher.position.x, 0, eye.z - this.watcher.position.z).normalize(),
        step
      );
      this.watcher.lookAt(eye.x, this.watcher.position.y + 1.5, eye.z);
    }
  }

  /** The house does not let you walk away from it. */
  _updateLeash(dt) {
    if (!this.leashOn) return;
    const pos = this.player.position;
    const d = Math.hypot(pos.x - this.houseCentre.x, pos.z - this.houseCentre.z);

    if (d > 13 && d < 17 && !this._leashWarned) {
      this._leashWarned = true;
      this.ui.whisper('the street does not continue');
    }
    if (d < 12) this._leashWarned = false;

    if (d > 17) {
      const rooms = this.level.rooms;
      const room = rooms[Math.floor(Math.random() * rooms.length)];
      // Room markers sit at lamp height; drop to floor level before probing.
      this.player.placeAt(
        new THREE.Vector3(room.pos.x, 0.2, room.pos.z),
        Math.random() * Math.PI * 2
      );
      this.sound.stinger(this.cycle + 1);
      this.ui.flash(0.85, 140);
      this.ui.whisper('you came back in through a door you did not open');
      this.dread = Math.min(1, this.dread + 0.2);
    }
  }

  _updateGrade(dt, p) {
    const u = this.liminal.uniforms;
    const d = this.dread;

    // Air thickens; the far wall of a room stops being reliable.
    // These ramps are deliberately shallow. Pushed further the late game stops
    // being frightening and simply becomes unreadable — the player needs to be
    // able to find the next lamp.
    this.fog.density = 0.085 + p * 0.045 + (this.ending ? 0.04 : 0);

    u.uTime.value = this.time;
    u.uExposure.value = 0.60 - p * 0.12;
    u.uAberration.value = 0.0016 + d * 0.006;
    u.uVignette.value = 1.05 + d * 0.5;
    u.uGrain.value = 0.06 + d * 0.06;
    u.uDesat.value = 0.40 + d * 0.18;
    u.uWarp.value = 0.08 + d * 0.16;
    u.uScan.value = 0.02 + d * 0.03;
    u.uPulse.value = d;

    // Colour drifts from cold blue toward a sick green as it takes hold.
    u.uTint.value.set(
      0.92 - d * 0.10,
      0.97 + d * 0.06,
      1.12 - d * 0.34
    );

    const mirrored = this.time < this.mirrorUntil;
    const targetMirror = mirrored ? 1 : 0;
    u.uMirror.value += (targetMirror - u.uMirror.value) * Math.min(1, dt * 6);
    this.player.lookFlip = u.uMirror.value > 0.5 ? -1 : 1;

    this.moon.intensity = 0.16 * (1 - p * 0.4);
    this.ambient.intensity = 0.055 * (1 - p * 0.35);

    if (this.ending) {
      u.uFade.value = Math.min(0.55, u.uFade.value + dt * 0.05);
    }
  }

  _updateRoomCaption() {
    const room = this.level.roomAt(this.player.position);
    const key = room ? room.key : null;

    if (key !== this.currentRoom) {
      this.currentRoom = key;
      this.roomShownAt = this.time;

      if (!room) {
        this.ui.room(null);
      } else if (this.active && Math.random() < this.dread * 0.45) {
        // The label lies more often the deeper you are.
        this.ui.room(WRONG_ROOMS[Math.floor(Math.random() * WRONG_ROOMS.length)], true);
      } else {
        this.ui.room(room.label, false);
      }
    }
  }
}
