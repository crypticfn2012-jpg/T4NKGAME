// Headless client-boot test. Exercises every scene/geometry/material path the
// browser entry point (src/index.js) runs at startup — with a canvas shim so
// no DOM or WebGL is needed. Catches boot-time null/undefined crashes (like
// the buildScatter banding failure) before they ship.
//
// Run: node test/clientboot.test.mjs

import * as THREE from 'three';
import CONFIG from '../src/config.js';
import { createTerrain } from '../shared/terrain.js';
import { createTerrainGeometry } from '../src/geometry/TerrainBuilder.js';
import { EnvironmentBuilder } from '../src/geometry/EnvironmentBuilder.js';
import { TankBuilder } from '../src/geometry/TankBuilder.js';
import { EffectsManager } from '../src/game/EffectsManager.js';
import { ShellView } from '../src/game/ShellView.js';
import { CameraController } from '../src/game/CameraController.js';
import { skyGradientTexture, glowTexture, createCanvasTexture } from '../src/materials/TextureGenerator.js';
import { TANKS } from '../shared/tanks.js';
import { LANDMARK_DEFS } from '../shared/colliders.js';

let failures = 0;
function check(cond, label) {
  if (cond) console.log(`  ok  ${label}`);
  else { console.error(`FAIL  ${label}`); failures++; }
}

// ---- minimal canvas 2d shim (Node has no <canvas>) ----
globalThis.document = {
  createElement(tag) {
    if (tag === 'canvas') {
      return {
        width: 128, height: 128,
        getContext: () => ({
          fillStyle: '', strokeStyle: '', lineWidth: 1,
          fillRect() {}, strokeRect() {}, clearRect() {}, save() {}, restore() {},
          translate() {}, rotate() {}, beginPath() {}, fill() {}, stroke() {},
          createRadialGradient() { return { addColorStop() {} }; },
          createLinearGradient() { return { addColorStop() {} }; }
        })
      };
    }
    return {};
  }
};

const matLib = {
  get: (name) => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.15 })
};

console.log('terrain + geometry');
const terrain = createTerrain(CONFIG.terrain);
const groundGeo = createTerrainGeometry(terrain);
check(groundGeo.attributes.position.count > 0, 'terrain geometry positions');
check(terrain.getHeightAt(0, 0) > 1.5, 'field centre is above minPlaceHeight');

console.log('environment scatter');
const env = new EnvironmentBuilder(matLib);
const scatter = env.buildScatter(terrain, CONFIG);
let placed = 0;
scatter.traverse((o) => { if (o.isInstancedMesh) placed += o.count; });
check(placed > 0, `instanced props placed (${placed})`);
check(!scatter.children.some((o) => o === null || o === undefined), 'no null children in scatter');

console.log('landmarks');
const landmarks = env.buildLandmarks(terrain);
check(landmarks.children.length === LANDMARK_DEFS.length, `one group per landmark (${landmarks.children.length}/${LANDMARK_DEFS.length})`);
check(landmarks.children.every((c) => c.children.length > 0), 'every landmark has geometry');

console.log('tanks');
const tb = new TankBuilder(matLib);
for (const id of Object.keys(TANKS)) {
  const m = tb.build({ paintMaterial: new THREE.MeshStandardMaterial(), seed: 7 });
  check(m.root && m.turret && m.barrel && m.barrelTip, `tank "${id}" builds root/turret/barrel/tip`);
}

console.log('effects + shell + camera');
const scene = new THREE.Scene();
const fx = new EffectsManager(scene, matLib, CONFIG);
check(fx.pools && fx.pools.spark && fx.glows.length === CONFIG.effects.maxGlows, 'effects pools initialised');
const sv = new ShellView(scene, matLib, CONFIG);
check(!sv.group.visible, 'shell view starts hidden');
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 4200);
const cc = new CameraController(camera, CONFIG, { getHeightAt: () => 0 });
check(cc.camera === camera, 'camera controller attached');
cc.punchFov(2.6);
cc.update(0.016, { x: 0, y: 2, z: 0 }, null, false);
const decay = CONFIG.camera.fovPunchDecay * 0.016;
check(Math.abs(camera.fov - (CONFIG.renderer.fov + Math.max(0, 2.6 - decay))) < 0.01, 'fov punch inflates camera fov');
cc.update(1, { x: 0, y: 2, z: 0 }, null, false);
check(Math.abs(camera.fov - CONFIG.renderer.fov) < 0.01, 'fov punch decays back to default');

console.log('sky textures');
const skyCanvas = skyGradientTexture();
check(skyCanvas.width > 0 && skyCanvas.height > 0, 'sky gradient canvas generated');
const skyTex = createCanvasTexture(skyCanvas, { flipY: false, srgb: true });
check(skyTex.flipY === false, 'sky texture drawn top=zenith');
const glowTex = createCanvasTexture(glowTexture(), { srgb: true });
check(glowTex.colorSpace !== undefined, 'glow texture wrapped');

console.log(failures === 0 ? '\nCLIENT-BOOT PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);