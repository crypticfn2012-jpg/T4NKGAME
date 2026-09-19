// Deterministic terrain heightfield. The SAME code and seed run on the server
// (authoritative physics) and the client (prediction + mesh generation), so a
// position sampled on one side matches the other exactly.
//
// The client's TerrainBuilder calls heightAt(ix, iz); physics code calls
// getHeightAt(x, z) / getSlopeDeg / getNormalAt.

import { createNoise2D } from 'simplex-noise';
import { mulberry32, clamp, lerp, smoothstep, TAU } from '../src/utils/Math.js';

export function createTerrain(cfg) {
  const { size, segments, noise, craters, flatten } = cfg;
  const half = size / 2;
  const cell = size / segments;

  const rand = mulberry32(cfg.seed);
  const noise2d = createNoise2D(rand);

  // Pre-roll crater positions deterministically.
  const cratersList = [];
  {
    const r = mulberry32((cfg.seed ^ 0x5bd1e995) >>> 0);
    const margin = 140;
    for (let i = 0; i < craters.count; i++) {
      cratersList.push({
        x: -half + margin + r() * (size - margin * 2),
        z: -half + margin + r() * (size - margin * 2),
        radius: craters.minRadius + r() * (craters.maxRadius - craters.minRadius),
        depth: craters.minDepth + r() * (craters.maxDepth - craters.minDepth),
        rim: craters.rim * (0.6 + r() * 0.8)
      });
    }
  }

  function fbm(x, z) {
    let amp = noise.amplitude;
    let freq = noise.baseFrequency;
    let sum = 0;
    for (let o = 0; o < noise.octaves; o++) {
      sum += noise2d(x * freq, z * freq) * amp;
      amp *= noise.persistence;
      freq *= noise.lacunarity;
    }
    return noise.baseHeight + sum;
  }

  function craterHeight(x, z) {
    let h = 0;
    for (const c of cratersList) {
      const dx = x - c.x;
      const dz = z - c.z;
      const d2 = dx * dx + dz * dz;
      const r2 = c.radius * c.radius;
      if (d2 < r2 * 1.15) {
        const t = Math.sqrt(d2) / c.radius;
        // Dian gently, lift the rim slightly so it reads as a fresh impact.
        h -= c.depth * Math.exp(-(t * t) * 2.4);
        if (t > 0.72 && t < 1.0) h += c.rim * smoothstep(0.72, 1.0, t) * c.depth * 0.22;
      }
    }
    return h;
  }

  function flattenHeight(x, z, h) {
    let out = h;
    for (const f of flatten) {
      const dx = x - f.x;
      const dz = z - f.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d < f.radius) {
        const w = smoothstep(f.radius, f.radius * 0.55, d);
        out = lerp(out, f.target, w);
      }
    }
    return out;
  }

  function sample(x, z) {
    let h = fbm(x, z) + craterHeight(x, z);
    h = Math.max(h, cfg.world ? cfg.world.yMin : 0);
    h = flattenHeight(x, z, h);
    return h;
  }

  const EPS = 3.0; // sampling step for slope/normal (fine enough at 8u grid)

  function getHeightAt(x, z) {
    return sample(x, z);
  }

  function getSlopeDeg(x, z) {
    const hx = sample(x + EPS, z) - sample(x - EPS, z);
    const hz = sample(x, z + EPS) - sample(x, z - EPS);
    const mag = Math.sqrt(hx * hx + hz * hz) / (2 * EPS);
    return Math.atan(mag) * (180 / Math.PI);
  }

  function getNormalAt(x, z) {
    const hx = sample(x + EPS, z) - sample(x - EPS, z);
    const hz = sample(x, z + EPS) - sample(x, z - EPS);
    const nx = -hx / (2 * EPS);
    const ny = 1;
    const nz = -hz / (2 * EPS);
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    return { x: nx / len, y: ny / len, z: nz / len };
  }

  function heightAt(ix, iz) {
    return getHeightAt(-half + ix * cell, -half + iz * cell);
  }

  return {
    size, segments, half, cell,
    getHeightAt, getSlopeDeg, getNormalAt, heightAt,
    sample, fbm, cratersList
  };
}

export default createTerrain;