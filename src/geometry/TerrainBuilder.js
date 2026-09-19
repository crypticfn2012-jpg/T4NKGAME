// Builds the terrain mesh from the Terrain heightmap. One BufferGeometry,
// one draw call. Vertex colors are blended by height (grass/dirt/rock bands)
// and by slope (steep faces erode to exposed rock), which reads as erosion
// without any textures.

import * as THREE from 'three';
import { clamp, lerp, mulberry32, smoothstep } from '../utils/Math.js';

const ROCK = [0.49, 0.47, 0.43];

// Height bands (world Y → color). Piecewise-linear interpolation between them.
const COLOR_BANDS = [
  { at: 0, color: [0.37, 0.32, 0.23] },   // dark earth
  { at: 15, color: [0.34, 0.39, 0.26] },  // low grass
  { at: 32, color: [0.41, 0.46, 0.30] },  // grass
  { at: 50, color: [0.48, 0.48, 0.34] },  // dry grass
  { at: 70, color: [0.50, 0.48, 0.43] },  // rock
  { at: 92, color: [0.56, 0.54, 0.50] }   // high rock
];

function bandColor(y) {
  for (let i = 0; i < COLOR_BANDS.length - 1; i++) {
    const a = COLOR_BANDS[i];
    const b = COLOR_BANDS[i + 1];
    if (y <= b.at) {
      const t = smoothstep(a.at, b.at, y);
      return [
        lerp(a.color[0], b.color[0], t),
        lerp(a.color[1], b.color[1], t),
        lerp(a.color[2], b.color[2], t)
      ];
    }
  }
  return [...COLOR_BANDS[COLOR_BANDS.length - 1].color];
}

export function createTerrainGeometry(terrain, seed = 1) {
  const { segments, size } = terrain;
  const N = segments + 1;
  const cell = size / segments;
  const half = size / 2;

  const positions = new Float32Array(N * N * 3);
  const uvs = new Float32Array(N * N * 2);

  for (let iz = 0; iz < N; iz++) {
    for (let ix = 0; ix < N; ix++) {
      const i = ix + iz * N;
      positions[i * 3] = -half + ix * cell;
      positions[i * 3 + 1] = terrain.heightAt(ix, iz);
      positions[i * 3 + 2] = -half + iz * cell;
      uvs[i * 2] = ix / segments;
      uvs[i * 2 + 1] = iz / segments;
    }
  }

  const indices = [];
  for (let iz = 0; iz < segments; iz++) {
    for (let ix = 0; ix < segments; ix++) {
      const a = ix + iz * N;
      const b = ix + 1 + iz * N;
      const c = ix + (iz + 1) * N;
      const d = ix + 1 + (iz + 1) * N;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  // Colors need normals (slope), so compute those first.
  const normals = geometry.attributes.normal;
  const colors = new Float32Array(N * N * 3);
  const rand = mulberry32(seed);

  for (let i = 0; i < N * N; i++) {
    const y = positions[i * 3 + 1];
    const up = normals.getY(i);
    const slope = 1 - up; // 0 flat → ~1 vertical

    let c = bandColor(y);
    // Steep faces read as exposed rock.
    const rockT = smoothstep(0.3, 0.62, slope) * 0.9;
    c = [lerp(c[0], ROCK[0], rockT), lerp(c[1], ROCK[1], rockT), lerp(c[2], ROCK[2], rockT)];

    const j = 1 + (rand() - 0.5) * 0.12; // breaks up the banding
    colors[i * 3] = clamp(c[0] * j, 0, 1);
    colors[i * 3 + 1] = clamp(c[1] * j, 0, 1);
    colors[i * 3 + 2] = clamp(c[2] * j, 0, 1);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();

  return geometry;
}
