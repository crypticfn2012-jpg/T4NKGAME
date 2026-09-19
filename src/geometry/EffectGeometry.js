// Base geometries for instanced particles. Each effect type gets ONE
// InstancedMesh; variation comes from per-instance matrices and colors.

import * as THREE from 'three';

export const sparkGeometry = () => new THREE.BoxGeometry(0.16, 0.16, 0.16);
export const puffGeometry = () => new THREE.IcosahedronGeometry(0.55, 0);
export const flashGeometry = () => new THREE.OctahedronGeometry(0.6, 0);
