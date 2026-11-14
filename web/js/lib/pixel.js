// Small pixel-art toolkit shared by the garden and the games.

export const clamp = (v, lo = 0, hi = 1) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const easeOutBack = (t) => 1 + 2.3 * Math.pow(t - 1, 3) + 1.3 * Math.pow(t - 1, 2);

/** FNV-1a string hash → uint32. Used for deterministic per-slot jitter. */
export function hash32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Tiny seeded PRNG (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function mixHex(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return `rgb(${Math.round(lerp(A[0], B[0], t))},${Math.round(lerp(A[1], B[1], t))},${Math.round(lerp(A[2], B[2], t))})`;
}
export function shade(hex, amount) {          // amount -1..1 (dark..light)
  const [r, g, b] = hexToRgb(hex);
  const f = (c) => Math.round(clamp(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount, 0, 255));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

/** Turn rows of palette letters into an offscreen canvas sprite. */
export function makeSprite(rows, pal) {
  const w = Math.max(...rows.map((r) => r.length));
  const h = rows.length;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const col = pal[row[x]];
      if (col) {
        ctx.fillStyle = col;
        ctx.fillRect(x, y, 1, 1);
      }
    }
  });
  return c;
}

export function flipH(sprite) {
  const c = document.createElement('canvas');
  c.width = sprite.width;
  c.height = sprite.height;
  const ctx = c.getContext('2d');
  ctx.translate(sprite.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(sprite, 0, 0);
  return c;
}

/** Prepare a canvas for crisp low-res drawing. */
export function pixelContext(canvas, w, h) {
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  return ctx;
}

export function px(ctx, x, y, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x | 0, y | 0, 1, 1);
}

/** Fill an ellipse with whole-pixel row spans (no anti-aliasing). */
export function fillEllipse(ctx, cx, cy, rx, ry, color) {
  ctx.fillStyle = color;
  for (let dy = -ry; dy <= ry; dy++) {
    const f = 1 - (dy * dy) / (ry * ry + 1e-6);
    if (f < 0) continue;
    const half = Math.round(rx * Math.sqrt(f));
    ctx.fillRect(Math.round(cx - half), Math.round(cy + dy), half * 2 + 1, 1);
  }
}

/** 1px pixel ring (Bresenham-ish midpoint circle). */
export function ringPixels(cx, cy, r) {
  const pts = [];
  let x = r, y = 0, err = 1 - r;
  while (x >= y) {
    pts.push([cx + x, cy + y], [cx + y, cy + x], [cx - y, cy + x], [cx - x, cy + y],
             [cx - x, cy - y], [cx - y, cy - x], [cx + y, cy - x], [cx + x, cy - y]);
    y++;
    if (err < 0) err += 2 * y + 1; else { x--; err += 2 * (y - x) + 1; }
  }
  return pts;
}

/** Draw `sprite` with its canopy rows (0..split) offset horizontally by `sway`. */
export function drawSwaying(ctx, sprite, x, y, split, sway) {
  if (!sway || split <= 0 || split >= sprite.height) {
    ctx.drawImage(sprite, x, y);
    return;
  }
  ctx.drawImage(sprite, 0, 0, sprite.width, split, x + sway, y, sprite.width, split);
  ctx.drawImage(sprite, 0, split, sprite.width, sprite.height - split, x, y + split, sprite.width, sprite.height - split);
}

/** Map a pointer event to logical canvas coordinates. */
export function pointerToCanvas(canvas, ev) {
  const r = canvas.getBoundingClientRect();
  return {
    x: ((ev.clientX - r.left) / r.width) * canvas.width,
    y: ((ev.clientY - r.top) / r.height) * canvas.height,
  };
}
