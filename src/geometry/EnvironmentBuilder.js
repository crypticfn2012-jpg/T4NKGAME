// Procedural environment dressing: crates, oil drums, sandbags, signs, rocks,
// trees, plus the landmark structures (radio tower, fuel depot, bunker,
// destroyed bridge, rock ridge). Identical props are instanced so the whole
// battlefield stays within the draw-call budget.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, randRange, randInt, clamp } from '../utils/Math.js';
import { addVertexVariation, mergePartsToMeshes } from './helpers.js';
import { LANDMARK_DEFS } from '../../shared/colliders.js';

const PI2 = Math.PI / 2;

export class EnvironmentBuilder {
  constructor(materials) {
    this.mat = materials;
  }

  // Instanced geometry gets a constant white color attribute so instanceColor
  // (and, where enabled, vertexColors) multiply cleanly.
  _whiteColor(geometry) {
    const count = geometry.attributes.position.count;
    const c = new Float32Array(count * 3).fill(1);
    geometry.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return geometry;
  }

  _instanced(geometry, material, count) {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;
    return mesh;
  }

  _matrix(o, x, z, y, { ry = 0, rx = 0, rz = 0, s = 1, sx = 1, sy = 1, sz = 1 } = {}) {
    o.position.set(x, y, z);
    o.rotation.set(rx, ry, rz);
    o.scale.set(s * sx, s * sy, s * sz);
    o.updateMatrix();
  }

  // ---------------------------- geometries --------------------------------

  crateGeometry() {
    const base = new THREE.BoxGeometry(1.6, 1.6, 1.6);
    const plank = new THREE.BoxGeometry(1.5, 0.16, 0.34);
    const geos = [base];
    for (let i = 0; i < 4; i++) {
      const g = plank.clone();
      g.translate(0, 0.85, -0.46 + i * 0.31);
      geos.push(g);
    }
    const merged = mergeGeometries(geos, false);
    merged.translate(0, 0.8, 0); // sit on the ground
    return this._whiteColor(merged);
  }

  barrelGeometry() {
    const body = new THREE.CylinderGeometry(0.62, 0.62, 1.5, 12);
    const rimT = new THREE.CylinderGeometry(0.66, 0.6, 0.18, 12); rimT.translate(0, 0.72, 0);
    const rimB = new THREE.CylinderGeometry(0.6, 0.66, 0.18, 12); rimB.translate(0, -0.72, 0);
    const merged = mergeGeometries([body, rimT, rimB], false);
    merged.translate(0, 0.9, 0);
    return this._whiteColor(merged);
  }

  barrelBandGeometry() {
    const band = new THREE.CylinderGeometry(0.66, 0.66, 0.34, 12);
    band.translate(0, 1.3, 0);
    return band;
  }

  sandbagStackGeometry() {
    const bag = new THREE.BoxGeometry(1.15, 0.5, 0.62);
    const geos = [];
    for (let i = 0; i < 3; i++) { const g = bag.clone(); g.translate(-0.9 + i * 0.9, 0.0, 0); geos.push(g); }
    for (let i = 0; i < 2; i++) { const g = bag.clone(); g.rotateZ(0.06); g.translate(-0.45 + i * 0.9, 0.48, 0); geos.push(g); }
    const top = bag.clone(); top.rotateZ(-0.05); top.translate(0, 0.96, 0); geos.push(top);
    const merged = mergeGeometries(geos, false);
    merged.translate(0, 0.25, 0);
    return this._whiteColor(merged);
  }

  signPostGeometry() {
    return new THREE.CylinderGeometry(0.09, 0.12, 2.7, 8);
  }

  signBoardGeometry() {
    const board = new THREE.BoxGeometry(1.7, 0.95, 0.12);
    board.translate(0, 2.9, 0);
    return board;
  }

  rockGeometry(seed = 7) {
    const g = new THREE.IcosahedronGeometry(1, 1);
    const pos = g.attributes.position;
    const rand = mulberry32(seed);
    for (let i = 0; i < pos.count; i++) {
      const s = 1 + (rand() - 0.5) * 0.6;
      pos.setXYZ(i, pos.getX(i) * s, pos.getY(i) * s * 0.75, pos.getZ(i) * s);
    }
    g.computeVertexNormals();
    return this._whiteColor(g);
  }

  treeTrunkGeometry() {
    const trunk = new THREE.CylinderGeometry(0.14, 0.4, 3.4, 7);
    trunk.translate(0, 1.7, 0);
    return this._whiteColor(trunk);
  }

  treeFoliageGeometry() {
    const c1 = new THREE.ConeGeometry(1.7, 3.4, 8); c1.translate(0, 4.6, 0);
    const c2 = new THREE.ConeGeometry(1.1, 2.4, 8); c2.translate(0, 6.5, 0);
    const merged = mergeGeometries([c1, c2], false);
    return this._whiteColor(merged);
  }

  // ------------------------------ scatter ---------------------------------

  buildScatter(terrain, config) {
    const group = new THREE.Group();
    const rand = mulberry32(20260822);
    const half = config.terrain.size / 2;
    const margin = 60;

    const zones = [
      { x: config.teams.steel.base[0], z: config.teams.steel.base[1], r: 150 },
      { x: config.teams.iron.base[0], z: config.teams.iron.base[1], r: 100 },
      ...LANDMARK_DEFS.map((l) => ({ x: l.x, z: l.z, r: 70 }))
    ];

    const allowed = (x, z, r = 0) =>
      !zones.some((zone) => {
        const dx = x - zone.x, dz = z - zone.z;
        return dx * dx + dz * dz < (zone.r + r) * (zone.r + r);
      });

    const sampleSpot = (slopeMaxDeg = 26, minR = 6) => {
      for (let attempt = 0; attempt < 60; attempt++) {
        const x = randRange(rand, -half + margin, half - margin);
        const z = randRange(rand, -half + margin, half - margin);
        if (!allowed(x, z, minR)) continue;
        const y = terrain.getHeightAt(x, z);
        if (y < config.world.minPlaceHeight) continue;
        if (terrain.getSlopeDeg(x, z) > slopeMaxDeg) continue;
        return { x, z, y };
      }
      return null;
    };

    const scratch = new THREE.Object3D();

    const place = (mesh, spots, colorize) => {
      spots.forEach((spot, i) => {
        const { ry, rx, rz, s } = spot.transform;
        scratch.position.set(spot.x, spot.y, spot.z);
        scratch.rotation.set(rx ?? 0, ry ?? 0, rz ?? 0);
        scratch.scale.setScalar(s ?? 1);
        scratch.updateMatrix();
        mesh.setMatrixAt(i, scratch.matrix);
        if (colorize) mesh.setColorAt(i, colorize(i));
      });
      mesh.count = spots.length;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      group.add(mesh);
    };

    // --- crates ---
    const crates = this._instanced(this.crateGeometry(), this.mat.get('wood'), 40);
    const crateSpots = [];
    for (let i = 0; i < 40; i++) {
      const spot = sampleSpot(30, 4);
      if (spot) crateSpots.push({ ...spot, transform: { ry: randRange(rand, 0, Math.PI * 2), s: randRange(rand, 0.7, 1.3) } });
    }
    place(crates, crateSpots, () => new THREE.Color().setScalar(randRange(rand, 0.82, 1.08)));

    // --- barrels + hazard bands ---
    const barrels = this._instanced(this.barrelGeometry(), this.mat.get('rust'), 26);
    const bands = this._instanced(this.barrelBandGeometry(), this.mat.get('warning'), 26);
    const barrelSpots = [];
    for (let i = 0; i < 26; i++) {
      const spot = sampleSpot(32, 4);
      if (spot) barrelSpots.push({ ...spot, banded: rand() < 0.6, transform: { ry: randRange(rand, 0, Math.PI * 2), s: randRange(rand, 0.75, 1.25) } });
    }
    place(barrels, barrelSpots, () => new THREE.Color().setScalar(randRange(rand, 0.78, 1.1)));
    // bands reuse barrel transforms; skip (zero-scale) where unbranded.
    const bandSpots = barrelSpots.filter((s) => s.banded);
    place(bands, bandSpots, () => new THREE.Color(1, 1, 1));

    // --- sandbags ---
    const sandbags = this._instanced(this.sandbagStackGeometry(), this.mat.get('sandbag'), 22);
    const sandSpots = [];
    for (let i = 0; i < 22; i++) {
      const spot = sampleSpot(30, 5);
      if (spot) sandSpots.push({ ...spot, transform: { ry: randRange(rand, 0, Math.PI * 2), s: randRange(rand, 0.85, 1.25) } });
    }
    place(sandbags, sandSpots, () => new THREE.Color().setScalar(randRange(rand, 0.82, 1.05)));

    // --- warning signs (post + board share a transform) ---
    const posts = this._instanced(this.signPostGeometry(), this.mat.get('steel'), 15);
    const boards = this._instanced(this.signBoardGeometry(), this.mat.get('warningSign'), 15);
    const signSpots = [];
    for (let i = 0; i < 15; i++) {
      const spot = sampleSpot(30, 5);
      if (spot) signSpots.push({ ...spot, transform: { ry: randRange(rand, 0, Math.PI * 2), rx: randRange(rand, -0.1, 0.1), s: randRange(rand, 0.9, 1.15) } });
    }
    place(posts, signSpots, () => new THREE.Color(1, 1, 1));
    place(boards, signSpots, () => new THREE.Color(1, 1, 1));

    // --- rocks ---
    const rocks = this._instanced(this.rockGeometry(), this.mat.get('rock'), 70);
    const rockSpots = [];
    for (let i = 0; i < 70; i++) {
      const spot = sampleSpot(44, 5); // rocks may perch on steeper ground
      if (spot) rockSpots.push({
        ...spot,
        transform: {
          ry: randRange(rand, 0, Math.PI * 2),
          rx: randRange(rand, -0.3, 0.3),
          rz: randRange(rand, -0.3, 0.3),
          s: randRange(rand, 0.5, 2.6)
        }
      });
    }
    place(rocks, rockSpots, () => new THREE.Color().setScalar(randRange(rand, 0.72, 1.02)));

    // --- trees (clustered) ---
    const trunks = this._instanced(this.treeTrunkGeometry(), this.mat.get('trunk'), 110);
    const foliage = this._instanced(this.treeFoliageGeometry(), this.mat.get('foliage'), 110);
    const treeSpots = [];
    for (let c = 0; c < 9 && treeSpots.length < 110; c++) {
      let center = null;
      for (let attempt = 0; attempt < 40; attempt++) {
        const cx = randRange(rand, -half + margin, half - margin);
        const cz = randRange(rand, -half + margin, half - margin);
        if (!allowed(cx, cz, 40)) continue;
        if (terrain.getSlopeDeg(cx, cz) > 20) continue;
        center = { x: cx, z: cz };
        break;
      }
      if (!center) continue;
      const n = randInt(rand, 7, 13);
      for (let t = 0; t < n && treeSpots.length < 110; t++) {
        const ang = randRange(rand, 0, Math.PI * 2);
        const rad = randRange(rand, 3, 26);
        const x = center.x + Math.cos(ang) * rad;
        const z = center.z + Math.sin(ang) * rad;
        if (Math.abs(x) > half - margin || Math.abs(z) > half - margin) continue;
        if (!allowed(x, z, 8)) continue;
        if (terrain.getSlopeDeg(x, z) > 26) continue;
        const y = terrain.getHeightAt(x, z);
        if (y < config.world.minPlaceHeight) continue;
        treeSpots.push({
          x, z, y,
          transform: { ry: randRange(rand, 0, Math.PI * 2), rx: randRange(rand, -0.05, 0.05), rz: randRange(rand, -0.05, 0.05), s: randRange(rand, 0.75, 1.5) }
        });
      }
    }
    place(trunks, treeSpots, () => new THREE.Color().setScalar(randRange(rand, 0.8, 1.0)));
    place(foliage, treeSpots, () => new THREE.Color(randRange(rand, 0.75, 1.0), randRange(rand, 0.85, 1.15), randRange(rand, 0.7, 1.0)));

    return group;
  }

  // ----------------------------- landmarks --------------------------------

  buildLandmarks(terrain) {
    const group = new THREE.Group();

    const placeAt = (parts, x, z, yaw) => {
      const meshes = mergePartsToMeshes(
        parts.map((p) => ({ geometry: p.geometry, material: p.material })),
        (m) => m
      );
      const g = new THREE.Group();
      for (const mesh of meshes) { mesh.castShadow = true; mesh.receiveShadow = true; g.add(mesh); }
      g.position.set(x, terrain.getHeightAt(x, z), z);
      g.rotation.y = yaw;
      group.add(g);
      return g;
    };

    const box = (w, h, d, mat) => ({ geometry: addVertexVariation(new THREE.BoxGeometry(w, h, d), { seed: Math.floor(Math.random() * 1e6) }), material: mat });
    const cyl = (rt, rb, h, mat, seg = 12) => ({ geometry: addVertexVariation(new THREE.CylinderGeometry(rt, rb, h, seg, 1), { seed: Math.floor(Math.random() * 1e6) }), material: mat });

    for (const lm of LANDMARK_DEFS) {
      if (lm.type === 'tower') this._buildTower(placeAt, lm, box, cyl);
      else if (lm.type === 'depot') this._buildDepot(placeAt, lm, box, cyl);
      else if (lm.type === 'bunker') this._buildBunker(placeAt, lm, box, cyl);
      else if (lm.type === 'bridge') this._buildBridge(placeAt, lm, box, cyl);
      else if (lm.type === 'ridge') this._buildRidge(group, lm, terrain);
    }

    return group;
  }

  _buildTower(placeAt, lm, box, cyl) {
    const steel = this.mat.get('steel');
    const accent = this.mat.get('accentRed');
    const light = this.mat.get('lightEmissive');
    const parts = [];
    // 4 angled legs.
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = new THREE.CylinderGeometry(0.22, 0.3, 34, 8);
        leg.translate(sx * 2.7, 17, sz * 2.7);
        leg.rotateX(sx * 0.11);
        leg.rotateZ(sz * 0.11);
        parts.push({ geometry: leg, material: steel });
      }
    }
    // Horizontal ring bracing every few metres.
    for (const y of [7, 13, 19, 25]) {
      const r = 2.7 - (y / 34) * 1.2;
      for (const s of [-1, 1]) {
        const barX = new THREE.BoxGeometry(r * 2, 0.16, 0.16);
        barX.translate(0, y, s * r);
        parts.push({ geometry: barX, material: steel });
        const barZ = new THREE.BoxGeometry(0.16, 0.16, r * 2);
        barZ.translate(s * r, y, 0);
        parts.push({ geometry: barZ, material: steel });
      }
    }
    // Top platform + antenna + beacon.
    const plat = new THREE.BoxGeometry(6.4, 0.7, 6.4); plat.translate(0, 33.2, 0);
    parts.push({ geometry: plat, material: accent });
    const antenna = new THREE.CylinderGeometry(0.08, 0.08, 12, 6); antenna.translate(0, 39, 0);
    parts.push({ geometry: antenna, material: steel });
    const beacon = new THREE.SphereGeometry(0.3, 8, 6); beacon.translate(0, 45, 0);
    parts.push({ geometry: beacon, material: light });
    placeAt(parts, lm.x, lm.z, lm.yaw);
  }

  _buildDepot(placeAt, lm, box, cyl) {
    const rust = this.mat.get('rust');
    const steel = this.mat.get('steel');
    const concrete = this.mat.get('concrete');
    const warning = this.mat.get('warning');
    const parts = [];
    // Concrete pad.
    parts.push(box(13, 0.6, 10, concrete));
    for (const [x, y] of [[-2.6, 2.9], [0, 2.9], [2.6, 2.9]]) {
      const tank = new THREE.CylinderGeometry(2.2, 2.2, 9, 14);
      tank.rotateZ(PI2); // axis → X
      tank.translate(x, y, 0);
      parts.push({ geometry: tank, material: rust });
      // Stands.
      const stand = new THREE.BoxGeometry(1.4, 0.8, 3);
      stand.translate(x, 0.4, 0);
      parts.push({ geometry: stand, material: concrete });
      // Hazard band around the tank.
      const band = new THREE.CylinderGeometry(2.26, 2.26, 1.4, 14);
      band.rotateZ(PI2);
      band.translate(x, y, 0);
      parts.push({ geometry: band, material: warning });
    }
    // Connecting pipe.
    const pipe = new THREE.CylinderGeometry(0.24, 0.24, 5.4, 8);
    pipe.rotateX(PI2);
    pipe.translate(0, 2.2, 0);
    parts.push({ geometry: pipe, material: steel });
    placeAt(parts, lm.x, lm.z, lm.yaw);
  }

  _buildBunker(placeAt, lm, box, cyl) {
    const concrete = this.mat.get('concrete');
    const dark = this.mat.get('armorDark');
    const sandbag = this.mat.get('sandbag');
    const parts = [];
    // Walls (bullet-scarred via strong vertex variation).
    const walls = addVertexVariation(new THREE.BoxGeometry(9, 4, 7), { seed: 3, patchStrength: 0.4, darkPatches: 12 });
    walls.translate(0, 2, 0);
    parts.push({ geometry: walls, material: concrete });
    // Roof slab.
    const roof = addVertexVariation(new THREE.BoxGeometry(9.8, 0.7, 7.8), { seed: 4 });
    roof.translate(0, 4.35, 0);
    parts.push({ geometry: roof, material: concrete });
    // Firing slit.
    const slit = new THREE.BoxGeometry(2.6, 0.7, 0.6);
    slit.translate(0, 2.1, 3.5);
    parts.push({ geometry: slit, material: dark });
    // Rear door.
    const door = new THREE.BoxGeometry(1.6, 2.4, 0.4);
    door.translate(0, 1.2, -3.5);
    parts.push({ geometry: door, material: dark });
    // Sandbag ring on the roof edge.
    for (let i = 0; i < 6; i++) {
      const x = Math.cos((i / 6) * Math.PI * 2) * 4.4;
      const z = Math.sin((i / 6) * Math.PI * 2) * 3.4;
      const bag = new THREE.BoxGeometry(1.6, 0.6, 0.9);
      bag.translate(x, 4.7, z);
      bag.rotateY((i / 6) * Math.PI * 2);
      parts.push({ geometry: bag, material: sandbag });
    }
    placeAt(parts, lm.x, lm.z, lm.yaw);
  }

  _buildBridge(placeAt, lm, box, cyl) {
    const concrete = this.mat.get('concrete');
    const rust = this.mat.get('rust');
    const parts = [];
    // Intact deck slab.
    const deckA = addVertexVariation(new THREE.BoxGeometry(7, 0.9, 4), { seed: 5 });
    deckA.translate(-3, 6, 0);
    parts.push({ geometry: deckA, material: concrete });
    // Collapsed, tilted slab.
    const deckB = addVertexVariation(new THREE.BoxGeometry(7, 0.9, 4), { seed: 6 });
    deckB.translate(5.2, 4.4, 0);
    deckB.rotateZ(0.28);
    parts.push({ geometry: deckB, material: concrete });
    // Pillars (one whole, one sheared).
    const pillarA = new THREE.BoxGeometry(1.8, 12, 3); pillarA.translate(-7, 6, 0);
    parts.push({ geometry: pillarA, material: concrete });
    const pillarB = new THREE.BoxGeometry(1.8, 5, 3); pillarB.translate(0.6, 2.5, 0);
    parts.push({ geometry: pillarB, material: concrete });
    // Fallen debris + rebar.
    for (const [dx, dz, s] of [[2, 1.2, 1], [3, -1, 0.8], [4.5, 0.4, 0.6]]) {
      const chunk = new THREE.BoxGeometry(1.6 * s, 0.8, 1.6 * s);
      chunk.translate(dx, 0.4, dz);
      chunk.rotateY(dz);
      parts.push({ geometry: chunk, material: concrete });
    }
    placeAt(parts, lm.x, lm.z, lm.yaw);
  }

  _buildRidge(group, lm, terrain) {
    const rocks = this._instanced(this.rockGeometry(11), this.mat.get('rock'), 9);
    const scratch = new THREE.Object3D();
    const rand = mulberry32(55);
    const baseH = terrain.getHeightAt(lm.x, lm.z);
    for (let i = 0; i < 9; i++) {
      const ang = randRange(rand, 0, Math.PI * 2);
      const rad = randRange(rand, 0, 18);
      const wx = lm.x + Math.cos(ang) * rad;
      const wz = lm.z + Math.sin(ang) * rad;
      const y = terrain.getHeightAt(wx, wz) - baseH;
      scratch.position.set(wx - lm.x, y, wz - lm.z);
      scratch.rotation.set(randRange(rand, -0.2, 0.2), randRange(rand, 0, Math.PI * 2), randRange(rand, -0.2, 0.2));
      scratch.scale.setScalar(randRange(rand, 3.2, 6.5));
      scratch.updateMatrix();
      rocks.setMatrixAt(i, scratch.matrix);
      rocks.setColorAt(i, new THREE.Color().setScalar(randRange(rand, 0.7, 0.95)));
    }
    rocks.count = 9;
    rocks.instanceMatrix.needsUpdate = true;
    rocks.instanceColor.needsUpdate = true;
    const g = new THREE.Group();
    g.add(rocks);
    g.position.set(lm.x, baseH, lm.z);
    g.rotation.y = lm.yaw;
    group.add(g);
  }
}
