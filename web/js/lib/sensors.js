// Browser sensors for the games: microphone breath detection and Bluetooth heart rate.
// Ports of BreathFilter (breathlight.py), BreathTracker and parse_hrm (breathdive.py).

export const support = {
  secure: typeof window !== 'undefined' && window.isSecureContext,
  mic: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
  bluetooth: !!navigator.bluetooth,
};

const median = (arr) => { const a = arr.slice().sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const percentile = (arr, p) => { const a = arr.slice().sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))]; };

/**
 * Turns analyser spectra (dB per bin) into a 0..1 breath level.
 *  1. band power 400-3000 Hz   2. spectral flatness over 6 sub-bands (hiss ~0.5, voice ~0.1-0.25),
 *  median-smoothed with hysteresis   3. non-hiss sound is pulled to the room floor
 *  4. median over 9 blocks (~0.3 s)   5. fast-attack / slow-release envelope between floor and ceiling.
 */
export class BreathFilter {
  constructor(sampleRate, fftSize, { gateDb = 9, spanDb = 20, flat = 0.52, calibS = 3, hyst = 0.05, minBreathS = 0.2, blockS = 0.032 } = {}) {
    const binHz = sampleRate / fftSize, nBins = fftSize / 2 + 1;
    const lo = 400, hi = 3000;
    this.band = []; for (let i = 0; i < nBins; i++) { const f = i * binHz; if (f >= lo && f <= hi) this.band.push(i); }
    const edges = Array.from({ length: 7 }, (_, k) => lo * Math.pow(hi / lo, k / 6));
    this.subs = edges.slice(0, -1).map((a, k) => this.band.filter((i) => i * binHz >= a && i * binHz < edges[k + 1])).filter((s) => s.length);
    this.gateDb = gateDb; this.spanDb = spanDb; this.flatThr = flat; this.hyst = hyst;
    this.minOpen = Math.round(minBreathS / blockS); this.openRun = 0;
    this.flatHist = []; this.dbHist = [];
    this.calib = []; this.calibN = Math.round(calibS / blockS);
    this.floor = this.ceil = this.env = null; this.room = null;
    this.gateOpen = false; this.flat = 0; this.db = 0;
  }
  /** @param {Float32Array} spec dB per bin from AnalyserNode.getFloatFrequencyData
   *  @param {boolean} calibDone true once 3 s of wall-clock time have passed (timer-throttle safe) */
  step(spec, calibDone = false) {
    const lin = (i) => Math.pow(10, (Number.isFinite(spec[i]) ? spec[i] : -160) / 10) + 1e-14;
    let sum = 0; for (const i of this.band) sum += lin(i);
    const db = 10 * Math.log10(sum);
    let fl = 0;
    for (const s of this.subs) { let lg = 0, ar = 0; for (const i of s) { const p = lin(i); lg += Math.log(p); ar += p; } fl += Math.exp(lg / s.length) / (ar / s.length); }
    fl /= this.subs.length;
    this.flatHist.push(fl); if (this.flatHist.length > 7) this.flatHist.shift();
    this.flat = median(this.flatHist); this.db = db;

    if (this.floor == null) {
      this.calib.push(db);
      if (this.calib.length >= this.calibN || (calibDone && this.calib.length >= 10)) {
        this.room = percentile(this.calib, 80);
        this.floor = this.room + this.gateDb; this.ceil = this.floor + this.spanDb; this.env = this.room;
      }
      return null;
    }
    this.gateOpen = this.gateOpen ? this.flat >= this.flatThr - this.hyst : this.flat >= this.flatThr;
    this.openRun = this.gateOpen ? this.openRun + 1 : 0;
    const isBreath = this.gateOpen && this.openRun >= this.minOpen;
    const dbg = isBreath ? db : Math.min(db, this.room);
    this.dbHist.push(dbg); if (this.dbHist.length > 9) this.dbHist.shift();
    const med = median(this.dbHist);
    const a = med > this.env ? 0.35 : 0.08;
    this.env += a * (med - this.env);
    if (!this.gateOpen) this.room += db > this.room ? 0.002 * (db - this.room) : 0.05 * (db - this.room);
    this.floor = Math.max(this.room + this.gateDb, Math.min(this.floor + 0.003, this.env + this.gateDb));
    this.ceil = Math.max(this.env, this.ceil - 0.02, this.floor + 8);
    const lvl = (this.env - this.floor) / (this.ceil - this.floor);
    return Math.max(0, Math.min(1, lvl));
  }
}

/** Turns the 0..1 mic level into in / out / rest phases. */
export class BreathTracker {
  static ON = 0.12; static OFF = 0.06; static OFF_HOLD = 0.35; static RESYNC = 8.0;
  constructor(scheme = 'alternate') { this.scheme = scheme; this.active = false; this.belowSince = null; this.n = 0; this.lastEnd = null; this.phase = 'rest'; }
  flip() { this.n += 1; if (this.active) this.phase = this.phase === 'in' ? 'out' : 'in'; }
  update(lvl, t) {
    const T = BreathTracker;
    if (!this.active) {
      if (lvl >= T.ON) {
        this.active = true; this.belowSince = null;
        if (this.lastEnd == null || t - this.lastEnd > T.RESYNC) this.n = 0;
        this.phase = this.scheme === 'alternate' ? (this.n % 2 === 0 ? 'in' : 'out') : 'out';
      }
    } else if (lvl < T.OFF) {
      if (this.belowSince == null) this.belowSince = t;
      else if (t - this.belowSince > T.OFF_HOLD) { this.active = false; this.n += 1; this.lastEnd = t; }
    } else this.belowSince = null;
    if (!this.active) {
      const gap = this.lastEnd != null ? t - this.lastEnd : 1e9;
      this.phase = this.scheme === 'exhale' && gap < 6 ? 'in' : 'rest';
    }
    return this.phase;
  }
}

/** Microphone breath input. start() asks for permission; then read .level / .phase / .status. */
export class MicBreath {
  constructor({ scheme = 'alternate' } = {}) {
    this.tracker = new BreathTracker(scheme);
    this.level = 0; this.phase = 'rest'; this.status = 'off'; this.ready = false;
  }
  set scheme(s) { this.tracker.scheme = s; }
  async start() {
    if (!support.mic) throw new Error(support.secure ? 'This browser has no microphone access' : 'Microphone needs https or localhost');
    // Prefer the trained in/out model (web/models/breath.json, built from recorded sessions).
    try {
      const { BreathModel, openMic16k } = await import('./breathmodel.js');
      const model = await BreathModel.load();
      this.model = model; this.modelState = model.state;
      this.mic16 = await openMic16k((block) => {
        const st = model.push(block);
        this.modelState = st; this.phase = st.phase; this.level = Math.min(1, st.pIn + st.pOut);
      });
      this.ready = true; this.status = 'mic (trained model)';
      return;
    } catch (e) { this.model = null; /* no model yet: fall back to the sound-level detector */ }
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    await this.ctx.resume();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0;
    this.ctx.createMediaStreamSource(this.stream).connect(this.analyser);
    this.filter = new BreathFilter(this.ctx.sampleRate, this.analyser.fftSize);
    this.spec = new Float32Array(this.analyser.frequencyBinCount);
    this.status = 'measuring room noise - stay quiet 3 s';
    this.calibUntil = performance.now() + 3000;
    this.lastStep = performance.now();
    this.timer = setInterval(() => this.poll(), 32);          // fallback when the game loop is paused
  }
  /** Process the audio in 32 ms blocks. Call from the game loop; safe to call often. */
  poll(now = performance.now()) {
    if (this.model || !this.analyser) return;
    let steps = 0;
    while (now - this.lastStep >= 32 && steps < 8) {
      this.lastStep += 32; steps++;
      this.analyser.getFloatFrequencyData(this.spec);
      const lvl = this.filter.step(this.spec, now >= this.calibUntil);
      if (lvl == null) continue;
      if (!this.ready) { this.ready = true; this.status = `mic (room ${this.filter.room.toFixed(0)} dB)`; }
      this.level = lvl;
      this.phase = this.tracker.update(lvl, now / 1000);
    }
    if (now - this.lastStep > 1000) this.lastStep = now;      // tab was asleep: do not replay a backlog
  }
  flip() { if (!this.model) this.tracker.flip(); }
  /** With the trained model: { phase, since, lastIn, lastOut, period, pIn, pOut, pRest }; else null. */
  get detail() { return this.model ? this.modelState : null; }
  stop() {
    this.mic16?.stop(); this.mic16 = null; this.model = null;
    clearInterval(this.timer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
    this.status = 'off'; this.level = 0; this.phase = 'rest';
  }
}

/** Standard Heart Rate Measurement characteristic -> { hr, rr: [seconds] }. */
export function parseHrm(bytes) {
  const flags = bytes[0];
  let i = 1, hr;
  if (flags & 0x01) { hr = bytes[1] | (bytes[2] << 8); i = 3; } else { hr = bytes[1]; i = 2; }
  if (flags & 0x08) i += 2;                       // energy expended
  const rr = [];
  if (flags & 0x10) while (i + 1 < bytes.length) { rr.push((bytes[i] | (bytes[i + 1] << 8)) / 1024); i += 2; }
  return { hr, rr };
}

/** Bluetooth heart-rate sensor (Polar, Wahoo, Garmin broadcast, Coospo, ...). */
export class BleHeart {
  constructor() { this.hr = null; this.hrTime = 0; this.rr = []; this.status = 'not connected'; this.name = ''; this.connected = false; this.onChange = null; }
  async connect() {
    if (!support.bluetooth) throw new Error(support.secure ? 'Web Bluetooth needs Chrome or Edge' : 'Bluetooth needs https or localhost');
    this.status = 'choose your sensor...'; this.onChange?.();
    this.device = await navigator.bluetooth.requestDevice({ filters: [{ services: ['heart_rate'] }] });
    this.name = this.device.name || 'heart sensor';
    this.status = `connecting to ${this.name}...`; this.onChange?.();
    this.device.addEventListener('gattserverdisconnected', () => { this.connected = false; this.status = `lost ${this.name}`; this.onChange?.(); });
    const server = await this.device.gatt.connect();
    const svc = await server.getPrimaryService('heart_rate');
    const ch = await svc.getCharacteristic('heart_rate_measurement');
    ch.addEventListener('characteristicvaluechanged', (e) => {
      const dv = e.target.value;
      this._push(parseHrm(new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength)));
    });
    await ch.startNotifications();
    this.connected = true; this.status = this.name; this.onChange?.();
  }
  _push({ hr, rr }) {
    if (hr) { this.hr = hr; this.hrTime = performance.now() / 1000; }
    for (const r of rr) if (r > 0.25 && r < 2) { this.rr.push(r); if (this.rr.length > 60) this.rr.shift(); }
    this.onChange?.();
  }
  /** Live bpm, or null if the sensor went quiet for 5 s. */
  get bpm() { return this.hr && performance.now() / 1000 - this.hrTime < 5 ? this.hr : null; }
  /** RMSSD over the last 30 beats, in ms. */
  rmssd() {
    const rr = this.rr.slice(-30);
    if (rr.length < 6) return null;
    let s = 0; for (let i = 1; i < rr.length; i++) s += (rr[i] - rr[i - 1]) ** 2;
    return 1000 * Math.sqrt(s / (rr.length - 1));
  }
  disconnect() { try { this.device?.gatt?.disconnect(); } catch {} this.connected = false; }
}
