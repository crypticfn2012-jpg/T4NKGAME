// TANKFIELD boot. Creates the renderer, builds the battlefield, wires the
// subsystems (net, game, UI, audio, effects) and starts the render loop.

import * as THREE from 'three';
import CONFIG from './config.js';
import { createTerrain } from '../shared/terrain.js';
import { MaterialLibrary } from './materials/MaterialLibrary.js';
import { createTerrainGeometry } from './geometry/TerrainBuilder.js';
import { EnvironmentBuilder } from './geometry/EnvironmentBuilder.js';
import { glowTexture, createCanvasTexture } from './materials/TextureGenerator.js';
import { NetClient } from './net/NetClient.js';
import { InputManager } from './game/InputManager.js';
import { AudioManager } from './game/AudioManager.js';
import { EffectsManager } from './game/EffectsManager.js';
import { CameraController } from './game/CameraController.js';
import { Hud } from './game/Hud.js';
import { Ui } from './ui/Ui.js';

let terrain;
let renderer, scene, camera;
let materials, environment;
let net, input, audio, effects, cam, hud, ui;
let game;
const cloudSprites = [];

const clock = new THREE.Clock();
let fpsAcc = 0;
let fpsCount = 0;
let fps = 0;

async function boot() {
  try {
    const container = document.getElementById('app');
    if (!container) throw new Error('Missing #app container');

    // ---- renderer / scene ----
    renderer = new THREE.WebGLRenderer({
      antialias: CONFIG.renderer.antialias,
      powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.renderer.pixelRatio));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = CONFIG.flags.shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = CONFIG.renderer.exposure;
    container.appendChild(renderer.domElement);
    renderer.domElement.id = 'gameCanvas';

    scene = new THREE.Scene();
    if (CONFIG.flags.fog) {
      scene.fog = new THREE.Fog(CONFIG.fog.color, 300, 2900);
      scene.background = new THREE.Color(CONFIG.fog.color);
    } else {
      scene.background = new THREE.Color(0x0f1410);
    }

    camera = new THREE.PerspectiveCamera(CONFIG.renderer.fov, window.innerWidth / window.innerHeight, CONFIG.renderer.near, CONFIG.renderer.far);
    camera.position.set(0, 60, 120);

    // ---- lights ----
    scene.add(new THREE.HemisphereLight(0xc9d4e3, 0x4a4436, 0.95));
    const sun = new THREE.DirectionalLight(0xfff0d0, 2.6);
    sun.position.set(320, 520, 190);
    sun.castShadow = CONFIG.flags.shadows;
    sun.shadow.mapSize.set(CONFIG.renderer.shadowMapSize, CONFIG.renderer.shadowMapSize);
    sun.shadow.camera.left = -600;
    sun.shadow.camera.right = 600;
    sun.shadow.camera.top = 600;
    sun.shadow.camera.bottom = -600;
    sun.shadow.camera.far = 1800;
    sun.shadow.bias = -0.0015;
    scene.add(sun);
    scene.add(sun.target);

    // ---- world data (shared + client) ----
    terrain = createTerrain(CONFIG.terrain);

    // ---- materials ----
    materials = new MaterialLibrary().build();

    // ---- terrain mesh ----
    const terrainGeo = createTerrainGeometry(terrain, 1337);
    const terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
    const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
    terrainMesh.receiveShadow = true;
    scene.add(terrainMesh);

    // ---- environment dressing ----
    const env = new EnvironmentBuilder(materials);
    environment = env.buildScatter(terrain, CONFIG);
    scene.add(environment);
    const landmarks = env.buildLandmarks(terrain);
    scene.add(landmarks);

    // ---- sky / sun glow ----
    _buildSky();

    // ---- systems ----
    const settings = (await import('./settings.js')).loadSettings();
    input = new InputManager(renderer.domElement, CONFIG.controls, settings);
    audio = new AudioManager();
    audio.setVolumes(settings.volume);
    effects = new EffectsManager(scene, materials, CONFIG);
    cam = new CameraController(camera, CONFIG, terrain);
    hud = new Hud(CONFIG, settings);
    ui = new Ui({
      onCreate: () => net.createMatch(),
      onJoin: (id) => {
        net.selectTank(localStorage.getItem('tankfield.tank') || 'vanguard');
        net.joinMatch(id, localStorage.getItem('tankfield.tank') || 'vanguard');
      },
      onLeave: () => net.leaveMatch(),
      onStart: () => net.startMatch(),
      onSelectTank: (id) => { game && game.selectTank(id); },
      onName: (name) => { if (net && net.connected) net.send({ type: 'hello' }); },
      onSettings: (s) => { audio.setVolumes(s.volume); _applyGraphics(s); },
      onResume: () => { input.lock(); hud.setPause(false); focusGame(); },
      onBackToMenu: () => { net.leaveMatch(); ui.showMenu(); input.unlock(); hud.show(false); }
    });

    net = new NetClient(settings.name);
    net.on('open', () => { ui.setConnection('ONLINE'); audio.resume(); });
    net.on('close', ({ wasConnected }) => {
      ui.setConnection(wasConnected ? 'RECONNECTING…' : 'OFFLINE');
    });
    net.on('lobby', () => ui.setConnection('ONLINE'));

    game = new (await import('./game/ClientGame.js')).default({
      scene, camera, materials, terrain, net, input, settings, audio, effects, cam, hud, ui
    });

    // pre-heat audio on first user gesture
    const resumeAudio = () => { audio.init(); audio.resume(); window.removeEventListener('pointerdown', resumeAudio); };
    window.addEventListener('pointerdown', resumeAudio);

    // ---- window / resize ----
    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // ---- ui ----
    ui.showBoot();
    ui.setBootProgress(1, 'READY');
    setTimeout(() => {
      ui.showMenu();
      net.connect();
    }, 300);

    // fps overlay
    const fpsEl = document.getElementById('fps');
    if (CONFIG.flags.fpsCounter && fpsEl) fpsEl.style.display = 'block';

    requestAnimationFrame(loop);
  } catch (err) {
    console.error(err);
    const container = document.getElementById('app');
    if (container) {
      container.innerHTML = `<div class="fatal">
        <h1>RENDERER FAILED</h1>
        <p>WebGL could not be initialised. This battlefield needs a WebGL-capable browser.<br/>
        <small>${escapeHtml(String(err && err.message))}</small></p>
        <button onclick="location.reload()">RELOAD</button>
      </div>`;
    }
  }
}

let lastFrame = performance.now();

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;

  fpsAcc += dt;
  fpsCount++;
  if (fpsAcc >= 0.5) {
    fps = fpsCount / fpsAcc;
    fpsAcc = 0;
    fpsCount = 0;
  }

  if (game && game.inSession) {
    game.setFps(fps);
    game.update(dt);
  }

  // drift clouds
  for (const s of cloudSprites) {
    s.position.x += s.userData.vel * dt;
    if (Math.abs(s.position.x) > 1900) s.userData.vel = -s.userData.vel;
    const y = s.userData.baseY + Math.sin(now * 0.00008) * 6;
    s.position.y = y;
  }

  renderer.render(scene, camera);
}

function _buildSky() {
  const glowCanvas = createCanvasTexture(glowTexture(), { wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping });
  const sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowCanvas, color: 0xffe0a0,
    transparent: true, opacity: 0.85, depthWrite: false, fog: false
  }));
  sunSprite.scale.set(260, 260, 1);
  const sunDir = new THREE.Vector3(320, 520, 190).normalize();
  sunSprite.position.copy(sunDir.multiplyScalar(2400));
  scene.add(sunSprite);

  if (!CONFIG.flags.clouds) return;
  // drifting cloud layer (cheap big soft sprites)
  const cloudTex = createCanvasTexture(glowTexture({ inner: 'rgba(235,232,220,0.7)', outer: 'rgba(235,232,220,0)' }), { wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping });
  const rnd = mulberry32(42);
  for (let i = 0; i < 14; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: cloudTex, color: 0xffffff, transparent: true,
      opacity: 0.28 + rnd() * 0.22, depthWrite: false, fog: false
    }));
    s.position.set((rnd() - 0.5) * 2600, 420 + rnd() * 260, (rnd() - 0.5) * 2600);
    const sc = 220 + rnd() * 320;
    s.scale.set(sc * 2.2, sc, 1);
    const vel = 1.2 + rnd() * 2.2;
    s.userData.vel = vel;
    s.userData.baseY = s.position.y;
    cloudSprites.push(s);
    scene.add(s);
  }
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function _applyGraphics(settings) {
  const q = settings.graphics;
  renderer.shadowMap.enabled = CONFIG.flags.shadows && q !== 'low';
  if (q === 'low') {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1));
  } else if (q === 'medium') {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.renderer.pixelRatio * 0.75));
  } else {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, CONFIG.renderer.pixelRatio));
  }
}

function focusGame() {
  if (ui && ui._current === 'lobby') return;
}

boot();