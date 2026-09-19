// ClientGame wires the whole client experience together:
// - prediction + reconciliation of the local tank (shared deterministic sim)
// - interpolation of remote tanks from the snapshot ring buffer
// - shell extrapolation between snapshots
// - event → FX / audio / HUD feedback
// - camera + aim + input → server command stream
//
// The server is always authoritative; every interesting number shown to the
// player comes from the server's snapshot.

import * as THREE from 'three';
import CONFIG from '../config.js';
import { EVT, STATUS } from '../../shared/protocol.js';
import { getTank, effectiveMovement, effectiveTurret } from '../../shared/tanks.js';
import { stepTank, stepTurret } from '../../shared/physics.js';
import { muzzleTransform, spawnShell, aimForPoint } from '../../shared/ballistics.js';
import { buildWorldBoxes } from '../../shared/colliders.js';
import { clamp, approachAngle } from '../utils/Math.js';
import { TankView } from './TankView.js';
import { ShellView } from './ShellView.js';

const RENDER_DELAY = 0.12;   // remote interpolation delay (s)
const INPUT_RATE = 1 / 30;   // matching server tick
const MAX_SHELL_AGE = 4;     // s before a missing shell view is recycled

export class ClientGame {
  constructor({ scene, camera, materials, terrain, net, input, settings, audio, effects, cam, hud, ui }) {
    this.scene = scene;
    this.camera = camera;
    this.materials = materials;
    this.terrain = terrain;
    this.net = net;
    this.input = input;
    this.settings = settings;
    this.audio = audio;
    this.effects = effects;
    this.cam = cam;
    this.hud = hud;
    this.ui = ui;

    this.cfg = CONFIG;
    this.boxes = buildWorldBoxes();

    this.selfId = null;
    this.status = STATUS.LOBBY;
    this.matchId = null;
    this.scores = { steel: 0, iron: 0 };
    this.timeLeft = CONFIG.match.timeLimit;

    this.views = new Map();      // playerId → { view, name, team, tankId, prev, cur, smokeT }
    this.shellPool = [];
    this.shells = new Map();     // shellId → ShellView
    this.snapBuf = [];
    this.lastSnap = null;

    // prediction state
    this.selfTank = null;        // predicted local tank
    this.selfAuth = null;        // last authoritative self snapshot
    this.selfAlive = true;
    this.selfHp = CONFIG.tanks?.hp ?? 100;
    this.selfMaxHp = 100;
    this.selfReloadPct = 1;
    this.selfCanFire = true;
    this.selfKills = 0;
    this.selfDeaths = 0;
    this.components = { tracks: 30, engine: 30, turret: 30, cannon: 30 };

    this.aim = { yaw: 0, pitch: this.cfg.camera.defaultPitch };
    this.predInput = { fwd: 0, steer: 0, brake: false, turretYaw: 0, elev: 0 };
    this.lastInputSent = 0;
    this.fireSeq = 0;
    this.fireWasDown = false;
    this.aimPoint = null;

    this.inSession = false;
    this.time = 0;
    this.lastBoardRows = [];

    this._wireNet();
    this._wireInput();
  }

  // -------------------------------------------------------------- receivers

  _wireNet() {
    const n = this.net;
    n.on('welcome', (msg) => {
      this.selfId = msg.playerId;
    });
    n.on('match', (msg) => {
      if (msg.inMatch) {
        this.matchId = msg.matchId;
        this.ui.showLobbyInMatch(msg);
      } else {
        this.matchId = null;
        this._teardownSession({ showResults: false });
        this.ui.showLobby();
      }
    });
    n.on('lobby', (msg) => {
      this.ui.updateLobby(msg.matches);
    });
    n.on('snap', (snap) => this._onSnap(snap));
    n.on('error', (msg) => {
      this.hud.pushMsg(`⚠ ${msg.message || 'error'}`, { color: '#c2452f' });
    });
    n.on('close', ({ wasConnected }) => {
      this.hud.setDisconnected(true, wasConnected ? 'CONNECTION LOST — RECONNECTING…' : 'CONNECTING…');
    });
    n.on('open', () => {
      this.hud.setDisconnected(false);
    });
  }

  _wireInput() {
    this.input.on('pause', () => {
      if (this.status !== STATUS.ACTIVE && this.status !== STATUS.COUNTDOWN) return;
      this.input.unlock();
      this.hud.setPause(true);
    });
  }

  // -------------------------------------------------------------- snapshots

  _onSnap(snap) {
    if (this.status !== STATUS.LOBBY && snap.matchId !== this.matchId) return;
    const arrival = performance.now() / 1000;
    this.snapBuf.push({ snap, arrival });
    if (this.snapBuf.length > 4) this.snapBuf.shift();
    this.lastSnap = snap;

    this.status = snap.status;
    this.scores = snap.scores || { steel: 0, iron: 0 };
    this.timeLeft = snap.timeLeft;

    if (snap.status === STATUS.COUNTDOWN && this.status !== this._prevStatus) {
      this.hud.banner(`MATCH STARTING — ${snap.countdown}`, '#d9a13c');
      this.audio.countdown();
      if (!this.inSession) this._startSession();
    }
    if (snap.status === STATUS.ACTIVE && this._prevStatus !== STATUS.ACTIVE) {
      const me = snap.tanks.find((t) => t.id === this.selfId);
      if (me) this._initSelf(me);
      this.hud.banner('FIGHT!', '#6d9a4a');
      this.audio.matchStart();
      this.audio.startAmbient();
    }
    this._prevStatus = snap.status;

    // events first (they drive effects independent of snapshot valve)
    if (snap.events) {
      for (const e of snap.events) this._handleEvent(e);
    }

    // populate interpolated state for remote views
    const curById = new Map();
    for (const t of snap.tanks) {
      curById.set(t.id, t);
      this._ensureView(t);
      if (t.id === this.selfId) {
        this._acceptAuthority(t);
        this.selfReloadPct = t.reloadPct;
        this.selfCanFire = t.canFire;
        if (this.status === STATUS.ACTIVE) {
          this.selfHp = Math.max(0, t.hp);
          this.selfAlive = t.alive;
          this.selfKills = t.kills;
          this.selfDeaths = t.deaths;
          this.components = { tracks: t.tr, engine: t.en, turret: t.tu, cannon: t.cn };
          if (!t.alive) this.selfTank.speed = 0;
          if (this.selfTank) this.selfTank.dead = !t.alive;
        }
      }
    }

    // phase out views for players no longer in snapshot
    for (const [id, v] of [...this.views]) {
      if (!curById.has(id)) {
        v.view.dispose(this.scene);
        this.views.delete(id);
      } else {
        // keep the previous/current interpolated pair
        v.prev = v.cur;
        v.cur = {
          id, at: arrival,
          x: tX(curById.get(id)), y: tY(curById.get(id)), z: tZ(curById.get(id)),
          yaw: curById.get(id).yaw, turretYaw: curById.get(id).turretYaw,
          elev: curById.get(id).elev, alive: curById.get(id).alive,
          hp: curById.get(id).hp, name: curById.get(id).name,
          team: curById.get(id).team, tankId: curById.get(id).tankId
        };
      }
    }

    // authoritative shell updates
    const liveIds = new Set();
    for (const s of snap.shells || []) {
      liveIds.add(s.id);
      const sv = this._getShellView(s.id);
      if (sv) sv.applyAuthoritative(s);
    }
    for (const [id, sv] of [...this.shells]) {
      if (sv.shell && !liveIds.has(id) && sv.shell.t > MAX_SHELL_AGE) {
        this._freeShell(id);
      }
    }

    if (snap.status === STATUS.ENDED && snap.timer != null && !this._showedResults && this.inSession) {
      this._showedResults = true;
      this._teardownSession({ showResults: true });
    }
  }

  _startSession() {
    this.inSession = true;
    this._showedResults = false;
    this.ui.showGame();
    this.hud.show(true);
    this.aim.yaw = 0;
    this.aim.pitch = this.cfg.camera.defaultPitch;
    this.cam.reset(0, this.cfg.camera.defaultPitch);
  }

  _teardownSession({ showResults = true } = {}) {
    this.inSession = false;
    this.hud.show(false);
    if (showResults) this.ui.showResults();
    this.audio.stopAmbient();
    this.selfTank = null;
    this.selfAuth = null;
    for (const v of this.views.values()) v.view.dispose(this.scene);
    this.views.clear();
    for (const id of [...this.shells.keys()]) this._freeShell(id);
    this.hud.showScoreboard(false);
    this.hud.deathScreen(0);
  }

  // ------------------------------------------------------------------- views

  _ensureView(t) {
    if (this.views.has(t.id)) return;
    const def = getTank(t.tankId);
    const view = new TankView(this.scene, this.materials, t.tankId, def, t.team, this.cfg);
    view.mount(t.id);
    view.drawTag(t.name, t.hp / def.hp, t.alive);
    this.views.set(t.id, { view, prev: null, cur: null, name: t.name, tankId: t.tankId });
  }

  _initSelf(t) {
    this.lastTankId = t.tankId;
    this.selfTank = {
      x: t.x, z: t.z, y: t.y, yaw: t.yaw, speed: 0,
      turretYaw: t.turretYaw, elev: t.elev, dead: false
    };
    this.selfAuth = { x: t.x, y: t.y, z: t.z, yaw: t.yaw, turretYaw: t.turretYaw, elev: t.elev };
    this.selfMaxHp = getTank(t.tankId).hp;
    this.selfHp = t.hp;
    this.aim.yaw = t.yaw;
    this.aim.pitch = this.cfg.camera.defaultPitch;
    this.cam.reset(t.yaw, this.cfg.camera.defaultPitch);
    const me = this.views.get(t.id);
    if (me) me.view.setPose(t.x, t.y, t.z, t.yaw, t.turretYaw, t.elev, this.terrain.getNormalAt(t.x, t.z));
    this.time = 0;
  }

  // ------------------------------------------------------------- prediction

  _acceptAuthority(t) {
    if (!this.selfTank) {
      this._initSelf(t);
      return;
    }
    const auth = { x: t.x, y: t.y, z: t.z, yaw: t.yaw, turretYaw: t.turretYaw, elev: t.elev };
    const s = this.selfTank;
    // soft blend; hard-snap for big divergences (respawn, teleport, round end)
    const dist = Math.hypot(s.x - auth.x, s.z - auth.z);
    const k = this.status === STATUS.ACTIVE ? 0.25 : 1;
    if (dist > 14 || Math.abs(s.yaw - auth.yaw) > 1.2) {
      s.x = auth.x; s.z = auth.z; s.y = auth.y;
      s.yaw = auth.yaw; s.turretYaw = auth.turretYaw; s.elev = auth.elev;
    } else {
      s.x += (auth.x - s.x) * k;
      s.z += (auth.z - s.z) * k;
      s.y += (auth.y - s.y) * k;
      s.yaw = approachAngle(s.yaw, auth.yaw, 0.12);
      s.turretYaw = approachAngle(s.turretYaw, auth.turretYaw, 0.16);
      s.elev = approachAngle(s.elev, auth.elev, 0.1);
    }
    this.selfAuth = auth;
  }

  // ------------------------------------------------------------ main update

  update(dt) {
    this.time += dt;
    if (!this.net.connected) return;

    const poll = this.input.poll();
    const mouse = this.input.consume();

    // aim steering
    if (this.input.locked || poll.fireHeld || mouse.wheel !== 0) {
      this.aim.yaw += mouse.yawDelta;
      this.aim.pitch += mouse.pitchDelta;
      this.aim.pitch = clamp(this.aim.pitch, this.cfg.camera.pitchMin, 0.6);
      this.cam.applyMouseDelta(mouse);
    } else if (mouse.wheel !== 0) {
      this.cam.applyMouseDelta(mouse);
    }

    if (this.status === STATUS.ACTIVE && this.selfId && this.selfTank) {
      this._predict(dt, poll);
    }

    this._renderRemote(dt);
    this._updateShells(dt);
    this.effects.update(dt);
    this._updateCamera(dt, poll);
    this._hudState(dt);
  }

  _predict(dt, poll) {
    const def = getTank(this.selfTank ? this.selfTank.tankId || this.lastTankId : 'vanguard');
    this.lastTankId = def.id;
    const eff = effectiveMovement(def, this.components);

    // determine aim point (raycast from camera)
    this.aimPoint = this._raycastAim(2400) || {
      x: this.selfTank.x + Math.sin(this.aim.yaw) * 1200 + 0,
      y: this.selfTank.y + this.cfg.camera.defaultPitch,
      z: this.selfTank.z + Math.cos(this.aim.yaw) * 1200
    };

    const yaw = Math.atan2(this.aimPoint.x - this.selfTank.x, this.aimPoint.z - this.selfTank.z);
    let elev = this._elevFor(yaw, this.aimPoint, def);

    const input = {
      fwd: poll.fwd,
      steer: poll.steer,
      brake: poll.brake,
      turretYaw: yaw,
      elev
    };

    const moves = stepTank(this.selfTank, input, dt, def, eff, this.terrain, this.boxes, this.cfg);
    const turret = stepTurret(moves, input, dt, effectiveTurret(def, this.components), this.components.turret <= 0);
    this.selfTank = turret;
    this.predInput = input;

    // firing intent
    let fireNow;
    if (this.settings.holdToFire) fireNow = poll.fireHeld;
    else { fireNow = poll.fireHeld && !this.fireWasDown; }
    this.fireWasDown = poll.fireHeld;
    if (fireNow && this.selfCanFire && this.selfAlive) {
      this.fireSeq++;
      this._predictShot(def, this.fireSeq);
    }

    // throttle network input to 30 Hz
    const hz = this.cfg.net.inputMaxRateHz;
    if (this.time - this.lastInputSent >= 1 / hz) {
      this.lastInputSent = this.time;
      this.net.sendInput({
        fwd: poll.fwd,
        steer: poll.steer,
        brake: poll.brake,
        ty: yaw,
        el: elev,
        fire: this.fireSeq ? `c${this.fireSeq}` : null
      });
      if (poll.reloadEdge) this.audio.reloadTick();
    }
  }

  _elevFor(yaw, target, def) {
    const stage = { ...this.selfTank, turretYaw: yaw };
    const res = aimForPoint(stage, target, def, this.cfg);
    return clamp(res.elev, def.turret.elevMin, def.turret.elevMax);
  }

  _predictShot(def, seq) {
    // spawn an immediate client-side shell using the same spawn rules;
    // the authoritative snapshot will overwrite it a split-second later.
    const muzzle = muzzleTransform(this.selfTank);
    const shell = spawnShell(
      { id: `${this.selfId}:c${seq}`, owner: this.selfId, team: 'self', x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0 },
      muzzle, def.cannon.projSpeed, def.cannon.spreadDeg * (Math.PI / 180)
    );
    this._getShellView(shell.id).spawn(shell);
    this.audio.gunshot();
    const v = this.views.get(this.selfId);
    if (v) v.view.recoil(0.55);
    this.cam.addShake(this.cfg.effects.shake.fire);
    this.cam.punchFov(this.cfg.camera.fovPunch);
    this.effects.muzzleFlash(muzzle.x, muzzle.y, muzzle.z, muzzle.dir.x, muzzle.dir.y, muzzle.dir.z);
  }

  _raycastAim(maxDist) {
    // march a ray from the camera through the crosshair and stop at the ground
    const v = this.camera;
    const ndc = _rayNdc.set(0, 0, 0.5);
    _raycaster.setFromCamera(ndc, v);
    const dir = _raycaster.ray.direction;
    const origin = _raycaster.ray.origin;
    const step = 3;
    const half = this.terrain.size / 2;
    let prevT = 0;
    let prevY = origin.y;
    for (let t = step; t <= maxDist; t += step) {
      const x = origin.x + dir.x * t;
      const z = origin.z + dir.z * t;
      if (Math.abs(x) > half || Math.abs(z) > half) break;
      const gy = this.terrain.getHeightAt(x, z);
      const rayy = origin.y + dir.y * t;
      if (rayy <= gy + 0.4) {
        // binary refine between [prevT, t]
        let lo = prevT, hi = t;
        for (let i = 0; i < 7; i++) {
          const mid = (lo + hi) / 2;
          const mx = origin.x + dir.x * mid;
          const mz = origin.z + dir.z * mid;
          const my = origin.y + dir.y * mid;
          if (Math.abs(mx) > half || Math.abs(mz) > half) break;
          if (my <= this.terrain.getHeightAt(mx, mz) + 0.4) hi = mid;
          else lo = mid;
        }
        const px = origin.x + dir.x * hi;
        const py = origin.y + dir.y * hi;
        const pz = origin.z + dir.z * hi;
        return { x: px, y: py, z: pz };
      }
      prevT = t;
      prevY = rayy;
    }
    return null;
  }

  _updateCamera(dt, poll) {
    if (!this.selfTank) return;
    const n = this.terrain.getNormalAt(this.selfTank.x, this.selfTank.z);
    this.cam.update(dt, this.selfTank, this.aimPoint, this.input.gunner);
    const v = this.views.get(this.selfId);
    if (v) {
      v.view.setPose(this.selfTank.x, this.selfTank.y, this.selfTank.z, this.selfTank.yaw, this.selfTank.turretYaw, this.selfTank.elev, n);
      v.view.updateRecoil(dt);
      v.view.applyDamage(this.selfHp / this.selfMaxHp);
      v.view.drawTag(v.name, this.selfHp / this.selfMaxHp, this.selfAlive);
    }
    // track dust
    if (this.cfg.flags.trackDust && this.settings.trackDust && Math.abs(this.selfTank.speed) > 2) {
      this.effects.trackDust(
        this.selfTank.x - Math.sin(this.selfTank.yaw) * 1.8,
        this.selfTank.y - 0.4,
        this.selfTank.z - Math.cos(this.selfTank.yaw) * 1.8,
        Math.sin(this.selfTank.yaw), Math.cos(this.selfTank.yaw)
      );
    }
    // engine audio
    const speedRatio = this.selfTank.speed / (getTank(this.lastTankId || 'vanguard').movement.maxForward);
    this.audio.engineLevel(speedRatio, Math.abs(this.selfTank.speed) > 0.3);
  }

  _renderRemote(dt) {
    const now = performance.now() / 1000;
    const tItp = now - RENDER_DELAY;
    for (const [id, v] of this.views) {
      if (id === this.selfId) continue;
      let x, y, z, yaw, ty, el;
      if (v.prev && v.cur) {
        const span = (v.cur.at ?? v.cur.receivedAt ?? now) - (v.prev.at ?? v.prev.receivedAt ?? (now - RENDER_DELAY));
        const f = span > 0 ? clamp((tItp - (v.prev.at ?? now - RENDER_DELAY)) / span, 0, 1) : 1;
        x = v.prev.x + (v.cur.x - v.prev.x) * f;
        y = v.prev.y + (v.cur.y - v.prev.y) * f;
        z = v.prev.z + (v.cur.z - v.prev.z) * f;
        yaw = lerpAngle(v.prev.yaw, v.cur.yaw, f);
        ty = lerpAngle(v.prev.turretYaw, v.cur.turretYaw, f);
        el = lerpAngle(v.prev.elev, v.cur.elev, f);
      } else if (v.cur) {
        ({ x, y, z, yaw, turretYaw: ty, elev: el } = v.cur);
      } else {
        continue;
      }
      const n = this.terrain.getNormalAt(x, z);
      const def = getTank(v.tankId);
      v.view.setPose(x, y, z, yaw, ty, el, n);
      v.view.drawTag(v.cur?.name || v.name, (v.cur?.hp ?? 100) / def.hp, v.cur?.alive !== false);
      if (v.cur?.alive === false) {
        v.view.group.rotation.set(0, yaw, 0);
        v.view.hide();
        // burn smoke while dead
        if (!v.smokeT || now - v.smokeT > 0.3) {
          v.smokeT = now;
          this.effects.smokeColumn(x, y + 1.5, z);
        }
      } else {
        v.view.mount(id);
      }
    }
  }

  _updateShells(dt) {
    for (const [id, sv] of [...this.shells]) {
      if (!sv.alive) continue;
      const owner = sv.shell && sv.shell.id ? id.split(':')[0] : 0;
      const tank = owner ? this.views.get(owner) : null;
      const drop = tank ? getTank(tank.tankId).cannon.drop : 1.0;
      if (!sv.update(dt, drop)) this._freeShell(id);
    }
    // despawn shells that have long since expired
    for (const [id, sv] of [...this.shells]) {
      if (sv.shell && sv.shell.t > this.cfg.projectile.lifetime) this._freeShell(id);
    }
  }

  _getShellView(id) {
    let sv = this.shells.get(id);
    if (sv) return sv;
    sv = this.shellPool.pop() || new ShellView(this.scene, this.materials, this.cfg);
    this.shells.set(id, sv);
    return sv;
  }

  _freeShell(id) {
    const sv = this.shells.get(id);
    if (!sv) return;
    sv.free();
    this.shells.delete(id);
    if (this.shellPool.length < this.cfg.projectile.poolSize) this.shellPool.push(sv);
  }

  _hudState(dt) {
    const gs = {
      selfState: this.selfTank ? {
        hp: this.selfHp, maxHp: this.selfMaxHp,
        reloadPct: this.selfReloadPct,
        components: this.components
      } : null,
      tankDef: this.lastTankId ? getTank(this.lastTankId) : null,
      scores: this.scores,
      timeLeft: this.timeLeft,
      rangeText: this._rangeText() || '',
      fps: this._fps
    };
    this.hud.update(dt, gs);
    this.hud.updateScoreboard(this._boardRows(), this.scores, this.timeLeft);
    this.hud.setLatency(this.net.rtt);
    this.hud.deathScreen(this.selfId && !this.selfAlive ? this.lastSnap?.tanks?.find((t) => t.id === this.selfId)?.respawnT : 0);
  }

  _rangeText() {
    if (!this.aimPoint || !this.selfTank) return '';
    return `${Math.round(Math.hypot(this.aimPoint.x - this.selfTank.x, this.aimPoint.z - this.selfTank.z))} m`;
  }

  _boardRows() {
    if (!this.lastSnap) return [];
    return this.lastSnap.tanks.map((t) => ({
      name: t.name, team: t.team, tank: t.tankId, k: t.kills, d: t.deaths
    }));
  }

  // ---------------------------------------------------------------- events

  _handleEvent(e) {
    const cfg = this.cfg;
    switch (e.type) {
      case EVT.SHOT: {
        const sv = this._getShellView(e.id);
        if (!sv.alive) {
          sv.spawn({
            id: e.id, owner: e.from, x: e.x, y: e.y, z: e.z,
            vx: e.dx, vy: e.dy, vz: e.dz, t: 0
          });
          // positional audio / m-flash for remote shots
          if (e.from !== this.selfId && this.selfTank) {
            const dist = Math.hypot(e.x - this.selfTank.x, e.z - this.selfTank.z);
            if (dist < 420) this.audio.distantGunshot();
          }
        }
        break;
      }
      case EVT.IMPACT: {
        if (e.kind === 'tank') {
          this.effects.impactSparks(e.x, e.y, e.z, 0, 1, 0);
          if (this.selfTank) {
            const dist = Math.hypot(e.x - this.selfTank.x, e.z - this.selfTank.z);
            this.audio.impactTank(dist);
          }
        } else if (e.kind === 'ground') {
          this.effects.impactDirt(e.x, e.y, e.z, 0, 1, 0);
          if (this.selfTank) {
            const dist = Math.hypot(e.x - this.selfTank.x, e.z - this.selfTank.z);
            this.audio.impactGround(dist);
          }
        } else {
          this.effects.impactSparks(e.x, e.y, e.z, 0, 1, 0);
        }
        if (this.shells.has(e.id)) this._freeShell(e.id);
        break;
      }
      case EVT.HIT: {
        const me = this.selfId;
        if (e.target === me) {
          this.hud.damageFlash(Math.min(1, e.dmg / 12));
          this.audio.impactGround(0);
          this.cam.addShake(cfg.effects.shake.impact);
        }
        if (e.from === me) {
          this.hud.hitMarker(false);
          if (e.overmatch) this.audio.ricochet();
          else this.audio.hitConfirm();
        }
        break;
      }
      case EVT.KILL: {
        const v = this.views.get(e.victim);
        if (v && v.view) {
          this.effects.explosion(v.cur?.x ?? v.view.group.position.x, v.cur?.y ?? v.view.group.position.y, v.cur?.z ?? v.view.group.position.z);
        }
        if (e.killer === this.selfId) {
          this.hud.hitMarker(true);
          this.hud.pushMsg(`+1 — ${e.victimName} DESTROYED`, { color: '#d9a13c' });
          this.audio.hitConfirm();
        }
        this.hud.pushMsg(`${e.killerName || 'THE FIELD'} destroyed ${e.victimName}`, { color: cfg.teams[e.victimTeam]?.color || '#fff' });
        break;
      }
      case EVT.DEATH: {
        if (e.id === this.selfId) {
          this.audio.playerDeath();
          this.cam.addShake(cfg.effects.shake.explosion);
          this.hud.deathScreen(5);
        }
        break;
      }
      case EVT.RESPAWN: {
        if (e.id === this.selfId && this.selfTank) {
          this.selfTank.x = e.x; this.selfTank.y = e.y; this.selfTank.z = e.z;
          this.selfTank.yaw = e.yaw;
          this.selfTank.speed = 0;
          this.selfAlive = true;
          this.selfHp = this.selfMaxHp;
          this.hud.deathScreen(0);
          this.cam.reset(e.yaw, this.cfg.camera.defaultPitch);
          this.fireSeq = 0;
        }
        break;
      }
      case EVT.MATCH_START: {
        this.hud.banner('FIGHT!', '#6d9a4a');
        break;
      }
      case EVT.RELOADED: {
        if (e.id === this.selfId) this.audio.reloaded();
        break;
      }
      case EVT.MSG: {
        if (e.text) this.hud.pushMsg(e.text);
        break;
      }
      case 'explosion': {
        this.effects.explosion(e.x, e.y, e.z);
        break;
      }
      default:
        break;
    }
  }

  selectTank(tankId) {
    this.lastTankId = tankId;
    this.net.selectTank(tankId);
  }

  setFps(v) {
    this._fps = v;
  }
}

// ------------------------------------------------------------------ helpers

function lerpAngle(a, b, t) {
  let d = (b - a + Math.PI * 3) % (Math.PI * 2) - Math.PI;
  return a + d * t;
}

const _raycaster = new THREE.Raycaster();
const _rayNdc = new THREE.Vector2(0, 0);

function tX(t) { return t.x; }
function tY(t) { return t.y; }
function tZ(t) { return t.z; }

export default ClientGame;