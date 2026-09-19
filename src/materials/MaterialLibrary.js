// MaterialLibrary owns ONE MeshStandardMaterial instance per visual type.
// Geometry-level detail (weathering, panel wear, damage) is carried by vertex
// colors multiplied on top, so thousands of objects share a handful of
// materials instead of each owning its own.

import * as THREE from 'three';
import { hazardTexture, glowTexture, createCanvasTexture } from './TextureGenerator.js';

export class MaterialLibrary {
  constructor() {
    /** @type {Map<string, THREE.Material>} */
    this.materials = new Map();
  }

  get(name) {
    return this.materials.get(name);
  }

  build() {
    const add = (name, params) => {
      const m = new THREE.MeshStandardMaterial(params);
      this.materials.set(name, m);
      return m;
    };
    const addBasic = (name, params) => {
      const m = new THREE.MeshBasicMaterial(params);
      this.materials.set(name, m);
      return m;
    };

    // --- Tanks -------------------------------------------------------------
    add('tankGreen', { color: 0x4c5c3c, metalness: 0.35, roughness: 0.62, vertexColors: true });
    add('tankDesert', { color: 0x7a6a4a, metalness: 0.35, roughness: 0.68, vertexColors: true });
    add('armorDark', { color: 0x26292b, metalness: 0.15, roughness: 0.9, vertexColors: true });
    add('steel', { color: 0x41464b, metalness: 0.7, roughness: 0.38 });
    add('accentRed', { color: 0x8a302a, metalness: 0.2, roughness: 0.7 });

    // --- Environment -------------------------------------------------------
    add('rust', { color: 0x7c4a2c, metalness: 0.25, roughness: 0.85 });
    add('wood', { color: 0x6e5438, metalness: 0.05, roughness: 0.9, vertexColors: true });
    add('sandbag', { color: 0x8d8160, metalness: 0.0, roughness: 1.0 });
    add('concrete', { color: 0x85888c, metalness: 0.05, roughness: 0.92, vertexColors: true });
    add('rock', { color: 0x6a6861, metalness: 0.05, roughness: 1.0, flatShading: true });
    add('foliage', { color: 0x405c30, metalness: 0.0, roughness: 0.85, flatShading: true });
    add('trunk', { color: 0x59472f, metalness: 0.0, roughness: 1.0 });

    // --- Warning stripes (textured) ---------------------------------------
    // Two distinct uses need different tiling: thin barrel bands vs. flat
    // sign boards, so each gets its own texture instance.
    const hazard = createCanvasTexture(hazardTexture(), { wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping });
    add('warning', { color: 0xffffff, map: hazard, roughness: 0.75 });
    const hazardSign = createCanvasTexture(hazardTexture(), { wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping });
    hazardSign.repeat.set(2, 1);
    add('warningSign', { color: 0xffffff, map: hazardSign, roughness: 0.75 });

    // --- Projectiles / effects --------------------------------------------
    add('shell', { color: 0x565b60, metalness: 0.85, roughness: 0.32 });
    addBasic('glowTip', { color: 0xff9a2e });
    addBasic('lightEmissive', { color: 0xffd98a });

    addBasic('spark', { color: 0xffc060, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    addBasic('puff', { color: 0x3a3a38, transparent: true, opacity: 0.5, depthWrite: false });
    addBasic('flash', { color: 0xffe9b8, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    addBasic('cloud', { color: 0xe8e4da, transparent: true, opacity: 0.88, fog: false, depthWrite: false });

    const glow = createCanvasTexture(glowTexture(), { wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping });
    addBasic('glowSprite', { color: 0xffe6b0, map: glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });

    return this;
  }

  // Per-entity clone (used for damage tinting). Clones are cheap: they share
  // the same shader programs and textures, only the color state diverges.
  cloneForEntity(name, overrides = {}) {
    const base = this.materials.get(name);
    if (!base) throw new Error(`MaterialLibrary: unknown material "${name}"`);
    return base.clone();
  }
}
