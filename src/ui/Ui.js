// Screen router + DOM wiring for menus, lobby, settings, controls, about and
// results. All screen markup lives in index.html; this module flips visibility
// and updates content. Gameplay overlays (pause / disconnect) are driven from
// Hud.

import CONFIG from '../config.js';
import { getTank } from '../../shared/tanks.js';
import { loadSettings, saveSettings } from '../settings.js';

const $ = (id) => document.getElementById(id);

export class Ui {
  constructor({ onCreate, onJoin, onLeave, onStart, onSelectTank, onName, onSettings, onResume, onBackToMenu }) {
    this.actions = { onCreate, onJoin, onLeave, onStart, onSelectTank, onName, onSettings, onResume, onBackToMenu };
    this.settings = loadSettings();
    this.matchId = null;
    this._current = 'boot';

    this._bindMenu();
    this._bindLobby();
    this._bindSettings();
    this._bindResults();
    this._bindOverlays();
    this._buildTankCards();
  }

  // ------------------------------------------------------------- visibility

  show(screen) {
    const screens = ['boot', 'menu', 'lobby', 'settings', 'controls', 'about', 'results'];
    for (const s of screens) {
      const el = $(`screen-${s}`);
      if (el) el.classList.toggle('active', s === screen);
    }
    this._current = screen;
    if (screen === 'lobby') this._refreshLobby();
  }

  showBoot() { this.show('boot'); }

  setBootProgress(frac, text) {
    const bar = $('bootBar');
    if (bar) bar.style.width = Math.round(Math.min(1, Math.max(0, frac)) * 100) + '%';
    const t = $('bootText');
    if (t) t.textContent = text || '';
  }

  showMenu() { this.show('menu'); }
  showLobby() { this.show('lobby'); }
  showSettings() { this.show('settings'); }
  showControls() { this.show('controls'); }
  showAbout() { this.show('about'); }
  showResults() { this.show('results'); }

  // -------------------------------------------------------------- boot/menu

  _bindMenu() {
    const nameField = $('nameField');
    if (nameField) {
      nameField.value = this.settings.name;
      nameField.addEventListener('change', () => {
        this.settings.name = nameField.value.trim().slice(0, 16) || 'Tanker';
        saveSettings(this.settings);
        if (this.actions.onName) this.actions.onName(this.settings.name);
      });
    }
    const mp = $('btnMultiplayer');
    if (mp) mp.addEventListener('click', () => {
      if (this.actions.onName) this.actions.onName(this.settings.name);
      this.showLobby();
    });
    const settings = $('btnSettings');
    if (settings) settings.addEventListener('click', () => this.showSettings());
    const controls = $('btnControls');
    if (controls) controls.addEventListener('click', () => this.showControls());
    const about = $('btnAbout');
    if (about) about.addEventListener('click', () => this.showAbout());
    const backFromSettings = $('btnSettingsLobbyBack');
    if (backFromSettings) backFromSettings.addEventListener('click', () => this.show(this._current === 'lobby' ? 'lobby' : 'menu'));
    const backFromControls = $('btnControlsBack');
    if (backFromControls) backFromControls.addEventListener('click', () => this.showMenu());
    const backFromAbout = $('btnAboutBack');
    if (backFromAbout) backFromAbout.addEventListener('click', () => this.showMenu());
  }

  _toLobby() {
    this.showLobby();
  }

  // ---------------------------------------------------------------- lobby

  _bindLobby() {
    const create = $('btnCreate');
    if (create) create.addEventListener('click', () => {
      if (this.actions.onCreate) this.actions.onCreate();
    });
    const leave = $('btnLeave');
    if (leave) leave.addEventListener('click', () => {
      if (this.actions.onLeave) this.actions.onLeave();
    });
    const start = $('btnStart');
    if (start) start.addEventListener('click', () => {
      if (this.actions.onStart) this.actions.onStart();
    });
  }

  updateLobby(matches) {
    this.matches = matches || [];
    this._refreshLobby();
  }

  _refreshLobby() {
    if (this._current !== 'lobby') return;
    const list = $('matchList');
    if (!list) return;

    if (!this.matches || this.matches.length === 0) {
      list.innerHTML = '<div class="empty">NO OPEN BATTLES — CREATE ONE</div>';
    } else {
      list.innerHTML = this.matches.map((m) => {
        const mine = m.id === this.matchId;
        return `<div class="match${mine ? ' mine' : ''}">
          <span class="m-name">${escapeHtml(m.name)}</span>
          <span class="m-count">${m.players}/${m.max}</span>
          <span class="m-status">${m.status === 'countdown' ? 'STARTING' : 'OPEN'}</span>
          ${!mine ? `<button class="btn mini" data-join="${escapeHtml(m.id)}">JOIN</button>` : '<span class="m-you">YOU</span>'}
        </div>`;
      }).join('');
    }
    list.querySelectorAll('[data-join]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (this.actions.onJoin) this.actions.onJoin(btn.dataset.join);
      });
    });

    const conn = $('connState');
    const room = $('inMatchPanel');
    if (room) room.classList.toggle('hidden', !this.matchId);
    if (conn) conn.textContent = this._connLabel;
  }

  setConnection(label) {
    this._connLabel = label;
    const conn = $('connState');
    if (conn) conn.textContent = label;
  }

  showLobbyInMatch(msg) {
    this.matchId = msg.matchId;
    this.showLobby();
  }

  clearMatch() {
    this.matchId = null;
  }

  // ---------------------------------------------------------------- settings

  _bindSettings() {
    const s = this.settings;
    const bind = (id, get, set, apply) => {
      const el = $(id);
      if (!el) return;
      el.value = get(s);
      el.addEventListener('input', () => {
        const v = set(el.value);
        saveSettings(this.settings);
        if (apply) apply(v);
      });
    };
    bind('setMaster', (x) => x.volume.master, (v) => (x.volume.master = Number(v), Number(v)), (v) => this._applyVolume());
    bind('setSfx', (x) => x.volume.sfx, (v) => (x.volume.sfx = Number(v), Number(v)), (v) => this._applyVolume());
    bind('setMusic', (x) => x.volume.music, (v) => (x.volume.music = Number(v), Number(v)), (v) => this._applyVolume());
    bind('setSens', (x) => x.sensitivity, (v) => (x.sensitivity = Number(v), Number(v)));
    bind('setDust', (x) => (x.trackDust ? 1 : 0), (v) => (x.trackDust = Number(v) === 1, Number(v)));
    bind('setShake', (x) => (x.shake ? 1 : 0), (v) => (x.shake = Number(v) === 1, Number(v)));
    bind('setHold', (x) => (x.holdToFire ? 1 : 0), (v) => (x.holdToFire = Number(v) === 1, Number(v)));
    const gfx = $('setGfx');
    if (gfx) {
      gfx.value = s.graphics;
      gfx.addEventListener('change', () => {
        this.settings.graphics = gfx.value;
        saveSettings(this.settings);
        if (this.actions.onSettings) this.actions.onSettings(this.settings);
      });
    }

    const back = $('btnSettingsLobbyBack');
    if (back) back.addEventListener('click', () => {
      this.show(this._current === 'lobby' ? 'lobby' : 'menu');
    });
  }

  _applyVolume() {
    if (this.actions.onSettings) this.actions.onSettings(this.settings);
  }

  // ---------------------------------------------------------------- results

  _bindResults() {
    const back = $('btnResultsLobby');
    if (back) back.addEventListener('click', () => {
      if (this.actions.onLeave) this.actions.onLeave();
    });
    const again = $('btnAgain');
    if (again) again.addEventListener('click', () => {
      if (this.actions.onStart) this.actions.onStart();
    });
  }

  showResults() {
    // populated from snapshot data by ClientGame via accessors below
    this.show('results');
  }

  fillResults(data) {
    const title = $('resultsTitle');
    if (title) {
      if (!data.winner) title.textContent = 'DRAW';
      else title.textContent = `${CONFIG.teams[data.winner].name} WINS`;
    }
    const score = $('resultsScore');
    if (score) score.textContent = `${data.scores.steel} — ${data.scores.iron}`;
    const list = $('resultsList');
    if (list && data.stats) {
      list.innerHTML = data.stats.slice().sort((a, b) => b.kills - a.kills).map((r) =>
        `<div class="row"><span>${escapeHtml(r.name)}</span><span>${r.tank.toUpperCase()}</span><span>${r.kills} K / ${r.deaths} D</span></div>`
      ).join('');
    }
  }

  _bindOverlays() {
    const resume = $('btnResume');
    if (resume) resume.addEventListener('click', () => {
      if (this.actions.onResume) this.actions.onResume();
    });
    const leave = $('btnPauseLeave');
    if (leave) leave.addEventListener('click', () => {
      if (this.actions.onLeave) this.actions.onLeave();
    });
    const backToMenu = $('btnMenuBack');
    if (backToMenu) backToMenu.addEventListener('click', () => {
      if (this.actions.onBackToMenu) this.actions.onBackToMenu();
    });
  }

  // ------------------------------------------------------------- tank cards

  _buildTankCards() {
    const wrap = $('tankCards');
    if (!wrap) return;
    const saved = localStorage.getItem('tankfield.tank') || 'vanguard';
    wrap.innerHTML = CONFIG.tankRoster.map((id) => {
      const t = getTank(id);
      const front = t.armour.front;
      return `<button class="tankcard" data-tank="${id}">
        <span class="t-name">${t.name}</span>
        <span class="t-class">${t.clazz}</span>
        <span class="t-stats">HP ${t.hp} · ARM ${front} · DMG ${t.cannon.damage}</span>
        <span class="t-stats">RATE ${t.cannon.reload}s · SPD ${t.movement.maxForward}</span>
      </button>`;
    }).join('');
    wrap.querySelectorAll('.tankcard').forEach((card) => {
      card.addEventListener('click', () => {
        const id = card.dataset.tank;
        wrap.querySelectorAll('.tankcard').forEach((c) => c.classList.toggle('selected', c === card));
        if (this.actions.onSelectTank) this.actions.onSelectTank(id);
      });
    });
    const sel = wrap.querySelector(`[data-tank="${saved}"]`);
    if (sel) sel.classList.add('selected');
  }

  updateTankSelection(id) {
    const wrap = $('tankCards');
    if (!wrap) return;
    wrap.querySelectorAll('.tankcard').forEach((c) => c.classList.toggle('selected', c.dataset.tank === id));
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export default Ui;