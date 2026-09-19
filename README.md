# TANKFIELD

Browser multiplayer tank combat. Real-time Team Deathmatch — 10v10 rules,
600-second battles, server-authoritative physics at 30 Hz, client-side
prediction and interpolation over WebSocket.

Everything is procedural: terrain, tanks, effects and audio are generated in
code. No image or audio assets.

## Run locally

```bash
npm install

# 1. build the client
npm run build

# 2. start the game server (Node >= 20)
npm start
# or: PORT=8080 node server/index.js
```

Open `http://localhost:3000`, click MULTIPLAYER, create or join a battle.

Dev mode (hot reload + `/ws` proxied to `localhost:3000`):

```bash
npm run dev          # vite dev server on :5173
node server/index.js # game server on :3000 (or PORT=…)
```

## How it works

| Layer | Path | Notes |
| --- | --- | --- |
| Shared deterministic sim | `shared/` | physics, ballistics, terrain, tanks, protocol — used by **both** server & client |
| Authoritative server | `server/` | `ws` + static `dist/`; state is computed here, clients just render it |
| Client | `src/` | prediction + reconciliation, remote interpolation, procedural rendering, synthesized audio |

- **Prediction**: the local tank is stepped locally with the exact same shared
  `stepTank`/`stepTurret`; authoritative snapshots blend it back with soft
  reconciliation (hard snap only on respawn / teleports).
- **Shells**: spawned client-side for instant feedback, then overwritten by
  the server's snapshot positions; between snapshots they re-extrapolate with
  the shared ballistics integrator.
- **Timing**: input sent at 30 Hz to match the server tick; remote tanks render
  at 0.12 s behind to hide latency.
- **Teams**: STEEL vs IRON, spawn zones at opposite corners, front armour >
  side > rear > roof, component damage (tracks/engine/turret/cannon).

## Tests

```bash
node test/sim.js   # headless server sim: movement, shells, hits, kills, respawns, scoring
node test/e2e.js   # boots the real server + two ws clients, plays a live match end-to-end
```

## Tech

- Node + `ws` (server), Three.js + Vite (client).