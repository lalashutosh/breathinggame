// ΑΝΑΣΑ breath phase model (browser runtime). Port of ml/breath_model.py: keep them in sync.
// 16 kHz mono -> 32 ms frames (hop 16 ms) -> 24 log-mel bands -> causal noise floor ->
// 320 ms context features -> small MLP -> [rest, in, out] -> phase tracker with timing.

const MODEL_URL = new URL('../../models/breath.json', import.meta.url).href;

function melFilters(sr, n, nmel, fmin, fmax) {
  const hz2mel = (f) => 2595 * Math.log10(1 + f / 700);
  const mel2hz = (m) => 700 * (Math.pow(10, m / 2595) - 1);
  const nb = n / 2 + 1, m0 = hz2mel(fmin), m1 = hz2mel(fmax);
  const pts = Array.from({ length: nmel + 2 }, (_, i) => mel2hz(m0 + ((m1 - m0) * i) / (nmel + 1)));
  const fb = [];
  for (let m = 0; m < nmel; m++) {
    const lo = pts[m], c = pts[m + 1], hi = pts[m + 2], row = new Float64Array(nb);
    for (let k = 0; k < nb; k++) { const f = (k * sr) / n; row[k] = Math.max(0, Math.min((f - lo) / (c - lo), (hi - f) / (hi - c))); }
    fb.push(row);
  }
  return fb;
}

/** In-place iterative radix-2 FFT on (re, im). */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

export class BreathModel {
  constructor(spec) {
    this.spec = spec;
    const { sr, n, hop, nmel, fmin, fmax } = spec;
    Object.assign(this, { sr, n, hop, nmel, W: spec.W, WS: spec.WS, down: spec.floor.down, up: spec.floor.up });
    this.fb = melFilters(sr, n, nmel, fmin, fmax);
    this.win = Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));
    this.re = new Float64Array(n); this.im = new Float64Array(n);
    this.layers = spec.layers.map((l) => ({ W: l.W, b: l.b }));
    this.mean = spec.scaler.mean; this.scale = spec.scaler.scale;
    const post = spec.post || {};
    this.alpha = post.alpha ?? 0.25; this.thr = post.thr ?? 0.55; this.minFrames = post.minFrames ?? 15;
    this.frameS = hop / sr;
    this.reset();
  }

  static async load(url = MODEL_URL) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`no breath model at ${url}`);
    return new BreathModel(await r.json());
  }

  reset() {
    this.buf = new Float64Array(0);
    this.floor = null; this.hist = [];
    this.p = [1, 0, 0]; this.phase = 'rest'; this.cand = null; this.candN = 0;
    this.t = 0; this.phaseStart = 0; this.lastIn = null; this.lastOut = null; this.lastInStart = null; this.period = null;
    this.state = this._state();
  }

  _logmel(frame) {
    const { n, re, im, win } = this;
    for (let i = 0; i < n; i++) { re[i] = frame[i] * win[i]; im[i] = 0; }
    fft(re, im);
    const nb = n / 2 + 1, pw = new Float64Array(nb);
    for (let k = 0; k < nb; k++) pw[k] = re[k] * re[k] + im[k] * im[k];
    return this.fb.map((row) => { let s = 0; for (let k = 0; k < nb; k++) s += row[k] * pw[k]; return Math.log10(s + 1e-10); });
  }

  _features(lm) {
    const { nmel, W, WS } = this;
    if (!this.floor) this.floor = lm.slice();
    else for (let b = 0; b < nmel; b++) this.floor[b] = lm[b] < this.floor[b] ? (1 - this.down) * this.floor[b] + this.down * lm[b] : this.floor[b] + this.up;
    this.hist.push(lm.map((v, b) => v - this.floor[b]));
    if (this.hist.length > W) this.hist.shift();
    if (this.hist.length < W) return null;
    const mean = new Array(nmel).fill(0), std = new Array(nmel).fill(0), last = new Array(nmel).fill(0);
    for (const z of this.hist) for (let b = 0; b < nmel; b++) mean[b] += z[b] / W;
    for (const z of this.hist) for (let b = 0; b < nmel; b++) std[b] += (z[b] - mean[b]) ** 2 / W;
    for (let b = 0; b < nmel; b++) std[b] = Math.sqrt(std[b]);
    for (let j = W - WS; j < W; j++) for (let b = 0; b < nmel; b++) last[b] += this.hist[j][b] / WS;
    const e = this.hist.map((z) => z.reduce((a, v) => a + v, 0) / nmel);
    const em = e.reduce((a, v) => a + v, 0) / W;
    let num = 0, den = 0;
    for (let j = 0; j < W; j++) { const d = j - (W - 1) / 2; num += d * (e[j] - em); den += d * d; }
    let ms = 0, mk = 0;
    for (let b = 0; b < nmel; b++) { const m = Math.max(mean[b], 0); ms += m; mk += b * m; }
    return [...mean, ...std, ...last, num / den, mk / (ms + 1e-6) / nmel];
  }

  _proba(f) {
    let x = f.map((v, i) => (v - this.mean[i]) / this.scale[i]);
    this.layers.forEach((L, li) => {
      const out = L.b.slice();
      for (let i = 0; i < x.length; i++) { const xi = x[i]; if (xi === 0) continue; const row = L.W[i]; for (let j = 0; j < out.length; j++) out[j] += xi * row[j]; }
      x = li < this.layers.length - 1 ? out.map((v) => Math.max(0, v)) : out;
    });
    const mx = Math.max(...x), ex = x.map((v) => Math.exp(v - mx)), s = ex.reduce((a, v) => a + v, 0);
    return ex.map((v) => v / s);
  }

  _track(probs) {
    const dt = this.frameS, names = ['rest', 'in', 'out'];
    this.t += dt;
    this.p = this.p.map((v, i) => (1 - this.alpha) * v + this.alpha * probs[i]);
    let k = 0; for (let i = 1; i < 3; i++) if (this.p[i] > this.p[k]) k = i;
    const name = names[k];
    if (name !== this.phase && this.p[k] >= this.thr) {
      if (this.cand === name) this.candN++; else { this.cand = name; this.candN = 1; }
      if (this.candN >= this.minFrames) {
        const start = this.t - this.candN * dt, dur = start - this.phaseStart;
        if (this.phase === 'in') this.lastIn = dur; else if (this.phase === 'out') this.lastOut = dur;
        if (name === 'in') { if (this.lastInStart != null) this.period = start - this.lastInStart; this.lastInStart = start; }
        this.phase = name; this.phaseStart = start; this.cand = null; this.candN = 0;
      }
    } else { this.cand = null; this.candN = 0; }
    this.state = this._state();
    return this.state;
  }

  _state() {
    return { phase: this.phase, since: this.t - this.phaseStart, lastIn: this.lastIn, lastOut: this.lastOut, period: this.period,
      pRest: this.p[0], pIn: this.p[1], pOut: this.p[2] };
  }

  /** Feed 16 kHz float samples; returns the latest state. `onFrame(probs, state)` is optional (for tests). */
  push(pcm, onFrame) {
    const merged = new Float64Array(this.buf.length + pcm.length);
    merged.set(this.buf); merged.set(pcm, this.buf.length);
    let off = 0;
    while (merged.length - off >= this.n) {
      const lm = this._logmel(merged.subarray(off, off + this.n));
      off += this.hop;
      const f = this._features(lm);
      if (!f) continue;
      const pr = this._proba(f);
      const st = this._track(pr);
      onFrame?.(pr, st);
    }
    this.buf = merged.slice(off);
    return this.state;
  }
}

/** Raw microphone capture at 16 kHz with browser processing off. onAudio(Float32Array) per block. */
export async function openMic16k(onAudio, { deviceId } = {}) {
  const base = { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false };
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { ...base, deviceId: deviceId ? { exact: deviceId } : undefined } });
  } catch (e) {
    // the chosen mic was unplugged: fall back to the default one
    if (!deviceId || (e.name !== 'OverconstrainedError' && e.name !== 'NotFoundError')) throw e;
    stream = await navigator.mediaDevices.getUserMedia({ audio: base });
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  let ctx;
  try { ctx = new AC({ sampleRate: 16000 }); } catch { ctx = new AC(); }
  await ctx.resume();
  const src = ctx.createMediaStreamSource(stream);
  const ratio = ctx.sampleRate / 16000;
  const emit = (block) => {
    if (ratio === 1) return onAudio(block);
    const out = new Float32Array(Math.floor(block.length / ratio));      // simple averaging decimator fallback
    for (let i = 0; i < out.length; i++) { let s = 0, c = 0; for (let j = Math.floor(i * ratio); j < Math.floor((i + 1) * ratio); j++) { s += block[j]; c++; } out[i] = s / Math.max(c, 1); }
    onAudio(out);
  };
  let node;
  if (ctx.audioWorklet) {
    const code = "class C extends AudioWorkletProcessor{process(i){const c=i[0]&&i[0][0];if(c)this.port.postMessage(c.slice(0));return true}}registerProcessor('anasa-cap',C)";
    const url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
    await ctx.audioWorklet.addModule(url);
    node = new AudioWorkletNode(ctx, 'anasa-cap');
    node.port.onmessage = (e) => emit(e.data);
    src.connect(node);
  } else {
    node = ctx.createScriptProcessor(1024, 1, 1);
    node.onaudioprocess = (e) => emit(e.inputBuffer.getChannelData(0).slice(0));
    src.connect(node); node.connect(ctx.destination);
  }
  return {
    ctx, stream, sampleRate: ctx.sampleRate,
    stop() { try { src.disconnect(); node.disconnect(); } catch {} stream.getTracks().forEach((t) => t.stop()); ctx.close().catch(() => {}); },
  };
}
