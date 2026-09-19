// Static battlefield collision definitions shared by server and client, plus
// deterministic spawn-point generation for Team Deathmatch.
//
// Landmark OBBs (2D boxes with a height range) block tank movement AND stop
// shells. Terrain handles everything else. Keeping these in one file means the
// visuals (EnvironmentBuilder) and the gameplay sim can never drift apart.

import { mulberry32, TAU, clamp } from '../src/utils/Math.js';

export const LANDMARK_DEFS = [
  {
    type: 'tower', x: 480, z: -350, yaw: 0.4,
    boxes: [{ cx: 0, cz: 0, hw: 7, hl: 7, y0: 0, y1: 46 }]
  },
  {
    type: 'depot', x: -600, z: 150, yaw: 0.6,
    boxes: [{ cx: 0, cz: 0, hw: 8.4, hl: 6.8, y0: 0, y1: 11 }]
  },
  {
    type: 'bunker', x: 300, z: -420, yaw: 0.8,
    boxes: [{ cx: 0, cz: 0, hw: 5.6, hl: 4.7, y0: 0, y1: 7 }]
  },
  {
    type: 'bridge', x: -150, z: -620, yaw: 0.3,
    boxes: [
      { cx: -3.0, cz: 0, hw: 4.0, hl: 2.4, y0: 5.0, y1: 8.5 },
      { cx: 5.2, cz: 0, hw: 4.0, hl: 2.4, y0: 3.5, y1: 8.5 },
      { cx: -7.0, cz: 0, hw: 1.4, hl: 2.0, y0: 0, y1: 13.5 },
      { cx: 0.6, cz: 0, hw: 1.4, hl: 2.0, y0: 0, y1: 6.5 }
    ]
  },
  {
    type: 'ridge', x: 0, z: 620, yaw: 0,
    boxes: [{ cx: 0, cz: 0, hw: 26, hl: 26, y0: -5, y1: 26 }]
  }
];

// Build the static OBB list once. Each box is stored with its local basis so a
// 2D point-in-OBB test is cheap.
export function buildWorldBoxes(landmarks = LANDMARK_DEFS) {
  const out = [];
  for (const lm of landmarks) {
    const cy = Math.cos(lm.yaw);
    const sy = Math.sin(lm.yaw);
    for (const b of lm.boxes) {
      out.push({
        x: lm.x + b.cx * cy - b.cz * sy,
        z: lm.z + b.cx * sy + b.cz * cy,
        hw: b.hw, hl: b.hl,
        y0: b.y0, y1: b.y1,
        yaw: lm.yaw,
        cy, sy
      });
    }
  }
  return out;
}

// Transform a world point into a box's local 2D frame.
function toLocal(box, x, z) {
  const dx = x - box.x;
  const dz = z - box.z;
  return {
    lx: dx * box.cy + dz * box.sy,
    lz: -dx * box.sy + dz * box.cy
  };
}

// Is a point (with optional radius) inside or within `pad` of any box?
export function pointBlocked(boxes, x, z, pad = 0) {
  for (const b of boxes) {
    const { lx, lz } = toLocal(b, x, z);
    if (Math.abs(lx) <= b.hw + pad && Math.abs(lz) <= b.hl + pad) return true;
  }
  return false;
}

// Is a tank (circle of `radius`) colliding with any box?
export function tankBlocked(boxes, x, z, radius) {
  for (const b of boxes) {
    const { lx, lz } = toLocal(b, x, z);
    const qx = clamp(lx, -b.hw, b.hw);
    const qz = clamp(lz, -b.hl, b.hl);
    const dx = lx - qx;
    const dz = lz - qz;
    if (dx * dx + dz * dz <= radius * radius) return true;
  }
  return false;
}

// Does a straight segment (p0→p1 at fixed height y) clip any box? Used for
// shell sub-step sampling.
export function segmentHitsBox(boxes, x0, y0, z0, x1, y1, z1, steps) {
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    const z = z0 + (z1 - z0) * t;
    for (const b of boxes) {
      if (y < b.y0 || y > b.y1) continue;
      const { lx, lz } = toLocal(b, x, z);
      if (Math.abs(lx) <= b.hw && Math.abs(lz) <= b.hl) return { hit: true, x, y, z, box: b };
    }
  }
  return { hit: false };
}

const WORLD = { boundsMargin: 60, maxSlopeDeg: 35 };

// Generate deterministic spawn points for each team around its base.
// Points are pushed flat (slope < ~7°) and clear of buildings and the enemy
// spawn zone.
export function generateSpawns(terrain, cfg, boxes) {
  const margin = cfg.world.boundsMargin;
  const half = terrain.size / 2;
  const rng = mulberry32((cfg.terrain.seed ^ 0x9e3779b9) >>> 0);

  const result = { steel: [], iron: [] };

  const teamOf = (key) => cfg.teams[key];

  for (const key of ['steel', 'iron']) {
    const team = teamOf(key);
    const [bx, bz] = team.base;
    const radius = team.spawnRadius;

    const candidates = [];
    for (let attempt = 0; attempt < 40; attempt++) {
      const ang = rng() * TAU;
      const r = 30 + rng() * (radius - 30);
      const x = bx + Math.cos(ang) * r;
      const z = bz + Math.sin(ang) * r;
      if (Math.abs(x) > half - margin || Math.abs(z) > half - margin) continue;
      const slope = terrain.getSlopeDeg(x, z);
      const y = terrain.getHeightAt(x, z);
      if (y < cfg.world.yMin + 0.5) continue;
      if (slope > 7.5) continue;
      if (tankBlocked(boxes, x, z, 3.4)) continue;
      // Keep away from the enemy base.
      const other = key === 'steel' ? teamOf('iron').base : teamOf('steel').base;
      const ddx = x - other[0], ddz = z - other[1];
      if (ddx * ddx + ddz * ddz < (radius + 90) * (radius + 90)) continue;
      candidates.push({ x, z, y, slope, ang });
    }
    // Pick the 10 flattest, most spread candidates.
    candidates.sort((a, b) => a.slope - b.slope || b.ang - a.ang);
    const chosen = new Set();
    const points = [];
    for (const c of candidates) {
      if (points.length >= 10) break;
      let ok = true;
      for (const p of points) {
        const ddx = p.x - c.x, ddz = p.z - c.z;
        if (ddx * ddx + ddz * ddz < 18 * 18) { ok = false; break; }
      }
      if (!ok) continue;
      points.push(c);
      chosen.add(c.ang);
    }
    // Face the point roughly toward the battlefield centre (map centre).
    const centre = { x: (team.base[0] > 0 ? -1 : 1) * 10, z: (team.base[1] > 0 ? -1 : 1) * 10 };
    result[key] = points.map((c, i) => ({
      x: c.x,
      z: c.z,
      yaw: Math.atan2(centre.x - c.x, centre.z - c.z) // heading toward centre
    }));
  }

  return result;
}

export const WORLD_CFG = WORLD;