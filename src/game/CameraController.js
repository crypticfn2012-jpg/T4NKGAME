// Third-person chase camera for the player's tank. Orbits around the tank on
// the aim direction (turret follows the crosshair, camera follows the aim),
// pitches with the mouse, zooms with the scroll wheel, and drops into a
// gunner-style low-FOV view while RMB is held. The camera never clips the
// ground: its position is lifted vertically when it sits below terrain.

import * as THREE from 'three';
import { damp, clamp } from '../utils/Math.js';

export class CameraController {
  constructor(camera, cfg, terrain) {
    this.camera = camera;
    this.cfg = cfg.camera;
    this.shakeCfg = cfg.effects.shake;
    this.terrain = terrain;
    this.fovDefault = cfg.renderer.fov;
    this.distance = cfg.camera.distance;
    this.fov = cfg.renderer.fov;
    this._fovTo = cfg.renderer.fov;

    this.target = { yaw: 0, pitch: cfg.camera.defaultPitch };
    this.yaw = 0;
    this.pitch = cfg.camera.defaultPitch;
    this.shakeAmp = 0;

    this.camPos = new THREE.Vector3(50, 20, 50);
    this.lookTarget = new THREE.Vector3(0, 2, 0);
    this.shake = new THREE.Vector3();
  }

  applyMouseDelta({ yawDelta, pitchDelta, wheel }) {
    const c = this.cfg;
    this.target.yaw += yawDelta;
    this.target.pitch += pitchDelta;
    this.target.pitch = clamp(this.target.pitch, c.pitchMin, c.pitchMax);
    if (wheel !== 0) {
      this.distance = clamp(this.distance - wheel * c.zoomStep, c.minDistance, c.maxDistance);
    }
  }

  reset(yaw, pitch) {
    this.target.yaw = yaw;
    this.target.pitch = pitch ?? this.cfg.defaultPitch;
    this.yaw = yaw;
    this.pitch = pitch ?? this.cfg.defaultPitch;
  }

  addShake(amount) {
    this.shakeAmp = Math.min(this.shakeCfg.maxDeg, this.shakeAmp + amount);
  }

  update(dt, tankState, aimPoint, gunner) {
    const c = this.cfg;
    this.yaw = damp(this.yaw, this.target.yaw, 1 / c.timeConstant, dt);
    this.pitch = damp(this.pitch, this.target.pitch, 1 / c.timeConstant, dt);

    this._fovTo = gunner ? c.fovMin : this.fovDefault;

    const cp = Math.cos(this.pitch);
    const dir = {
      x: Math.sin(this.yaw) * cp,
      y: Math.sin(this.pitch),
      z: Math.cos(this.yaw) * cp
    };

    const dx = tankState.x - dir.x * this.distance;
    const dy = tankState.y + Math.max(this.distance * 0.42, 4);
    const dz = tankState.z - dir.z * this.distance;

    this.camPos.set(dx, dy, dz);

    // keep above the ground
    const gh = this.terrain.getHeightAt(this.camPos.x, this.camPos.z);
    if (this.camPos.y < gh + c.groundClearance) {
      this.camPos.y = gh + c.groundClearance;
    }

    // smoothing toward the aim point for the look direction
    const tx = aimPoint ? aimPoint.x : tankState.x;
    const tz = aimPoint ? aimPoint.z : tankState.z;
    const ty = aimPoint ? aimPoint.y : tankState.y + 2;
    this.lookTarget.lerp(_L.set(tx, ty, tz), 1 - Math.exp(-dt * 10));

    // camera shake
    this.shakeAmp = Math.max(0, this.shakeAmp - this.shakeCfg.decay * dt);
    const s = this.shakeAmp * 0.11;
    this.shake.set((Math.random() - 0.5) * s, (Math.random() - 0.5) * s, (Math.random() - 0.5) * s);

    this.camera.position.copy(this.camPos).add(this.shake);
    this.camera.lookAt(this.lookTarget.x, this.lookTarget.y + 2, this.lookTarget.z);
    this.fov = this._fovTo;
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
  }
}

const _L = new THREE.Vector3();

export default CameraController;