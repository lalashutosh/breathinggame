// Shared calm helpers for the ΑΝΑΣΑ modes.
//   HeartCalm  - notices when the heart settles below its own starting rate (reward only, never a penalty)
//   CalmAudio  - soft breathing cues (in: airy rising swell, out: warm falling tone) and a reward chime
// Both are optional and silent until used.

/**
 * Feed it bpm readings; it learns a baseline over the first `baselineS` seconds, then fires
 * onCalm({ drop, bpm, baseline }) each time the 10 s average reaches a new step of `stepBpm`
 * below that baseline (2, 4, 6 ... bpm), at most once every `cooldownS` seconds.
 */
export class HeartCalm {
  constructor({ baselineS = 20, stepBpm = 2, cooldownS = 12, onCalm = null } = {}) {
    Object.assign(this, { baselineS, stepBpm, cooldownS, onCalm });
    this.reset();
  }
  reset() {
    this.buf = []; this.hist = []; this.baseline = null; this.best = 0; this.lastAt = -1e9; this.events = 0; this.startBpm = null; this.lastBpm = null;
  }
  push(bpm, t) {
    if (!bpm) return;
    this.lastBpm = bpm; if (this.startBpm == null) this.startBpm = bpm;
    this.hist.push([t, bpm]);
    while (this.hist.length && t - this.hist[0][0] > 10) this.hist.shift();
    if (this.baseline == null) {
      this.buf.push([t, bpm]);
      if (t - this.buf[0][0] >= this.baselineS) this.baseline = this.buf.reduce((a, b) => a + b[1], 0) / this.buf.length;
      return;
    }
    const avg = this.average();
    const drop = this.baseline - avg;
    const step = Math.floor(drop / this.stepBpm);
    if (step >= 1 && step > this.best && t - this.lastAt >= this.cooldownS) {
      this.best = step; this.lastAt = t; this.events++;
      this.onCalm?.({ drop, bpm: Math.round(avg), baseline: Math.round(this.baseline) });
    }
  }
  average() { return this.hist.length ? this.hist.reduce((a, b) => a + b[1], 0) / this.hist.length : null; }
  /** bpm change against the baseline (negative = calmer), or null while still learning. */
  delta() { const a = this.average(); return this.baseline != null && a != null ? a - this.baseline : null; }
}

/**
 * Gentle generated sounds. Create on a user gesture (browsers need one to start audio).
 * root: base pitch in Hz (pentatonic notes are derived from it).
 */
export class CalmAudio {
  constructor({ root = 130.81, volume = 0.8 } = {}) {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = AC ? new AC() : null;
    this.root = root;
    this.enabled = true;
    if (!this.ctx) return;
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = volume; this.master.connect(c.destination);
    // a little room: feedback delay
    this.bus = c.createGain(); this.bus.connect(this.master);
    const dl = c.createDelay(1); dl.delayTime.value = 0.37; const fb = c.createGain(); fb.gain.value = 0.32; const wet = c.createGain(); wet.gain.value = 0.28;
    this.bus.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(wet); wet.connect(this.master);
    const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    let b = 0; for (let i = 0; i < len; i++) { b = 0.97 * b + 0.03 * (Math.random() * 2 - 1); d[i] = b * 3; } // soft brown-ish noise
    this.noise = buf;
  }
  resume() { if (this.ctx?.state === 'suspended') this.ctx.resume(); }
  setEnabled(on) { this.enabled = on; if (this.master) this.master.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.3); }
  close() { try { this.ctx?.close(); } catch {} }

  _tone(freq, t, dur, vol, type = 'sine', attack = 0.02) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0004, t + dur);
    o.connect(g); g.connect(this.bus); o.start(t); o.stop(t + dur + 0.05);
    return o;
  }

  /** In-breath cue: airy noise swelling up with a soft rising tone. `dur` = length of the rise (s). */
  inhale(dur = 2) {
    if (!this.ctx || !this.enabled) return;
    const c = this.ctx, t = c.currentTime, d = Math.max(1, Math.min(dur, 6));
    const src = c.createBufferSource(); src.buffer = this.noise; src.loop = true;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.8;
    f.frequency.setValueAtTime(500, t); f.frequency.exponentialRampToValueAtTime(1800, t + d);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + d * 0.8); g.gain.linearRampToValueAtTime(0, t + d);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t); src.stop(t + d + 0.1);
    const o = this._tone(this.root * 2, t, d + 0.4, 0.018, 'sine', d * 0.7);
    o.frequency.exponentialRampToValueAtTime(this.root * 3, t + d);
  }

  /** Out-breath cue: a warm low tone that falls away gently. `dur` = length of the fall (s). */
  exhale(dur = 3) {
    if (!this.ctx || !this.enabled) return;
    const c = this.ctx, t = c.currentTime, d = Math.max(1.2, Math.min(dur, 8));
    const o = this._tone(this.root * 1.5, t, d, 0.03, 'triangle', 0.15);
    o.frequency.exponentialRampToValueAtTime(this.root, t + d);
    const o2 = this._tone(this.root * 0.75, t, d, 0.02, 'sine', 0.2);
    o2.frequency.exponentialRampToValueAtTime(this.root * 0.5, t + d);
  }

  /** A soft single bell (gathering things, sheep, seeds). */
  bell(mul = 4, vol = 0.05) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    this._tone(this.root * mul, t, 2.6, vol, 'sine');
    this._tone(this.root * mul * 2.01, t, 1.2, vol * 0.25, 'sine');
  }

  /** Heart-calm reward: a slow, warm rising major arpeggio with a shimmer on top. */
  calmChime() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime, r = this.root;
    [1, 5 / 4, 3 / 2, 2, 5 / 2].forEach((m, i) => {
      this._tone(r * 2 * m, t + i * 0.22, 3.4, 0.045 - i * 0.004, 'sine', 0.03);
      this._tone(r * 4 * m, t + i * 0.22 + 0.01, 1.6, 0.012, 'triangle', 0.02);
    });
    const o = this._tone(r * 0.5, t, 4, 0.03, 'sine', 0.6); // warm floor under it
    void o;
  }
}

/** Live phase from a MicBreath ('in'|'out'|'rest') turned into a 0..1 breath value with smooth rise/fall. */
export class BreathFollower {
  constructor() { this.val = 0; this.lastIn = null; this.periods = []; this.prev = 'rest'; }
  update(phase, dt, t, worldPeriod = 6) {
    if (phase === 'in' && this.prev !== 'in') {
      if (this.lastIn != null) { const p = t - this.lastIn; if (p > 1.5 && p < 20) { this.periods.push(p); if (this.periods.length > 4) this.periods.shift(); } }
      this.lastIn = t;
    }
    this.prev = phase;
    const rise = dt / (0.4 * worldPeriod), fall = dt / (0.6 * worldPeriod);
    this.val = Math.max(0, Math.min(1, this.val + (phase === 'in' ? rise : phase === 'out' ? -fall : -fall * 0.3)));
    return this.val;
  }
  /** Seconds per breath from the last few in-breath onsets, or null. */
  period() { if (!this.periods.length) return null; const s = [...this.periods].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }
}
