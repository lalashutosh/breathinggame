// The community garden: a full-bleed pixel scene, 270 logical pixels tall, as wide as the
// viewport's aspect ratio needs (360..800), scaled up with crisp edges.
import { clamp, hash32, rng, fillEllipse, ringPixels, drawSwaying, easeOutBack } from '../lib/pixel.js';
import { TREES, KINDS, KIND_NAMES, WILD_TREES, MOUND, ROCKS, BUSH, SIGN, BENCH, LANTERN, CLOUDS, BIRD, FROG, butterfly, OUTLINE } from './sprites.js';

export const H = 270;
const MIN_W = 360, MAX_W = 800;
const GROUND_Y = 100;
export const PLOT = { x: 44, y: 148, w: 256, h: 100 };
export const COLS = 9, ROWS = 5;
const CELL_W = (PLOT.w - 16) / COLS, CELL_H = (PLOT.h - 14) / ROWS;
const GATE = { x: PLOT.x + PLOT.w / 2 - 8, w: 16 };
const POND = { x: PLOT.x + PLOT.w + 46, y: 186, rx: 21, ry: 9 };

/**
 * How a planted sprout becomes a tree. A tree advances a stage when enough
 * neighbours have planted after it, or simply with time. Tweak freely.
 */
export const GROWTH = {
  sapling: { laterPlantings: 2, hours: 12 },
  tree:    { laterPlantings: 6, hours: 48 },
};
export function growthStage(c, all, now = Date.now()) {
  const t = Date.parse(c.plantedAt);
  const later = all.reduce((n, o) => n + (Date.parse(o.plantedAt) > t ? 1 : 0), 0);
  const hours = (now - t) / 3600e3;
  if (later >= GROWTH.tree.laterPlantings || hours >= GROWTH.tree.hours) return 2;
  if (later >= GROWTH.sapling.laterPlantings || hours >= GROWTH.sapling.hours) return 1;
  return 0;
}

/** Things that appear as the garden fills up. */
const MILESTONES = { butterflies: 1, flowers: 4, birds: 10, pond: 18, bench: 30 };

// ------------------------------------------------------------ time of day
const SKIES = {
  dawn:  { bands: ['#a9c5e6', '#cdd4e6', '#f1d9c3', '#f8e7c9'], mtn: '#8fa6b8', mtn2: '#7a90a3', snow: '#f8eee6', far: '#a5c5b1', near: '#86b394', overlay: 'rgba(255,205,160,0.10)', sun: '#f9d58a' },
  day:   { bands: ['#9fd3e6', '#b4dced', '#c9e6f1', '#dcf0f4'], mtn: '#86a9ae', mtn2: '#6f949a', snow: '#f4f8f8', far: '#9ccbb0', near: '#7fb891', overlay: null, sun: '#f8e38c' },
  dusk:  { bands: ['#7fa0d0', '#b3aed0', '#eec3a1', '#f7d7a4'], mtn: '#8a8fb0', mtn2: '#737a9c', snow: '#f6e2d2', far: '#8fb0a0', near: '#6f9a7e', overlay: 'rgba(255,140,70,0.12)', sun: '#f6a65c' },
  night: { bands: ['#1b2440', '#232f55', '#2c3b68', '#334676'], mtn: '#2e3f5c', mtn2: '#26344c', snow: '#9aa6c2', far: '#3b5862', near: '#2f4a50', overlay: 'rgba(16,26,70,0.30)', sun: '#f3f0d8' },
};
export function timeOfDay() {
  const q = new URLSearchParams(location.search).get('time');
  if (q && SKIES[q]) return q;
  const h = new Date().getHours();
  return h < 6 || h >= 20 ? 'night' : h < 8 ? 'dawn' : h < 17 ? 'day' : 'dusk';
}

// ------------------------------------------------------------ slot geometry
export function slotIndex(col, row) { return row * COLS + col; }
export function slotPos(i) {
  const col = i % COLS, row = Math.floor(i / COLS);
  const r = rng(hash32(`slot:${i}`));
  const jx = Math.floor(r() * 9) - 4, jy = Math.floor(r() * 5) - 2;
  return {
    col, row,
    x: Math.round(PLOT.x + 8 + (col + 0.5) * CELL_W + jx),
    y: Math.round(PLOT.y + 12 + (row + 0.6) * CELL_H + jy),     // baseline (trunk bottom)
  };
}

export class Garden {
  constructor(canvas, { onPick } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onPick = onPick;
    this.W = 0;
    this.items = [];
    this.stages = new Map();     // id -> last rendered growth stage
    this.anims = new Map();      // id -> { kind: 'plant'|'grow'|'celebrate', t0, from }
    this.sparkles = []; this.leaves = []; this.puffs = [];
    this.butterflies = []; this.birds = []; this.fireflies = [];
    this.hover = null;
    this.planting = null;        // { kind } while the visitor picks a spot
    this.tod = timeOfDay();
    this.t = 0;
    this._last = performance.now();
    this._reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this._fit();
    new ResizeObserver(() => this._fit()).observe(canvas);
    this._bindPointer();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  /** Pick the logical width from the element's aspect ratio and rebuild the scenery. */
  _fit() {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const W = clamp(Math.round((r.width / r.height) * H), MIN_W, MAX_W);
    if (W === this.W) return;
    this.W = W;
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx.imageSmoothingEnabled = false;
    this._buildStatic();
  }

  // ---------------------------------------------------------- data in
  setContributions(list, { animateNew = true, celebrateId = null } = {}) {
    const prevIds = new Set(this.items.map((c) => c.id));
    const sorted = list.slice().sort((a, b) => Date.parse(a.plantedAt) - Date.parse(b.plantedAt));
    this.items = sorted;
    const now = performance.now();
    for (const c of sorted) {
      const st = growthStage(c, sorted);
      const prev = this.stages.get(c.id);
      if (prev === undefined) {
        if (animateNew && prevIds.size) this.anims.set(c.id, { kind: c.id === celebrateId ? 'celebrate' : 'plant', t0: now });
        this.stages.set(c.id, st);
      } else if (st > prev) {
        this.anims.set(c.id, { kind: 'grow', t0: now, from: prev });
        this.stages.set(c.id, st);
      }
    }
    this._syncWildlife();
  }

  get count() { return this.items.length; }
  get freeSlots() {
    const taken = new Set(this.items.map((c) => slotIndex(c.slot.col, c.slot.row)));
    const free = [];
    for (let i = 0; i < COLS * ROWS; i++) if (!taken.has(i)) free.push(i);
    return free;
  }
  stageCounts() {
    const n = [0, 0, 0];
    for (const c of this.items) n[growthStage(c, this.items)]++;
    return n;
  }

  /** Pick a pleasant free slot automatically: far from the crowd, a little random. */
  suggestSlot() {
    const free = this.freeSlots;
    if (!free.length) return null;
    const taken = this.items.map((c) => slotPos(slotIndex(c.slot.col, c.slot.row)));
    const scored = free.map((i) => {
      const p = slotPos(i);
      const d = taken.length ? Math.min(...taken.map((q) => Math.hypot(p.x - q.x, p.y - q.y))) : 50;
      return { i, score: Math.min(d, 60) + Math.random() * 25 };
    });
    scored.sort((a, b) => b.score - a.score);
    const i = scored[0].i;
    return { col: i % COLS, row: Math.floor(i / COLS) };
  }

  enterPlanting(kind) { this.planting = { kind }; this.canvas.classList.add('is-planting'); }
  exitPlanting() { this.planting = null; this.hover = null; this.canvas.classList.remove('is-planting'); }

  // ---------------------------------------------------------- pointer
  /** Pointer -> logical coordinates, allowing for object-fit: cover. */
  _toLogical(ev) {
    const r = this.canvas.getBoundingClientRect();
    const s = Math.max(r.width / this.W, r.height / H);
    const ox = (r.width - this.W * s) / 2, oy = (r.height - H * s) / 2;
    return { x: (ev.clientX - r.left - ox) / s, y: (ev.clientY - r.top - oy) / s };
  }
  _bindPointer() {
    const c = this.canvas;
    const update = (ev) => {
      if (!this.planting) { this.hover = null; return; }
      const p = this._toLogical(ev);
      let best = null, bd = 14;
      for (const i of this.freeSlots) {
        const s = slotPos(i);
        const d = Math.hypot(p.x - s.x, p.y - (s.y - 6));
        if (d < bd) { bd = d; best = i; }
      }
      this.hover = best;
    };
    c.addEventListener('pointermove', update);
    c.addEventListener('pointerleave', () => { this.hover = null; });
    c.addEventListener('pointerdown', (ev) => {
      if (!this.planting) return;
      update(ev);
      if (this.hover != null && this.onPick) {
        const i = this.hover;
        this.onPick({ col: i % COLS, row: Math.floor(i / COLS) });
      }
    });
  }

  // ---------------------------------------------------------- static scenery
  riverCx(y) { return Math.round(this.riverBase + Math.sin(y / 34 + 1) * 20 - (y - GROUND_Y) * 0.15); }

  _buildStatic() {
    const W = this.W, r = rng(20251114 + W);
    this.riverBase = Math.max(PLOT.x + PLOT.w + 100, W - 130);
    const hasRiver = this.riverBase + 30 < W;
    this.mtnFar = []; this.mtnNear = []; this.hillsFar = []; this.hillsNear = [];
    for (let x = 0; x < W; x++) {
      this.mtnFar.push(Math.round(60 + Math.sin(x / 53) * 7 - Math.abs(Math.sin(x / 23 + 1)) * 12 + Math.sin(x / 7) * 1.5));
      this.mtnNear.push(Math.round(76 + Math.sin(x / 41 + 2) * 6 - Math.abs(Math.sin(x / 17)) * 10));
      this.hillsFar.push(Math.round(86 + Math.sin(x / 38) * 4 + Math.sin(x / 17 + 2) * 2));
      this.hillsNear.push(Math.round(92 + Math.sin(x / 29 + 1) * 3 + Math.sin(x / 11) * 2));
    }
    this.farTrees = [];
    for (let i = 0; i < W / 16; i++) { const x = Math.floor(r() * W); this.farTrees.push({ x, y: this.hillsNear[x] + 1, h: 3 + Math.floor(r() * 3) }); }
    this.speckles = [];
    for (let i = 0; i < W * 1.3; i++) this.speckles.push({ x: Math.floor(r() * W), y: GROUND_Y + Math.floor(r() * (H - GROUND_Y)), k: r() < 0.5 ? 0 : 1 });
    this.tufts = [];
    for (let i = 0; i < W * 0.4; i++) this.tufts.push({ x: Math.floor(r() * W), y: GROUND_Y + 4 + Math.floor(r() * (H - GROUND_Y - 6)), ph: r() * 6.28 });

    // fixed decor around the plot
    this.decor = [
      { img: ROCKS[0], x: PLOT.x + PLOT.w + 18, y: 160 }, { img: ROCKS[1], x: 12, y: 180 }, { img: BUSH, x: PLOT.x + PLOT.w + 12, y: 212 },
      { img: BUSH, x: 6, y: 150 }, { img: BUSH, x: 230, y: 268 }, { img: SIGN, x: GATE.x + GATE.w + 8, y: 266 }, { img: ROCKS[0], x: 70, y: 266 },
      { img: BENCH, x: 14, y: 214 },
    ];
    // wild trees: a treeline under the hills, then scattered copses that avoid the plot, path, pond and river
    this.wild = [];
    const kinds = ['pine', 'oak', 'pine', 'dark', 'pineSmall', 'oak'];
    for (let x = -4; x < W + 6; x += 9 + Math.floor(r() * 7)) {
      const k = kinds[Math.floor(r() * kinds.length)];
      this.wild.push({ spr: WILD_TREES[k], x, y: 106 + Math.floor(r() * 18), ph: r() * 6.28 });
    }
    const blocked = (x, y) =>
      (x > PLOT.x - 12 && x < PLOT.x + PLOT.w + 12 && y > PLOT.y - 24 && y < PLOT.y + PLOT.h + 8) ||
      (y > PLOT.y + PLOT.h - 4 && x > GATE.x - 10 && x < GATE.x + GATE.w + 28) ||
      (Math.abs(x - POND.x) < POND.rx + 14 && Math.abs(y - POND.y) < POND.ry + 18) ||
      (hasRiver && Math.abs(x - this.riverCx(y)) < 22) ||
      this.wild.some((w) => Math.abs(w.x - x) < 11 && Math.abs(w.y - y) < 9);
    const want = Math.round(W * 0.075);
    for (let tries = 0, n = 0; tries < want * 30 && n < want; tries++) {
      const x = Math.floor(r() * W), y = 130 + Math.floor(r() * (H - 132));
      if (blocked(x, y)) continue;
      const k = kinds[Math.floor(r() * kinds.length)];
      this.wild.push({ spr: WILD_TREES[k], x, y, ph: r() * 6.28 });
      n++;
    }
    for (let i = 0; i < want / 2; i++) {
      const x = Math.floor(r() * W), y = 130 + Math.floor(r() * (H - 132));
      if (blocked(x, y)) continue;
      const img = r() < 0.6 ? BUSH : ROCKS[Math.floor(r() * 2)];
      this.decor.push({ img, x: x - (img.width >> 1), y });
    }
    this.flowers = [];
    const spots = [[10, 150], [18, 198], [8, 236], [30, 262], [PLOT.x + PLOT.w + 24, 176], [PLOT.x + PLOT.w + 40, 222], [120, 262], [200, 262], [60, 262],
      [POND.x + 30, POND.y + 6], [PLOT.x + PLOT.w + 70, 150]];
    for (let i = 0; i < W / 40; i++) spots.push([Math.floor(r() * W), 132 + Math.floor(r() * 130)]);
    for (const [x, y] of spots) {
      if (hasRiver && Math.abs(x - this.riverCx(y)) < 16) continue;
      const n = 3 + Math.floor(r() * 4), cluster = [];
      for (let j = 0; j < n; j++) cluster.push({ dx: Math.floor(r() * 14) - 7, dy: Math.floor(r() * 8) - 4, c: ['#f3c94d', '#f08fb0', '#ffffff', '#ff8e6e', '#c9a0ff'][Math.floor(r() * 5)] });
      this.flowers.push({ x, y, cluster });
    }
    this.clouds = [];
    for (let i = 0; i < 3 + W / 160; i++) this.clouds.push({ img: CLOUDS[i % 2], x: r() * W, y: 4 + Math.floor(r() * 40), v: 1.5 + r() * 3 });
    this.stars = [];
    for (let i = 0; i < W / 6; i++) this.stars.push({ x: Math.floor(r() * W), y: Math.floor(r() * 70), ph: r() * 6.28 });
    this.pondGlints = [{ x: 0, ph: 0 }, { x: 8, ph: 2 }, { x: -9, ph: 4 }];
    this.hasRiver = hasRiver;
    this.cols = { grass: '#78ad5e', grassIn: '#86ba66', dark: '#669c51', light: '#95c774', soil: '#b48a5a', soilEdge: '#9a7047' };
  }

  _syncWildlife() {
    const n = this.count;
    const want = n >= MILESTONES.butterflies ? Math.min(6, 1 + Math.floor(n / 5)) : 0;
    while (this.butterflies.length < want) {
      const i = this.butterflies.length, r = rng(hash32(`bf:${i}`));
      this.butterflies.push({
        frames: butterfly(['#f3c94d', '#f08fb0', '#ffb366', '#c9a0ff', '#8fd3ff', '#ffffff'][i % 6]),
        ax: PLOT.x + 20 + r() * (PLOT.w - 40), ay: PLOT.y + 10 + r() * (PLOT.h - 20), a: r() * 6.28, b: r() * 6.28, sp: 0.35 + r() * 0.3,
      });
    }
    const wantFf = this.tod === 'night' && n >= MILESTONES.butterflies ? Math.min(14, 4 + n) : 0;
    while (this.fireflies.length < wantFf) {
      const r = rng(hash32(`ff:${this.fireflies.length}`));
      this.fireflies.push({ x: PLOT.x + r() * PLOT.w, y: PLOT.y + r() * PLOT.h, ph: r() * 6.28, sp: 0.3 + r() * 0.5 });
    }
  }

  // ---------------------------------------------------------- loop
  _loop(now) {
    const dt = clamp((now - this._last) / 1000, 0, 0.05);
    this._last = now;
    if (!this._reduced) this.t += dt;
    this._update(dt, now);
    this._draw(now);
    requestAnimationFrame(this._loop);
  }

  _update(dt, now) {
    const t = this.t, W = this.W;
    for (const c of this.clouds) { c.x += c.v * dt; if (c.x > W + 10) c.x = -c.img.width - 10; }
    for (const s of this.sparkles) { s.x += s.vx * dt; s.y += s.vy * dt; s.vy += 10 * dt; s.life -= dt; }
    this.sparkles = this.sparkles.filter((s) => s.life > 0);
    for (const p of this.puffs) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy -= 6 * dt; p.life -= dt; }
    this.puffs = this.puffs.filter((p) => p.life > 0);
    for (const l of this.leaves) { l.x += (l.vx + Math.sin(t * 3 + l.ph) * 6) * dt; l.y += l.vy * dt; l.life -= dt; }
    this.leaves = this.leaves.filter((l) => l.life > 0);
    if (!this._reduced && Math.random() < dt * 0.6) this._spawnLeaf();
    for (const b of this.butterflies) {
      b.a += dt * b.sp; b.b += dt * b.sp * 0.63;
      b.x = b.ax + Math.sin(b.a) * 22 + Math.sin(b.b * 2.1) * 6;
      b.y = b.ay + Math.sin(b.b) * 10 - 14;
      if (Math.random() < dt * 0.05) { b.ax = PLOT.x + 20 + Math.random() * (PLOT.w - 40); b.ay = PLOT.y + 10 + Math.random() * (PLOT.h - 20); }
    }
    if (this.count >= MILESTONES.birds && !this.birds.length && Math.random() < dt / 14) {
      const dir = Math.random() < 0.5 ? 1 : -1, y = 10 + Math.random() * 34;
      for (let i = 0; i < 3; i++) this.birds.push({ x: dir > 0 ? -10 - i * 9 : W + 10 + i * 9, y: y + (i % 2) * 3, v: dir * (26 + Math.random() * 6), ph: i });
    }
    for (const b of this.birds) { b.x += b.v * dt; b.y += Math.sin(t * 2 + b.ph) * 2 * dt; }
    this.birds = this.birds.filter((b) => b.x > -20 && b.x < W + 20);
    for (const f of this.fireflies) { f.x += Math.sin(t * f.sp + f.ph) * 8 * dt; f.y += Math.cos(t * f.sp * 0.8 + f.ph) * 5 * dt; }
    for (const [id, a] of this.anims) {
      const age = (now - a.t0) / 1000;
      const c = this.items.find((x) => x.id === id);
      if (!c) { this.anims.delete(id); continue; }
      const p = slotPos(slotIndex(c.slot.col, c.slot.row));
      if (a.kind !== 'grow' && age < 0.5 && Math.random() < 0.6) this.puffs.push({ x: p.x + (Math.random() * 10 - 5), y: p.y - 1, vx: Math.random() * 16 - 8, vy: -4 - Math.random() * 6, life: 0.5 + Math.random() * 0.3 });
      const sparkleFrom = a.kind === 'grow' ? 0.3 : 0.6, dur = a.kind === 'celebrate' ? 2.6 : 1.7;
      if (age > sparkleFrom && age < dur && Math.random() < (a.kind === 'celebrate' ? 0.9 : 0.45)) {
        const kind = KINDS[c.kind] || KINDS.apple;
        this.sparkles.push({ x: p.x + (Math.random() * 20 - 10), y: p.y - 4 - Math.random() * 16, vx: Math.random() * 10 - 5, vy: -14 - Math.random() * 14, life: 0.6 + Math.random() * 0.5, c: Math.random() < 0.5 ? '#fff6b0' : kind.L });
      }
      if (age > dur + 0.4) this.anims.delete(id);
    }
  }

  _spawnLeaf() {
    const grown = this.items.filter((c) => this.stages.get(c.id) === 2);
    if (!grown.length) return;
    const c = grown[Math.floor(Math.random() * grown.length)];
    const p = slotPos(slotIndex(c.slot.col, c.slot.row));
    this.leaves.push({ x: p.x + Math.random() * 10 - 5, y: p.y - 14 - Math.random() * 4, vx: 6 + Math.random() * 6, vy: 7 + Math.random() * 5, ph: Math.random() * 6.28, life: 2 + Math.random() * 1.5, c: (KINDS[c.kind] || KINDS.apple).petal });
  }

  // ---------------------------------------------------------- draw
  _draw(now) {
    const ctx = this.ctx, t = this.t, sky = SKIES[this.tod], C = this.cols, W = this.W;
    ctx.clearRect(0, 0, W, H);

    // sky
    const bands = [0, 24, 44, 62, GROUND_Y];
    for (let i = 0; i < 4; i++) { ctx.fillStyle = sky.bands[i]; ctx.fillRect(0, bands[i], W, bands[i + 1] - bands[i]); }
    const sunX = Math.round(W * 0.58);
    if (this.tod === 'night') {
      for (const s of this.stars) { const tw = Math.sin(t * 2 + s.ph); if (tw > -0.3) { ctx.fillStyle = tw > 0.7 ? '#ffffff' : '#aab6d6'; ctx.fillRect(s.x, s.y, 1, 1); } }
      fillEllipse(ctx, sunX, 24, 10, 10, '#f3f0d8'); fillEllipse(ctx, sunX - 5, 22, 9, 9, sky.bands[0]);
    } else {
      const sy = this.tod === 'dusk' ? 58 : this.tod === 'dawn' ? 52 : 26;
      fillEllipse(ctx, sunX, sy, 12, 12, this.tod === 'day' ? '#fff3bf' : sky.sun);
      fillEllipse(ctx, sunX, sy, 10, 10, sky.sun);
    }
    ctx.globalAlpha = this.tod === 'night' ? 0.3 : 0.95;
    for (const c of this.clouds) ctx.drawImage(c.img, Math.round(c.x), c.y);
    ctx.globalAlpha = 1;
    for (const b of this.birds) ctx.drawImage(BIRD[Math.floor(t * 6 + b.ph) % 2], Math.round(b.x), Math.round(b.y));

    // mountains and hills
    for (let x = 0; x < W; x++) {
      const m = this.mtnFar[x];
      ctx.fillStyle = sky.mtn; ctx.fillRect(x, m, 1, GROUND_Y - m);
      if (m < 58) { ctx.fillStyle = sky.snow; ctx.fillRect(x, m, 1, Math.min(3, 58 - m)); }
      const n = this.mtnNear[x];
      ctx.fillStyle = sky.mtn2; ctx.fillRect(x, n, 1, GROUND_Y - n);
    }
    ctx.fillStyle = sky.far;
    for (let x = 0; x < W; x++) ctx.fillRect(x, this.hillsFar[x], 1, GROUND_Y - this.hillsFar[x]);
    ctx.fillStyle = sky.near;
    for (let x = 0; x < W; x++) ctx.fillRect(x, this.hillsNear[x], 1, GROUND_Y - this.hillsNear[x]);
    ctx.fillStyle = this.tod === 'night' ? '#223a3e' : '#5f8f6e';
    for (const ft of this.farTrees) for (let i = 0; i < ft.h; i++) ctx.fillRect(ft.x - i, ft.y - ft.h + i, i * 2 + 1, 1);

    // ground
    ctx.fillStyle = C.grass; ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    ctx.fillStyle = C.light; ctx.fillRect(0, GROUND_Y, W, 2);
    ctx.fillStyle = C.grassIn; ctx.fillRect(PLOT.x, PLOT.y, PLOT.w, PLOT.h);
    for (const s of this.speckles) { ctx.fillStyle = s.k ? C.dark : C.light; ctx.fillRect(s.x, s.y, 2, 1); }
    for (const tf of this.tufts) {
      const bend = Math.sin(t * 1.6 + tf.ph) > 0.6 ? 1 : 0;
      ctx.fillStyle = C.dark; ctx.fillRect(tf.x, tf.y - 1, 1, 2); ctx.fillRect(tf.x - 1 + bend, tf.y - 2, 1, 1); ctx.fillRect(tf.x + 1 + bend, tf.y - 2, 1, 1);
    }
    // path from the gate
    ctx.fillStyle = C.soilEdge; ctx.fillRect(GATE.x - 1, PLOT.y + PLOT.h, GATE.w + 2, H - PLOT.y - PLOT.h);
    ctx.fillStyle = C.soil; ctx.fillRect(GATE.x + 1, PLOT.y + PLOT.h, GATE.w - 2, H - PLOT.y - PLOT.h);
    ctx.fillStyle = '#cfae7e'; for (let i = 0; i < 6; i++) ctx.fillRect(GATE.x + 3 + ((i * 7) % 11), PLOT.y + PLOT.h + 4 + i * 4, 2, 1);
    ctx.fillStyle = '#b9b7a6'; ctx.fillRect(GATE.x + 4, PLOT.y + PLOT.h - 6, 3, 2); ctx.fillRect(GATE.x + 9, PLOT.y + PLOT.h - 11, 3, 2); ctx.fillRect(GATE.x + 5, PLOT.y + PLOT.h - 16, 3, 2);

    if (this.hasRiver) this._drawRiver(t);
    this._drawPond(t);

    // flowers unlock gradually
    const flowerN = this.count >= MILESTONES.flowers ? Math.min(this.flowers.length, 3 + Math.floor((this.count - MILESTONES.flowers) / 2)) : 0;
    for (let i = 0; i < flowerN; i++) {
      const f = this.flowers[i];
      for (const p of f.cluster) {
        ctx.fillStyle = C.dark; ctx.fillRect(f.x + p.dx, f.y + p.dy + 1, 1, 2);
        ctx.fillStyle = p.c; ctx.fillRect(f.x + p.dx - 1, f.y + p.dy, 3, 1); ctx.fillRect(f.x + p.dx, f.y + p.dy - 1, 1, 3);
        ctx.fillStyle = '#fff3b0'; ctx.fillRect(f.x + p.dx, f.y + p.dy, 1, 1);
      }
    }

    // back + side fences
    this._fenceH(PLOT.x, PLOT.y, PLOT.w, false);
    this._fenceV(PLOT.x, PLOT.y, PLOT.h);
    this._fenceV(PLOT.x + PLOT.w - 3, PLOT.y, PLOT.h);

    if (this.planting && this.hover != null) this._drawGhost(this.hover, t);

    // depth-sorted things
    const things = [];
    for (const c of this.items) {
      const p = slotPos(slotIndex(c.slot.col, c.slot.row));
      things.push({ y: p.y, draw: () => this._drawTree(c, p, now) });
    }
    for (const w of this.wild) {
      const sway = Math.round(Math.sin(t * 1.2 + w.ph));
      things.push({ y: w.y, draw: () => drawSwaying(ctx, w.spr.img, w.x - (w.spr.img.width >> 1), w.y - w.spr.img.height, w.spr.split, sway) });
    }
    for (const d of this.decor) things.push({ y: d.y, draw: () => ctx.drawImage(d.img, d.x, d.y - d.img.height) });
    if (this.count >= MILESTONES.bench) {
      things.push({ y: POND.y - 14, draw: () => ctx.drawImage(BENCH, POND.x - 10, POND.y - 21) });
      things.push({ y: POND.y - 13, draw: () => ctx.drawImage(LANTERN, POND.x + 12, POND.y - 13 - LANTERN.height) });
    }
    for (const b of this.butterflies) things.push({ y: b.y + 20, draw: () => ctx.drawImage(b.frames[Math.floor(t * 9 + b.a) % 2], Math.round(b.x), Math.round(b.y)) });
    things.sort((a, b) => a.y - b.y);
    for (const th of things) th.draw();

    // front fence with a gate gap
    this._fenceH(PLOT.x, PLOT.y + PLOT.h - 2, GATE.x - PLOT.x, true);
    this._fenceH(GATE.x + GATE.w, PLOT.y + PLOT.h - 2, PLOT.x + PLOT.w - GATE.x - GATE.w, true);

    // particles
    for (const p of this.puffs) { ctx.globalAlpha = clamp(p.life * 2); ctx.fillStyle = '#d9c4a3'; ctx.fillRect(Math.round(p.x), Math.round(p.y), 2, 2); }
    ctx.globalAlpha = 1;
    for (const l of this.leaves) { ctx.globalAlpha = clamp(l.life); ctx.fillStyle = l.c; ctx.fillRect(Math.round(l.x), Math.round(l.y), 1, 1); }
    ctx.globalAlpha = 1;
    for (const s of this.sparkles) {
      ctx.fillStyle = s.c; const x = Math.round(s.x), y = Math.round(s.y);
      if (s.life > 0.5) { ctx.fillRect(x - 1, y, 3, 1); ctx.fillRect(x, y - 1, 1, 3); } else ctx.fillRect(x, y, 1, 1);
    }

    // time-of-day tint, then glowing things on top
    if (sky.overlay) { ctx.fillStyle = sky.overlay; ctx.fillRect(0, 0, W, H); }
    if (this.tod === 'night') {
      for (const f of this.fireflies) {
        const on = Math.sin(t * 3 * f.sp + f.ph);
        if (on > 0.2) { ctx.fillStyle = on > 0.8 ? '#fffbc2' : '#e9e27a'; ctx.fillRect(Math.round(f.x), Math.round(f.y), 1, 1); }
      }
      if (this.count >= MILESTONES.bench) { ctx.globalAlpha = 0.18 + Math.sin(t * 4) * 0.03; fillEllipse(ctx, POND.x + 14, POND.y - 22, 14, 9, '#ffd36a'); ctx.globalAlpha = 1; }
    }
  }

  _fenceH(x, y, w, front) {
    const ctx = this.ctx;
    ctx.fillStyle = '#d9ad70'; ctx.fillRect(x, y - 6, w, 2);
    ctx.fillStyle = '#9a6a3b'; ctx.fillRect(x, y - 4, w, 1);
    ctx.fillStyle = '#d9ad70'; ctx.fillRect(x, y - 1, w, 2);
    ctx.fillStyle = '#9a6a3b'; ctx.fillRect(x, y + 1, w, 1);
    for (let px = x; px < x + w; px += 14) this._post(px, y + (front ? 3 : 2));
    this._post(x + w - 3, y + (front ? 3 : 2));
  }
  _fenceV(x, y, h) {
    const ctx = this.ctx;
    ctx.fillStyle = '#9a6a3b'; ctx.fillRect(x + 1, y - 4, 1, h + 4);
    for (let py = y; py <= y + h; py += 14) this._post(x, py + 2);
  }
  _post(x, baseY) {
    const ctx = this.ctx;
    ctx.fillStyle = OUTLINE; ctx.fillRect(x, baseY - 11, 3, 1);
    ctx.fillStyle = '#c99c62'; ctx.fillRect(x, baseY - 10, 2, 10);
    ctx.fillStyle = '#8a5a30'; ctx.fillRect(x + 2, baseY - 10, 1, 10);
  }

  _drawRiver(t) {
    const ctx = this.ctx;
    const flow = Math.floor(t * 18);
    for (let y = GROUND_Y - 1; y < H; y++) {
      const cx = this.riverCx(y);
      ctx.fillStyle = '#5f8a4d'; ctx.fillRect(cx - 12, y, 25, 1);
      ctx.fillStyle = '#cdb47c'; ctx.fillRect(cx - 10, y, 21, 1);
      ctx.fillStyle = '#3f7a98'; ctx.fillRect(cx - 8, y, 17, 1);
      ctx.fillStyle = '#5fa6c9'; ctx.fillRect(cx - 7, y, 15, 1);
      if ((y + flow) % 9 < 3) { ctx.fillStyle = '#8fcbe2'; ctx.fillRect(cx - 4 + ((y >> 3) % 3), y, 3, 1); }
      if ((y * 7 + flow) % 23 === 0) { ctx.fillStyle = '#e6f7ff'; ctx.fillRect(cx + 2, y, 2, 1); }
    }
  }

  _drawPond(t) {
    const ctx = this.ctx, { x: cx, y: cy, rx, ry } = POND;
    fillEllipse(ctx, cx, cy, rx + 2, ry + 2, '#5f8a4d');
    fillEllipse(ctx, cx, cy, rx, ry, '#3f7a98');
    fillEllipse(ctx, cx, cy - 1, rx - 3, ry - 2, '#6fb0d0');
    fillEllipse(ctx, cx - 3, cy - 2, rx - 10, 3, '#8fcbe2');
    for (const g of this.pondGlints) {
      const gx = cx + g.x + Math.round(Math.sin(t * 0.8 + g.ph) * 6), gy = cy - 2 + Math.round(Math.sin(t * 0.5 + g.ph) * 2);
      ctx.fillStyle = '#e6f7ff'; ctx.fillRect(gx, gy, 3, 1);
    }
    if (this.count >= MILESTONES.pond) {
      const pad = (x, y) => { ctx.fillStyle = '#5fa04a'; ctx.fillRect(x - 2, y, 5, 1); ctx.fillRect(x - 1, y - 1, 3, 1); ctx.fillRect(x - 1, y + 1, 2, 1); ctx.fillStyle = '#86c466'; ctx.fillRect(x - 1, y, 2, 1); };
      pad(cx + 10, cy + 2); pad(cx - 8, cy + 4); pad(cx + 3, cy - 4);
      ctx.fillStyle = '#f08fb0'; ctx.fillRect(cx + 10, cy + 1, 1, 1);
      const hop = Math.max(0, Math.sin(t * 2.2)) > 0.9 ? -2 : 0;
      ctx.drawImage(FROG, cx - 12, cy + hop);
    }
  }

  _drawGhost(i, t) {
    const ctx = this.ctx, p = slotPos(i);
    const spr = TREES[this.planting.kind || 'apple'][1].img;
    ctx.globalAlpha = 0.45 + Math.sin(t * 5) * 0.1;
    ctx.drawImage(MOUND, p.x - 4, p.y - 2);
    ctx.drawImage(spr, p.x - (spr.width >> 1), p.y - spr.height - 1);
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#fff8c8';
    const off = Math.floor(t * 10);
    ringPixels(p.x, p.y - 4, 10).forEach((q, k) => { if ((k + off) % 3 === 0) ctx.fillRect(q[0], q[1], 1, 1); });
    ctx.globalAlpha = 1;
  }

  _drawTree(c, p, now) {
    const ctx = this.ctx, t = this.t;
    const kind = TREES[c.kind] ? c.kind : 'apple';
    const stage = this.stages.get(c.id) ?? growthStage(c, this.items);
    const a = this.anims.get(c.id);
    const sway = Math.round(Math.sin(t * 1.4 + hash32(c.id) % 7) * (stage === 2 ? 1 : 0.6));
    let drawStage = stage, reveal = 1, yoff = 0;
    if (a) {
      const age = (now - a.t0) / 1000;
      if (a.kind === 'grow') {
        if (age < 0.3) { drawStage = a.from; yoff = 1; }
        else { reveal = clamp((age - 0.3) / 0.5); yoff = age < 1.1 ? Math.round(-2 * Math.sin((age - 0.3) * 6)) : 0; }
      } else {
        if (age < 0.35) { ctx.drawImage(MOUND, p.x - 4, p.y - 2); return; }
        reveal = clamp((age - 0.35) / 0.45);
        if (age > 0.8 && age < 1.5) yoff = Math.round(-2 * Math.abs(Math.sin((age - 0.8) * 9)));
      }
    }
    const spr = TREES[kind][drawStage];
    const x = p.x - (spr.img.width >> 1), y = p.y - spr.img.height + yoff;
    if (drawStage === 0) ctx.drawImage(MOUND, p.x - 4, p.y - 2);
    if (reveal < 1) {
      const hh = Math.min(spr.img.height, Math.max(1, Math.round(spr.img.height * easeOutBack(reveal))));
      ctx.drawImage(spr.img, 0, spr.img.height - hh, spr.img.width, hh, x, p.y - hh + yoff, spr.img.width, hh);
      return;
    }
    drawSwaying(ctx, spr.img, x, y, spr.split, sway);
  }
}

/** Render one growth stage big, for the "every tree has a story" cards. */
export function renderStageCard(canvas, kind, stage, scale = 6) {
  const spr = TREES[kind][stage].img;
  const w = 30, h = 26;
  canvas.width = w * scale; canvas.height = h * scale;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.scale(scale, scale);
  ctx.fillStyle = '#86ba66'; ctx.fillRect(0, h - 4, w, 4);
  ctx.fillStyle = '#95c774'; ctx.fillRect(0, h - 4, w, 1);
  if (stage === 0) ctx.drawImage(MOUND, w / 2 - 4, h - 6);
  ctx.drawImage(spr, Math.round(w / 2 - spr.width / 2), h - 4 - spr.height);
}

export function randomKind(seedStr) {
  const r = rng(hash32(seedStr || String(Math.random())))();
  return KIND_NAMES[Math.floor(r * KIND_NAMES.length)];
}
