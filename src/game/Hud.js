// DOM HUD. Reads config for colours and drives pre-existing elements by id.
// Writes are throttled to ~12 Hz so the DOM tree isn't the hot path.

function $(id) {
  return document.getElementById(id);
}

export class Hud {
  constructor(cfg, settings) {
    this.cfg = cfg;
    this.settings = settings;
    this._el = {};
    const ids = [
      'hud', 'crosshair', 'reload', 'reloadTag', 'range',
      'healthValue', 'healthFill', 'healthRow',
      'targetDir', 'targetSub', 'targetReading',
      'messages', 'debug', 'scoreSteel', 'scoreIron', 'timer',
      'scoreboard', 'boardList', 'boardScore', 'boardTimer',
      'hitmarker', 'hitmarkerK', 'banner', 'bannerText',
      'death', 'deathCount', 'pause', 'disconnected', 'reason',
      'hint', 'fps', 'vignette', 'ammo', 'weapon', 'vehicle'
    ];
    for (const id of ids) this._el[id] = $(id);
    this._acc = 0;
    this._last = {};
    this._lastBoard = '';
    this._msgSeq = 0;
  }

  show(visible) {
    const hud = this._el.hud;
    if (hud) hud.classList.toggle('on', visible);
  }

  update(dt, gameState) {
    this._acc += dt;
    if (this._acc < 1 / 12) return;
    this._acc = 0;

    const el = this._el;
    if (!gameState) return;
    const st = gameState.selfState;
    if (el.healthValue && st) el.healthValue.textContent = String(Math.max(0, Math.round(st.hp)));
    if (el.healthFill && st) {
      const pct = Math.max(0, Math.min(1, (st.hp || 0) / st.maxHp));
      el.healthFill.style.width = Math.round(pct * 100) + '%';
      // green → amber → red
      el.healthFill.style.background = pct > 0.55 ? 'var(--ok)' : pct > 0.28 ? 'var(--accent)' : 'var(--danger)';
    }
    if (st) {
      const comps = st.components || {};
      if (el.weapon) el.weapon.textContent = (gameState.tankDef?.name || 'VANGUARD');
      const state = [
        ['TRK', comps.tracks], ['ENG', comps.engine], ['TRT', comps.turret], ['GUN', comps.cannon]
      ];
      if (this._last.healthRow !== (st.hp | 0) + gameState.tankDef?.name) {
        this._last.healthRow = (st.hp | 0) + gameState.tankDef?.name;
        const row = el.healthRow;
        if (row) {
          row.innerHTML = state.map(([k, v]) =>
            `<span class="comp ${v <= 0 ? 'dead' : v < 0.4 ? 'warn' : ''}">${k} ${(v ?? 0) | 0}%</span>`
          ).join('');
        }
      }
    }
    if (el.reload && st) {
      const pct = st.reloadPct ?? 1;
      el.reload.style.width = Math.round(pct * 100) + '%';
      if (el.reloadTag) el.reloadTag.textContent = pct >= 1 ? 'READY' : 'RELOADING';
      if (el.reloadTag) el.reloadTag.style.color = pct >= 1 ? 'var(--ok)' : 'var(--hud-dim)';
    }
    if (el.range) el.range.textContent = gameState.rangeText || '';

    // scores + timer + scoreboard
    if (el.scoreSteel) el.scoreSteel.textContent = String(gameState.scores?.steel ?? 0);
    if (el.scoreIron) el.scoreIron.textContent = String(gameState.scores?.iron ?? 0);
    if (el.timer && gameState.timeLeft != null) {
      const s = Math.ceil(gameState.timeLeft);
      el.timer.textContent = `${String((s / 60) | 0).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    }

    if (el.fps && gameState.fps != null) el.fps.textContent = String(gameState.fps | 0);
  }

  updateScoreboard(rows, scores, timeLeft) {
    const el = this._el;
    if (!el.boardList) return;
    const key = rows.map((r) => `${r.name}:${r.k}:${r.d}`).join('|');
    if (key === this._lastBoard) {
      if (el.boardScore) el.boardScore.textContent = `${scores.steel} — ${scores.iron}`;
      if (el.boardTimer && timeLeft != null) el.boardTimer.textContent = `TIME ${(timeLeft | 0)}s`;
      return;
    }
    this._lastBoard = key;
    el.boardList.innerHTML = rows
      .sort((a, b) => b.k - a.k)
      .map((r) => {
        const teamName = this.cfg.teams[r.team] ? this.cfg.teams[r.team].short : r.team;
        return `<div class="row">
          <span class="name" style="color:var(--hud)">${escapeHtml(r.name)}</span>
          <span class="team" style="color:${this.cfg.teams[r.team]?.color || '#aaa'}">${teamName}</span>
          <span>${r.tank.toUpperCase()}</span>
          <span>${r.k} / ${r.d}</span>
        </div>`;
      }).join('');
    if (el.boardScore) el.boardScore.textContent = `${scores.steel} — ${scores.iron}`;
    if (el.boardTimer && timeLeft != null) el.boardTimer.textContent = `TIME ${(timeLeft | 0)}s`;
  }

  showScoreboard(visible) {
    const el = this._el.scoreboard;
    if (el) el.classList.toggle('on', visible);
  }

  // -------------------------------------------------------------- feedback

  hitMarker(kill = false) {
    const el = kill ? this._el.hitmarkerK : this._el.hitmarker;
    if (el) {
      el.classList.remove('active');
      void el.offsetWidth; // reflow restarts the animation
      el.classList.add('active');
    }
  }

  banner(text, color) {
    const b = this._el.banner;
    if (!b) return;
    const t = this._el.bannerText;
    if (t) {
      t.textContent = text;
      if (color) t.style.color = color;
    }
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
    clearTimeout(this._bannerTimer);
    this._bannerTimer = setTimeout(() => b.classList.remove('show'), 3200);
  }

  deathScreen(count) {
    const d = this._el.death;
    const c = this._el.deathCount;
    if (count <= 0) {
      if (d) d.classList.remove('on');
      return;
    }
    if (d) d.classList.add('on');
    if (c) c.textContent = String(Math.ceil(count));
  }

  damageFlash(amount) {
    const v = this._el.vignette;
    if (v) {
      v.style.opacity = String(Math.min(1, (this.settings?.shake ? 0.9 : 0.7) * amount));
      clearTimeout(this._vignetteTimer);
      this._vignetteTimer = setTimeout(() => { v.style.opacity = '0'; }, 320);
    }
  }

  rangeTo(targetDist) {
    this._rangeText = targetDist != null ? `${Math.round(targetDist)} m` : '';
  }

  pushMsg(text, opts = {}) {
    const wrap = this._el.messages;
    if (!wrap) return;
    const div = document.createElement('div');
    div.className = 'msg on';
    div.textContent = text;
    if (opts.color) div.style.borderLeftColor = opts.color;
    wrap.appendChild(div);
    while (wrap.children.length > 5) wrap.removeChild(wrap.firstChild);
    setTimeout(() => {
      div.classList.remove('on');
      setTimeout(() => div.remove(), 400);
    }, 5200);
  }

  setLatency(ms) {
    const dbg = this._el.debug;
    if (dbg && this._acc < 0.001) dbg.textContent = `PING ${ms}ms`;
  }

  setPause(visible) {
    const p = this._el.pause;
    if (p) p.classList.toggle('on', visible);
  }

  setDisconnected(visible, reason) {
    const d = this._el.disconnected;
    const r = this._el.reason;
    if (d) d.classList.toggle('on', visible);
    if (r && reason) r.textContent = reason;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export default Hud;