// Shared shell ballistics. The server advances shells; the client extrapolates
// the same way between snapshots so visuals track exactly.
//
// Shell state: { id, owner, x, y, z, vx, vy, vz, t, team }
// Muzzle transform helper mirrors the procedural tank builder's barrel layout:
//   turret pivot at (0, 1.05, 1.35) in hull space, barrel tip at local +Z 6.35.

export const MUZZLE = {
  y: 1.05,
  z: 1.35,
  length: 6.35
};

// World muzzle position/orientation for a tank state (hull + turret transforms).
export function muzzleTransform(state) {
  const L = MUZZLE.length;
  const tipY = MUZZLE.y + Math.sin(state.elev) * L;
  const tipZ = MUZZLE.z + Math.cos(state.elev) * L;

  // Rotate the local (0, tipY, tipZ) offset by turret yaw.
  const ox = Math.sin(state.turretYaw) * tipZ;
  const oz = Math.cos(state.turretYaw) * tipZ;

  // Direction: forward vector pitched by elevation, then yawed.
  const cosE = Math.cos(state.elev);
  const dir = {
    x: Math.sin(state.turretYaw) * cosE,
    y: Math.sin(state.elev),
    z: Math.cos(state.turretYaw) * cosE
  };

  return {
    x: state.x + ox,
    y: state.y + tipY,
    z: state.z + oz,
    dir
  };
}

// Compute (turretYaw, elev) so a shell fired from `state` lands on `target`,
// compensating for the shell's ballistic drop. Returns { yaw, elev }.
export function aimForPoint(state, target, def, cfg) {
  const g = cfg.physics.shellGravity * (def.cannon.drop ?? 1.0);
  const v = def.cannon.projSpeed;
  const dx = target.x - state.x;
  const dz = target.z - state.z;
  const yaw = Math.atan2(dx, dz);
  const range = Math.hypot(dx, dz) || 1;
  // muzzle sits above the hull centre; measure relative to the muzzle point.
  const muzzleY = state.y + MUZZLE.y;
  const dy = (target.y - muzzleY);
  const droop = (g * range * range) / (2 * v * v);
  const elev = Math.atan2(dy + droop, range);
  return { yaw, elev };
}

// Advance a shell by dt under gravity + quadratic drag. Returns false when its
// life is spent.
export function stepShell(shell, dt, cfg, drop = 1.0) {
  shell.t += dt;
  const g = cfg.physics.shellGravity * drop;
  const drag = 1.0 - cfg.physics.shellDrag * dt;
  shell.vy = shell.vy - g * dt;
  shell.vx *= drag;
  shell.vy *= drag;
  shell.vz *= drag;
  shell.x += shell.vx * dt;
  shell.y += shell.vy * dt;
  shell.z += shell.vz * dt;
  return shell.t <= cfg.projectile.lifetime && shell.y > -50;
}

// Random unit vector perpendicular to `d`.
function perp(d) {
  const axis = Math.abs(d.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const u = {
    x: d.y * axis.z - d.z * axis.y,
    y: d.z * axis.x - d.x * axis.z,
    z: d.x * axis.y - d.y * axis.x
  };
  const l = Math.hypot(u.x, u.y, u.z) || 1;
  return { x: u.x / l, y: u.y / l, z: u.z / l };
}

// Apply ±spreadRad (1σ) of muzzle inaccuracy inside a uniform cone.
export function spawnShell(shell, muzzle, speed, spreadRad) {
  const u = perp(muzzle.dir);
  const v = {
    x: muzzle.dir.y * u.z - muzzle.dir.z * u.y,
    y: muzzle.dir.z * u.x - muzzle.dir.x * u.z,
    z: muzzle.dir.x * u.y - muzzle.dir.y * u.x
  };
  const theta = (Math.abs(Math.random() - Math.random()) + Math.random() * 0.3) * spreadRad;
  const phi = Math.random() * Math.PI * 2;
  const cost = Math.cos(theta);
  const sint = Math.sin(theta);
  const offX = Math.cos(phi) * sint;
  const offY = Math.sin(phi) * sint;

  const dir = {
    x: muzzle.dir.x * cost + (u.x * offX + v.x * offY),
    y: muzzle.dir.y * cost + (u.y * offX + v.y * offY),
    z: muzzle.dir.z * cost + (u.z * offX + v.z * offY)
  };
  return {
    ...shell,
    x: muzzle.x, y: muzzle.y, z: muzzle.z,
    vx: dir.x * speed,
    vy: dir.y * speed,
    vz: dir.z * speed
  };
}

export default { muzzleTransform, stepShell, spawnShell };