// Headless validation of the server-side simulation: terrain, spawning,
// tank physics, firing, damage, kills, respawn and the match state machine.
// Run with: npm run test:server

import CONFIG from '../src/config.js';
import { createTerrain } from '../shared/terrain.js';
import { Match } from '../server/Match.js';
import { buildWorldBoxes, generateSpawns } from '../shared/colliders.js';
import { getTank } from '../shared/tanks.js';
import { aimForPoint } from '../shared/ballistics.js';
import { STATUS, EVT } from '../shared/protocol.js';

const cfg = CONFIG;

// ---- terrain sanity
const terrain = createTerrain(cfg.terrain);
const boxes = buildWorldBoxes();
console.log('terrain size', terrain.size, 'segments', terrain.segments);
let minY = Infinity, maxY = -Infinity;
for (let i = 0; i < 4000; i++) {
  const x = (Math.random() - 0.5) * 1900;
  const z = (Math.random() - 0.5) * 1900;
  const y = terrain.getHeightAt(x, z);
  if (y < minY) minY = y;
  if (y > maxY) maxY = y;
}
console.log('terrain height range', minY.toFixed(2), '→', maxY.toFixed(2));

const spawns = generateSpawns(terrain, cfg, boxes);
for (const team of ['steel', 'iron']) {
  console.log(team, 'spawns:', spawns[team].length);
  for (const s of spawns[team]) {
    const slope = terrain.getSlopeDeg(s.x, s.z);
    if (slope > 8) console.log('  !! high-slope spawn', s, slope.toFixed(1));
  }
}

// ---- match flow
const match = new Match(cfg, terrain);
const p1 = { id: 'p1', name: 'Alpha', socket: null, tankId: 'vanguard', ready: true };
const p2 = { id: 'p2', name: 'Bravo', socket: null, tankId: 'vanguard', ready: true };
match.addPlayer(p1);
match.addPlayer(p2);
console.log('teams:', p1.team, p2.team);

let tick = 0;
const TICK = 1 / cfg.physics.fixedRate;
let now = 1000;
let fired = 0;
let hitCount = 0;
let killSeen = 0;
let respawnSeen = 0;
let firedLog = [];

// Drive both players toward map centre and fire constantly.
match.status = STATUS.ACTIVE; // skip countdown for headless speed

// place players at their spawns
for (const p of [p1, p2]) {
  match.resetTank(p, getTank(p.tankId), true);
  match.placeAtFreeSpawn(p);
}

const run = (until) => {
  while (now < until) {
    now += TICK;
    tick++;
    for (const me of [p1, p2]) {
      if (!me.alive) { me.input = { fwd: 0, steer: 0, brake: true }; continue; }
      const enemy = me === p1 ? p2 : p1;
      const def = getTank(me.tankId);
      const dx = enemy.tank.x - me.tank.x;
      const dz = enemy.tank.z - me.tank.z;
      const targetYaw = Math.atan2(dx, dz);
      const dy = ((targetYaw - me.tank.yaw + Math.PI) % (Math.PI * 2)) - Math.PI;
      const steer = clampf(dy / 0.3, -1, 1);
      const aim = aimForPoint(me.tank, { x: enemy.tank.x, y: enemy.tank.y, z: enemy.tank.z }, def, cfg);
      me.input = {
        fwd: 1,
        steer,
        brake: false,
        ty: aim.yaw,
        el: clampf(aim.elev, def.turret.elevMin, def.turret.elevMax),
        fire: me.alive && me.canFire ? 't' + tick : null
      };
      if (me.canFire && me.alive) fired++;
    }
    const snap = match.update(TICK, now);
    for (const e of snap.events) {
      if (e.type === EVT.HIT) { hitCount++; }
      if (e.type === EVT.KILL) { killSeen++; console.log('KILL:', e.killerName, 'destroyed', e.victimName, 'scores', JSON.stringify(snap.scores)); }
      if (e.type === EVT.RESPAWN) { respawnSeen++; }
    }
    if (tick % 300 === 0) {
      console.log(`t=${now.toFixed(1)} status=${snap.status} p1hp=${(p1.hp||0).toFixed(0)} p2hp=${(p2.hp||0).toFixed(0)} shells=${snap.shells.length} score=${JSON.stringify(snap.scores)}`);
    }
  }
};

run(1000 + 240);
console.log('state after 240s of fighting:');
console.log(' p1', p1.alive, 'hp', Math.round(p1.hp || 0), 'kills', p1.kills || 0, 'deaths', p1.deaths || 0, 'speed', p1.tank && p1.tank.speed.toFixed(1));
console.log(' p2', p2.alive, 'hp', Math.round(p2.hp || 0), 'kills', p2.kills || 0, 'deaths', p2.deaths || 0, 'speed', p2.tank && p2.tank.speed.toFixed(1));
console.log(' score', JSON.stringify(match.scores), 'shells', match.shells.size, 'events:' );

const checks = [];
checks.push(['fired shells', fired > 0]);
checks.push(['hits landed', hitCount > 0]);
checks.push(['kill events', killSeen > 0]);
checks.push(['respawns', respawnSeen > 0]);

// force end
match.endMatch();
console.log('end status', match.status, 'winner', match.scores.steel === match.scores.iron ? 'draw' : match.scores.steel > match.scores.iron ? 'steel' : 'iron');
console.log('scores', match.scores);

let fail = 0;
for (const [label, ok] of checks) {
  console.log((ok ? 'PASS' : 'FAIL') + ' — ' + label);
  if (!ok) fail++;
}
process.exit(fail ? 1 : 0);

function clampf(v, a, b) { return v < a ? a : v > b ? b : v; }