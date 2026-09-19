// WebSocket client wrapper with reconnect & ping. Emits typed events up to the
// rest of the game: 'open', 'close', 'welcome', 'lobby', 'match', 'snap',
// 'error'. All protocol payloads are plain objects produced by the server.

import CONFIG from '../config.js';
import { EventEmitter } from '../utils/EventEmitter.js';
import { S2C } from '../../shared/protocol.js';

// Turn a user-supplied "server location" (https URL or bare host[:port]) into
// a full ws(s) WebSocket endpoint on the game path (/ws).
function serverToWsUrl(input) {
  let u;
  try {
    u = new URL(input);
  } catch {
    u = new URL(`https://${input}`);
  }
  const proto = (u.protocol === 'https:' || u.protocol === 'wss:') ? 'wss' : 'ws';
  const base = u.host + (u.pathname && u.pathname !== '/' ? u.pathname.replace(/\/$/, '') : '');
  return `${proto}://${base}${CONFIG.net.wsPath}`;
}

export class NetClient extends EventEmitter {
  constructor(name, settings = null) {
    super();
    this.name = name;
    this.ws = null;
    this.connected = false;
    this.playerId = null;
    this.rtt = 0;
    this._seq = 0;
    this._pings = new Map();
    this._pingTimer = null;
    this._reconnectAttempts = 0;
    this._closedByUser = false;
    this._url = '';
    this.server = (settings && settings.server) || '';
  }

  connect() {
    const q = (new URLSearchParams(location.search).get('server') || '').trim();
    const override = q || this.server;
    if (override) {
      this._url = serverToWsUrl(override);
    } else {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      this._url = `${proto}://${location.host}${CONFIG.net.wsPath}`;
    }
    this._closedByUser = false;
    this._open();
  }

  // Switch to a different game server (Settings screen). Empty value returns
  // to same-origin behaviour.
  setServer(url, { reconnect = true } = {}) {
    this.server = (url || '').trim();
    if (reconnect) {
      this.close();
      this.connect();
    }
  }

  _open() {
    try {
      this.ws = new WebSocket(this._url);
    } catch (err) {
      this.emit('fatal', String(err));
      return;
    }
    this.ws.onopen = () => this._onOpen();
    this.ws.onmessage = (ev) => this._onMessage(ev.data);
    this.ws.onclose = (ev) => this._onClose(ev);
    this.ws.onerror = () => {};
  }

  _onOpen() {
    this.connected = true;
    this._reconnectAttempts = 0;
    this.emit('open');
    this.send({ type: 'hello', name: this.name, tankId: localStorage.getItem('tankfield.tank') || 'vanguard' });
    this._startPing();
  }

  _onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    switch (msg.type) {
      case S2C.WELCOME:
        this.playerId = msg.playerId;
        this.emit('welcome', msg);
        break;
      case S2C.LOBBY:
        this.emit('lobby', msg);
        break;
      case S2C.MATCH:
        this.emit('match', msg);
        break;
      case S2C.SNAP:
        this.emit('snap', msg);
        break;
      case S2C.ERROR:
        this.emit('error', msg);
        break;
      case S2C.PONG: {
        const t = Number(msg.t);
        if (this._pings.has(t)) {
          this.rtt = Math.max(1, (performance.now() - this._pings.get(t)) | 0);
          this._pings.delete(t);
        }
        break;
      }
      default:
        break;
    }
  }

  _onClose() {
    const wasConnected = this.connected;
    this.connected = false;
    this._stopPing();
    this.emit('close', { wasConnected });
    if (!this._closedByUser) this._scheduleReconnect();
  }

  _scheduleReconnect() {
    const cfg = CONFIG.net;
    const delay = Math.min(
      cfg.reconnectMaxMs,
      cfg.reconnectMinMs * Math.pow(cfg.reconnectFactor, this._reconnectAttempts)
    );
    this._reconnectAttempts++;
    setTimeout(() => {
      if (!this._closedByUser && !this.connected) this._open();
    }, delay);
  }

  _startPing() {
    this._stopPing();
    this._pingTimer = setInterval(() => {
      const t = ++this._seq;
      this._pings.set(t, performance.now());
      this.send({ type: 'ping', t });
    }, CONFIG.net.pingIntervalMs);
  }

  _stopPing() {
    if (this._pingTimer) {
      clearInterval(this._pingTimer);
      this._pingTimer = null;
    }
    this._pings.clear();
  }

  send(msg) {
    if (!this.connected || !this.ws) return false;
    try {
      this.ws.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  close() {
    this._closedByUser = true;
    this._stopPing();
    if (this.ws) {
      try { this.ws.close(); } catch { /* noop */ }
      this.ws = null;
    }
  }

  // -------- high-level commands ----------

  createMatch() {
    this.send({ type: 'create' });
  }

  joinMatch(matchId, tankId) {
    this.send({ type: 'join', matchId, tankId });
  }

  leaveMatch() {
    this.send({ type: 'leave' });
  }

  startMatch() {
    this.send({ type: 'start' });
  }

  selectTank(tankId) {
    localStorage.setItem('tankfield.tank', tankId);
    this.send({ type: 'selectTank', tankId });
  }

  sendInput(input) {
    // fire carries a unique id so the server can name shells deterministically.
    this.send({ type: 'input', f: input.fwd, s: input.steer, b: input.brake ? 1 : 0, ty: input.ty, el: input.el, fire: input.fire });
  }

  requestReload() {
    this.send({ type: 'reload' });
  }
}