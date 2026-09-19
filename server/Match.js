// One Team Deathmatch instance. Runs on the server only. Holds players,
// the authoritative tank simulation, shells, scoring and the match state
// machine (LOBBY → COUNTDOWN → ACTIVE → ENDED → LOBBY).

import { TANKS, getTank, effectiveMovement, effectiveTurret, cannonDead } from '../shared/tanks.js';
import { stepTank, stepTurret, placeTankOnTerrain, profileRadius } from '../shared/physics.js';
import { muzzleTransform, stepShell, spawnShell } from '../shared/ballistics.js';
import { buildWorldBoxes, generateSpawns, tankBlocked } from '../shared/colliders.js';
import { EVT, STATUS } from '../shared/protocol.js';
import { clamp, mulberry32 } from '../src/utils/Math.js';

let NEXT_MATCH = 1;

export class Match {
  constructor(cfg, terrain) {
    this.cfg = cfg;
    this.terrain = terrain;
    this.id = 'm' + NEXT_MATCH++;
    this.name = `Battlefield ${NEXT_MATCH - 1}`;
    this.boxes = buildWorldBoxes();
    this.spawns = generateSpawns(terrain, cfg, this.boxes);
    this.players = new Map(); // playerId → data
    this.shells = new Map();  // shellId → shell
    this.status = STATUS.LOBBY;
    this.timer = null;        // countdown/active/end timers
    this.timeLeft = cfg.match.timeLimit;
    this.scores = { steel: 0, iron: 0 };
    this.events = [];
    this.spawnCursor = { steel: 0, iron: 0 };
    this.broadcast = null;   // set by GameServer
    this.rand = mulberry32((cfg.terrain.seed ^ this.id.length) >>> 0);
    this.rng = () => this.rand();
  }

  get playerCount() { return this.players.size; }

  // ---------------------------------------------------------------- lifecycle

  addPlayer(p) {
    this.players.set(p.id, p);
    const team = this.pickTeam();
    p.team = team;
    p.tankId = p.tankId || 'vanguard';
    const def = getTank(p.tankId);
    this.resetTank(p, def, true);
    p.events = [];
    this.pushEvent(EVT.JOIN, { id: p.id, name: p.name, team });
    this.pushSystem(`${p.name} joined ${team.toUpperCase()} team`);
    this.checkAutoStart();
  }

  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this.pushEvent(EVT.LEAVE, { id, name: p.name });
    this.pushSystem(`${p.name} left the match`);
    if (this.status === STATUS.COUNTDOWN && this.playerCount < this.cfg.match.minPlayersToStart) {
      this.status = STATUS.LOBBY;
      this.timer = null;
    }
    if (this.playerCount === 0) return 'empty';
    return null;
  }

  selectTank(p, tankId) {
    if (!TANKS[tankId]) return;
    p.tankId = tankId;
    p.ready = true;
    if (this.status === STATUS.LOBBY) {
      this.resetTank(p, getTank(tankId), true);
    }
    this.checkAutoStart();
  }

  start() {
    if (this.status !== STATUS.LOBBY && this.status !== STATUS.COUNTDOWN) return;
    if (this.playerCount < this.cfg.match.minPlayersToStart) {
      this.pushSystem('Need at least ' + this.cfg.match.minPlayersToStart + ' players to start.');
      return;
    }
    this.status = STATUS.COUNTDOWN;
    this.timer = this.cfg.match.countdownTime;
    for (const p of this.players.values()) {
      this.resetTank(p, getTank(p.tankId), true);
      this.placeAtFreeSpawn(p);
      p.kills = 0; p.deaths = 0;
    }
    this.scores = { steel: 0, iron: 0 };
    this.shells.clear();
    this.events.push({ type: EVT.COUNTDOWN, t: this.timer });
  }

  checkAutoStart() {
    if (!this.cfg.match.autoStart) return;
    if (this.status !== STATUS.LOBBY) return;
    const ready = [...this.players.values()].filter((p) => p.ready);
    if (ready.length >= this.cfg.match.minPlayersToStart) this.start();
  }

  // ------------------------------------------------------------- tank setup

  pickTeam() {
    let steel = 0;
    let iron = 0;
    for (const p of this.players.values()) {
      if (p.team === 'steel') steel++;
      else if (p.team === 'iron') iron++;
    }
    return steel <= iron ? 'steel' : 'iron';
  }

  resetTank(p, def, place) {
    let s = {
      x: 0, z: 0, y: 0,
      yaw: 0, speed: 0,
      turretYaw: 0, elev: 0,
      dead: false
    };
    if (place) {
      const sp = this.pickSpawn(p.team);
      if (sp) {
        s.x = sp.x; s.z = sp.z; s.yaw = sp.yaw;
      }
    }
    s = placeTankOnTerrain(s, this.terrain, def);
    p.tank = s;
    p.hp = def.hp;
    p.components = {
      tracks: def.components.tracks,
      engine: def.components.engine,
      turret: def.components.turret,
      cannon: def.components.cannon
    };
    p.alive = true;
    p.dead = false;
    p.respawnTimer = 0;
    p.canFire = true;
    p.reloadTimer = 0;
    p.reloadMax = def.cannon.reload;
  }

  // Farthest-from-enemies spawning.
  pickSpawn(team) {
    const list = this.spawns[team];
    if (!list.length) return null;
    const enemies = [...this.players.values()].filter((q) => q.team !== team && q.alive);
    let best = null;
    let bestScore = -Infinity;
    for (let i = 0; i < list.length; i++) {
      const sp = list[(this.spawnCursor[team] + i) % list.length];
      let minDist = Infinity;
      for (const e of enemies) {
        const d = Math.hypot(e.tank.x - sp.x, e.tank.z - sp.z);
        if (d < minDist) minDist = d;
      }
      if (minDist === Infinity) minDist = 1e6;
      // penalise closeness to any player (not just enemies) a bit
      for (const q of this.players.values()) {
        if (q.alive && q.id !== undefined) {
          const d = Math.hypot(q.tank.x - sp.x, q.tank.z - sp.z);
          if (d < 24) { minDist = Math.min(minDist, d); }
        }
      }
      const score = minDist;
      if (score > bestScore) { bestScore = score; best = sp; }
    }
    this.spawnCursor[team] = (this.spawnCursor[team] + 1) % list.length;
    return best;
  }

  pushSystem(text) {
    this.events.push({ type: EVT.MSG, text });
  }

  pushEvent(type, data) {
    this.events.push({ type, ...data });
  }

  // -------------------------------------------------------------------- tick

  update(dt, now) {
    this.events = [];
    this.shellStep(dt);

    if (this.status === STATUS.COUNTDOWN) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.status = STATUS.ACTIVE;
        this.timeLeft = this.cfg.match.timeLimit;
        this.events.push({ type: EVT.MATCH_START, scores: { ...this.scores } });
        this.pushSystem('FIGHT!');
      }
    } else if (this.status === STATUS.ACTIVE) {
      this.tickTanks(dt, now);
      this.timeLeft -= dt;
      if (this.timeLeft <= 0 || this.scores.steel >= this.cfg.match.scoreLimit || this.scores.iron >= this.cfg.match.scoreLimit) {
        this.endMatch();
      }
    } else if (this.status === STATUS.ENDED) {
      this.timer -= dt;
      if (this.timer <= 0) {
        // back to lobby for the next round
        this.status = STATUS.LOBBY;
        this.timer = null;
        this.events = [];
        this.pushSystem('Returning to match lobby…');
      }
    }

    return this.buildSnapshot(now);
  }

  tickTanks(dt) {
    for (const p of this.players.values()) {
      const def = getTank(p.tankId);
      const input = p.input || { fwd: 0, steer: 0, brake: false, ty: p.tank.turretYaw, el: p.tank.elev, fire: null };
      input.turretYaw = input.ty ?? p.tank.turretYaw;
      input.elev = input.el ?? p.tank.elev;

      if (!p.alive) {
        p.respawnTimer -= dt;
        p.tank.speed = 0;
        if (p.respawnTimer <= 0) this.respawn(p);
        continue;
      }

      // reload
      if (!p.canFire) {
        p.reloadTimer -= dt;
        if (p.reloadTimer <= 0) {
          p.canFire = true;
          p.reloadTimer = 0;
          this.pushEvent(EVT.RELOADED, { id: p.id });
        }
      }

      const eff = effectiveMovement(def, p.components);
      const moves = stepTank(p.tank, input, dt, def, eff, this.terrain, this.boxes, this.cfg);
      const turret = stepTurret(moves, input, dt, effectiveTurret(def, p.components), (p.components.turret || 100) <= 0);
      p.tank = turret;

      // player requested fire
      if (input.fire && p.canFire && !cannonDead(def, p.components)) {
        this.fire(p, def, input.fire);
      }
    }

    // tank-vs-tank separation (cheap circle push-apart).
    const list = [...this.players.values()].filter((p) => p.alive);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const dx = b.tank.x - a.tank.x;
        const dz = b.tank.z - a.tank.z;
        const min = profileRadius(getTank(a.tankId)) + profileRadius(getTank(b.tankId)) - 0.6;
        const d2 = dx * dx + dz * dz;
        if (d2 < min * min && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const push = (min - d) / 2;
          const nx = dx / d;
          const nz = dz / d;
          if (!tankBlocked(this.boxes, a.tank.x - nx * push, a.tank.z - nz * push, 1)) {
            a.tank.x -= nx * push;
            a.tank.z -= nz * push;
            a.tank.y = this.terrain.getHeightAt(a.tank.x, a.tank.z) + getTank(a.tankId).body.lift;
          }
          if (!tankBlocked(this.boxes, b.tank.x + nx * push, b.tank.z + nz * push, 1)) {
            b.tank.x += nx * push;
            b.tank.z += nz * push;
            b.tank.y = this.terrain.getHeightAt(b.tank.x, b.tank.z) + getTank(b.tankId).body.lift;
          }
        }
      }
    }
  }

  fire(p, def, cmd) {
    const muzzle = muzzleTransform(p.tank);
    const id = `${p.id}:${cmd}`;
    const shell = spawnShell(
      { id, owner: p.id, team: p.team, x: muzzle.x, y: muzzle.y, z: muzzle.z, vx: 0, vy: 0, vz: 0, t: 0 },
      muzzle,
      def.cannon.projSpeed,
      def.cannon.spreadDeg * (Math.PI / 180)
    );
    this.shells.set(id, shell);
    p.canFire = false;
    p.reloadTimer = def.cannon.reload;
    this.pushEvent(EVT.SHOT, {
      id,
      from: p.id,
      x: shell.x, y: shell.y, z: shell.z,
      dx: shell.vx, dy: shell.vy, dz: shell.vz,
      speed: def.cannon.projSpeed,
      team: p.team
    });
  }

  respawn(p) {
    const def = getTank(p.tankId);
    this.resetTank(p, def, true);
    this.placeAtFreeSpawn(p);
    this.pushEvent(EVT.RESPAWN, { id: p.id, x: p.tank.x, y: p.tank.y, z: p.tank.z, yaw: p.tank.yaw });
    this.pushSystem(`${p.name} re-deployed`);
  }

  placeAtFreeSpawn(p) {
    // avoid stacking on teammates
    for (let attempt = 0; attempt < 6; attempt++) {
      const sp = this.pickSpawn(p.team);
      if (!sp) break;
      let crowded = false;
      for (const q of this.players.values()) {
        if (q === p || !q.alive) continue;
        if (Math.hypot(q.tank.x - sp.x, q.tank.z - sp.z) < 30) { crowded = true; break; }
      }
      if (!crowded) {
        p.tank.x = sp.x; p.tank.z = sp.z; p.tank.yaw = sp.yaw;
        p.tank = placeTankOnTerrain(p.tank, this.terrain, getTank(p.tankId));
        return;
      }
    }
    p.tank = placeTankOnTerrain(p.tank, this.terrain, getTank(p.tankId));
  }

  // --------------------------------------------------------------- shells

  shellStep(dt) {
    for (const [id, shell] of this.shells) {
      const drop = getTank(this.shellOwnerTankId(shell.owner)).cannon.drop ?? 1.0;
      // substep to avoid tunnelling
      const dist = Math.hypot(shell.vx, shell.vy, shell.vz) * dt;
      const steps = Math.max(1, Math.ceil(dist / this.cfg.physics.shellSegment));
      let done = false;
      for (let i = 0; i < steps && !done; i++) {
        const sdt = dt / steps;
        const x0 = shell.x, y0 = shell.y, z0 = shell.z;
        const alive = stepShell(shell, sdt, this.cfg, drop);
        if (!alive) { this.removeShell(id, shell, 'lifetime'); done = true; break; }

        const ground = this.terrain.getHeightAt(shell.x, shell.z);
        if (shell.y <= ground) {
          this.impactGround(shell, x0, y0, z0);
          this.removeShell(id, shell, 'ground');
          done = true;
          break;
        }
        const box = this.segmentHitsBoxes(x0, y0, z0, shell.x, shell.y, shell.z, 2);
        if (box) {
          this.impactWorld(shell, box);
          this.removeShell(id, shell, 'prop');
          done = true;
          break;
        }
        const hit = this.hitTank(shell);
        if (hit) { done = true; break; }
      }
    }
  }

  segmentHitsBoxes(x0, y0, z0, x1, y1, z1, subs) {
    for (let i = 0; i < subs; i++) {
      const t = (i + 0.5) / subs;
      const x = x0 + (x1 - x0) * t;
      const y = y0 + (y1 - y0) * t;
      const z = z0 + (z1 - z0) * t;
      for (const b of this.boxes) {
        if (y < b.y0 || y > b.y1) continue;
        const dx = x - b.x;
        const dz = z - b.z;
        const lx = dx * b.cy + dz * b.sy;
        const lz = -dx * b.sy + dz * b.cy;
        if (Math.abs(lx) <= b.hw && Math.abs(lz) <= b.hl) return { x, y, z };
      }
    }
    return null;
  }

  shellOwnerTankId(ownerId) {
    const p = this.players.get(ownerId);
    return p ? p.tankId : 'vanguard';
  }

  hitTank(shell) {
    for (const q of this.players.values()) {
      if (!q.alive || q.team === shell.team) continue;
      const def = getTank(q.tankId);
      const dx = shell.x - q.tank.x;
      const dz = shell.z - q.tank.z;
      const d2 = dx * dx + dz * dz;
      const reachX = def.body.halfWidth + 1.0;
      const reachZ = def.body.halfLength + 1.2;
      if (d2 > reachZ * reachZ) continue;
      // bounding-box check in the hull's local frame
      const cy = Math.cos(q.tank.yaw);
      const sy = Math.sin(q.tank.yaw);
      const lx = dx * cy - dz * sy;
      const lz = dx * sy + dz * cy;
      if (Math.abs(lx) > reachX) continue;
      if (shell.y < q.tank.y - def.body.height * 0.6 - 0.6 || shell.y > q.tank.y + def.body.height * 1.0 + 1.2) continue;
      this.resolveHit(shell, q, lx, lz);
      this.shells.delete(shell.id);
      return true;
    }
    return false;
  }

  resolveHit(shell, victim, lx, lz) {
    const def = getTank(victim.tankId);
    const shooter = this.players.get(shell.owner);
    const shooterDef = shooter ? getTank(shooter.tankId) : getTank('vanguard');

    // hit zone
    const hl = def.body.halfLength;
    const hw = def.body.halfWidth;
    let zone = 'side';
    if (shell.y - victim.tank.y > def.body.height * 0.5) zone = 'roof';
    else if (Math.abs(lz) > hl * 0.55) zone = lz > 0 ? 'front' : 'rear';
    else if (Math.abs(lx) > hw * 0.85) zone = 'side';

    // armour vs impact angle
    const armour = def.armour[zone];
    const speed = Math.hypot(shell.vx, shell.vy, shell.vz);
    const dir = { x: shell.vx / speed, y: shell.vy / speed, z: shell.vz / speed };

    const cy = Math.cos(victim.tank.yaw);
    const sy = Math.sin(victim.tank.yaw);
    let nx, ny, nz;
    if (zone === 'front') { nx = sy; ny = 0; nz = cy; }
    else if (zone === 'rear') { nx = -sy; ny = 0; nz = -cy; }
    else if (zone === 'roof') { nx = 0; ny = 1; nz = 0; }
    else { const s = Math.sign(lx) || 1; nx = cy * s; ny = 0; nz = -sy * s; }

    const cosAng = clamp(-(dir.x * nx + dir.y * ny + dir.z * nz), 0, 1);
    const ang = Math.acos(cosAng);
    const effective = armour / Math.max(Math.cos(ang), 0.18);

    // range falloff on penetration
    const sx = shooter ? shooter.tank.x : shell.x;
    const sz = shooter ? shooter.tank.z : shell.z;
    const range = Math.hypot(shell.x - sx, 0, shell.z - sz);
    if (!Number.isFinite(range)) range = 0;
    const pen = shooterDef.cannon.penetration * (1 - Math.min(0.35, range / 10000 * 0.35));

    let dmg;
    let overmatch = false;
    if (!Number.isFinite(effective)) effective = armour;
    if (pen < effective) {
      dmg = shooterDef.cannon.damage * 0.28; // richochet / dink
      overmatch = true;
    } else {
      dmg = shooterDef.cannon.damage * clamp(pen / effective, 0.6, 1.15) * (0.92 + this.rng() * 0.16);
    }
    if (!Number.isFinite(dmg) || dmg <= 0) dmg = shooterDef.cannon.damage * 0.5;

    // component damage
    const compHurt = Math.max(6, dmg * 0.55);
    let comp = null;
    const roll = this.rng();
    if (zone === 'roof') { comp = 'turret'; }
    else if (zone === 'rear') { comp = roll < 0.6 ? 'engine' : roll < 0.85 ? 'tracks' : null; }
    else if (zone === 'side') { comp = roll < 0.5 ? 'tracks' : roll < 0.7 ? 'engine' : null; }
    else if (zone === 'front') { comp = roll < 0.25 ? (roll < 0.12 ? 'cannon' : 'turret') : null; }
    if (comp) {
      victim.components[comp] = Math.max(0, victim.components[comp] - compHurt);
    }

    victim.hp = Number.isFinite(victim.hp) ? victim.hp - dmg : def.hp - dmg;

    const hitEvt = {
      from: shell.owner,
      target: victim.id,
      dmg: Math.round(dmg),
      zone,
      comp: comp || null,
      overmatch,
      targetHP: Math.max(0, Math.round(victim.hp))
    };
    this.events.push({ type: EVT.HIT, ...hitEvt });
    this.events.push({
      type: EVT.IMPACT,
      kind: 'tank',
      x: shell.x, y: shell.y, z: shell.z,
      zone, from: shell.owner, target: victim.id
    });

    if (victim.hp <= 0) this.kill(shell.owner, victim);
  }

  kill(shooterId, victim) {
    victim.alive = false;
    victim.dead = true;
    victim.hp = 0;
    victim.respawnTimer = this.cfg.match.respawnTime;
    victim.tank.speed = 0;
    victim.deaths++;
    const shooter = this.players.get(shooterId);
    if (shooter && shooter !== victim) {
      shooter.kills++;
      this.scores[shooter.team]++;
      this.pushEvent(EVT.KILL, {
        killer: shooterId, killerName: shooter.name, killerTeam: shooter.team,
        victim: victim.id, victimName: victim.name, victimTeam: victim.team
      });
    } else {
      this.pushEvent(EVT.KILL, {
        killer: null, killerName: 'The battlefield', killerTeam: null,
        victim: victim.id, victimName: victim.name, victimTeam: victim.team
      });
    }
    this.pushEvent(EVT.DEATH, { id: victim.id });
    this.pushSystem(`${victim.name} destroyed${shooter && shooter !== victim ? ` by ${shooter.name}` : ''}`);
    this.events.push({
      type: 'explosion', x: victim.tank.x, y: victim.tank.y + defOf(victim).body.height * 0.3, z: victim.tank.z
    });
  }

  removeShell(id, shell, reason) {
    this.shells.delete(id);
  }

  impactGround(shell) {
    this.events.push({
      type: EVT.IMPACT,
      kind: 'ground',
      x: shell.x,
      y: Math.max(this.terrain.getHeightAt(shell.x, shell.z), shell.y),
      z: shell.z,
      from: shell.owner
    });
  }

  impactWorld(shell, box) {
    this.events.push({ type: EVT.IMPACT, kind: 'prop', x: box.x, y: box.y, z: box.z, from: shell.owner });
  }

  // ------------------------------------------------------------------- snap

  endMatch() {
    this.status = STATUS.ENDED;
    this.timer = this.cfg.match.returnToLobbyAfterMs / 1000;
    const winner = this.scores.steel === this.scores.iron ? null : (this.scores.steel > this.scores.iron ? 'steel' : 'iron');
    const stats = [...this.players.values()].map((p) => ({
      id: p.id, name: p.name, team: p.team,
      kills: p.kills, deaths: p.deaths,
      tank: p.tankId
    }));
    this.events.push({ type: EVT.MATCH_END, scores: { ...this.scores }, winner, stats });
    this.pushSystem(winner ? `${this.cfg.teams[winner].name} wins the battle!` : 'The battle ends in a draw!');
  }

  buildSnapshot(now) {
    const tanks = [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      team: p.team,
      tankId: p.tankId,
      x: round2(p.tank.x), y: round2(p.tank.y), z: round2(p.tank.z),
      yaw: round3(p.tank.yaw), turretYaw: round3(p.tank.turretYaw), elev: round3(p.tank.elev),
      speed: round2(p.tank.speed),
      hp: Math.max(0, Math.round(p.hp)),
      alive: p.alive,
      respawnT: round1(p.respawnTimer),
      reloadPct: p.canFire ? 1 : clamp(1 - p.reloadTimer / p.reloadMax, 0, 1),
      canFire: p.canFire,
      tr: p.components.tracks, en: p.components.engine,
      tu: p.components.turret, cn: p.components.cannon,
      kills: p.kills, deaths: p.deaths,
      ping: p.ping | 0
    }));

    const shells = [...this.shells.values()].map((s) => ({
      id: s.id, team: s.team,
      x: round2(s.x), y: round2(s.y), z: round2(s.z),
      vx: round2(s.vx), vy: round2(s.vy), vz: round2(s.vz)
    }));

    const events = this.events.filter((e) => e.type !== EVT.COUNTDOWN);
    const snap = {
      type: 'snap',
      t: round2(now),
      matchId: this.id,
      status: this.status,
      timeLeft: round1(Math.max(0, this.status === STATUS.ACTIVE ? this.timeLeft : this.timeLeft)),
      countdown: this.status === STATUS.COUNTDOWN ? Math.max(0, Math.ceil(this.timer)) : null,
      scores: { ...this.scores },
      tanks,
      shells,
      events
    };
    if (this.status === STATUS.ENDED) snap.timer = round1(this.timer);
    return snap;
  }
}

function round1(v) { return Math.round(v * 10) / 10; }
function round2(v) { return Math.round(v * 100) / 100; }
function round3(v) { return Math.round(v * 1000) / 1000; }

function defOf(p) {
  return getTank(p.tankId);
}

export default Match;