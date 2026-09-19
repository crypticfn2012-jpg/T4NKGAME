// Shared geometry utilities used by the procedural builders.
//
// addVertexVariation() bakes ambient-occlusion-style darkening and wear
// patches directly into vertex colors. This is the "detail via vertex colors"
// approach: cheap, always lit, no extra texture memory.
//
// mergePartsToMeshes() folds all parts that share a material into a single
// BufferGeometry so each material = one draw call instead of one per part.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, smoothstep } from '../utils/Math.js';

export function addVertexVariation(
  geometry,
  { jitter = 0.05, darkenBottom = 0.4, bottomY = -1.0, darkPatches = 3, patchStrength = 0.22, seed = 1 } = {}
) {
  const pos = geometry.attributes.position;
  const count = pos.count;
  const colors = new Float32Array(count * 3);
  const rand = mulberry32(seed);

  const patches = [];
  for (let p = 0; p < darkPatches; p++) {
    patches.push({
      x: (rand() - 0.5) * 3.4,
      y: (rand() - 0.5) * 2.2,
      z: (rand() - 0.5) * 3.4,
      r: 0.4 + rand() * 1.1
    });
  }

  for (let i = 0; i < count; i++) {
    let v = 0.9 + rand() * 0.18; // base brightness variation
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);

    // Baked AO: darken toward the bottom of the part.
    const bottom = smoothstep(bottomY, bottomY + 1.1, y);
    v -= darkenBottom * (1 - bottom);

    // Random worn patches.
    for (const p of patches) {
      const dx = x - p.x, dy = y - p.y, dz = z - p.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      v -= patchStrength * Math.exp(-d2 / (p.r * p.r));
    }

    colors[i * 3] = v;
    colors[i * 3 + 1] = v;
    colors[i * 3 + 2] = v;
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

// parts: [{ geometry, material, matrix? }] → one THREE.Mesh per distinct material.
// `material` may be a name (resolved by `resolve`) or a Material instance.
export function mergePartsToMeshes(parts, resolve = (m) => m) {
  const buckets = new Map();
  for (const part of parts) {
    const mat = resolve(part.material);
    const geometry = part.geometry.clone ? part.geometry.clone() : part.geometry;
    if (part.matrix) geometry.applyMatrix4(part.matrix);
    if (!buckets.has(mat)) buckets.set(mat, []);
    buckets.get(mat).push(geometry);
  }

  const meshes = [];
  for (const [mat, geos] of buckets) {
    const geometry = geos.length === 1 ? geos[0] : mergeGeometries(geos, false);
    geometry.computeBoundingSphere();
    meshes.push(new THREE.Mesh(geometry, mat));
  }
  return meshes;
}
