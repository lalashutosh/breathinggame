// Tiny procedural pixel scenes for the game cards (64x40 logical pixels).
import { pixelContext, fillEllipse, rng } from '../lib/pixel.js';

const W = 64, H = 40;

const SCENES = {
  dive(ctx) {
    const bands = ['#f7c9a0', '#f3a86f', '#e98b63'];
    bands.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(0, i * 5, W, 5); });
    fillEllipse(ctx, 40, 15, 7, 7, '#fff1a8'); fillEllipse(ctx, 40, 15, 5, 5, '#ffd86b');
    ['#4f93c9', '#3b7ab3', '#2b5f93', '#1f4777', '#163560'].forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(0, 15 + i * 5, W, 5); });
    ctx.fillStyle = '#8ad0f0'; for (let x = 2; x < W; x += 9) ctx.fillRect(x, 16, 4, 1);
    ctx.globalAlpha = 0.18; ctx.fillStyle = '#fff6c8';
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.moveTo(30 + i * 8, 15); ctx.lineTo(36 + i * 8, 15); ctx.lineTo(28 + i * 10, H); ctx.lineTo(18 + i * 10, H); ctx.fill(); }
    ctx.globalAlpha = 1;
    const r = rng(7);
    for (let i = 0; i < 20; i++) { ctx.fillStyle = i % 3 ? '#1b3d2a' : '#2f6b45'; const x = Math.floor(r() * W); const h = 3 + Math.floor(r() * 6); ctx.fillRect(x, H - h, 3, h); }
    ctx.fillStyle = '#ffd86b'; ctx.fillRect(10, 24, 4, 2); ctx.fillRect(9, 23, 1, 1); ctx.fillRect(9, 26, 1, 1); ctx.fillRect(14, 25, 1, 1);
    ctx.fillStyle = '#ff9f6e'; ctx.fillRect(20, 30, 3, 2); ctx.fillRect(19, 29, 1, 1); ctx.fillRect(19, 32, 1, 1);
    ctx.fillStyle = '#bfe9ff'; ctx.fillRect(13, 21, 1, 1); ctx.fillRect(12, 19, 1, 1);
  },
  night(ctx) {
    ['#1d2448', '#262f5c', '#2e3a6b', '#36457a'].forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(0, i * 7, W, 7); });
    const r = rng(3);
    ctx.fillStyle = '#fff'; for (let i = 0; i < 18; i++) ctx.fillRect(Math.floor(r() * W), Math.floor(r() * 22), 1, 1);
    fillEllipse(ctx, 46, 11, 6, 6, '#f6f1cf'); fillEllipse(ctx, 43, 10, 5, 5, '#2e3a6b');
    ctx.fillStyle = '#2d4a58'; for (let x = 0; x < W; x++) ctx.fillRect(x, 26 + Math.round(Math.sin(x / 7) * 3), 1, 14);
    ctx.fillStyle = '#213845'; for (let x = 0; x < W; x++) ctx.fillRect(x, 31 + Math.round(Math.sin(x / 5 + 2) * 2), 1, 9);
    for (let i = 0; i < 4; i++) { ctx.fillStyle = i % 2 ? '#f2c9d8' : '#cfe5ff'; ctx.fillRect(8 + i * 13, 20 - (i % 2) * 3, 7, 7); ctx.fillStyle = '#1d2448'; ctx.fillRect(10 + i * 13, 22 - (i % 2) * 3, 3, 3); }
  },
  valley(ctx) {
    ['#3a3f78', '#7a5a8a', '#d9806f', '#f6b47a', '#ffd59a'].forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(0, i * 4, W, 4); });
    fillEllipse(ctx, 44, 17, 4, 4, '#fff3cf');
    ctx.fillStyle = '#8a7a9a'; for (let x = 0; x < W; x++) ctx.fillRect(x, 13 + Math.round(Math.abs(Math.sin(x / 6)) * -5 + Math.sin(x / 3) * 1.5) + 5, 1, 10);
    ctx.fillStyle = '#b8955a'; for (let x = 0; x < W; x++) ctx.fillRect(x, 21 + Math.round(Math.sin(x / 11) * 2), 1, 20);
    ctx.fillStyle = '#d9b36a'; ctx.fillRect(0, 28, W, 12);
    const r = rng(5);
    for (let i = 0; i < 40; i++) { ctx.fillStyle = i % 2 ? '#f0cf7e' : '#a8853f'; ctx.fillRect(Math.floor(r() * W), 27 + Math.floor(r() * 13), 1, 2); }
    for (const x of [6, 14, 52, 58]) { ctx.fillStyle = '#2f5a3a'; ctx.fillRect(x - 1, 17, 3, 2); ctx.fillRect(x - 2, 19, 5, 3); ctx.fillStyle = '#5a3e2a'; ctx.fillRect(x, 22, 1, 2); }
    ctx.fillStyle = '#e0643f'; ctx.fillRect(30, 29, 3, 5); ctx.fillRect(31, 28, 1, 1);
    ctx.fillStyle = '#ffe9a8'; ctx.fillRect(34, 27, 1, 1);
    ctx.fillStyle = '#f6f1e2'; ctx.fillRect(41, 30, 4, 2); ctx.fillRect(47, 32, 4, 2);
    ctx.fillStyle = '#2a2a33'; ctx.fillRect(45, 30, 1, 1); ctx.fillRect(51, 32, 1, 1);
  },
  drift(ctx) {
    ['#2b3a67', '#5a4a7a', '#9a5a7e', '#d9806f', '#ffc98f'].forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(0, i * 5, W, 5); });
    ctx.fillStyle = '#5a4a72'; for (let x = 0; x < W; x++) ctx.fillRect(x, 22 + Math.round(Math.sin(x / 8) * 2 + Math.sin(x / 3) * 0.6), 1, 4);
    ctx.fillStyle = '#2e2648'; for (let x = 0; x < W; x++) ctx.fillRect(x, 24 + Math.round(Math.sin(x / 5 + 1)), 1, 3);
    ctx.fillStyle = '#3a3560'; ctx.fillRect(0, 26, W, 14);
    ctx.fillStyle = 'rgba(255,240,214,0.35)';
    for (let x = 0; x < W; x++) { const y = 15 - Math.round(Math.sin(x / 10 - 1) * 6); ctx.fillRect(x, y, 1, 2); }
    fillEllipse(ctx, 18, 14, 3, 3, '#ffe2a8'); ctx.fillStyle = '#fffbea'; ctx.fillRect(17, 13, 2, 2);
    ctx.fillStyle = 'rgba(255,226,168,0.5)'; for (let y = 28; y < 38; y += 2) ctx.fillRect(16 + (y % 4 ? 1 : 0), y, 4, 1);
    ctx.fillStyle = '#fff'; [[40, 4], [52, 7], [30, 3], [58, 2]].forEach(([x, y]) => ctx.fillRect(x, y, 1, 1));
  },
  river(ctx) {
    ['#bfe2ec', '#d6eef2'].forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(0, i * 8, W, 8); });
    ctx.fillStyle = '#6f9f78'; for (let x = 0; x < W; x++) ctx.fillRect(x, 12 + Math.round(Math.sin(x / 9) * 3), 1, 30);
    ctx.fillStyle = '#4e7f5a'; for (let x = 0; x < W; x++) ctx.fillRect(x, 17 + Math.round(Math.sin(x / 6 + 1) * 2), 1, 25);
    ctx.fillStyle = '#8bbf68'; ctx.fillRect(0, 24, W, 16);
    const r = rng(11);
    for (let i = 0; i < 9; i++) { const x = Math.floor(r() * W), y = 22 + Math.floor(r() * 4); ctx.fillStyle = '#386b3e'; ctx.fillRect(x - 2, y - 4, 5, 4); ctx.fillRect(x - 1, y - 6, 3, 2); ctx.fillStyle = '#6a4a2a'; ctx.fillRect(x, y, 1, 3); }
    for (let y = 26; y < H; y++) { const w = 10 + (y - 26) * 1.2, cx = 32 + Math.sin(y / 4) * 3; ctx.fillStyle = '#5aa6c9'; ctx.fillRect(Math.round(cx - w / 2), y, Math.round(w), 1); }
    ctx.fillStyle = '#bfe9ff'; for (let i = 0; i < 6; i++) ctx.fillRect(28 + (i * 5) % 9, 28 + i * 2, 2, 1);
  },
};

export function drawThumb(canvas, name) {
  const ctx = pixelContext(canvas, W, H);
  (SCENES[name] || SCENES.river)(ctx);
}
