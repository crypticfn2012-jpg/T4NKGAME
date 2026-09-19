// Procedural tank: hull, turret, barrel, wheels and tracks composed entirely
// from Three.js primitives, then merged per material so each tank costs only
// a handful of draw calls.
//
// Layout: the root group's origin is the hull's mass center (y=0). Tracks
// touch the ground at y ≈ -1.25, forward is +Z. The turret and barrel are
// child groups so they rotate independently of the hull.

import * as THREE from 'three';
import { addVertexVariation, mergePartsToMeshes } from './helpers.js';

const PI2 = Math.PI / 2;

export class TankBuilder {
  constructor(materials) {
    this.mat = materials;
  }

  // paintMaterial: per-entity (cloned) material so damage can tint it.
  build({ paintMaterial, seed = 1 } = {}) {
    const M = this.mat;
    let seedCounter = seed;

    const parts = (list) =>
      list.map(({ geometry, material, matrix }) => {
        if (!geometry.attributes.color) {
          addVertexVariation(geometry, { seed: seedCounter++, darkenBottom: 0.42, bottomY: -0.9 });
        }
        return { geometry, material, matrix };
      });

    // --- HULL --------------------------------------------------------------
    const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
    const cyl = (rt, rb, h, seg = 12) => new THREE.CylinderGeometry(rt, rb, h, seg, 1);

    const hullParts = [];

    // Main hull body (slightly tapered silhouette via the glacis/rear plates).
    hullParts.push({ geometry: box(4.4, 1.5, 7.6), material: paintMaterial, matrix: new THREE.Matrix4().makeTranslation(0, -0.5, 0) });

    // Front glacis — angled plate for the classic sloped front.
    {
      const m = new THREE.Matrix4().makeRotationX(0.42);
      m.setPosition(0, -0.25, 3.35);
      hullParts.push({ geometry: box(4.0, 1.15, 1.6), material: paintMaterial, matrix: m });
    }
    // Rear plate.
    {
      const m = new THREE.Matrix4().makeRotationX(-0.12);
      m.setPosition(0, -0.6, -3.7);
      hullParts.push({ geometry: box(4.2, 1.0, 0.6), material: paintMaterial, matrix: m });
    }
    // Engine deck + radiator grille.
    hullParts.push({ geometry: box(3.6, 0.14, 2.2), material: paintMaterial, matrix: new THREE.Matrix4().makeTranslation(0, 0.28, -1.9) });
    hullParts.push({ geometry: box(3.2, 0.07, 1.5), material: M.get('armorDark'), matrix: new THREE.Matrix4().makeTranslation(0, 0.38, -2.15) });
    // Side skirts over the tracks.
    hullParts.push({ geometry: box(0.16, 0.5, 7.3), material: M.get('armorDark'), matrix: new THREE.Matrix4().makeTranslation(2.3, -0.5, 0) });
    hullParts.push({ geometry: box(0.16, 0.5, 7.3), material: M.get('armorDark'), matrix: new THREE.Matrix4().makeTranslation(-2.3, -0.5, 0) });
    // Fenders.
    for (const s of [-1, 1]) {
      hullParts.push({ geometry: box(0.7, 0.12, 1.4), material: paintMaterial, matrix: new THREE.Matrix4().makeTranslation(2.5 * s, 0.34, 3.4) });
      hullParts.push({ geometry: box(0.7, 0.12, 1.4), material: paintMaterial, matrix: new THREE.Matrix4().makeTranslation(2.5 * s, 0.34, -3.4) });
    }
    // Hatches on the front deck.
    for (const s of [-1, 1]) {
      const h = cyl(0.42, 0.42, 0.16, 14);
      h.rotateX(PI2);
      hullParts.push({ geometry: h, material: paintMaterial, matrix: new THREE.Matrix4().makeTranslation(0.95 * s, 0.33, -1.1) });
    }
    // Stowage boxes on the fenders.
    for (const s of [-1, 1]) {
      hullParts.push({ geometry: box(0.9, 0.4, 1.1), material: paintMaterial, matrix: new THREE.Matrix4().makeTranslation(2.2 * s, 0.6, -0.9) });
    }
    // Headlights (red housing + emissive lens).
    for (const s of [-1, 1]) {
      hullParts.push({ geometry: box(0.36, 0.24, 0.22), material: M.get('accentRed'), matrix: new THREE.Matrix4().makeTranslation(1.75 * s, 0.12, 3.85) });
      hullParts.push({ geometry: box(0.2, 0.14, 0.08), material: M.get('lightEmissive'), matrix: new THREE.Matrix4().makeTranslation(1.75 * s, 0.12, 3.97) });
    }
    // Exhausts.
    for (const s of [-1, 1]) {
      const e = cyl(0.13, 0.13, 1.0, 8);
      const m = new THREE.Matrix4().makeRotationX(0.5);
      m.setPosition(1.85 * s, 0.35, -3.7);
      hullParts.push({ geometry: e, material: M.get('steel'), matrix: m });
    }
    // Radio antenna.
    {
      const a = cyl(0.025, 0.025, 2.4, 6);
      const m = new THREE.Matrix4().makeRotationX(-0.16);
      m.setPosition(1.5, 0.3, -3.0);
      hullParts.push({ geometry: a, material: M.get('steel'), matrix: m });
    }
    // Tow hooks front + rear.
    for (const z of [3.95, -3.95]) {
      hullParts.push({ geometry: box(0.5, 0.3, 0.2), material: M.get('steel'), matrix: new THREE.Matrix4().makeTranslation(0, -0.2, z) });
    }

    // --- TRACKS (two assemblies, merged per side) --------------------------
    const trackParts = (side) => {
      const list = [];
      const sx = 2.28 * side;
      // Track band.
      list.push({ geometry: box(1.0, 1.42, 9.4), material: M.get('armorDark'), matrix: new THREE.Matrix4().makeTranslation(sx, -0.62, 0) });
      // Road wheels (6 per side).
      for (let i = 0; i < 6; i++) {
        const z = -3.5 + i * 1.4;
        const w = cyl(0.66, 0.66, 0.52, 14);
        w.rotateZ(PI2); // axis → X
        list.push({ geometry: w, material: M.get('armorDark'), matrix: new THREE.Matrix4().makeTranslation(sx, -0.62, z) });
        const hub = cyl(0.28, 0.28, 0.6, 10);
        hub.rotateZ(PI2);
        list.push({ geometry: hub, material: M.get('steel'), matrix: new THREE.Matrix4().makeTranslation(sx, -0.62, z) });
      }
      // Taller idler wheels at the ends (exaggerated proportion).
      for (const z of [-4.15, 4.15]) {
        const idler = cyl(0.8, 0.8, 0.4, 14);
        idler.rotateZ(PI2);
        list.push({ geometry: idler, material: M.get('armorDark'), matrix: new THREE.Matrix4().makeTranslation(sx, -0.5, z) });
      }
      return list;
    };

    // --- TURRET ------------------------------------------------------------
    const turretParts = [];
    // Flat base ring.
    turretParts.push({ geometry: cyl(1.62, 1.5, 0.36, 16), material: paintMaterial, matrix: new THREE.Matrix4().makeTranslation(0, -0.02, 0) });
    // Dome (flattened hemisphere).
    {
      const dome = new THREE.SphereGeometry(1.32, 14, 9, 0, Math.PI * 2, 0, Math.PI / 2);
      const m = new THREE.Matrix4().makeScale(1, 0.82, 1);
      m.setPosition(0, 0.3, 0);
      turretParts.push({ geometry: dome, material: paintMaterial, matrix: m });
    }
    // Gun mantlet.
    turretParts.push({ geometry: box(1.7, 0.95, 1.15), material: paintMaterial, matrix: new THREE.Matrix4().makeTranslation(0, 0.15, 1.35) });
    // Commander cupola + hatch.
    turretParts.push({ geometry: cyl(0.48, 0.48, 0.3, 12), material: paintMaterial, matrix: new THREE.Matrix4().makeTranslation(-0.2, 1.15, -0.15) });
    turretParts.push({ geometry: cyl(0.52, 0.52, 0.08, 12), material: M.get('armorDark'), matrix: new THREE.Matrix4().makeTranslation(-0.2, 1.32, -0.15) });
    // Commander MG.
    {
      const mg = cyl(0.035, 0.035, 0.6, 6);
      mg.rotateX(-0.4);
      const m = new THREE.Matrix4().makeTranslation(-0.05, 1.5, 0.15);
      turretParts.push({ geometry: mg, material: M.get('steel'), matrix: m });
    }
    // Turret stowage boxes.
    for (const s of [-1, 1]) {
      turretParts.push({ geometry: box(0.5, 0.4, 1.0), material: M.get('armorDark'), matrix: new THREE.Matrix4().makeTranslation(1.15 * s, 0.5, 0.3) });
    }

    // --- BARREL (child of turret; pitches) ---------------------------------
    const barrelParts = [];
    // Tapered barrel from pivot out to +Z.
    {
      const b = cyl(0.24, 0.42, 6.0, 12);
      b.rotateX(PI2);
      barrelParts.push({ geometry: b, material: M.get('steel'), matrix: new THREE.Matrix4().makeTranslation(0, 0, 3.3) });
    }
    // Reinforcing collars.
    for (const z of [1.1, 2.3]) {
      const c = cyl(0.34, 0.34, 0.18, 12);
      c.rotateX(PI2);
      barrelParts.push({ geometry: c, material: M.get('steel'), matrix: new THREE.Matrix4().makeTranslation(0, 0, z) });
    }
    // Muzzle brake.
    barrelParts.push({ geometry: box(0.58, 0.52, 0.5), material: M.get('armorDark'), matrix: new THREE.Matrix4().makeTranslation(0, 0, 5.9) });
    barrelParts.push({ geometry: box(0.4, 0.4, 0.18), material: M.get('steel'), matrix: new THREE.Matrix4().makeTranslation(0, 0, 6.2) });

    // --- Assemble ----------------------------------------------------------
    const root = new THREE.Group();

    const hullMesh = mergePartsToMeshes(parts(hullParts));
    for (const mesh of hullMesh) { mesh.castShadow = true; mesh.receiveShadow = true; root.add(mesh); }

    const trackL = mergePartsToMeshes(parts(trackParts(-1)));
    const trackR = mergePartsToMeshes(parts(trackParts(1)));
    for (const mesh of [...trackL, ...trackR]) { mesh.castShadow = true; mesh.receiveShadow = true; root.add(mesh); }

    const turret = new THREE.Group();
    turret.position.set(0, 0.85, 0);
    const turretMeshes = mergePartsToMeshes(parts(turretParts));
    for (const mesh of turretMeshes) { mesh.castShadow = true; mesh.receiveShadow = true; turret.add(mesh); }

    const barrel = new THREE.Group();
    barrel.position.set(0, 0.2, 1.35);
    const barrelMeshes = mergePartsToMeshes(parts(barrelParts));
    for (const mesh of barrelMeshes) { mesh.castShadow = true; barrel.add(mesh); }
    turret.add(barrel);

    // Marker at the muzzle tip — used for the projectile spawn point.
    const barrelTip = new THREE.Object3D();
    barrelTip.position.set(0, 0, 6.35);
    barrel.add(barrelTip);

    root.add(turret);

    return { root, turret, barrel, barrelTip };
  }
}
