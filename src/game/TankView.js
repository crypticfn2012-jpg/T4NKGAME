// Per-tank 3D view. One TankView per live player. Owns the procedural tank
// meshes (hull group + rotating turret/barrel), the floating name + HP marker,
// a 1px team marker, and per-frame pose update driven by shared state.
//
// Pose math mirrors shared/physics: hull yaw, independent turret yaw, barrel
// pitch (positive = up raises nose, so rotation.x = -elev), plus pitch/roll
// from the terrain normal so tanks sit convincingly on slopes.

import * as THREE from 'three';
import { TankBuilder } from '../geometry/TankBuilder.js';

const UP = new THREE.Vector3(0, 1, 0);
const _qN = new THREE.Quaternion();
const _qY = new THREE.Quaternion();
const _eul = new THREE.Euler(0, 0, 0, 'YXZ');

export class TankView {
  constructor(scene, materials, tankId, def, team, cfg) {
    this.id = null;
    this.def = def;
    this.team = team;
    this.cfg = cfg;
    this.reloadFull = def.cannon.reload;
    this.reloadPct = 1;
    this.canFireNow = true;
    this.hpPct = 1;
    this.alive = true;
    this.damageTint = 0;

    const builder = new TankBuilder(materials);
    const paint = materials.cloneForEntity('tankGreen');
    const teamColor = team === 'steel' ? cfg.teams.steel.colorHex : cfg.teams.iron.colorHex;
    this.teamPaint = new THREE.Color(teamColor).multiplyScalar(1.15).getHex();
    paint.color.setHex(this.teamPaint);
    paint.needsUpdate = true;

    const built = builder.build({ paintMaterial: paint, seed: 7 });
    this.group = built.root;
    this.turret = built.turret;
    this.barrel = built.barrel;
    this.barrelTip = built.barrelTip;
    this.paint = paint;

    // Scale by tank body so light/heavy tanks actually differ in silhouette.
    const sx = def.body.halfWidth / 2.4;
    const sy = def.body.height / 1.6;
    const sz = def.body.halfLength / 4.9;
    const s = (sx + sy + sz) / 3;
    this.group.scale.setScalar(s * 1.0);

    // Name + HP marker.
    this.tag = this._makeTag();
    this.group.add(this.tag);

    scene.add(this.group);
    this.hide();
  }

  _makeTag() {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    this._tagCanvas = canvas;
    this._tagCtx = ctx;

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(7, 1.75, 1);
    sprite.position.set(0, 4.6, 0);
    return sprite;
  }

  drawTag(name, hpPct, alive) {
    const ctx = this._tagCtx;
    ctx.clearRect(0, 0, 256, 64);
    // HP bar
    const frac = Math.max(0, Math.min(1, hpPct));
    ctx.fillStyle = 'rgba(8,10,7,0.7)';
    ctx.fillRect(24, 8, 208, 14);
    const hue = 120 * frac;
    ctx.fillStyle = `hsl(${hue}, 55%, 45%)`;
    ctx.fillRect(26, 10, 204 * frac, 10);
    // Name
    ctx.fillStyle = alive ? 'rgba(225,220,200,0.95)' : 'rgba(160,150,140,0.8)';
    ctx.font = 'bold 24px Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.fillText(name ? name.toUpperCase() : '…', 128, 52);
    this._tagCanvas.needsUpdate = true;
  }

  setPose(x, y, z, yaw, turretYaw, elev, n, ny) {
    this.group.position.set(x, y, z);
    // Orient hull to heading, then tilt to terrain normal.
    if (n) {
      const qN = _qN.setFromUnitVectors(UP, new THREE.Vector3(n.x, Math.max(ny || 1, 0), n.z).normalize());
      this.group.quaternion.copy(_qY.setFromEuler(_eul.set(0, yaw, 0, 'YXZ')).multiply(qN));
    } else {
      this.group.rotation.set(0, yaw, 0);
    }
    const hullYaw = yaw;
    this.turret.rotation.y = turretYaw - hullYaw;
    this.barrel.rotation.x = -elev;
  }

  // Damage tint + recoil animation settling (called per frame).
  applyDamage(hpPct) {
    this.damageTint = Math.max(this.damageTint, 1 - Math.max(0, Math.min(1, hpPct)));
    const k = this.damageTint * 0.62;
    this.paint.color.setHex(this.teamPaint).multiplyScalar(1 - k);
    this.paint.needsUpdate = true;
  }

  updateRecoil(dt) {
    if (this._recoil && Math.abs(this._recoil) > 0.001) {
      this._recoil = this._recoil * Math.exp(-dt * 8);
      this.barrel.position.z = 1.35 + this._recoil;
    }
  }

  recoil(amount) {
    this._recoil = -amount;
    this.barrel.position.z = 1.35 + this._recoil;
  }

  mount(id) {
    this.id = id;
    this.group.visible = true;
  }

  hide() {
    this.group.visible = false;
  }

  get visible() {
    return this.group.visible;
  }

  dispose(scene) {
    scene.remove(this.group);
  }
}

export default TankView;