// Shell / projectile views. One pool of shell meshes re-used per live shell.
// Positions are server-authoritative (updated on every snapshot); between
// snapshots the shared ballistic integrator extrapolates the exact same path
// the server predicts, so visuals track perfectly.

import * as THREE from 'three';
import { stepShell } from '../../shared/ballistics.js';
import { MUZZLE } from '../../shared/ballistics.js';

export class ShellView {
  constructor(scene, materials, cfg) {
    this.cfg = cfg;
    this.group = new THREE.Group();
    const geo = new THREE.CylinderGeometry(0.09, 0.09, 0.7, 6);
    geo.rotateX(Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, materials.get('shell'));
    this.tip = new THREE.Mesh(geo, materials.get('glowTip'));
    this.tip.scale.setScalar(0.8);
    this.group.add(this.mesh);
    this.group.add(this.tip);
    scene.add(this.group);
    this._q = new THREE.Quaternion();
    this.free();
    this.shell = null;
  }

  spawn(shell) {
    this.shell = shell;
    this.group.visible = true;
    this._t = 0;
  }

  applyAuthoritative(s) {
    if (!this.shell || this.shell.id !== s.id) return;
    this.shell.x = s.x; this.shell.y = s.y; this.shell.z = s.z;
    this.shell.vx = s.vx; this.shell.vy = s.vy; this.shell.vz = s.vz;
  }

  // advance extrapolation by dt; returns false if the shell is expired.
  update(dt, drop) {
    if (!this.shell) return true;
    const ok = stepShell(this.shell, dt, this.cfg, drop);
    if (!ok) return false;
    const q = this._q.setFromUnitVectors(_FWD, new THREE.Vector3(this.shell.vx, this.shell.vy, this.shell.vz).normalize());
    this.group.quaternion.copy(q);
    this.group.position.set(this.shell.x, this.shell.y, this.shell.z);
    return true;
  }

  get alive() {
    return !!this.shell;
  }

  free() {
    this.shell = null;
    this.group.visible = false;
  }

  dispose(scene) {
    scene.remove(this.group);
  }
}

const _FWD = new THREE.Vector3(0, 0, 1);

const _q = new THREE.Quaternion();

export default ShellView;