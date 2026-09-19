// Keyboard + mouse state exposed as a per-frame input command. The mappings
// come from CONFIG.controls; the aim deltas are consumed by the camera system
// (turret follows the crosshair, so "aim input" is mouse deltas + position).

import { EventEmitter } from '../utils/EventEmitter.js';

function clamp11(v) {
  return v < -1 ? -1 : v > 1 ? 1 : v;
}

export class InputManager extends EventEmitter {
  constructor(canvas, controls, settings) {
    super();
    this.canvas = canvas;
    this.controls = controls;
    this.settings = settings;

    this.keys = new Set();          // physical key codes currently down
    this.mouse = { left: false, right: false, wheel: 0 };
    this.mouseDelta = { x: 0, y: 0 };
    this.mode = 'idle';             // idle | locked
    this.gunner = false;

    this._bind();
  }

  get locked() {
    return this.mode === 'locked';
  }

  _bind() {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        if (this.locked) this.unlock();
        this.emit('pause');
        return;
      }
      if (!e.repeat) this.keys.add(e.code);
      if (this.isAction('menu', e.code)) this.emit('menu');
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));

    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0) {
        this.mouse.left = true;
        if (!this.locked && this.mode !== 'locked') this.lock();
      } else if (e.button === 2) {
        this.mouse.right = true;
        this.gunner = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) {
        this.mouse.right = false;
        this.gunner = false;
      }
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());

    window.addEventListener('wheel', (e) => {
      this.mouse.wheel += Math.sign(e.deltaY);
    }, { passive: true });

    document.addEventListener('mousemove', (e) => {
      if (this.locked) {
        this.mouseDelta.x += e.movementX;
        this.mouseDelta.y += e.movementY;
      }
    });
    document.addEventListener('pointerlockchange', () => {
      const locked = document.pointerLockElement === this.canvas;
      this.mode = locked ? 'locked' : 'idle';
      if (!locked) this.emit('unlock');
    });
  }

  lock() {
    if (this.canvas.requestPointerLock) this.canvas.requestPointerLock();
  }

  unlock() {
    if (document.exitPointerLock) document.exitPointerLock();
  }

  isAction(action, code) {
    const list = this.controls[action];
    return !!list && list.includes(code);
  }

  key(action) {
    for (const code of this.controls[action] || []) {
      if (this.keys.has(code)) return true;
    }
    return false;
  }

  // Consume accumulated mouse deltas & wheel (called once per frame).
  consume() {
    const { x, y } = this.mouseDelta;
    const wheel = this.mouse.wheel;
    const s = this.settings;
    const inv = s.invertY ? 1 : -1;
    this.mouseDelta.x = 0;
    this.mouseDelta.y = 0;
    this.mouse.wheel = 0;
    return {
      yawDelta: x * s.sensitivity * 0.004,
      pitchDelta: y * s.sensitivity * 0.004 * inv,
      wheel
    };
  }

  // Per-frame movement/combat intent.
  poll() {
    let fwd = 0;
    if (this.key('forward')) fwd += 1;
    if (this.key('reverse')) fwd -= 1;
    let steer = 0;
    if (this.key('left')) steer -= 1;
    if (this.key('right')) steer += 1;
    const brake = this.key('brake');
const fireHeld = this.mouse.left;
    const reloadEdge = this._consumeReload();
    return { fwd: clamp11(fwd), steer: clamp11(steer), brake, fireHeld, reloadEdge };
  }

  _consumeReload() {
    const down = this.key('reload');
    const edge = down && !this._prevReload;
    this._prevReload = down;
    return edge;
  }
}