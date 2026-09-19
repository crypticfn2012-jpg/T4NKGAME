// Instanced particle effects: sparks, dust/smoke puffs, muzzle + impact
// flashes, drifting smoke columns and additive glow sprites. All pools are
// fixed-size and recycled (oldest first), so the effect budget never grows.

import * as THREE from 'three';
import { sparkGeometry, puffGeometry, flashGeometry } from '../geometry/EffectGeometry.js';
import { glowTexture, createCanvasTexture } from '../materials/TextureGenerator.js';
import { mulberry32, clamp, randRange, lerp } from '../utils/Math.js';

export class EffectsManager {
  constructor(scene, materials, cfg) {
    this.cfg = cfg;
    this.scene = scene;
    this.time = 0;

    // Four instanced pools: sparks (additive), puffs (smoke/dirt),
    // flashes (short-lived light shapes), smoke (long white columns).
    this.pools = {
      spark: this._makePool(sparkGeometry(), materials.get('spark'), cfg.effects.maxSparks, 'spark'),
      puff: this._makePool(puffGeometry(), materials.get('puff'), cfg.effects.maxPuffs, 'puff'),
      flash: this._makePool(flashGeometry(), materials.get('flash'), cfg.effects.maxFlashes, 'flash'),
      smoke: this._makePool(puffGeometry(), materials.get('cloud'), cfg.effects.maxSmoke, 'smoke')
    };

    // Glow sprite pool for muzzle flashes + hits.
    const glowTex = createCanvasTexture(glowTexture(), { wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping });
    this.glows = [];
    for (let i = 0; i < cfg.effects.maxGlows; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTex, color: 0xffd9a0,
        blending: THREE.AdditiveBlending, depthWrite: false,
        transparent: true, opacity: 0
      }));
      s.visible = false;
      scene.add(s);
      this.glows.push({ sprite: s, life: 0, maxLife: 1, size: 1 });
    }

    this.rand = mulberry32(Date.now() & 0xffff);
    this._glowCursor = 0;
  }

  _makePool(geo, material, count, key) {
    const mesh = new THREE.InstancedMesh(geo, material, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    this.scene.add(mesh);
    const dummy = new THREE.Object3D();
    const items = [];
    for (let i = 0; i < count; i++) {
      items.push({
        active: false,
        life: 0,
        maxLife: 1,
        x: 0, y: 0, z: 0,
        vx: 0, vy: 0, vz: 0,
        size: 1,
        grav: 0,
        drag: 0,
        color: new THREE.Color()
      });
      dummy.position.set(0, -10000, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      if (mesh.instanceColor) mesh.setColorAt(i, new THREE.Color(0, 0, 0));
    }
    mesh.instanceMatrix.needsUpdate = true;
    return { mesh, items, cursor: 0, dummy };
  }

  _spawn(poolKey, opts) {
    const pool = this.pools[poolKey];
    if (!pool) return;
    const item = pool.items[pool.cursor];
    pool.cursor = (pool.cursor + 1) % pool.items.length;
    const life = opts.life ?? 0.6;
    item.active = true;
    item.life = 0;
    item.maxLife = life;
    item.x = opts.x; item.y = opts.y; item.z = opts.z;
    item.vx = opts.vx || 0; item.vy = opts.vy || 0; item.vz = opts.vz || 0;
    item.size = opts.size ?? 1;
    item.grav = opts.grav ?? 0;
    item.drag = opts.drag ?? 0;
    if (opts.color) item.color.set(opts.color);
    else item.color.setRGB(1, 1, 1);
  }

  // ------------------------------------------------------------- public API

  muzzleFlash(x, y, z, dirX, dirY, dirZ) {
    const n = 4;
    for (let i = 0; i < n; i++) {
      const spread = 0.25;
      this._spawn('spark', {
        x, y, z,
        vx: dirX * 26 + (this._rnd() - 0.5) * spread,
        vy: dirY * 26 + (this._rnd() - 0.5) * spread,
        vz: dirZ * 26 + (this._rnd() - 0.5) * spread,
        life: 0.18 + this._rnd() * 0.15,
        size: 0.5 + this._rnd() * 0.6,
        color: 0xffd080, grav: 12, drag: 2
      });
    }
    const flash = this.pools.flash.items[(this.pools.flash.cursor)];
    this._spawn('flash', {
      x: x + dirX * 0.6, y: y + dirY * 0.6, z: z + dirZ * 0.6,
      vx: dirX * 4, vy: dirY * 4, vz: dirZ * 4,
      life: 0.09, size: 1.4, color: 0xfff2c8
    });
    this._glow(x, y, z, 2.6, 0.12, 0xffc878);
  }

  impactDirt(x, y, z, nx, ny, nz) {
    const n = 8;
    for (let i = 0; i < n; i++) {
      this._spawn('puff', {
        x, y, z,
        vx: nx * 2 + (this._rnd() - 0.5) * 7,
        vy: ny * 6 + this._rnd() * 5,
        vz: nz * 2 + (this._rnd() - 0.5) * 7,
        life: 0.5 + this._rnd() * 0.7,
        size: 1.1 + this._rnd() * 1.3,
        color: 0x6a6248, grav: -1.2, drag: 1.4
      });
    }
  }

  impactSparks(x, y, z, dirX, dirY, dirZ) {
    const n = 16;
    for (let i = 0; i < n; i++) {
      const a = this._rnd() * Math.PI * 2;
      const up = this._rnd() * 1.4;
      this._spawn('spark', {
        x, y: y + 0.3, z,
        vx: Math.cos(a) * 9, vy: up * 8 + 2, vz: Math.sin(a) * 9,
        life: 0.25 + this._rnd() * 0.35,
        size: 0.45 + this._rnd() * 0.5,
        color: 0xffe0a0, grav: 18, drag: 1
      });
    }
    this._glow(x, y, z, 2.2, 0.1, 0xffcc80);
  }

  explosion(x, y, z) {
    for (let i = 0; i < 26; i++) {
      const a = this._rnd() * Math.PI * 2;
      const r = 3 + this._rnd() * 9;
      this._spawn('spark', {
        x, y, z,
        vx: Math.cos(a) * r, vy: 4 + this._rnd() * 12, vz: Math.sin(a) * r,
        life: 0.5 + this._rnd() * 0.9,
        size: 0.7 + this._rnd() * 1.1,
        color: 0xffb060, grav: 16, drag: 1.2
      });
    }
    for (let i = 0; i < 10; i++) {
      const a = this._rnd() * Math.PI * 2;
      const r = 1.5 + this._rnd() * 5;
      this._spawn('puff', {
        x, y, z,
        vx: Math.cos(a) * r * 0.6, vy: 3 + this._rnd() * 6, vz: Math.sin(a) * r * 0.6,
        life: 1.0 + this._rnd() * 1.2,
        size: 2.2 + this._rnd() * 2.6,
        color: 0x3a3632, grav: -1.4, drag: 1.6
      });
    }
    for (let i = 0; i < 8; i++) {
      this._spawn('smoke', {
        x: x + (this._rnd() - 0.5) * 2, y, z: z + (this._rnd() - 0.5) * 2,
        vx: (this._rnd() - 0.5) * 2, vy: 2 + this._rnd() * 3, vz: (this._rnd() - 0.5) * 2,
        life: 2.4 + this._rnd() * 2,
        size: 3 + this._rnd() * 3.4,
        color: 0x302c28, grav: -0.8, drag: 1.8
      });
    }
    this._glow(x, y, z, 9, 0.3, 0xff9840);
  }

  smokeColumn(x, y, z) {
    // long-burning wreck smoke
    this._spawn('smoke', {
      x: x + (this._rnd() - 0.5) * 1.2, y: y + 1, z: z + (this._rnd() - 0.5) * 1.2,
      vx: (this._rnd() - 0.5) * 1.2, vy: 4 + this._rnd() * 2.4, vz: (this._rnd() - 0.5) * 1.2,
      life: 3.4,
      size: 3.2 + this._rnd() * 2.2,
      color: this._rnd() < 0.3 ? 0x40332a : 0x2c2a28, grav: -0.6, drag: 1.6
    });
  }

  trackDust(x, y, z, dirX, dirZ) {
    this._spawn('puff', {
      x: x + (this._rnd() - 0.5) * 2, y, z: z + (this._rnd() - 0.5) * 2,
      vx: -dirX * 2 + (this._rnd() - 0.5) * 2, vy: 0.6 + this._rnd() * 1, vz: -dirZ * 2 + (this._rnd() - 0.5) * 2,
      life: 0.8 + this._rnd() * 0.6,
      size: 1.2 + this._rnd() * 1,
      color: 0x6a6a58, grav: 0, drag: 2
    });
  }

  _glow(x, y, z, size, life, color) {
    const g = this.glows[this._glowCursor % this.glows.length];
    this._glowCursor++;
    g.sprite.visible = true;
    g.sprite.position.set(x, y, z);
    g.size = size;
    g.life = life;
    g.maxLife = life;
    if (color !== undefined) g.sprite.material.color.setHex(color);
  }

  _rnd() {
    return this.rand();
  }

  // ---------------------------------------------------------------- update

  update(dt) {
    this.time += dt;
    for (const key of Object.keys(this.pools)) {
      const pool = this.pools[key];
      const { mesh, items, dummy } = pool;
      let anyActive = false;
      for (let i = 0; i < items.length; i++) {
        const p = items[i];
        if (!p.active) continue;
        anyActive = true;
        p.life += dt;
        if (p.life >= p.maxLife) {
          p.active = false;
          dummy.position.set(0, -10000, 0);
          dummy.scale.set(1, 1, 1);
          dummy.updateMatrix();
          mesh.setMatrixAt(i, dummy.matrix);
          continue;
        }
        // integrate
        const dragF = 1 - Math.min(1, p.drag * dt);
        p.vx *= dragF; p.vy *= dragF; p.vz *= dragF;
        p.vy -= p.grav * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        const t = p.life / p.maxLife;
        const scale = p.size * (1 - t * 0.92);
        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(t * 3.1, t * 5.7, 0);
        dummy.scale.set(scale, scale, scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        if (mesh.instanceColor) mesh.setColorAt(i, p.color);
      }
      mesh.instanceMatrix.needsUpdate = anyActive;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = anyActive;
    }

    for (const g of this.glows) {
      if (g.life <= 0) continue;
      g.life -= dt;
      const t = Math.max(0, g.life / g.maxLife);
      g.sprite.scale.setScalar(g.size * (1.6 - t));
      const m = g.sprite.material;
      m.opacity = t * 0.9;
      g.sprite.visible = t > 0.02;
    }
  }
}

export default EffectsManager;