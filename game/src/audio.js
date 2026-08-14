/**
 * Every sound in the house is synthesised at runtime — there are no audio
 * files. Noise buffers plus filters get you creaks, footsteps, whispers and
 * the low room drone that does most of the emotional work.
 */

export class Sound {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.dread = 0;        // 0..1, raised by the surreal layer
  }

  /**
   * @param {object} [opts]
   * @param {boolean} [opts.ambient=false] Build the drone, room tone and the
   *   scheduled ambient events. That layer belonged to the night mode; the
   *   walkthrough wants footsteps and the room reverb only.
   */
  start({ ambient = false } = {}) {
    this.ambient = ambient;
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }

    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;

    // --- master chain -----------------------------------------------------
    this.master = ctx.createGain();
    this.master.gain.value = 0.0001;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 20;
    comp.ratio.value = 5;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;

    this.master.connect(comp);
    comp.connect(ctx.destination);

    // A big, dead, empty-house reverb.
    this.verb = ctx.createConvolver();
    this.verb.buffer = this._impulse(2.9, 2.4);
    this.verbGain = ctx.createGain();
    this.verbGain.gain.value = 0.5;
    this.verb.connect(this.verbGain);
    this.verbGain.connect(this.master);

    this.dry = ctx.createGain();
    this.dry.gain.value = 0.85;
    this.dry.connect(this.master);

    this.noiseBuffer = this._noise(4);

    if (ambient) {
      this._buildDrone();
      this._buildRoomTone();
    }

    // Fade the world in rather than punching it on.
    this.master.gain.setTargetAtTime(0.85, ctx.currentTime, 1.6);

    this.ready = true;
    if (ambient) this._scheduleAmbient();
  }

  suspend() { this.ctx?.suspend(); }
  resume() { this.ctx?.resume(); }

  // ---------------------------------------------------------------- buffers

  _noise(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < len; i++) {
        // Brown-ish noise: warmer and heavier than white.
        const white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;
        d[i] = last * 3.5;
      }
    }
    return buf;
  }

  _impulse(seconds, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    return buf;
  }

  _src(loop = true) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuffer;
    s.loop = loop;
    return s;
  }

  // ------------------------------------------------------------------- beds

  /** Sub-bass drone: three detuned partials that slowly beat against each other. */
  _buildDrone() {
    const ctx = this.ctx;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0.16;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 220;
    lp.Q.value = 1.2;

    this.droneOsc = [];
    const partials = [
      { f: 43.65, g: 0.5, type: 'sine' },      // F1
      { f: 65.41, g: 0.28, type: 'sine' },     // C2
      { f: 43.9, g: 0.22, type: 'triangle' },  // deliberately out of tune
    ];

    for (const p of partials) {
      const o = ctx.createOscillator();
      o.type = p.type;
      o.frequency.value = p.f;
      const g = ctx.createGain();
      g.gain.value = p.g;

      // Slow amplitude drift so it never sits still.
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.03 + Math.random() * 0.06;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = p.g * 0.55;
      lfo.connect(lfoGain);
      lfoGain.connect(g.gain);
      lfo.start();

      o.connect(g);
      g.connect(lp);
      o.start();
      this.droneOsc.push(o);
    }

    lp.connect(this.droneGain);
    this.droneGain.connect(this.dry);
    this.droneGain.connect(this.verb);
    this.droneFilter = lp;
  }

  /** Air in an empty house: filtered noise, barely there. */
  _buildRoomTone() {
    const ctx = this.ctx;
    const src = this._src();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 420;
    bp.Q.value = 0.5;

    this.toneGain = ctx.createGain();
    this.toneGain.gain.value = 0.05;

    src.connect(bp);
    bp.connect(this.toneGain);
    this.toneGain.connect(this.dry);
    src.start();
    this.roomToneFilter = bp;
  }

  // ------------------------------------------------------------- one-shots

  /** Short filtered noise burst — the basis of most physical sounds. */
  _burst({ freq, q = 6, dur = 0.2, gain = 0.3, type = 'bandpass', sweep = 0, verb = 0.5, pan = 0 }) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    const src = this._src(false);
    src.playbackRate.value = 0.7 + Math.random() * 0.6;

    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + dur);
    f.Q.value = q;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.02, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    const p = ctx.createStereoPanner();
    p.pan.value = pan;

    src.connect(f); f.connect(g); g.connect(p);
    p.connect(this.dry);
    if (verb > 0) {
      const vg = ctx.createGain();
      vg.gain.value = verb;
      p.connect(vg);
      vg.connect(this.verb);
    }

    src.start(t);
    src.stop(t + dur + 0.05);
  }

  footstep(intensity = 0.7) {
    // Two layers: a soft heel thud and a brighter scuff.
    this._burst({ freq: 140 + Math.random() * 50, q: 2.5, dur: 0.11, gain: 0.09 * intensity, verb: 0.35 });
    this._burst({ freq: 1400 + Math.random() * 900, q: 1.2, dur: 0.055, gain: 0.028 * intensity, verb: 0.25 });
  }

  creak() {
    const pan = Math.random() * 1.6 - 0.8;
    this._burst({
      freq: 300 + Math.random() * 700, q: 22,
      dur: 0.5 + Math.random() * 0.9,
      gain: 0.05 + Math.random() * 0.05,
      sweep: 0.55 + Math.random() * 0.5, verb: 0.9, pan,
    });
  }

  thump() {
    const ctx = this.ctx;
    if (!this.ready) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.28);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.42, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g);
    g.connect(this.dry);
    g.connect(this.verb);
    o.start(t); o.stop(t + 0.55);
    this._burst({ freq: 220, q: 1, dur: 0.18, gain: 0.12, verb: 1.0 });
  }

  /** Breathy, unvoiced, formant-ish — reads as a voice without being one. */
  whisper() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dur = 1.1 + Math.random() * 1.4;
    const pan = Math.random() * 1.8 - 0.9;

    const src = this._src(false);
    src.playbackRate.value = 0.5 + Math.random() * 0.4;

    // Two moving formants over a high-passed noise bed.
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 700;

    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass'; f1.Q.value = 9;
    f1.frequency.setValueAtTime(700 + Math.random() * 300, t);
    f1.frequency.linearRampToValueAtTime(500 + Math.random() * 600, t + dur);

    const f2 = ctx.createBiquadFilter();
    f2.type = 'bandpass'; f2.Q.value = 12;
    f2.frequency.setValueAtTime(1600 + Math.random() * 700, t);
    f2.frequency.linearRampToValueAtTime(1200 + Math.random() * 1400, t + dur);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.075, t + dur * 0.3);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);

    // Syllable-rate tremolo.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 3.5 + Math.random() * 3;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.045;
    lfo.connect(lfoG); lfoG.connect(g.gain); lfo.start(t); lfo.stop(t + dur);

    const p = ctx.createStereoPanner();
    p.pan.value = pan;

    src.connect(hp); hp.connect(f1); f1.connect(f2); f2.connect(g); g.connect(p);
    p.connect(this.dry);
    const vg = ctx.createGain(); vg.gain.value = 0.7;
    p.connect(vg); vg.connect(this.verb);

    src.start(t); src.stop(t + dur + 0.1);
  }

  /** The sound of a lamp letting go. */
  extinguish() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;

    // Filament ping falling away.
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(1800, t);
    o.frequency.exponentialRampToValueAtTime(160, t + 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    o.connect(g); g.connect(this.dry); g.connect(this.verb);
    o.start(t); o.stop(t + 1);

    this._burst({ freq: 3200, q: 1.5, dur: 0.12, gain: 0.1, sweep: 0.2, verb: 0.9 });
  }

  /** A hard tonal shift marking a new cycle of the house. */
  stinger(cycle) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const base = 55 * Math.pow(2, -cycle * 0.06);

    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator();
      o.type = i === 0 ? 'sawtooth' : 'sine';
      o.frequency.setValueAtTime(base * (i + 1) * (1 + i * 0.01), t);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16 / (i + 1), t + 0.4);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 4.5);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(2400, t);
      lp.frequency.exponentialRampToValueAtTime(160, t + 4.5);
      o.connect(lp); lp.connect(g); g.connect(this.dry); g.connect(this.verb);
      o.start(t); o.stop(t + 5);
    }
  }

  heartbeat() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const beat = (at, gain) => {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(62, at);
      o.frequency.exponentialRampToValueAtTime(30, at + 0.16);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(gain, at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.3);
      o.connect(g); g.connect(this.dry);
      o.start(at); o.stop(at + 0.35);
    };
    beat(t, 0.2);
    beat(t + 0.29, 0.13);
  }

  // ------------------------------------------------------------- scheduling

  _scheduleAmbient() {
    const tick = () => {
      if (!this.ready) return;
      const d = this.dread;

      // Creaks get more frequent and whispers arrive as the house turns.
      if (Math.random() < 0.55 + d * 0.35) this.creak();
      if (Math.random() < 0.06 + d * 0.30) this.thump();
      if (Math.random() < d * 0.42) this.whisper();

      const wait = (2600 + Math.random() * 6500) * (1 - d * 0.55);
      this._timer = setTimeout(tick, Math.max(700, wait));
    };
    this._timer = setTimeout(tick, 3500);
  }

  /** Called every frame so the beds can track tension. */
  update(dt, dread) {
    if (!this.ready) return;
    this.dread = dread;
    if (!this.ambient) return;      // nothing to modulate without the drone
    const t = this.ctx.currentTime;

    // The drone rises and opens up as things get worse.
    this.droneGain.gain.setTargetAtTime(0.16 + dread * 0.30, t, 0.6);
    this.droneFilter.frequency.setTargetAtTime(220 + dread * 420, t, 0.8);
    this.toneGain.gain.setTargetAtTime(0.05 + dread * 0.07, t, 0.8);
    this.verbGain.gain.setTargetAtTime(0.5 + dread * 0.28, t, 1.0);

    // Detune the partials apart — the house going out of tune with itself.
    for (let i = 0; i < this.droneOsc.length; i++) {
      const o = this.droneOsc[i];
      o.detune.setTargetAtTime(dread * (i === 2 ? -38 : 14 * i), t, 1.4);
    }

    if (dread > 0.55) {
      this._hb = (this._hb || 0) + dt;
      const period = 1.5 - (dread - 0.55) * 0.9;
      if (this._hb > period) { this._hb = 0; this.heartbeat(); }
    }
  }

  dispose() {
    clearTimeout(this._timer);
    this.ready = false;
    this.ctx?.close();
  }
}
