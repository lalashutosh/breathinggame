// Breath Dive (browser edition): a port of breathdive.py.
// Breathe in and the diver floats up; breathe out and she sinks, trailing bubbles.
// Breath comes from the microphone (BreathFilter port), a held key/button, or a guide pacer.
// A Bluetooth heart-rate sensor adds live bpm / HRV, and a calming heart earns extra.
import { clamp, mixHex, pixelContext, makeSprite, flipH, fillEllipse, ringPixels, rng } from '../../lib/pixel.js';
import { MicBreath, BleHeart, support } from '../../lib/sensors.js';
import { MOODS, MOOD_ORDER, wave } from './moods.js';
import { HeartCalm, CalmAudio } from '../../lib/calm.js';

export const meta = { id: 'breath-dive', title: 'ΑΝΑΣΑ · Retro' };

let W = 320;
const H = 180;
const GOAL_BREATHS = 5; // demo length: about a minute
const SESSION_FLOOR = 55; // seconds: the water reaches its calm end even without perfect breaths
const MAX_BEAUTY = 9;
const STAGES = [
  [0,   'The deep is dark and quiet. Breathe.'],
  [1,   'Sunbeams reach down to you'],
  [2,   'The reef edges begin to glow'],
  [3,   'A school of fish passes by'],
  [4,   'Coral and kelp bloom on the reef'],
  [5,   'Bright reef fish come to say hello'],
  [6,   'Jellyfish drift in the blue'],
  [7.5, 'A sea turtle swims alongside you'],
  [9,   'Golden light. The reef is fully alive'],
];

// ---- sprites ported from breathdive.py
const PAL = { K: '#12121c', B: '#286eeb', b: '#3c96ff', G: '#9698a5', L: '#d7dae4', D: '#555864', O: '#f58728', C: '#378cff', W: '#ffffff' };
const DIVER_ROWS = [
  ['........................KKKK....', '...............DDDDDDD.KKKKKK...', '..............DLLLLLLLDKKOOOOOO.', '..............DGGGGGGGDKOCCCWCO.',
   '..............DGGGGGGGDKOCCCCCO.', '...........KKKKKKKKKKKKKKOOOOOO.', 'bbb...KKKKKKBBBBBBBBBBBKKKKKDD..', '.bbbbKKKKKKKKKKKKKKKKKKKBBKKDDD.',
   '..bbbbKKKKK......KKKKKKKKBBOO...', '......................OO....OO..'],
  ['........................KKKK....', '...............DDDDDDD.KKKKKK...', '..............DLLLLLLLDKKOOOOOO.', '..............DGGGGGGGDKOCCCWCO.',
   '..............DGGGGGGGDKOCCCCCO.', '...........KKKKKKKKKKKKKKOOOOOO.', '......KKKKKKBBBBBBBBBBBKKKKKDD..', '..bbbKKKKKKKKKKKKKKKKKKKBBKKDDD.',
   'bbbbbbKKKKK......KKKKKKKKBBOO...', 'bbb...................OO....OO..'],
];
const FISH_ROWS = ['T..XX..', 'TTXXXX.', 'TXXXXEX', 'TTXXXX.', 'T..XX..'];
const TURTLE_ROWS = [
  ['.....SSSSSS.......', '...SSsSSsSSsS.....', '..SsSSsSSsSSsSHHH.', '.SSSSSSSSSSSSSHHEH', '..SSSSSSSSSSSS.HH.', '.FF.........FF....', 'FF...........FF...'],
  ['.....SSSSSS.......', '...SSsSSsSSsS.....', 'FFSsSSsSSsSSsSHHH.', '.SSSSSSSSSSSSSHHEH', '..SSSSSSSSSSSS.HH.', '..FF........FF....', '..............F...'],
];
const TURTLE_PAL = { S: '#60803c', s: '#a5b955', H: '#7db46e', E: '#0f0f14', F: '#6ea55f' };
const fishSprite = (body) => makeSprite(FISH_ROWS, { X: body, T: mixHex(body, '#000000', 0.35), E: '#0a0a0f' });

const floorY = (x) => 150 + Math.sin(x / 23) * 5 + Math.sin(x / 9 + 1) * 3 + Math.sin(x / 47) * 6;

const SETUP_HTML = `
  <div>
    <h3><span class="bd-brand" lang="el">ΑΝΑΣΑ</span>Retro dive</h3>
    <p>Breathe in and the diver floats up. Breathe out and she sinks, trailing bubbles. The sea starts where you are and settles as you dive; long out-breaths and a calming heart count extra.</p>
    <div class="bd-setup">
      <fieldset>
        <legend>How are you arriving?</legend>
        <div class="bd-moods">
          ${MOOD_ORDER.map((id, i) => `<label class="bd-mood"><input type="radio" name="bd-mood" value="${id}" ${i === 0 ? 'checked' : ''}><i style="--a:${MOODS[id].water[0][1]};--b:${MOODS[id].water[1][2]}"></i><span>${MOODS[id].label}<small>${MOODS[id].sub}</small></span></label>`).join('')}
        </div>
      </fieldset>
      <fieldset>
        <legend>Breath</legend>
        <label><input type="radio" name="bd-breath" value="mic" data-mic-radio> Microphone</label>
        <label><input type="radio" name="bd-breath" value="keys" checked> Hold a key or button</label>
        <label><input type="radio" name="bd-breath" value="guide"> Follow the pacer</label>
        <div class="bd-sub" data-mic-opts hidden>
          <label>Breath sounds
            <select data-scheme>
              <option value="alternate">alternate in / out (nose in, mouth out)</option>
              <option value="exhale">only the out-breath is audible</option>
            </select>
          </label>
          <span class="bd-status" data-mic-status>Stay quiet for 3 s after starting so it can hear the room.</span>
        </div>
      </fieldset>
      <fieldset>
        <legend>Heart rate <small style="font-family:var(--font-body);font-size:12px;color:#7fa6c1">optional</small></legend>
        <div class="bd-sub" style="margin-top:0">
          <button type="button" class="bd-small" data-hr-connect>Connect Bluetooth sensor</button>
          <span class="bd-status" data-hr-status>Polar, Wahoo, Garmin (broadcast), Coospo and any standard strap or armband.</span>
        </div>
      </fieldset>
    </div>
    <button class="btn btn-primary" data-start type="button">Start the dive</button>
    <p class="keys"><kbd>SPACE</kbd> breathe (keys) · <kbd>P</kbd> flip in/out (mic) · <kbd>G</kbd> pacer ring · <kbd>F</kbd> fullscreen</p>
  </div>`;

export function mount(container, { onComplete, onExit } = {}) {
  container.innerHTML = `
    <div class="bd is-full">
      <div class="bd-stage" tabindex="0" aria-label="Anasa, retro mode">
        <canvas></canvas>
        <div class="bd-hud">
          <div class="tl">Breath <span data-n>0</span> / ${GOAL_BREATHS}<small data-rate>&nbsp;</small></div>
          <div class="meter" data-meter hidden><i></i></div>
          <div class="tr" data-help>hold <b>SPACE</b> · breathe in<br>let go · breathe out</div>
          <div class="vitals" data-vitals hidden></div>
          <div class="src" data-src></div>
          <div class="flash" data-flash></div>
          <div class="cap" data-cap></div>
        </div>
        <div class="bd-intro">${SETUP_HTML}</div>
      </div>
      <div class="bd-controls">
        <button class="bd-hold" type="button" data-hold>Hold to breathe in</button>
        <button class="bd-small" type="button" data-flip hidden>Flip in / out</button>
        <button class="bd-small" type="button" data-pacer aria-pressed="true">Pacer ring</button>
        <button class="bd-small" type="button" data-sound aria-pressed="true">Sound on</button>
        <button class="bd-small" type="button" data-fs>Fullscreen</button>
        <button class="bd-small" type="button" data-quit>Leave the dive</button>
      </div>
      <p class="bd-note">The desktop version (<code>python3 breathdive.py</code>) adds your trained microphone filter, a Wi-Fi lamp and session logs.</p>
    </div>`;

  const q = (sel) => container.querySelector(sel);
  const rootEl = q('.bd'), stageEl = q('.bd-stage'), canvas = q('canvas');
  let ctx;
  const fit = () => {
    const r = stageEl.getBoundingClientRect();
    const nw = clamp(Math.round((H * (r.width || 16)) / (r.height || 9)), 240, 480);
    if (nw !== W || !ctx) { W = nw; ctx = pixelContext(canvas, W, H); }
  };
  W = 320; fit();
  const ro = new ResizeObserver(fit); ro.observe(stageEl);
  const toggleFs = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else rootEl.requestFullscreen?.().catch(() => {});
  };
  const els = {
    n: q('[data-n]'), rate: q('[data-rate]'), cap: q('[data-cap]'), flash: q('[data-flash]'), help: q('[data-help]'),
    vitals: q('[data-vitals]'), src: q('[data-src]'), meter: q('[data-meter]'), intro: q('.bd-intro'),
    hold: q('[data-hold]'), flip: q('[data-flip]'), pacer: q('[data-pacer]'),
    micOpts: q('[data-mic-opts]'), micStatus: q('[data-mic-status]'), scheme: q('[data-scheme]'),
    hrBtn: q('[data-hr-connect]'), hrStatus: q('[data-hr-status]'), start: q('[data-start]'), fs: q('[data-fs]'),
  };

  // ---- sprites & scenery
  const diverFrames = DIVER_ROWS.map((r) => makeSprite(r, PAL));
  const turtleFrames = TURTLE_ROWS.map((r) => makeSprite(r, TURTLE_PAL));
  const schoolFish = fishSprite('#7fd6ff');
  const reefFish = ['#ffb03a', '#ff6a6a', '#ffe066', '#7cf5d2', '#c07cff'].map((c, i) => ({ r: fishSprite(c), l: flipH(fishSprite(c)), x: 60 + i * 55, dir: i % 2 ? 1 : -1, ph: i * 1.7, sp: 6 + i * 1.5 }));
  const seed = rng(99);
  const school = Array.from({ length: 10 }, (_, i) => ({ ox: (i % 5) * 11 + Math.floor(seed() * 6), oy: Math.floor(i / 5) * 8 + Math.floor(seed() * 5), ph: seed() * 6.28 }));
  const snow = Array.from({ length: 55 }, () => ({ x: seed() * W, y: seed() * H, v: 2 + seed() * 4 }));
  const jellies = [0, 1, 2].map((i) => ({ x: 70 + i * 90, ph: i * 2.1 }));
  const kelp = [40, 55, 150, 165, 300, 420, 435, 600].map((x, i) => ({ x, h: 26 + (i * 7) % 20, ph: i }));
  const corals = [110, 260, 380, 520].map((x, i) => ({ x, seed: i + 1 }));
  const boulders = [80, 210, 330, 470, 560].map((x, i) => ({ x, r: 7 + (i * 3) % 7 }));

  // ---- state
  let audio = null;
  const calm = new HeartCalm({
    onCalm: ({ drop }) => {
      // reward only: warm light, a ripple from the diver, sparkles, a chime, and a little more life
      S.calmFx = 1;
      S.calmRings.push({ r: 4, a: 1 }, { r: -10, a: 1 });
      for (let i = 0; i < 40; i++) S.sparkles.push({ x: S.diver.x + 16 + (Math.random() - 0.5) * 60, y: S.diver.y + (Math.random() - 0.5) * 40, life: 1.2 + Math.random() * 1.5 });
      S.beauty = Math.min(MAX_BEAUTY, S.beauty + 0.6);
      flash(drop >= 4 ? 'your heart is settling deeper' : 'your heart is settling');
      audio?.calmChime();
    },
  });
  const mic = new MicBreath({ scheme: els.scheme.value });
  const heart = new BleHeart();
  const S = {
    started: false, finished: false, done: false, breathMode: 'keys',
    mood: 'dive', M: MOODS.dive, p: 0, e: 0, playT: 0,
    worldPhase: 0, worldP: MOODS.dive.period[0], worldVal: 0, rising: true, firstRate: null, stageName: 'Mirror',
    rain: [], glows: [], calmFx: 0, calmRings: [],
    inhaling: false, pacer: true,
    lung: 0.3, phase: 'rest', level: 0, t: 0, cam: 0,
    beauty: 0, light: 0, stage: 0, unlock: [0],
    counter: { phase: 'rest', since: 0, inDur: 0, count: 0, ends: [], slowest: 0 },
    diver: { x: 92, y: 110, vy: 0, kick: 0, bubbles: [], acc: 0 },
    hrHist: [], baseline: null, baselineBuf: [], startHr: null, lastHr: null, calmBreaths: 0,
    sparkles: [], doneAt: null, capUntil: 0, flashUntil: 0, raf: 0, last: performance.now(),
  };
  const reveal = (i) => (S.unlock[i] == null ? 0 : clamp((S.t - S.unlock[i]) / 1.6));
  const V = (k) => { const a = S.M[k]; return a[0] + (a[1] - a[0]) * S.e; };
  const C = (k) => mixHex(S.M[k][0], S.M[k][1], S.e);
  const life = () => V('life');
  const setCaption = (text) => { els.cap.textContent = text; els.cap.classList.remove('is-dim'); S.capUntil = S.t + 4.5; };
  const flash = (text) => { els.flash.textContent = text; els.flash.classList.add('is-on'); S.flashUntil = S.t + 2.2; };
  const setStatus = (el, text, cls) => { el.textContent = text; el.className = 'bd-status' + (cls ? ` is-${cls}` : ''); };

  // ---- setup screen
  if (!support.mic) { q('[data-mic-radio]').disabled = true; setStatus(els.micStatus, support.secure ? 'This browser cannot use the microphone.' : 'Microphone needs https or localhost.', 'err'); els.micOpts.hidden = false; }
  if (!support.bluetooth) { els.hrBtn.disabled = true; setStatus(els.hrStatus, support.secure ? 'Web Bluetooth needs Chrome or Edge (desktop or Android).' : 'Bluetooth needs https or localhost.', 'err'); }
  container.querySelectorAll('input[name="bd-breath"]').forEach((r) => r.addEventListener('change', () => { els.micOpts.hidden = r.value !== 'mic' && support.mic; }));
  els.scheme.addEventListener('change', () => { mic.scheme = els.scheme.value; });
  container.querySelectorAll('input[name="bd-mood"]').forEach((r) => r.addEventListener('change', () => { S.M = MOODS[r.value]; S.mood = r.value; S.worldP = S.M.period[0]; }));
  els.fs.addEventListener('click', toggleFs);
  const sndBtn = q('[data-sound]');
  sndBtn.addEventListener('click', () => { const on = sndBtn.getAttribute('aria-pressed') !== 'true'; sndBtn.setAttribute('aria-pressed', String(on)); sndBtn.textContent = on ? 'Sound on' : 'Sound off'; audio?.setEnabled(on); });
  heart.onChange = () => {
    setStatus(els.hrStatus, heart.connected ? `connected: ${heart.status}` : heart.status, heart.connected ? 'ok' : heart.status.startsWith('lost') ? 'err' : '');
    if (heart.connected) els.hrBtn.textContent = 'Connected';
  };
  els.hrBtn.addEventListener('click', async () => {
    try { els.hrBtn.disabled = true; await heart.connect(); }
    catch (e) { setStatus(els.hrStatus, e.name === 'NotFoundError' ? 'No sensor chosen. Is it on and broadcasting?' : e.message, 'err'); }
    finally { els.hrBtn.disabled = heart.connected; }
  });
  els.start.addEventListener('click', async () => {
    const mode = container.querySelector('input[name="bd-breath"]:checked').value;
    if (mode === 'mic') {
      try { els.start.disabled = true; setStatus(els.micStatus, 'asking for the microphone...'); await mic.start(); }
      catch (e) { setStatus(els.micStatus, e.name === 'NotAllowedError' ? 'Microphone permission was refused.' : e.message, 'err'); els.start.disabled = false; return; }
    }
    S.mood = container.querySelector('input[name="bd-mood"]:checked').value;
    S.M = MOODS[S.mood];
    S.worldP = S.M.period[0];
    S.breathMode = mode; S.started = true;
    audio = new CalmAudio({ root: 130.81 }); audio.resume();
    els.intro.remove();
    rootEl.requestFullscreen?.().catch(() => {});
    stageEl.focus();
    setCaption(S.M.intro);
    els.hold.hidden = mode !== 'keys';
    els.flip.hidden = mode !== 'mic';
    els.meter.hidden = mode !== 'mic';
    els.help.innerHTML = mode === 'keys' ? 'hold <b>SPACE</b> · breathe in<br>let go · breathe out' : mode === 'mic' ? 'breathe so the mic can hear you<br><b>P</b> if in / out get swapped' : 'follow the ring<br>in 4 s · out 6 s';
  });

  // ---- input
  const setInhale = (v) => { if (!S.started || S.finished || S.breathMode !== 'keys') return; S.inhaling = v; els.hold.classList.toggle('is-down', v); };
  const onKeyDown = (e) => {
    if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) setInhale(true); }
    else if (e.code === 'KeyP' && S.breathMode === 'mic') mic.flip();
    else if (e.code === 'KeyG') togglePacer();
    else if (e.code === 'KeyF') toggleFs();
  };
  const onKeyUp = (e) => { if (e.code === 'Space') { e.preventDefault(); setInhale(false); } };
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  const press = (el) => {
    el.addEventListener('pointerdown', (e) => { if (S.breathMode !== 'keys') return; e.preventDefault(); el.setPointerCapture?.(e.pointerId); setInhale(true); });
    const up = () => setInhale(false);
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  };
  press(els.hold); press(canvas);
  const togglePacer = () => { S.pacer = !S.pacer; els.pacer.setAttribute('aria-pressed', String(S.pacer)); };
  els.pacer.addEventListener('click', togglePacer);
  els.flip.addEventListener('click', () => mic.flip());
  q('[data-quit]').addEventListener('click', () => onExit && onExit());

  // ---- breath counting (port of BreathCounter)
  function countBreath(phase, t) {
    const c = S.counter;
    if (phase === c.phase) return null;
    const dur = t - c.since;
    let result = null;
    if (c.phase === 'in') c.inDur = dur;
    else if (c.phase === 'out' && c.inDur > 0.6 && dur > 0.8) {
      c.count++; c.ends.push(t); if (c.ends.length > 6) c.ends.shift();
      result = [c.inDur, dur]; c.inDur = 0;
    }
    c.phase = phase; c.since = t;
    return result;
  }
  const breathRate = () => { const e = S.counter.ends; return e.length < 2 ? null : (60 * (e.length - 1)) / (e[e.length - 1] - e[0]); };
  const avgHr = () => (S.hrHist.length ? S.hrHist.reduce((a, b) => a + b[1], 0) / S.hrHist.length : null);

  function onBreath([inDur, outDur]) {
    let gain = 1; const notes = [];
    if (outDur >= inDur) { gain += 0.4; notes.push('long exhale'); }
    if (inDur + outDur >= 7) { gain += 0.4; notes.push('slow'); }
    if (S.baseline && S.hrHist.length && avgHr() < S.baseline - 2) { gain *= 1.25; notes.push('heart calming'); S.calmBreaths++; }
    S.beauty = Math.min(MAX_BEAUTY, S.beauty + gain);
    S.counter.slowest = Math.max(S.counter.slowest, inDur + outDur);
    flash(`+${gain.toFixed(1)}${notes.length ? '  ·  ' + notes.join(' · ') : ''}`);
    while (S.stage + 1 < STAGES.length && S.beauty >= STAGES[S.stage + 1][0]) { S.stage++; S.unlock[S.stage] = S.t; if ((['dive', 'low', 'anxious'].includes(S.mood) && life() > 0.25) || S.stage === STAGES.length - 1) setCaption(S.stage === STAGES.length - 1 ? S.M.arrive : STAGES[S.stage][1]); }
    els.n.textContent = String(S.counter.count);
    const r = breathRate();
    if (r && S.firstRate == null) S.firstRate = r;
    els.rate.textContent = r ? `${r.toFixed(1)} breaths / min` : ' ';
    if (!S.finished && (S.counter.count >= GOAL_BREATHS || S.beauty >= MAX_BEAUTY)) { S.finished = true; S.doneAt = S.t + 2.6; }
  }

  // ---- update
  function update(dt) {
    S.t += dt; S.cam += dt * 5;
    const now = S.t;
    // session progress: breaths drive it, a slow time floor guarantees the calm end, finishing arrives
    if (S.started) {
      S.playT += dt;
      const target = S.finished ? 1 : Math.max(S.beauty / MAX_BEAUTY, S.playT / SESSION_FLOOR);
      S.p += (Math.min(1, target) - S.p) * Math.min(1, dt * (S.finished ? 0.6 : 0.35));
    }
    S.e = S.p * S.p * (3 - 2 * S.p);
    // demo: every dive ends within about a minute and a quarter, however the breathing went
    if (S.started && !S.finished && S.playT > 75) { S.finished = true; S.doneAt = S.t + 2.6; }
    // hidden world rhythm: mirror the player's own pace first, then lead toward the mood's calm pace
    const measured = breathRate();
    let targetP;
    if (S.started && S.playT < 20) { targetP = measured ? clamp(60 / measured, 2.5, 12) : S.M.period[0]; S.stageName = 'Mirror'; }
    else { targetP = S.M.period[0] + (S.M.period[1] - S.M.period[0]) * Math.min(1, S.e * 1.15); S.stageName = 'Lead'; }
    S.worldP += (targetP - S.worldP) * Math.min(1, dt * 0.4);
    S.worldPhase = (S.worldPhase + dt / S.worldP) % 1;
    S.worldVal = wave(S.worldPhase);
    const wasRising = S.rising;
    S.rising = S.worldPhase < 0.4;
    if (S.started && !S.finished && audio) {
      if (S.rising && !wasRising) audio.inhale(0.4 * S.worldP);
      else if (!S.rising && wasRising) audio.exhale(0.6 * S.worldP);
    }
    const pacerV = S.worldVal;

    if (S.started && !S.finished) {
      let phase, level;
      if (S.breathMode === 'guide') {
        phase = S.rising ? 'in' : 'out'; level = 0.6; S.lung = pacerV;
      } else {
        if (S.breathMode === 'mic') { phase = mic.phase; level = mic.level; }
        else {
          const c = S.counter;
          phase = S.inhaling ? 'in' : (c.phase === 'in' || (c.phase === 'out' && now - c.since < 8 && S.lung > 0.02)) ? 'out' : 'rest';
          level = phase !== 'rest' ? 0.6 : 0;
        }
        const drive = Math.max(0.35, level);
        if (phase === 'in') S.lung += dt * (0.12 + 0.3 * drive);
        else if (phase === 'out') S.lung -= dt * (0.08 + 0.22 * drive);
        S.lung = clamp(S.lung);
      }
      S.phase = phase; S.level = level;
      const res = countBreath(phase, now);
      if (res) onBreath(res);
    } else if (S.finished) {
      S.lung = Math.max(0, S.lung - dt * 0.15); S.phase = S.lung > 0.02 ? 'out' : 'rest';
    }

    // heart
    const hr = heart.bpm;
    if (hr && S.started) calm.push(hr, performance.now() / 1000); // heart runs on real time
    S.calmFx = Math.max(0, S.calmFx - dt / 5);
    for (const r of S.calmRings) { r.r += dt * 45; r.a -= dt * 0.45; }
    S.calmRings = S.calmRings.filter((r) => r.a > 0 && r.r < W);
    if (hr) {
      S.hrHist.push([now, hr]); S.lastHr = hr; if (S.startHr == null) S.startHr = hr;
      if (S.baseline == null) { S.baselineBuf.push([now, hr]); if (now - S.baselineBuf[0][0] > 20) S.baseline = S.baselineBuf.reduce((a, b) => a + b[1], 0) / S.baselineBuf.length; }
    }
    while (S.hrHist.length && now - S.hrHist[0][0] > 10) S.hrHist.shift();

    S.light += (S.beauty / MAX_BEAUTY - S.light) * Math.min(1, dt * 0.8);
    if (S.capUntil && now > S.capUntil) { els.cap.classList.add('is-dim'); S.capUntil = 0; }
    if (S.flashUntil && now > S.flashUntil) { els.flash.classList.remove('is-on'); S.flashUntil = 0; }

    // diver (port of Diver.update)
    const d = S.diver;
    const target = 138 - S.lung * 82 + Math.sin(now * 0.9) * 2, prev = d.y;
    d.y += (target - d.y) * Math.min(1, dt * 2.5);
    d.vy = (d.y - prev) / Math.max(dt, 1e-3);
    const surge = V('surge');
    d.x = 92 + Math.sin(now * 0.3) * 6 + Math.sin(now * 0.9) * 7 * surge;
    d.kick += dt * (2.2 + Math.abs(d.vy) * 0.08);
    if (S.phase === 'out') {
      d.acc += dt * (5 + 12 * Math.max(S.level, 0.3));
      while (d.acc > 1) { d.acc -= 1; d.bubbles.push({ x: d.x + 29, y: d.y - 2, r: [1, 1, 2, 2, 3][Math.floor(Math.random() * 5)], ph: Math.random() * 6.28 }); }
    }
    for (const b of d.bubbles) { b.y -= (14 + b.r * 6) * dt; b.x += Math.sin(now * 4 + b.ph) * 6 * dt; }
    d.bubbles = d.bubbles.filter((b) => b.y > 4);
    const drift = S.rising ? -0.6 : 0.4; // motes lift on the in-phase, settle on the out-phase
    for (const s of snow) {
      s.y += (s.v * (0.6 + drift * 0.5) + drift * 3) * dt;
      s.x -= dt * (2 + 26 * surge * (0.6 + 0.4 * Math.sin(now * 0.8 + s.v)));
      if (s.y > H) { s.y = -2; s.x = Math.random() * W; } if (s.y < -3) s.y = H;
      if (s.x < 0) s.x += W; if (s.x > W) s.x -= W;
    }
    // rain dimples on a stormy surface
    if (Math.random() < dt * 40 * V('rain')) S.rain.push({ x: Math.random() * W, life: 1 });
    for (const r of S.rain) r.life -= dt * 2.2;
    S.rain = S.rain.filter((r) => r.life > 0);
    // bioluminescent plankton (night)
    const g = V('glow');
    if (Math.random() < dt * 30 * g) S.glows.push({ x: Math.random() * W, y: 20 + Math.random() * (H - 50), life: 1.5 + Math.random() * 2, ph: Math.random() * 6.28 });
    for (const p of S.glows) { p.life -= dt; p.y -= dt * 1.5; }
    S.glows = S.glows.filter((p) => p.life > 0);
    for (const f of reefFish) { f.x += f.dir * f.sp * dt; if (f.x > W + 10) f.dir = -1; if (f.x < -10) f.dir = 1; }
    if (S.stage >= 8 && Math.random() < dt * 8) S.sparkles.push({ x: Math.random() * W, y: H - 20 - Math.random() * 100, life: 1 + Math.random() });
    for (const s of S.sparkles) { s.y -= 8 * dt; s.life -= dt; }
    S.sparkles = S.sparkles.filter((s) => s.life > 0);

    if (S.finished && !S.done && now > S.doneAt) { S.done = true; showDone(); }
  }

  // ---- HUD (DOM, a few times a second)
  let hudAt = 0;
  function hud() {
    if (S.t - hudAt < 0.2) return;
    hudAt = S.t;
    const parts = [];
    if (S.breathMode === 'mic') parts.push(mic.ready ? `breath: ${mic.status}` : `breath: ${mic.status}`);
    else parts.push(S.breathMode === 'keys' ? 'breath: keys' : 'breath: guided');
    if (heart.connected || heart.status.startsWith('lost')) parts.push(`heart: ${heart.status}`);
    els.src.textContent = parts.join('   ·   ');
    if (S.breathMode === 'mic') els.meter.firstElementChild.style.width = `${Math.round(mic.level * 100)}%`;
    const hr = heart.bpm, rmssd = heart.rmssd();
    if (hr || heart.connected) {
      els.vitals.hidden = false;
      const avg = avgHr();
      const d = S.baseline && avg != null ? avg - S.baseline : null;
      els.vitals.innerHTML = `<span class="bpm"><i class="hrt" style="--beat:${hr ? (60 / hr).toFixed(2) : 1}s"></i>${hr ? hr + ' bpm' : '-- bpm'}</span><br>`
        + `HRV ${rmssd ? rmssd.toFixed(0) + ' ms' : '-- ms'}`
        + (d != null ? ` · <span class="${d < 0 ? 'calm' : 'warm'}">${d >= 0 ? '+' : ''}${d.toFixed(0)} vs start</span>` : S.baseline ? '' : ' · finding your resting rate…');
    }
  }

  // ---- draw
  function draw() {
    const t = S.t, L = S.e, wv = S.worldVal, lf = life();
    ctx.clearRect(0, 0, W, H);
    const [w0, w1] = S.M.water;
    const bandH = Math.ceil(H / w0.length);
    w0.forEach((c, i) => { ctx.fillStyle = mixHex(c, w1[i], L); ctx.fillRect(0, i * bandH, W, bandH); });
    // sun / moon glow seen through the surface
    const sun = V('sun'), moon = V('moon');
    if (sun > 0.01) { ctx.globalAlpha = Math.min(1, sun) * (0.35 + 0.15 * wv); fillEllipse(ctx, Math.round(W * 0.7), -6, 60, 26, '#ffd9a0'); fillEllipse(ctx, Math.round(W * 0.7), -8, 30, 14, '#fff3d6'); ctx.globalAlpha = 1; }
    if (moon > 0.01) { ctx.globalAlpha = moon * 0.35; fillEllipse(ctx, Math.round(W * 0.25), -4, 34, 14, '#c9d6ff'); fillEllipse(ctx, Math.round(W * 0.25), -6, 14, 7, '#eef2ff'); ctx.globalAlpha = 1; }
    // the surface: choppy in a storm, glassy when calm
    const chop = V('surge');
    ctx.fillStyle = 'rgba(220,240,255,0.18)';
    for (let x = 0; x < W; x++) { const y = 3 + Math.round(Math.sin(x / (6 - 3 * chop) + t * (1 + 3 * chop)) * (0.5 + 2.5 * chop) + Math.sin(x / 17 - t * 0.7) * chop * 2); ctx.fillRect(x, Math.max(0, y), 1, 1); }
    for (const r of S.rain) { ctx.fillStyle = `rgba(230,245,255,${0.5 * r.life})`; const rr = Math.round((1 - r.life) * 5); ctx.fillRect(Math.round(r.x) - rr, 4, rr * 2 + 1, 1); ctx.fillRect(Math.round(r.x), 5 + Math.round((1 - r.life) * 10), 1, 2); }

    const sb = Math.max(reveal(1), S.mood === 'dive' ? 0 : 1) * V('beams');
    if (sb > 0.01) {
      // light swells on the in-phase, softens on the out-phase
      ctx.globalAlpha = Math.min(1, sb) * (0.05 + 0.09 * L) * (0.75 + 0.5 * wv); ctx.fillStyle = C('beamCol');
      for (let i = 0; i < Math.ceil(W / 62); i++) {
        const x0 = 40 + i * 62 + Math.sin(t * 0.25 + i) * 10, w = 8 + (i % 3) * 4, drift = 30 + Math.sin(t * 0.2 + i * 2) * 20;
        ctx.beginPath(); ctx.moveTo(x0, 0); ctx.lineTo(x0 + w, 0); ctx.lineTo(x0 + w * 3 + drift, H); ctx.lineTo(x0 - w + drift, H); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    const siltN = Math.round(snow.length * Math.min(1, V('silt') / 3.2) * 1), siltBig = V('silt') > 1.4;
    ctx.fillStyle = `rgba(200,230,255,${0.25 + L * 0.35})`;
    for (let i = 0; i < snow.length; i++) {
      const s = snow[i];
      ctx.fillRect(Math.round(s.x), Math.round(s.y), 1, 1);
      if (V('silt') > 1 && i < siltN) { ctx.fillRect(Math.round((s.x * 1.7 + 50) % W), Math.round((s.y * 1.3 + 30) % H), siltBig ? 2 : 1, 1); }
    }

    const sf = reveal(3) * lf;
    if (sf > 0) {
      const cx = ((t * 18) % (W + 160)) - 80, cy = 62 + Math.sin(t * 0.6) * 12;
      ctx.globalAlpha = sf;
      for (const f of school) ctx.drawImage(schoolFish, Math.round(cx + f.ox + Math.sin(t * 3 + f.ph) * 2), Math.round(cy + f.oy + Math.sin(t * 2 + f.ph) * 3));
      ctx.globalAlpha = 1;
    }
    const jf = Math.max(reveal(6) * lf, V('glow') * 0.6);
    if (jf > 0) for (const j of jellies) {
      const y = 150 - ((t * 6 + j.ph * 20) % 150), x = j.x + Math.sin(t * 0.7 + j.ph) * 12, pulse = Math.sin(t * 2.2 + j.ph);
      ctx.globalAlpha = jf * 0.75;
      fillEllipse(ctx, x, y, 6 + Math.round(pulse), 4, '#ff9ed9'); fillEllipse(ctx, x, y - 1, 3, 2, '#ffe3f6');
      ctx.fillStyle = '#ffb8e6';
      for (let k = -3; k <= 3; k += 2) for (let s = 1; s < 13; s++) ctx.fillRect(Math.round(x + k + Math.sin(t * 3 + s / 2.5 + k) * (s / 5)), Math.round(y + 3 + s), 1, 1);
      ctx.globalAlpha = 1;
    }

    const rim = reveal(2);
    const body = mixHex('#0d1d30', '#1c3a52', L), rimC = mixHex('#1b3a55', '#5ff0d8', rim * (0.6 + 0.4 * Math.abs(Math.sin(t * 1.5))));
    for (let sx = 0; sx < W; sx++) {
      const y = Math.round(floorY(sx + S.cam));
      ctx.fillStyle = body; ctx.fillRect(sx, y, 1, H - y);
      ctx.fillStyle = rimC; ctx.fillRect(sx, y, 1, 1);
    }
    const PERIOD = 640;
    const worldToScreen = (x) => { let sx = (x - S.cam) % PERIOD; if (sx < -PERIOD / 2) sx += PERIOD; if (sx < -60) sx += PERIOD; return sx; };
    for (const b of boulders) {
      const sx = worldToScreen(b.x); if (sx < -20 || sx > W + 20) continue;
      const fy = floorY(sx + S.cam);
      fillEllipse(ctx, sx, fy + 1, b.r, Math.round(b.r * 0.6), mixHex('#13263b', '#2d5273', L));
      fillEllipse(ctx, sx - 2, fy - 2, Math.round(b.r * 0.5), 2, mixHex('#1b3450', '#4a7ba3', L));
    }
    const ck = reveal(4) * Math.max(lf, 0.35);
    if (ck > 0) {
      ctx.globalAlpha = ck;
      for (const c of corals) {
        const sx = worldToScreen(c.x); if (sx < -20 || sx > W + 20) continue;
        const fy = floorY(sx + S.cam), r = rng(c.seed), cols = ['#ff7f7f', '#ff9f5a', '#ff6fa3', '#c77dff', '#ffd26b'];
        for (let i = 0; i < 4; i++) { const rr = 3 + Math.floor(r() * 4), ox = Math.floor(r() * 16) - 8; fillEllipse(ctx, sx + ox, fy - rr + 1, rr, rr, cols[(c.seed + i) % cols.length]); fillEllipse(ctx, sx + ox - 1, fy - rr, 1, 1, '#fff0f0'); }
        ctx.fillStyle = '#ff9f5a'; for (let i = 0; i < 5; i++) ctx.fillRect(sx + 10 + i * 2, fy - 8 + Math.abs(i - 2) * 2, 1, 8 - Math.abs(i - 2) * 2);
      }
      for (const k of kelp) {
        const sx = worldToScreen(k.x); if (sx < -10 || sx > W + 10) continue;
        const fy = Math.round(floorY(sx + S.cam));
        for (let i = 0; i < k.h; i++) {
          const y = fy - i, off = Math.round((Math.sin(t * 1.5 + i / 7 + k.ph) * 3 + Math.sin(t * 0.9 + k.ph) * 5 * chop + (wv - 0.5) * 2) * (i / k.h));
          ctx.fillStyle = i % 2 ? '#2d8a5a' : '#3fb978'; ctx.fillRect(sx + off, y, 1, 1);
          if (i % 6 === 3) { ctx.fillStyle = '#4fd08a'; ctx.fillRect(sx + off + (i % 12 === 3 ? 1 : -2), y, 2, 1); }
        }
      }
      ctx.globalAlpha = 1;
    }
    const rf = reveal(5) * lf;
    if (rf > 0) {
      ctx.globalAlpha = rf;
      for (const f of reefFish) { const y = floorY(f.x + S.cam) - 14 - Math.sin(t * 1.3 + f.ph) * 5; ctx.drawImage(f.dir > 0 ? f.r : f.l, Math.round(f.x), Math.round(y)); }
      ctx.globalAlpha = 1;
    }
    const tu = reveal(7);
    if (tu > 0 && lf > 0.3) ctx.drawImage(turtleFrames[Math.floor(t * 2) % 2], Math.round(26 + Math.sin(t * 0.4) * 10 - (1 - tu) * 70), Math.round(S.diver.y + 22 + Math.sin(t * 0.8) * 4));

    const d = S.diver, img = diverFrames[Math.floor(d.kick) % 2], ang = clamp(-d.vy * 0.9, -14, 14);
    ctx.save();
    ctx.translate(Math.round(d.x + 16), Math.round(d.y + 5));
    if (Math.abs(ang) > 1) ctx.rotate((-ang * Math.PI) / 180);
    ctx.drawImage(img, -16, -5);
    ctx.restore();
    for (const b of d.bubbles) {
      const x = Math.round(b.x), y = Math.round(b.y);
      if (b.r === 1) { ctx.fillStyle = '#bee6ff'; ctx.fillRect(x, y, 1, 1); }
      else { fillEllipse(ctx, x, y, b.r, b.r, '#c8ebff'); fillEllipse(ctx, x, y, b.r - 1, b.r - 1, '#468cf5'); ctx.fillStyle = '#fff'; ctx.fillRect(x - 1, y - 1, 1, 1); }
    }

    // bioluminescent plankton
    for (const p of S.glows) {
      const a = Math.min(1, p.life) * (0.5 + 0.5 * Math.sin(t * 2 + p.ph)) * 0.8;
      ctx.fillStyle = `rgba(120,255,230,${a})`; ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
      ctx.fillStyle = `rgba(120,255,230,${a * 0.25})`; ctx.fillRect(Math.round(p.x) - 1, Math.round(p.y), 3, 1); ctx.fillRect(Math.round(p.x), Math.round(p.y) - 1, 1, 3);
    }
    // turbidity (silt, storm murk) then depth darkness
    const murk = V('murk');
    if (murk > 0.005) { ctx.globalAlpha = murk; ctx.fillStyle = S.M.murkCol; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
    ctx.fillStyle = `rgba(2,8,20,${V('dark')})`; ctx.fillRect(0, 0, W, H);
    const gl = reveal(8);
    if (gl > 0 && sun + (S.mood === 'dive' ? 1 : 0) > 0.3) { ctx.fillStyle = `rgba(255,205,110,${0.14 * gl})`; ctx.fillRect(0, 0, W, H); }
    for (const s of S.sparkles) { ctx.fillStyle = s.life > 0.5 ? '#fff6c8' : '#ffd36a'; ctx.fillRect(Math.round(s.x), Math.round(s.y), 1, 1); }

    // heart-calm reward: warm wash and golden ripples from the diver
    if (S.calmFx > 0) { ctx.fillStyle = `rgba(255,214,140,${0.16 * S.calmFx})`; ctx.fillRect(0, 0, W, H); }
    for (const r of S.calmRings) {
      if (r.r <= 0) continue;
      ctx.fillStyle = `rgba(255,226,150,${0.55 * r.a})`;
      for (const [x, y] of ringPixels(Math.round(S.diver.x + 16), Math.round(S.diver.y + 5), Math.round(r.r))) ctx.fillRect(x, y, 1, 1);
    }

    // lung bar + pacer ring
    if (S.started) {
      ctx.fillStyle = 'rgba(0,20,40,0.5)'; ctx.fillRect(10, 164, 62, 6);
      ctx.fillStyle = '#ffc86e'; ctx.fillRect(11, 165, Math.round(60 * S.lung), 4);
    }
    if (S.pacer && S.started) {
      const r = Math.round(6 + 9 * wv);
      ctx.fillStyle = 'rgba(110,230,235,0.7)';
      for (const [x, y] of ringPixels(W - 28, 150, r)) ctx.fillRect(x, y, 1, 1);
      ctx.fillStyle = S.phase === 'in' ? '#bfffff' : S.phase === 'out' ? '#6ee6eb' : '#3d8a90';
      ctx.fillRect(W - 29, 149, 3, 3);
    }
  }

  function showDone() {
    const c = S.counter;
    const hrLine = S.startHr && S.lastHr ? `<div><b>${S.startHr} → ${S.lastHr}</b>bpm</div>` : '';
    const rmssd = heart.rmssd();
    const done = document.createElement('div');
    done.className = 'bd-done';
    done.innerHTML = `
      <div>
        <h3>Dive complete</h3>
        <p>${S.M.arrive}</p>
        <div class="stats">
          <div><b>${c.count}</b>breaths</div>
          ${S.firstRate && breathRate() ? `<div><b>${S.firstRate.toFixed(0)} → ${breathRate().toFixed(0)}</b>breaths / min</div>` : ''}
          <div><b>${c.slowest ? c.slowest.toFixed(1) + 's' : '–'}</b>slowest breath</div>
          <div><b>${S.stage + 1}/${STAGES.length}</b>reef awake</div>
          ${hrLine}${rmssd ? `<div><b>${rmssd.toFixed(0)} ms</b>HRV</div>` : ''}
        </div>
        <p class="bd-step">${S.M.step}</p>
        <button class="btn btn-primary" type="button" data-collect>Collect your sapling</button>
      </div>`;
    stageEl.appendChild(done);
    done.querySelector('[data-collect]').focus();
    done.querySelector('[data-collect]').addEventListener('click', () => {
      onComplete && onComplete({
        gameId: meta.id, mood: S.mood, breaths: c.count, slowestBreath: c.slowest, stage: S.stage + 1, stages: STAGES.length,
        breathSource: S.breathMode, heart: S.startHr ? { start: S.startHr, end: S.lastHr, rmssd, calmBreaths: S.calmBreaths, sensor: heart.name } : null,
      });
    }, { once: true });
  }

  function frame(now) {
    const dt = clamp((now - S.last) / 1000, 0, 0.05);
    S.last = now;
    if (S.breathMode === 'mic') mic.poll(now);
    update(dt); draw(); if (S.started) hud();
    S.raf = requestAnimationFrame(frame);
  }
  S.raf = requestAnimationFrame(frame);
  if (location.search.includes('debug')) window.__bd = { S, mic, heart };

  return {
    unmount() {
      cancelAnimationFrame(S.raf);
      ro.disconnect();
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      mic.stop(); heart.disconnect(); audio?.close();
      container.innerHTML = '';
    },
  };
}
