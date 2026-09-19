// End-to-end test: boots the real game server, connects two simulated WebSocket
// clients, drives a full Team Deathmatch loop and asserts the core protocol
// contract works:
//   hello → welcome, lobby broadcasts, create/join, countdown → active,
//   inputs move tanks, firing spawns shells (SHOT + shells in snap), shells
//   impact, hits land, kills happen, scores increment, death → respawn.
//
// Run: node test/e2e.js   (must be run from the project root)
//
// Exit 0 on PASS, 1 on FAIL.

import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { angleDelta, clamp } from '../src/utils/Math.js';
import CONFIG from '../src/config.js';
import { getTank } from '../shared/tanks.js';
import { MUZZLE } from '../shared/ballistics.js';

const PORT = process.env.E2E_PORT || 3100;
const URL = `ws://127.0.0.1:${PORT}/ws`;
const HARD_TIMEOUT_MS = 100000;
const MAX_SEC = 90;

const notes = [];
const seen = {
  welcome: 0, lobby: 0, inMatch: 0, countdown: false, active: false,
  moved: false, shot: 0, shellsSeen: false, impact: 0, hit: 0,
  kill: false, death: false, respawn: false, scoreUp: false, matchEnd: null
};

function note(s) {
  notes.push(s);
  console.log('[e2e]', s);
}

// ------------------------------------------------------------------ helpers

function tryStartServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['server/index.js'], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    child.stdout.on('data', (d) => { const t = d.toString().trim(); if (t) console.log('[server]', t); });
    child.stderr.on('data', (d) => console.error('[server:err]', d.toString().trim()));
    const timeout = setTimeout(() => { child.kill(); reject(new Error('server boot timed out')); }, 8000);
    const probe = () => {
      const ws = new WebSocket(URL);
      ws.on('open', () => { ws.close(); clearTimeout(timeout); resolve(child); });
      ws.on('error', () => setTimeout(probe, 200));
    };
    probe();
  });
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// A minimal protocol client.
class Bot {
  constructor(name, tankId = 'vanguard') {
    this.name = name;
    this.tankId = tankId;
    this.ws = null;
    this.id = null;
    this.team = null;
    this.openP = new Promise((res) => { this._resolveOpen = res; });
    this.queue = [];
    this.waiters = [];
    this.snap = null;          // latest snapshot object
    this.lobby = [];
    this.state = null;         // my tank record from the latest snap
    this.theirPos = null;      // last known enemy {x, z}
    this.lastFire = 0;
    this.seq = 0;
  }

  connect() {
    this.ws = new WebSocket(URL);
    this.ws.on('open', () => {
      this.send({ type: 'hello', name: this.name, tankId: this.tankId });
      this._resolveOpen();
    });
    this.ws.on('message', (raw) => this._onMessage(JSON.parse(raw.toString())));
    this.ws.on('error', () => {});
    return this.openP;
  }

  _onMessage(msg) {
    this.queue.push(msg);
    // run the waiter queue FIFO (one at a time is enough for this test)
    while (this.waiters.length) {
      const w = this.waiters[0];
      const found = w.match(msg);
      if (found) {
        this.waiters.shift();
        clearTimeout(w.timer);
        w.resolve(msg);
      } else break; // FIFO ordering — don't skip
    }
    switch (msg.type) {
      case 'welcome':
        seen.welcome++;
        this.id = msg.playerId;
        break;
      case 'lobby':
        seen.lobby++;
        this.lobby = msg.matches;
        break;
      case 'match':
        seen.inMatch++;
        if (msg.team) this.team = msg.team;
        break;
      case 'snap':
        this._onSnap(msg);
        break;
      default:
        break;
    }
  }

  _onSnap(snap) {
    if (snap.status === 'countdown') seen.countdown = true;
    if (snap.status === 'active') seen.active = true;
    if (snap.status === 'ended' && !this.snap) seen.matchEnd = snap.status;
    this.snap = snap;
    for (const t of snap.tanks) {
      if (t.id === this.id) this.state = t;
      else this.enemy = t;
    }
    for (const s of snap.shells || []) {
      if (!seen.shellsSeen) { seen.shellsSeen = true; break; }
    }
    for (const e of snap.events || []) {
      if (e.type === 'shot') seen.shot++;
      if (e.type === 'impact') seen.impact++;
      if (e.type === 'hit') seen.hit++;
      if (e.type === 'kill') seen.kill = true;
      if (e.type === 'death') seen.death = true;
      if (e.type === 'respawn') seen.respawn = true;
    }
    if (seen.active && this.state) {
      if (!seen.moved) {
        const dist = Math.hypot(this.state.x, this.state.z);
        if (Math.abs(this.state.x) > 300 || Math.abs(this.state.z) > 300) seen.moved = true;
      }
      if (this.snapPrev) {
        if (snap.scores && this.snapPrev.scores &&
            (snap.scores.steel > this.snapPrev.scores.steel || snap.scores.iron > this.snapPrev.scores.iron)) {
          seen.scoreUp = true;
        }
      }
      this.snapPrev = snap;
    }
  }

  waitFor(matchFn, ms) {
    for (let i = 0; i < this.queue.length; i++) {
      if (matchFn(this.queue[i])) return Promise.resolve(this.queue.splice(i, 1)[0]);
    }
    return new Promise((resolve, reject) => {
      const w = { match: matchFn, resolve, timer: setTimeout(() => {
        const idx = this.waiters.indexOf(w);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(new Error(`timeout waiting for message on ${this.name}`));
      }, ms || 10000) };
      this.waiters.push(w);
    });
  }

  send(o) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o));
  }

  close() {
    if (this.ws) { try { this.ws.close(); } catch { /* noop */ } }
  }

  drive() {
    const me = this.state;
    if (!me || !this.enemy || !this.enemy.x) return;
    if (seen.active) {
      const def = getTank(this.tankId);
      const dx = this.enemy.x - me.x;
      const dz = this.enemy.z - me.z;
      const dist = Math.hypot(dx, dz);
      const targetYaw = Math.atan2(dx, dz);
      const steer = clamp(angleDelta(me.yaw, targetYaw) * 1.6, -1, 1);
      const fwd = dist > 45 ? 1 : 0;
      // aim the barrel at the enemy hull with ballistics drop (same as the client).
      const g = CONFIG.physics.shellGravity * (def.cannon.drop ?? 1.0);
      const v = def.cannon.projSpeed;
      const targetY = this.enemy.y + 1.0;
      const muzzleY = me.y + MUZZLE.y;
      const dy = targetY - muzzleY;
      const droop = (g * dist * dist) / (2 * v * v);
      const elev = clamp(Math.atan2(dy + droop, dist), def.turret.elevMin, def.turret.elevMax);
      const fire = Math.random() < 0.9 ? `c${++this.seq}` : null;
      this.send({
        type: 'input',
        f: fwd, s: steer, b: 0,
        ty: targetYaw,
        el: elev,
        fire
      });
    }
  }
}

// --------------------------------------------------------------------- main

function assert(cond, label) {
  if (cond) { note(`PASS ${label}`); return; }
  throw new Error(`ASSERT FAIL: ${label}`);
}

async function main() {
  const server = await tryStartServer().catch((e) => {
    console.error('Failed to start server:', e.message);
    process.exit(1);
  });
  note(`server up on :${PORT}`);

  const A = new Bot('Alpha');
  const B = new Bot('Bravo');
  await Promise.all([A.connect(), B.connect()]);

  // greet round-trip
  await A.waitFor((m) => m.type === 'welcome');
  await B.waitFor((m) => m.type === 'welcome');
  assert(A.id && B.id && A.id !== B.id, 'welcome assigns distinct player ids');

  // A creates a match, B joins it
  A.send({ type: 'create' });
  await A.waitFor((m) => m.type === 'match' && m.inMatch === true);
  const matchId = A.queue.find((m) => m.type === 'match')?.matchId;
  note(`A in match ${matchId}`);

  await B.waitFor((m) => m.type === 'lobby' && m.matches && m.matches.some((x) => x.id === matchId), 8000);
  B.send({ type: 'join', matchId, tankId: 'vanguard' });
  await B.waitFor((m) => m.type === 'match' && m.inMatch === true && (m.team === 'steel' || m.team === 'iron'));
  // team tag is only in the JOIN ack; find it from snapshot records instead.
  await A.waitFor((m) => m.type === 'snap' && m.tanks && m.tanks.some((t) => t.id === A.id && t.team), 8000);
  A.team = (A.snap.tanks.find((t) => t.id === A.id) || {}).team;
  assert(A.team && B.team && A.team !== B.team, 'players assigned to opposing teams');

  // auto-start should fire; send start anyway as a fallback
  async function sendStart() {
    const pre = A.snap?.status;
    if (pre === 'active' || pre === 'countdown') return;
    A.send({ type: 'start' });
    await delay(250);
  }
  await sendStart();

  // drive + observe until we see the full loop or the clock runs out
  const t0 = Date.now();
  let lastReport = 0;
  while (Date.now() - t0 < MAX_SEC * 1000 && !(seen.kill && seen.death && seen.respawn && seen.scoreUp)) {
    A.drive();
    B.drive();
    if (Date.now() - lastReport > 15000) {
      lastReport = Date.now();
      note(`t=${((Date.now() - t0) / 1000) | 0}s  hit=${seen.hit} kill=${seen.kill} impact=${seen.impact} shot=${seen.shot}${A.state ? ` A=${A.state.x.toFixed(0)},${A.state.z.toFixed(0)}` : ''}${B.state ? ` B=${B.state.x.toFixed(0)},${B.state.z.toFixed(0)}` : ''}`);
    }
    await delay(33);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  // --------------------------------------------------------------- asserts
  assert(seen.countdown, `countdown state reached (${elapsed}s)`);
  assert(seen.active, 'active state reached');
  assert(seen.moved, 'tanks moved under input');
  assert(seen.shot > 0, `SHOT events observed (${seen.shot})`);
  assert(seen.shellsSeen, 'shells present in snapshots');
  assert(seen.impact > 0, `IMPACT events observed (${seen.impact})`);
  assert(seen.hit > 0, `HIT events observed (${seen.hit})`);
  assert(seen.kill, 'KILL event observed');
  assert(seen.death, 'DEATH event observed');
  assert(seen.respawn, 'RESPAWN event observed');
  assert(seen.scoreUp, 'team score incremented after a kill');

  note(`==== E2E PASS after ${elapsed}s ====`);
  console.log('[e2e] summary:', JSON.stringify(seen, null, 0));

  A.close(); B.close(); server.kill();
  process.exit(0);
}

const timeout = setTimeout(() => {
  console.error('[e2e] HARD TIMEOUT reached. Failing.');
  process.exit(1);
}, HARD_TIMEOUT_MS);

main().catch((err) => {
  console.error('[e2e] FAIL:', err && err.message || err);
  notes.forEach((n) => console.log('  ·', n));
  process.exit(1);
}).finally(() => clearTimeout(timeout));