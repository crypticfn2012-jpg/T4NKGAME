// Data-driven tank definitions shared by the server (authoritative sim) and
// the client (prediction + rendering). Adding a tank = adding one entry here.
//
// All values use 1 unit ≈ 1 metre. Angles are radians. Armour/penetration are
// in normalised units (not millimetres) but the ratios carry the intent:
// a heavy's front shrugs most shells, a light dies in a couple of hits.
//
// Movement fields:
//   maxForward / maxReverse  top speed (u/s)
//   accel / reverseAccel     throttle ramp (u/s^2)
//   coastDecel / brakeDecel  passive stopping / hard-stop (u/s^2)
//   turnRate                 hull yaw rate at full steering effort (rad/s)
//   slopeScale               how strongly uphill terrain bleeds speed
//   pivotScale               turning strength while nearly stationary
//
// Cannon fields:
//   damage    base hull damage per penetrating shot
//   pen       penetration vs armour (compared to effective armour)
//   reload    seconds between shots
//   projSpeed muzzle velocity (u/s)
//   spreadDeg 1σ muzzle inaccuracy (±)
//   drop      gravity multiplier applied to the shell (1 = standard)

export const TANKS = {
  vanguard: {
    id: 'vanguard',
    name: 'VANGUARD',
    clazz: 'MEDIUM',
    desc: 'Reliable main-battle tank. Balanced armour, firepower and mobility.',
    hp: 100,
    armour: { front: 92, side: 58, rear: 40, roof: 26 },
    body: { halfWidth: 2.4, halfLength: 4.9, height: 1.6, lift: 1.32 },
    movement: {
      maxForward: 34, maxReverse: 17,
      accel: 24, reverseAccel: 15,
      coastDecel: 14, brakeDecel: 80,
      turnRate: 1.45, slopeScale: 0.55, pivotScale: 0.22
    },
    turret: { slewRate: 1.55, elevMin: -0.14, elevMax: 0.34, panHalf: null },
    cannon: { damage: 24, pen: 98, reload: 2.6, projSpeed: 135, spreadDeg: 1.1, drop: 1.0 },
    components: { tracks: 30, engine: 30, turret: 30, cannon: 30 },
    paint: { primary: 0x4c5c3c, accent: 0x3a4730 }
  },

  bulwark: {
    id: 'bulwark',
    name: 'BULWARK',
    clazz: 'HEAVY',
    desc: 'Slow fortress. Sloped frontal armour shrugs off most shells.',
    hp: 150,
    armour: { front: 132, side: 84, rear: 58, roof: 34 },
    body: { halfWidth: 3.0, halfLength: 5.6, height: 1.85, lift: 1.5 },
    movement: {
      maxForward: 26, maxReverse: 13,
      accel: 14, reverseAccel: 9,
      coastDecel: 12, brakeDecel: 78,
      turnRate: 0.95, slopeScale: 0.7, pivotScale: 0.18
    },
    turret: { slewRate: 0.85, elevMin: -0.12, elevMax: 0.3, panHalf: null },
    cannon: { damage: 34, pen: 138, reload: 4.2, projSpeed: 118, spreadDeg: 1.0, drop: 1.1 },
    components: { tracks: 38, engine: 38, turret: 38, cannon: 38 },
    paint: { primary: 0x5d563f, accent: 0x47422f }
  },

  raptor: {
    id: 'raptor',
    name: 'RAPTOR',
    clazz: 'LIGHT',
    desc: 'Scout tank. Extremely mobile, fast-firing, lightly armoured.',
    hp: 75,
    armour: { front: 46, side: 34, rear: 24, roof: 16 },
    body: { halfWidth: 2.0, halfLength: 4.3, height: 1.45, lift: 1.22 },
    movement: {
      maxForward: 47, maxReverse: 24,
      accel: 34, reverseAccel: 20,
      coastDecel: 16, brakeDecel: 82,
      turnRate: 1.9, slopeScale: 0.42, pivotScale: 0.3
    },
    turret: { slewRate: 2.4, elevMin: -0.16, elevMax: 0.4, panHalf: null },
    cannon: { damage: 15, pen: 52, reload: 1.6, projSpeed: 155, spreadDeg: 1.6, drop: 1.0 },
    components: { tracks: 24, engine: 24, turret: 24, cannon: 24 },
    paint: { primary: 0x4a5248, accent: 0x363c33 }
  },

  basilisk: {
    id: 'basilisk',
    name: 'BASILISK',
    clazz: 'DESTROYER',
    desc: 'Casemate tank destroyer. Hulking gun, limited traverse.',
    hp: 100,
    armour: { front: 110, side: 48, rear: 32, roof: 24 },
    body: { halfWidth: 2.5, halfLength: 5.8, height: 1.6, lift: 1.35 },
    movement: {
      maxForward: 30, maxReverse: 15,
      accel: 18, reverseAccel: 11,
      coastDecel: 13, brakeDecel: 76,
      turnRate: 1.1, slopeScale: 0.62, pivotScale: 0.2
    },
    turret: { slewRate: 0.65, elevMin: -0.1, elevMax: 0.26, panHalf: 1.05 },
    cannon: { damage: 44, pen: 165, reload: 5.5, projSpeed: 175, spreadDeg: 0.7, drop: 0.85 },
    components: { tracks: 30, engine: 30, turret: 30, cannon: 34 },
    paint: { primary: 0x43483e, accent: 0x2f332c }
  }
};

export const TANK_LIST = Object.values(TANKS);

export function getTank(id) {
  return TANKS[id] || TANKS.vanguard;
}

// Effective movement stats after component damage (server-authoritative).
// Returns a plain object the shared sim can step with.
export function effectiveMovement(tankDef, components = null) {
  const m = tankDef.movement;
  const out = { ...m };
  if (!components) return out;
  const trackDown = (components.tracks || 100) <= 0;
  const engineDown = (components.engine || 100) <= 0;
  if (trackDown) {
    out.maxForward *= 0.45;
    out.maxReverse *= 0.45;
    out.turnRate *= 0.5;
    out.accel *= 0.6;
    out.reverseAccel *= 0.6;
  }
  if (engineDown) {
    out.maxForward *= 0.5;
    out.maxReverse *= 0.5;
    out.accel *= 0.4;
    out.reverseAccel *= 0.4;
  }
  return out;
}

export function effectiveTurret(tankDef, components = null) {
  const t = tankDef.turret;
  const out = { ...t };
  if (components && (components.turret || 100) <= 0) out.slewRate = 0.08; // barely graunches
  return out;
}

export function cannonDead(tankDef, components = null) {
  return !!(components && (components.cannon || 100) <= 0);
}

export default TANKS;