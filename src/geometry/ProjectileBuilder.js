// Procedural armour-piercing shell: tapered body + nose cone + base band +
// a small glowing tracer tip. Built along +Z so the group can be oriented
// with a single quaternion.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function buildShellMesh(materials) {
  const steel = materials.get('shell');
  const tip = materials.get('glowTip');

  const body = new THREE.CylinderGeometry(0.16, 0.3, 2.4, 10, 1);
  body.rotateX(Math.PI / 2); // +Y → +Z
  body.translate(0, 0, 0.9);

  const band = new THREE.CylinderGeometry(0.33, 0.33, 0.16, 10);
  band.rotateX(Math.PI / 2);
  band.translate(0, 0, -0.2);

  const nose = new THREE.ConeGeometry(0.16, 0.72, 10);
  nose.rotateX(Math.PI / 2); // apex → +Z
  nose.translate(0, 0, 2.35);

  const group = new THREE.Group();
  const merged = mergeGeometries([body, band, nose], false);
  group.add(new THREE.Mesh(merged, steel));

  const tipMesh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), tip);
  tipMesh.position.set(0, 0, 2.6);
  group.add(tipMesh);

  return group;
}

// Dynamic line geometry for the shell trail. The draw range grows as points
// are appended so we never reallocate buffers.
export function createTrailGeometry(maxPoints) {
  const positions = new Float32Array(maxPoints * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setDrawRange(0, 0);
  return geometry;
}
