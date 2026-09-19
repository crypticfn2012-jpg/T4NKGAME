// TANKFIELD game server.
//
// Serves the built client (dist/) over HTTP and hosts the authoritative
// multiplayer simulation over WebSocket at /ws.
//
// Run: node server/index.js   (PORT env, default 3000)

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import CONFIG from '../src/config.js';
import { createTerrain } from '../shared/terrain.js';
import { Match } from './Match.js';
import { TANKS } from '../shared/tanks.js';
import { S2C, C2S, STATUS } from '../shared/protocol.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');

const PORT = Number(process.env.PORT || 3000);
const TICK_MS = 1000 / CONFIG.physics.fixedRate;

// ---------------------------------------------------------------- world data

const terrain = createTerrain(CONFIG.terrain);
const matches = new Map();      // matchId → Match
const players = new Map();      // playerId → PlayerData (all connected clients)

let playerSeq = 0;

// ------------------------------------------------------------------ helpers

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json'
};

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function safeName(name) {
  return String(name || 'Tanker').replace(/[<>&"'/\\]/g, '').trim().slice(0, 16) || 'Tanker';
}

// ------------------------------------------------------------- lobby / rooms

function lobbyList() {
  const list = [];
  for (const m of matches.values()) {
    if (m.status !== STATUS.LOBBY && m.status !== STATUS.COUNTDOWN) continue;
    list.push({
      id: m.id,
      name: m.name,
      players: m.playerCount,
      max: CONFIG.match.maxPlayersPerMatch,
      status: m.status,
      position: m.players.size
    });
  }
  list.sort((a, b) => a.id.localeCompare(b.id));
  return list;
}

function broadcastLobby() {
  const payload = { type: S2C.LOBBY, matches: lobbyList(), servers: 1 };
  for (const p of players.values()) {
    send(p.socket, payload);
  }
}

function createMatch(host) {
  const m = new Match(CONFIG, terrain);
  matches.set(m.id, m);
  m.broadcast = (msg) => {
    for (const p of m.players.values()) send(p.socket, msg);
  };
  m.addPlayer(host);
  host.match = m;
  m.name = `${host.name}'s Battlefield`;
  broadcastLobby();
  return m;
}

function removeFromMatch(p) {
  if (!p.match) return;
  const m = p.match;
  m.removePlayer(p.id);
  p.match = null;
  if (m.playerCount === 0) {
    matches.delete(m.id);
  }
  send(p.socket, { type: S2C.MATCH, inMatch: false });
  broadcastLobby();
}

// ------------------------------------------------------------- game tick loop

let lastTick = Date.now();

function tick() {
  const nowMs = Date.now();
  const now = nowMs / 1000;
  let dt = (nowMs - lastTick) / 1000;
  lastTick = nowMs;
  if (dt <= 0 || dt > 0.1) dt = TICK_MS / 1000;

  for (const [id, m] of matches) {
    if (m.playerCount === 0) {
      matches.delete(id);
      continue;
    }
    const snap = m.update(dt, now);
    m.broadcast(snap);
  }
}

setInterval(tick, TICK_MS);

// ------------------------------------------------------------ message routing

function handleMessage(p, raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  if (!msg || typeof msg.type !== 'string') return;

  switch (msg.type) {
    case C2S.PING: {
      send(p.socket, { type: S2C.PONG, t: msg.t });
      break;
    }
    case C2S.HELLO: {
      if (p.name) return; // already greeted
      p.name = safeName(msg.name);
      p.tankId = isTankId(msg.tankId) ? msg.tankId : 'vanguard';
      p.ready = false;
      send(p.socket, { type: S2C.WELCOME, playerId: p.id });
      broadcastLobby();
      break;
    }
    case C2S.CREATE: {
      if (!p.name) return sendError(p, 'not_greeted', 'Say hello first.');
      if (p.match) return sendError(p, 'in_match', 'Leave your current match first.');
      if (createMatch(p)) {
        send(p.socket, { type: S2C.MATCH, inMatch: true, matchId: p.match.id });
      }
      break;
    }
    case C2S.JOIN: {
      if (!p.name) return sendError(p, 'not_greeted', 'Say hello first.');
      if (p.match) return sendError(p, 'in_match', 'Leave your current match first.');
      const m = matches.get(msg.matchId);
      if (!m) return sendError(p, 'no_match', 'That match no longer exists.');
      if (m.playerCount >= CONFIG.match.maxPlayersPerMatch) return sendError(p, 'full', 'That match is full.');
      if (m.status !== STATUS.LOBBY && m.status !== STATUS.COUNTDOWN) return sendError(p, 'started', 'That match has already started.');
      if (msg.tankId && TANKS[msg.tankId]) p.tankId = msg.tankId;
      m.addPlayer(p);
      p.match = m;
      broadcastLobby();
      send(p.socket, { type: S2C.MATCH, inMatch: true, matchId: m.id, team: p.team });
      break;
    }
    case C2S.SELECT_TANK: {
      if (!p.name) return;
      if (TANKS[msg.tankId]) {
        p.tankId = msg.tankId;
        if (p.match) p.match.selectTank(p, msg.tankId);
      }
      break;
    }
    case C2S.START: {
      if (p.match) p.match.start();
      break;
    }
    case C2S.LEAVE: {
      if (p.match) removeFromMatch(p);
      break;
    }
    case C2S.INPUT: {
      if (!p.match) return;
      const f = Number(msg.f);
      p.input = {
        fwd: clamp11(f),
        steer: clamp11(Number(msg.s)),
        brake: !!msg.b,
        ty: Number.isFinite(msg.ty) ? msg.ty : p.tank?.turretYaw ?? 0,
        el: Number.isFinite(msg.el) ? msg.el : p.tank?.elev ?? 0,
        fire: msg.fire || null
      };
      break;
    }
    case C2S.RELOAD: {
      if (p.match && p.tank && !p.canFire) {
        // restart the reload timer (harmless; the buzz is informational)
      }
      break;
    }
    default:
      break;
  }
}

function sendError(p, code, message) {
  send(p.socket, { type: S2C.ERROR, code, message });
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp11 = (v) => (v < -1 ? -1 : v > 1 ? 1 : v);

// Pre-resolve valid tank ids once.
function isTankId(id) {
  return !!TANKS[id];
}

// ------------------------------------------------------------------ static

async function serveStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = normalize(join(DIST, urlPath));
  if (!filePath.startsWith(DIST)) {
    res.writeHead(403).end();
    return;
  }

  // SPA fallback for unknown paths (must not shadow real files).
  let target = filePath;
  if (!existsSync(target) || statSync(target).isDirectory()) {
    target = join(DIST, 'index.html');
  }
  try {
    const data = await readFile(target);
    const type = MIME[extname(target)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    res.writeHead(404).end('Not found');
  }
}

// -------------------------------------------------------------------- http

const server = http.createServer(serveStatic);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname !== CONFIG.net.wsPath) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws) => {
  const p = {
    id: 'p' + (++playerSeq) + '_' + Math.random().toString(36).slice(2, 7),
    socket: ws,
    name: null,
    match: null,
    tankId: 'vanguard',
    ready: false,
    ping: 0,
    input: null
  };
  players.set(p.id, p);

  ws.on('message', (data) => handleMessage(p, data.toString()));
  ws.on('close', () => {
    players.delete(p.id);
    if (p.match) {
      const m = p.match;
      m.removePlayer(p.id);
      if (m.playerCount === 0) matches.delete(m.id);
    }
    broadcastLobby();
  });
  ws.on('error', () => {});
});

// ---------------------------------------------------------------- startup

const hasDist = existsSync(DIST);
server.listen(PORT, () => {
  console.log(`TANKFIELD server listening on http://localhost:${PORT}`);
  console.log(`  WebSocket: ws://localhost:${PORT}${CONFIG.net.wsPath}`);
  console.log(`  Tick rate: ${CONFIG.physics.fixedRate} Hz`);
  if (!hasDist) {
    console.log('  NOTE: dist/ not found — run `npm run build` to serve the game client.');
  }
});

export { server, matches, players };