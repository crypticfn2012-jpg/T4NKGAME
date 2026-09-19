// Small math utilities shared across the codebase.

export const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp01 = (v) => clamp(v, 0, 1);

// Move `current` toward `target` by at most `maxDelta` (frame-rate independent
// when `maxDelta` is scaled by dt).
export const approach = (current, target, maxDelta) => {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
};

// Exponential smoothing: `lambda` = 1 / timeConstant.
export const damp = (current, target, lambda, dt) =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

export const dampVec3 = (out, target, lambda, dt) => {
  const f = 1 - Math.exp(-lambda * dt);
  out.x += (target.x - out.x) * f;
  out.y += (target.y - out.y) * f;
  out.z += (target.z - out.z) * f;
  return out;
};

// Shortest signed angular difference from `from` to `to` in [-π, π].
export const angleDelta = (from, to) => {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

export const approachAngle = (current, target, maxDelta) =>
  current + clamp(angleDelta(current, target), -maxDelta, maxDelta);

// Smooth angular exponential damping (handles wraparound).
export const dampAngle = (current, target, lambda, dt) =>
  current + angleDelta(current, target) * (1 - Math.exp(-lambda * dt));

export const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export const easeOutCubic = (t) => 1 - Math.pow(1 - clamp01(t), 3);

// Deterministic PRNG (mulberry32) so every run generates the same battlefield.
export const mulberry32 = (seed) => {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const randRange = (rand, min, max) => min + rand() * (max - min);
export const randInt = (rand, min, max) => Math.floor(randRange(rand, min, max + 1));

export const degToRad = (d) => d * (Math.PI / 180);
export const radToDeg = (r) => r * (180 / Math.PI);

export const TAU = Math.PI * 2;
