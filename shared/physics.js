// Shared tank physics used by BOTH the authoritative server sim and the
// client's prediction. Pure deterministic math (no engines), so the two sides
// agree to within floating point noise, and any residual drift is corrected by
// normal server reconciliation.
//
// A tank state is a plain object:
//   { x, z, y, yaw, speed, turretYaw, elev, dead }
// World convention: +Z is forward at yaw 0, +Y up, +X right. Heading matches
// the movement formula dx = sin(yaw)*s, dz = cos(yaw)*s.

import { clamp, angleDelta, approach, approachAngle } from '../src/utils/Math.js';

const HULL_PROFILE = 1.05; // collision radius factor applied to half-length

export function profileRadius(def) {
  return def.body.halfLength * HULL_PROFILE;
}

// Step hull movement. Returns a NEW modified copy of `state`.
// - def: the tank definition (body/lift), eff: effectiveMovement() result
// - boxes: static OBB list (may be null on the client until first snapshot)
export function stepTank(state, input, dt, def, eff, terrain, boxes, cfg) {
  const s = { ...state };

  if (s.dead) return s;

  const m = eff;
  const brake = !!input.brake;
  const fwd = clamp(input.fwd || 0, -1, 1);
  const steer = clamp(input.steer || 0, -1, 1);

  let target = 0;
  if (fwd > 0.05) target = m.maxForward;
  else if (fwd < -0.05) target = -m.maxReverse;

  if (brake) {
    s.speed = approach(s.speed, 0, m.brakeDecel * dt);
  } else if (target !== 0) {
    const rate = target > 0 ? m.accel : m.reverseAccel;
    s.speed = approach(s.speed, target, rate * dt);
  } else {
    s.speed = approach(s.speed, 0, m.coastDecel * dt);
  }

  // Terrain slope bleeds speed: uphill slows, downhill gives a slight push.
  const h0 = terrain.getHeightAt(s.x, s.z);
  const fwdSlope = (terrain.getHeightAt(s.x + Math.sin(s.yaw) * 1.5, s.z + Math.cos(s.yaw) * 1.5) - h0) / 1.5;
  let slopeFactor = 1 - Math.max(0, fwdSlope) * m.slopeScale;
  if (fwdSlope < -0.05) slopeFactor = Math.min(1.2, 1 + -fwdSlope * 0.12);
  s.speed *= clamp(slopeFactor, 0.2, 1.2);

  // Steering: full-strength near max speed, slow pivot when nearly static.
  const speedFactor = clamp(Math.abs(s.speed) / cfg.physics.turnAtSpeed, m.pivotScale, 1.05) * Math.sign(s.speed || 1);
  s.yaw += steer * m.turnRate * dt * speedFactor;

  // Integrate.
  const nx = s.x + Math.sin(s.yaw) * s.speed * dt;
  const nz = s.z + Math.cos(s.yaw) * s.speed * dt;

  // World bounds.
  const half = terrain.size / 2;
  const margin = cfg.world.boundsMargin;
  if (Math.abs(nx) > half - margin || Math.abs(nz) > half - margin) {
    s.speed = 0;
    s.x = clamp(nx, -(half - margin), half - margin);
    s.z = clamp(nz, -(half - margin), half - margin);
  } else {
    s.x = nx;
    s.z = nz;
  }

  // Static blocking (buildings, bridge, ridge) + max climbable slope.
  const radius = profileRadius(def);
  if (terrain.getSlopeDeg(s.x, s.z) > cfg.world.maxSlopeDeg || tankBlockedCheck(boxes, s.x, s.z, radius)) {
    s.speed = 0;
    s.x = state.x;
    s.z = state.z;
  }

  s.y = terrain.getHeightAt(s.x, s.z) + def.body.lift;
  return s;
}

// Turret/cannon aiming. Clamps to pan limits (null = full traverse) + elevation.
export function stepTurret(state, input, dt, tdef, turretDead) {
  const s = { ...state };
  const rate = turretDead ? 0.06 : tdef.slewRate;

  let desired = input.turretYaw != null ? input.turretYaw : s.turretYaw;
  const hasPanLimit = tdef.panHalf != null;
  if (hasPanLimit) {
    const rel = angleDelta(s.yaw, desired);
    const lim = tdef.panHalf;
    if (rel > lim) desired = s.yaw + lim;
    else if (rel < -lim) desired = s.yaw - lim;
  }
  s.turretYaw = approachAngle(s.turretYaw, desired, rate * dt);

  const elevRate = rate * 0.6;
  const desiredElev = clamp(input.elev != null ? input.elev : s.elev, tdef.elevMin, tdef.elevMax);
  s.elev = approachAngle(s.elev, desiredElev, elevRate * dt);

  return s;
}

// Position a tank on the terrain given x/z + yaw (used on spawn and respawn).
export function placeTankOnTerrain(state, terrain, def) {
  return { ...state, y: terrain.getHeightAt(state.x, state.z) + def.body.lift };
}

function tankBlockedCheck(boxes, x, z, radius) {
  if (!boxes) return false;
  for (const b of boxes) {
    const dx = x - b.x;
    const dz = z - b.z;
    const lx = dx * b.cy + dz * b.sy;
    const lz = -dx * b.sy + dz * b.cy;
    const qx = clamp(lx, -b.hw, b.hw);
    const qz = clamp(lz, -b.hl, b.hl);
    const px = lx - qx;
    const pz = lz - qz;
    if (px * px + pz * pz <= radius * radius) return true;
  }
  return false;
}

export default { stepTank, stepTurret, placeTankOnTerrain, profileRadius };