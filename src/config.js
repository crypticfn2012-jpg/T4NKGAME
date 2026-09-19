// Global constants, tuning parameters and feature flags.
// Everything gameplay-relevant lives here so the game is data-driven:
// match rules, teams, terrain generation, projectiles, camera feel and
// performance budgets are all tweakable without touching system code.
// The Terrain instance (shared/client) is assigned into `terrain` at boot.

import { TANKS } from '../shared/tanks.js';

const DEG = Math.PI / 180;

export const CONFIG = {
  app: {
    name: 'TANKFIELD',
    version: '1.0.0',
    title: 'TANKFIELD — Multiplayer Tank Combat'
  },

  // --- Networking ----------------------------------------------------------
  net: {
    // The server path the WebSocket connects to. In production the Node server
    // serves the built client AND answers /ws on the same origin. In dev the
    // vite server proxies /ws to the game server (see vite.config.js).
    wsPath: '/ws',
    reconnectMinMs: 1000,
    reconnectMaxMs: 8000,
    reconnectFactor: 1.6,
    pingIntervalMs: 3000,
    // Client-side rule mirrors used for prediction only; server is canonical.
    inputMaxRateHz: 30
  },

  // --- Match (Team Deathmatch) --------------------------------------------
  match: {
    mode: 'tdm',
    label: 'TEAM DEATHMATCH',
    scoreLimit: 25,
    timeLimit: 600,        // seconds
    countdownTime: 5,      // seconds of "match starting"
    respawnTime: 5,        // seconds a dead tank waits
    minPlayersToStart: 2,
    autoStart: true,       // start as soon as enough players are ready
    maxPlayersPerMatch: 10,
    returnToLobbyAfterMs: 15000, // time results screen stays up
    killScore: 1,
    killAssistDisabled: true
  },

  // --- Teams ---------------------------------------------------------------
  // base x/z are the flattened spawn zones. Colours drive paint + HUD.
  teams: {
    steel: {
      name: 'STEEL GREY',
      short: 'STEEL',
      color: '#7d8b6a',
      colorHex: 0x7d8b6a,
      base: [-620, -560],
      spawnRadius: 95
    },
    iron: {
      name: 'BURNT IRON',
      short: 'IRON',
      color: '#b0563f',
      colorHex: 0xb0563f,
      base: [620, 460],
      spawnRadius: 95
    }
  },

  // --- Physics (shared sim, 1 unit ≈ 1 meter) ------------------------------
  physics: {
    gravity: 9.81,
    fixedRate: 30,          // server tick (Hz)
    shellGravity: 9.81,
    shellDrag: 0.06,        // exponential air drag
    shellSegment: 3.0,      // substep segment length (anti-tunnelling)
    tankMinSeparation: 0.1, // residual push-apart after collision
    turnAtSpeed: 10         // speed (u/s) at which steering is full-strength
  },

  // --- Renderer ------------------------------------------------------------
  renderer: {
    antialias: true,
    pixelRatio: 1.75,       // clamp on top of devicePixelRatio
    exposure: 1.06,
    fov: 62,
    near: 0.1,
    far: 4200,
    shadowMapSize: 2048,
    precision: 'highp'
  },

  fog: { color: 0xb7a98c, density: 0.00135 },

  // --- Terrain -------------------------------------------------------------
  terrain: {
    size: 2048,             // 2048 × 2048 ≈ 4.2 km² playable area
    segments: 256,          // grid resolution → 8-unit cells
    seed: 1337,
    noise: {
      baseHeight: 15,
      amplitude: 17,
      baseFrequency: 1 / 520,
      octaves: 4,
      persistence: 0.55,
      lacunarity: 2.0
    },
    craters: { count: 5, minRadius: 18, maxRadius: 42, minDepth: 6, maxDepth: 14, rim: 0.35 },
    // Flattened areas so tanks sit on level ground near bases and objectives.
    flatten: [
      { x: -620, z: -560, radius: 135, target: 26 },
      { x: 620, z: 460, radius: 135, target: 24 },
      { x: 0, z: -60, radius: 90, target: 27 },   // central crossroads
      { x: 320, z: -160, radius: 70, target: 25 }, // mid-field objective bowl
      { x: -340, z: 240, radius: 70, target: 25 }  // west ridge clearing
    ],
    maxSlopeDeg: 45
  },

  // --- World ---------------------------------------------------------------
  world: {
    boundsMargin: 60,       // keep tanks this far inside the map edge
    minPlaceHeight: 1.5,
    yMin: 0                 // terrain floor clamp (smooth valleys, no holes)
  },

  // Exclusion zones used by the environment scatter so props never block
  // spawn lanes. Team bases (keep names for backwards compat with the
  // environment builder).
  spawn: { position: [-620, -560] },
  enemy: { position: [620, 460] },

  // --- Projectiles ---------------------------------------------------------
  projectile: {
    lifetime: 12,
    poolSize: 24,
    trailLength: 18
  },

  // --- Camera --------------------------------------------------------------
  camera: {
    distance: 17,
    minDistance: 9,
    maxDistance: 30,
    height: 8.5,
    timeConstant: 0.15,
    lookAhead: 5,
    groundClearance: 0.6,
    zoomStep: 2.5,
    pitchMin: 0.02,
    pitchMax: 1.15,
    defaultPitch: 0.42,
    shoulder: 0.6,
    mouseSensitivity: 0.0032,
    fovMin: 45,
    fovMax: 90
  },

  // --- Effects -------------------------------------------------------------
  effects: {
    maxSparks: 1600,
    maxPuffs: 800,
    maxFlashes: 8,
    maxSmoke: 400,
    maxGlows: 12,
    particleGravity: 14,
    shake: { fire: 0.12, impact: 0.3, explosion: 0.7, maxDeg: 1.6, decay: 5 },
    ca: { impact: 0.5, explosion: 0.85, decay: 6 },
    post: { vignette: 0.38, grain: 0.024 }
  },

  // --- Feature flags -------------------------------------------------------
  flags: {
    shadows: true,
    postFX: true,
    fog: true,
    pointerLock: true,
    fpsCounter: true,
    clouds: true,
    trackDust: true
  },

  // --- Tank roster ---------------------------------------------------------
  // Full stats live in shared/tanks.js; this list drives selection UI.
  tankRoster: Object.keys(TANKS),

  // --- Controls (defaults; editable in Settings) ---------------------------
  controls: {
    forward: ['KeyW', 'ArrowUp'],
    reverse: ['KeyS', 'ArrowDown'],
    left: ['KeyA', 'ArrowLeft'],
    right: ['KeyD', 'ArrowRight'],
    brake: ['Space'],
    fire: ['Mouse0'],
    reload: ['KeyR'],
    zoom: ['Mouse2'],
    pause: ['Escape'],
    menu: ['KeyM']
  }
};

// Server ticks per second — tile the render loop to this rate for prediction.
CONFIG.physics.tickMs = 1000 / CONFIG.physics.fixedRate;

export default CONFIG;