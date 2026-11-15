// Browser sensors for the games: microphone breath detection and Bluetooth heart rate.
// Ports of BreathFilter (breathlight.py), BreathTracker and parse_hrm (breathdive.py).

export const support = {
  secure: typeof window !== 'undefined' && window.isSecureContext,
  mic: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
  bluetooth: !!navigator.bluetooth,
};

// ---- microphone choice (shared by every mode; remembered in this browser)
const MIC_KEY = 'anasa.micDevice';
export function savedMic() { try { return localStorage.getItem(MIC_KEY) || ''; } catch { return ''; } }
export function saveMic(id) { try { if (id) localStorage.setItem(MIC_KEY, id); else localStorage.removeItem(MIC_KEY); } catch { /* storage blocked */ } }

/** Audio inputs the browser can see. Labels stay empty until the page has had mic permission once. */
export async function listMics() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devs = await navigator.mediaDevices.enumerateDevices();
  return devs.filter((d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
}

/** getUserMedia for the chosen mic, falling back to the default one if it was unplugged. */
export async function getMicStream(constraints = {}, deviceId = savedMic()) {
  const base = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, ...constraints };
  if (deviceId) {
    try { return await navigator.mediaDevices.getUserMedia({ audio: { ...base, deviceId: { exact: deviceId } } }); }
    catch (e) { if (e.name !== 'OverconstrainedError' && e.name !== 'NotFoundError') throw e; }
  }
  return navigator.mediaDevices.getUserMedia({ audio: base });
}

/**
 * A <select> listing the microphones. The choice is saved and used by every MicBreath.start().
 * onChange(deviceId) fires after a new choice is saved.
 */
export function micPicker({ className = '', onChange } = {}) {
  const sel = document.createElement('select');
  sel.className = className;
  sel.setAttribute('aria-label', 'Microphone');
  if (!support.mic) { sel.disabled = true; sel.innerHTML = '<option>no microphone access</option>'; return sel; }
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  async function fill() {
    let mics = [];
    try { mics = await listMics(); } catch { /* ignore */ }
    const saved = savedMic();
    const named = mics.some((m) => m.label);
    sel.innerHTML = '<option value="">Default microphone</option>'
      + mics.map((m, i) => `<option value="${esc(m.deviceId)}">${esc(m.label || `Microphone ${i + 1}`)}</option>`).join('')
      + (named ? '' : '<option value="__ask">Show microphone names…</option>');
    sel.value = mics.some((m) => m.deviceId === saved) ? saved : '';
  }
  sel.addEventListener('change', async () => {
    if (sel.value === '__ask') {
      try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); s.getTracks().forEach((t) => t.stop()); }
      catch { /* refused: keep the default */ }
      await fill();
      return;
    }
    saveMic(sel.value);
    onChange?.(sel.value);
  });
  navigator.mediaDevices.addEventListener?.('devicechange', fill);
  fill();
  return sel;
}

/** Microphones on the machine running serve.py (for the Godot mode), or [] if unavailable. */
export async function listServerMics() {
  try { const r = await fetch('/api/mics', { cache: 'no-store' }); return r.ok ? (await r.json()).mics || [] : []; }
  catch { return []; }
}
const SERVER_MIC_KEY = 'anasa.micSource';
export function savedServerMic() { try { return localStorage.getItem(SERVER_MIC_KEY) || ''; } catch { return ''; } }
export function saveServerMic(name) { try { if (name) localStorage.setItem(SERVER_MIC_KEY, name); else localStorage.removeItem(SERVER_MIC_KEY); } catch { /* storage blocked */ } }

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

/**
 * Out-breath detector, tuned on labelled sessions recorded with a close (clip-on) mic.
 * A mouth exhale onto the mic is low-frequency wind; a nose inhale is a thin high hiss.
 * So: an out-breath = sound above the room level whose energy leans low (40-800 Hz vs 800-3000 Hz).
 *  1. band level 40-3000 Hz and "tilt" (low band dB - high band dB), per 32 ms block
 *  2. median over 7 blocks (~0.2 s) kills clicks
 *  3. room level and room tilt measured in the first 3 s, the room level then tracks slowly
 *  4. on when level > room + onDb and tilt > roomTilt + tiltDb, with 2 dB hysteresis
 */
export class ExhaleDetector {
  constructor(sampleRate, fftSize, { lo = 40, split = 800, hi = 3000, onDb = 3, tiltDb = -6, hyst = 2, med = 7, calibS = 3, blockS = 0.032 } = {}) {
    const binHz = sampleRate / fftSize, nBins = fftSize / 2 + 1;
    this.low = []; this.high = [];
    for (let i = 1; i < nBins; i++) { const f = i * binHz; if (f >= lo && f < split) this.low.push(i); else if (f >= split && f < hi) this.high.push(i); }
    Object.assign(this, { onDb, tiltDb, hyst, med });
    this.lh = []; this.th = []; this.calib = []; this.calibN = Math.round(calibS / blockS);
    this.room = null; this.roomTilt = 0; this.on = false; this.above = 0; this.db = -160;
  }
  /** @param {Float32Array} spec dB per bin. @returns {number|null} 0..1 out-breath strength, null while calibrating. */
  step(spec, calibDone = false) {
    const pow = (idx) => { let s = 0; for (const i of idx) s += Math.pow(10, (Number.isFinite(spec[i]) ? spec[i] : -160) / 10); return s + 1e-14; };
    const pl = pow(this.low), ph = pow(this.high);
    const L = 10 * Math.log10(pl + ph), tilt = 10 * Math.log10(pl) - 10 * Math.log10(ph);
    this.db = L;
    this.lh.push(L); this.th.push(tilt);
    if (this.lh.length > this.med) { this.lh.shift(); this.th.shift(); }
    if (this.room == null) {
      this.calib.push([L, tilt]);
      if (this.calib.length >= this.calibN || (calibDone && this.calib.length >= 10)) {
        this.room = median(this.calib.map((c) => c[0]));
        this.roomTilt = median(this.calib.map((c) => c[1]));
      }
      return null;
    }
    const l = median(this.lh) - this.room, t = median(this.th) - this.roomTilt;
    const h = this.on ? this.hyst : 0;
    this.on = l > this.onDb - h && t > this.tiltDb - h;
    if (!this.on) this.room += L > this.room ? 0.002 * (L - this.room) : 0.05 * (L - this.room);
    this.above = l;
    return this.on ? Math.max(0.3, Math.min(1, l / 15)) : 0;
  }
}

/**
 * Microphone breath input, out-breath only. start() asks for permission; then read .level / .phase / .status.
 * phase: 'out' while an out-breath is heard, 'in' otherwise (the world rises / follows its path), 'rest' while calibrating.
 */
export class MicBreath {
  constructor() { this.level = 0; this.phase = 'rest'; this.status = 'off'; this.ready = false; }
  set scheme(_) { /* out-breath only now */ }
  async start() {
    if (!support.mic) throw new Error(support.secure ? 'This browser has no microphone access' : 'Microphone needs https or localhost');
    this.stream = await getMicStream({ channelCount: 1 });
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    await this.ctx.resume();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = this.ctx.sampleRate > 24000 ? 2048 : 1024;   // ~43-64 ms window, ~23 Hz bins
    this.analyser.smoothingTimeConstant = 0;
    this.ctx.createMediaStreamSource(this.stream).connect(this.analyser);
    this.filter = new ExhaleDetector(this.ctx.sampleRate, this.analyser.fftSize);
    this.spec = new Float32Array(this.analyser.frequencyBinCount);
    this.status = 'measuring room noise - stay quiet 3 s';
    this.calibUntil = performance.now() + 3000;
    this.lastStep = performance.now();
    this.timer = setInterval(() => this.poll(), 32);          // keeps running when the game loop is paused
  }
  /** Process the audio in 32 ms blocks. Call from the game loop; safe to call often. */
  poll(now = performance.now()) {
    if (!this.analyser) return;
    let steps = 0;
    while (now - this.lastStep >= 32 && steps < 8) {
      this.lastStep += 32; steps++;
      this.analyser.getFloatFrequencyData(this.spec);
      const lvl = this.filter.step(this.spec, now >= this.calibUntil);
      if (lvl == null) continue;
      if (!this.ready) { this.ready = true; this.status = 'listening for out-breaths'; }
      this.level = lvl;
      this.phase = lvl > 0 ? 'out' : 'in';
    }
    if (now - this.lastStep > 1000) this.lastStep = now;      // tab was asleep: do not replay a backlog
  }
  flip() {}
  get detail() { return null; }
  stop() {
    clearInterval(this.timer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
    this.stream = null; this.ctx = null; this.analyser = null; this.ready = false;
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
