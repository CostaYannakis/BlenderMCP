import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);

// Scratch objects — allocating inside the step loop would churn the heap.
const _box = new THREE.Box3();
const _seg = new THREE.Line3();
const _tri = new THREE.Vector3();
const _cap = new THREE.Vector3();
const _delta = new THREE.Vector3();
const _old = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _move = new THREE.Vector3();
const _sub = new THREE.Vector3();
const _down = new THREE.Vector3(0, -1, 0);
const _ray = new THREE.Raycaster();

export class Player {
  constructor(collider, camera) {
    this.collider = collider;
    this.camera = camera;

    this.position = new THREE.Vector3();   // feet, world space
    this.velocity = new THREE.Vector3();   // vertical only; horizontal is positional
    this.yaw = 0;
    this.pitch = 0;

    this.radius = 0.3;
    this.height = 1.72;
    this.eyeStand = 1.58;
    this.eyeCrouch = 0.92;
    this.eye = this.eyeStand;

    // Faster than a real walk on purpose. 2 m/s is the honest figure and it
    // feels like wading; a walkthrough wants to cross a room in a couple of
    // seconds, not five.
    this.walkSpeed = 3.4;
    this.runSpeed = 6.4;
    this.crouchSpeed = 1.6;

    this.onGround = false;
    this.crouching = false;
    this.running = false;

    // Feel
    this.bobPhase = 0;
    this.bobAmount = 0;
    this.roll = 0;
    this.breath = 0;
    this.stepDistance = 0;
    this.lastStepDistance = 0;
    this.speedScale = 1;      // the house can slow you down
    this.gravity = -18;

    // Radians per CSS pixel of mouse travel. Note "CSS pixel": pointer lock
    // reports movementX in physical device pixels, so on a display running at
    // 125% or 150% scaling — the Windows default on most laptops — the same
    // hand movement produced 1.25-1.5x the turn. Normalising by devicePixelRatio
    // in _onMouseMove makes the feel identical on every display.
    this.lookSensitivity = Number(
      globalThis.localStorage?.getItem('balmoral.sens')) || 0.0014;

    // Look input accumulated between frames, applied whole in update().
    this._pendingYaw = 0;
    this._pendingPitch = 0;

    this.keys = Object.create(null);
    this.enabled = false;
    this.onFootstep = null;

    this._bindInput();
  }

  _bindInput() {
    const dom = document.body;

    this._onKeyDown = e => {
      this.keys[e.code] = true;
      if (e.code === 'Space') e.preventDefault();
    };
    this._onKeyUp = e => { this.keys[e.code] = false; };

    // Pointer lock occasionally reports a single enormous movement delta — on
    // the frame lock is acquired, and intermittently when the OS applies
    // pointer acceleration. Unclamped, one of those snaps the view round.
    //
    // The cap has to sit well above real input or it throttles fast turns,
    // which feels just as wrong. A hard flick is a couple of hundred pixels in
    // one event at a low polling rate; the spikes are in the thousands. 500 px
    // is about 60 degrees in a single event — comfortably past anything a hand
    // produces, comfortably under a glitch.
    // Pointer lock emits occasional bogus deltas: one on the frame lock is
    // acquired, and intermittently when the OS applies pointer acceleration or
    // the compositor drops frames. They are the cause of the view snapping to a
    // random direction. A fixed clamp alone cannot catch them, because a
    // "small" spike of 150 px is still ~12 degrees in a single event while a
    // real fast flick is only a few px per event at a 1000 Hz polling rate.
    //
    // So: a hard ceiling, plus rejection of anything wildly out of line with
    // how the mouse has actually been moving over the last handful of events.
    const MAX_EVENT_DELTA = 180;
    const HISTORY = 12;
    this._mag = [];

    this._onMouseMove = e => {
      if (!this.enabled) return;
      // Pointer lock's first events after acquisition are the worst offenders.
      if (performance.now() < (this._settleUntil || 0)) return;

      const mx = e.movementX || 0;
      const my = e.movementY || 0;
      const mag = Math.hypot(mx, my);

      const h = this._mag;
      if (h.length >= 4) {
        const sorted = [...h].sort((a, b) => a - b);
        const median = sorted[sorted.length >> 1];
        // 6x the recent median, with a floor so slow, careful movement does not
        // set a threshold so low that a normal flick trips it.
        if (mag > Math.max(70, median * 6)) return;
      }
      h.push(mag);
      if (h.length > HISTORY) h.shift();

      // Accumulated here, applied whole once per frame in update(). Mouse
      // events arrive in irregular bursts that do not line up with frames, so
      // summing them and applying the total is what keeps the turn matched to
      // the hand rather than to the event timing.
      const dpr = globalThis.devicePixelRatio || 1;
      const s = this.lookSensitivity / dpr;
      const clamp = v => Math.max(-MAX_EVENT_DELTA, Math.min(MAX_EVENT_DELTA, v));
      this._pendingYaw -= clamp(mx) * s * this.lookFlip;
      this._pendingPitch -= clamp(my) * s;
    };

    this.lookFlip = 1;   // look inversion; always 1 in the walkthrough

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    document.addEventListener('mousemove', this._onMouseMove);
    this.dom = dom;
  }

  /**
   * Drop the player onto whatever solid surface is under a world position.
   *
   * The probe starts only slightly above the requested height on purpose: this
   * is an enclosed house with a roof, and a ray cast from well overhead finds
   * the roof first and buries the capsule in solid geometry.
   */
  /**
   * Drop any look input still in flight, and ignore incoming events briefly.
   *
   * Called when pointer lock is acquired. Chrome reports a large bogus
   * movementX/Y on the first event or two after locking - the delta from
   * wherever the cursor happened to be - which lands as a hard snap of the
   * view. The settle window swallows those, and clearing the history stops
   * them poisoning the outlier median.
   */
  clearLook() {
    this._pendingYaw = 0;
    this._pendingPitch = 0;
    this._mag = [];
    this._settleUntil = performance.now() + 180;
  }

  placeAt(worldPos, yaw = 0) {
    this.yaw = yaw;
    this.pitch = 0;
    this.velocity.set(0, 0, 0);
    this.clearLook();

    _ray.set(new THREE.Vector3(worldPos.x, worldPos.y + 0.8, worldPos.z), _down);
    _ray.far = 6;
    const hit = _ray.intersectObject(this.collider, true)[0];

    this.position.set(
      worldPos.x,
      hit ? hit.point.y + 0.02 : worldPos.y,
      worldPos.z
    );
    this.updateCamera();
  }

  forward(target = new THREE.Vector3()) {
    return target.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  /**
   * Apply the look input accumulated since the last frame, in full.
   *
   * This used to drain exponentially towards the target, which sounds like
   * smoothing but is not: mouse deltas are already a displacement, not a rate,
   * so holding part of one back spreads a single flick across several frames as
   * a decaying tail. At a variable frame rate the size of that tail changes
   * frame to frame, which is what read as jerk. Summing the events and applying
   * the total is exactly 1:1 with the hand and cannot judder on its own.
   */
  _applyLook(dt) {
    this.yaw += this._pendingYaw;
    this.pitch += this._pendingPitch;
    this._pendingYaw = 0;
    this._pendingPitch = 0;

    const limit = Math.PI / 2 - 0.02;
    if (this.pitch > limit) this.pitch = limit;
    if (this.pitch < -limit) this.pitch = -limit;
  }

  /** Nudge look speed. Returns the new value, persisted across sessions. */
  adjustSensitivity(step) {
    const lo = 0.0004, hi = 0.0050;
    const next = Math.min(hi, Math.max(lo, this.lookSensitivity * (step > 0 ? 1.25 : 0.8)));
    this.lookSensitivity = Math.round(next * 1e5) / 1e5;
    try { globalThis.localStorage?.setItem('balmoral.sens', String(this.lookSensitivity)); } catch {}
    return this.lookSensitivity;
  }

  update(dt) {
    if (!this.enabled) return;

    this._applyLook(dt);

    const wantCrouch = !!(this.keys.KeyC || this.keys.ControlLeft);
    this.crouching = wantCrouch;
    this.running = !!(this.keys.ShiftLeft || this.keys.ShiftRight) && !wantCrouch;

    // Movement basis on the ground plane. cross(forward, up) already points to
    // the player's right — negating it here is what put strafe the wrong way
    // round.
    const fwd = this.forward(_dir);
    const right = _right.crossVectors(fwd, UP).normalize();

    let ix = 0, iz = 0;
    if (this.keys.KeyW || this.keys.ArrowUp) iz += 1;
    if (this.keys.KeyS || this.keys.ArrowDown) iz -= 1;
    if (this.keys.KeyD || this.keys.ArrowRight) ix += 1;
    if (this.keys.KeyA || this.keys.ArrowLeft) ix -= 1;

    const moving = ix !== 0 || iz !== 0;
    let speed = this.crouching ? this.crouchSpeed : this.running ? this.runSpeed : this.walkSpeed;
    speed *= this.speedScale;

    const move = _move.set(0, 0, 0);
    if (moving) {
      move.addScaledVector(fwd, iz).addScaledVector(right, ix).normalize().multiplyScalar(speed * dt);
    }

    // Five substeps keeps the capsule from tunnelling through 100 mm walls at a run.
    const steps = 5;
    const sdt = dt / steps;
    const subMove = _sub.copy(move).divideScalar(steps);

    for (let i = 0; i < steps; i++) {
      this.velocity.y += this.gravity * sdt;
      this.position.add(subMove);
      this.position.y += this.velocity.y * sdt;
      this._resolveCollision(sdt);
    }

    // Head bob and lean, driven by ground distance so it stays in step with speed.
    if (moving && this.onGround) {
      this.stepDistance += move.length();
      // Deliberately subtle. Bob is driven by distance travelled, so raising
      // the walk and run speeds scaled both its size and its rate — which is
      // what turned it into a twitch.
      const targetBob = this.crouching ? 0.006 : this.running ? 0.016 : 0.011;
      this.bobAmount += (targetBob - this.bobAmount) * Math.min(1, dt * 6);

      // Capped so a sprint cannot oscillate the head faster than a stride.
      const stridePhase = (move.length() / (this.crouching ? 0.62 : 1.05)) * Math.PI;
      this.bobPhase += Math.min(stridePhase, dt * 9);

      const stride = this.crouching ? 0.78 : this.running ? 1.35 : 0.95;
      if (this.stepDistance - this.lastStepDistance > stride) {
        this.lastStepDistance = this.stepDistance;
        this.onFootstep?.(this.running ? 1 : this.crouching ? 0.35 : 0.7);
      }
    } else {
      this.bobAmount += (0 - this.bobAmount) * Math.min(1, dt * 4);
    }

    const targetRoll = -ix * (this.running ? 0.012 : 0.007);
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 5);

    this.breath += dt * (this.running ? 2.4 : 0.9);

    const targetEye = this.crouching ? this.eyeCrouch : this.eyeStand;
    this.eye += (targetEye - this.eye) * Math.min(1, dt * 9);

    this.updateCamera(dt);
  }

  _resolveCollision(dt) {
    const bvh = this.collider.geometry.boundsTree;
    if (!bvh) return;

    _old.copy(this.position);

    // Capsule as a segment between the two sphere centres.
    const h = this.crouching ? 1.15 : this.height;
    _seg.start.set(this.position.x, this.position.y + this.radius, this.position.z);
    _seg.end.set(this.position.x, this.position.y + h - this.radius, this.position.z);

    _box.makeEmpty();
    _box.expandByPoint(_seg.start);
    _box.expandByPoint(_seg.end);
    _box.min.addScalar(-this.radius);
    _box.max.addScalar(this.radius);

    bvh.shapecast({
      intersectsBounds: box => box.intersectsBox(_box),
      intersectsTriangle: tri => {
        const dist = tri.closestPointToSegment(_seg, _tri, _cap);
        if (dist < this.radius) {
          const depth = this.radius - dist;
          const dir = _cap.sub(_tri).normalize();
          _seg.start.addScaledVector(dir, depth);
          _seg.end.addScaledVector(dir, depth);
        }
      },
    });

    const newFeetY = _seg.start.y - this.radius;
    _delta.set(_seg.start.x, newFeetY, _seg.start.z).sub(_old);

    // A meaningful upward correction while falling means we landed on something.
    this.onGround = _delta.y > Math.abs(dt * this.velocity.y * 0.25);

    const offset = Math.max(0, _delta.length() - 1e-5);
    _delta.normalize().multiplyScalar(offset);
    this.position.add(_delta);

    if (this.onGround) {
      this.velocity.y = 0;
    } else if (offset > 0) {
      // Slide along the surface instead of sticking to it.
      _delta.normalize();
      this.velocity.addScaledVector(_delta, -_delta.dot(this.velocity));
    }

    // Failsafe: the house is allowed to be strange, but not to swallow you.
    if (this.position.y < -12) {
      this.position.y = 6;
      this.velocity.set(0, 0, 0);
    }
  }

  updateCamera() {
    const bob = Math.sin(this.bobPhase) * this.bobAmount;
    const breathe = Math.sin(this.breath) * 0.004;

    this.camera.position.set(
      this.position.x,
      this.position.y + this.eye + bob + breathe,
      this.position.z
    );

    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    // Roll comes only from strafing now. Rolling the horizon in time with the
    // walk cycle as well was the most disorienting part of the old feel — the
    // whole world tilted rhythmically while you were trying to aim.
    this.camera.rotation.z = this.roll;
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    document.removeEventListener('mousemove', this._onMouseMove);
  }
}
