// Procedural textures via <canvas> — no image assets anywhere in the project.
// Everything the game shows (hazard stripes, glows, health bars) is drawn
// here at runtime.

import * as THREE from 'three';

export function createCanvas(w = 128, h = 128) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

export function createCanvasTexture(canvas, { wrapS, wrapT, srgb = true, flipY = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = wrapS ?? THREE.RepeatWrapping;
  t.wrapT = wrapT ?? THREE.RepeatWrapping;
  t.flipY = flipY;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function drawStripes(ctx, w, h, stripeCount, c1, c2, diagonal) {
  ctx.fillStyle = c2;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = c1;
  const step = w / stripeCount;
  const band = step * 0.55;
  if (diagonal) {
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(Math.PI / 4);
    ctx.translate(-w, -h);
    for (let x = -w; x < w * 2; x += step) {
      ctx.fillRect(x, -h, band * 1.5, h * 3);
    }
    ctx.restore();
  } else {
    for (let x = 0; x <= w; x += step) ctx.fillRect(x, 0, band, h);
  }
}

// Yellow/black hazard stripes (used on warning signs, barrel bands, fuel depots).
export function hazardTexture({ stripes = 6, c1 = '#d9a13c', c2 = '#1d1d1b' } = {}) {
  const w = 256, h = 128;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  drawStripes(ctx, w, h, stripes, c1, c2, true);
  return canvas;
}

// Vertical day-sky gradient used by the skydome (drawn top→bottom exactly
// like the dome's UVs: v=1 at the zenith, v=0 at the horizon).
export function skyGradientTexture(stops = [
  [0.0, '#7ea6cf'],
  [0.45, '#b7c8d8'],
  [0.72, '#dfd2b8'],
  [1.0, '#c2ad8c']
]) {
  const w = 8, h = 512;
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, h);
  for (const [t, color] of stops) g.addColorStop(t, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  return canvas;
}

// Soft radial glow (sun, muzzle flash).
export function glowTexture({ inner = 'rgba(255,244,214,1)', outer = 'rgba(255,200,110,0)' } = {}) {
  const size = 128;
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, 'rgba(255,224,160,0.55)');
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}

// Health bar texture (enemy world-space HP). Redrawn on damage.
export function healthBarCanvas(frac, w = 128, h = 18) {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  // backing
  ctx.fillStyle = 'rgba(10, 12, 9, 0.75)';
  ctx.fillRect(0, 0, w, h);
  // fill
  const f = Math.max(0, Math.min(1, frac));
  const hue = 120 * f; // green → red
  ctx.fillStyle = `hsl(${hue}, 55%, 45%)`;
  ctx.fillRect(2, 2, (w - 4) * f, h - 4);
  // border
  ctx.strokeStyle = 'rgba(220, 214, 195, 0.65)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, w - 2, h - 2);
  return canvas;
}
