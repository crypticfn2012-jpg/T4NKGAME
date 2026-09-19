// Procedural WebAudio: everything is synthesized — engine loop, gunshot,
// impacts, explosions, reload, UI ticks and a low dark ambient bed. No audio
// assets to ship. Volume follows user settings.

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfx = null;
    this.music = null;
    this.enabled = false;
    this.engine = null;
    this._components = {};
    this._ambientTimer = null;
    this.listener = null;
  }

  init() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    this.master.connect(comp);
    comp.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.music = ctx.createGain();
    this.music.connect(this.master);
    this.enabled = true;

    // shared noise buffer used by all bursts
    const len = ctx.sampleRate * 1.2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this._noiseBuffer = buf;

    this._bumpVolumes(1, 1);
    this._startEngine();
    this._startAmbient();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolumes({ master, sfx, music }) {
    this._bumpVolumes(this.enabled ? (master ?? 1) : 0, this.enabled ? (sfx ?? 1) : 0);
    if (this.music) this.music.gain.linearRampToValueAtTime((music ?? 1) * 0.35, this.ctx.currentTime + 0.3);
  }

  _bumpVolumes(master, sfx) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (this.master) this.master.gain.linearRampToValueAtTime(master * (this.enabled ? 0.85 : 0), t + 0.2);
    if (this.sfx) this.sfx.gain.linearRampToValueAtTime(sfx, t + 0.2);
  }

  mute(on) {
    if (this.master) this.master.gain.value = on ? 0 : (this._lastMaster ?? 0.8);
    if (!on) this._lastMaster = this.master ? this.master.gain.value : 0.8;
  }

  // ------------------------------------------------------------- engine loop

  _startEngine() {
    const ctx = this.ctx;
    if (!ctx) return;
    const g = ctx.createGain();
    g.gain.value = 0;

    // low rumble from detuned saws
    const o1 = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    o1.type = 'sawtooth';
    o2.type = 'sawtooth';
    o1.frequency.value = 38;
    o2.frequency.value = 41;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260;
    const g2 = ctx.createGain();
    g2.gain.value = 1.2;
    o1.connect(g2); o2.connect(g2);
    g2.connect(lp);
    lp.connect(g);
    g.connect(this.sfx);

    const noise = ctx.createBufferSource();
    noise.buffer = this._noiseBuffer;
    noise.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 90;
    bp.Q.value = 0.8;
    const ng = ctx.createGain();
    ng.gain.value = 0.5;
    noise.connect(bp); bp.connect(ng); ng.connect(g);

    o1.start(); o2.start(); noise.start();
    this.engine = { gain: g, lp, o1, o2 };
  }

  // ratio: 0..1 of max speed → engine pitch + volume.
  engineLevel(ratio, moving) {
    if (!this.engine || !this.ctx) return;
    const t = this.ctx.currentTime;
    const target = moving ? 0.09 + Math.abs(ratio) * 0.16 : 0.02;
    this.engine.gain.gain.linearRampToValueAtTime(target, t + 0.12);
    const freq = 36 + Math.abs(ratio) * 44;
    this.engine.o1.frequency.linearRampToValueAtTime(freq, t + 0.15);
    this.engine.o2.frequency.linearRampToValueAtTime(freq * 1.08, t + 0.15);
    this.engine.lp.frequency.linearRampToValueAtTime(200 + Math.abs(ratio) * 320, t + 0.12);
  }

  // ---------------------------------------------------------------- bursts

  _burst(opts) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + (opts.at || 0);
    const out = ctx.createGain();
    const distGain = opts.gain ?? 1;
    out.gain.value = (opts.volume ?? 0.5) * distGain;
    const filter = ctx.createBiquadFilter();
    filter.type = opts.filter || 'lowpass';
    filter.frequency.value = opts.freq || 1600;
    if (opts.slide) filter.frequency.linearRampToValueAtTime(opts.slide, t + (opts.dur || 0.3));
    out.connect(filter);
    filter.connect(this.sfx);

    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer;
    src.loop = opts.loop || false;
    src.start(t, opts.offset || 0, opts.dur || 0.2);
    src.stop(t + (opts.dur || 0.2) + 0.02);

    // tide the gain envelope off
    out.gain.setValueAtTime((opts.volume ?? 0.5) * distGain, t);
    out.gain.exponentialRampToValueAtTime(0.0001, t + (opts.dur || 0.2));
    return { src, out, start: t };
  }

  _tone(freq, dur, type, opts = {}) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + (opts.at || 0);
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    if (opts.slide) o.frequency.exponentialRampToValueAtTime(Math.max(1, opts.slide), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.volume ?? 0.5, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.sfx);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  gunshot() {
    this._burst({ dur: 0.09, volume: 0.6, freq: 900, slide: 140, gain: 1 });
    this._burst({ dur: 0.22, volume: 0.35, freq: 240, slide: 70, sort: 0.05 });
    this._tone(70, 0.16, 'triangle', { volume: 0.4, slide: 34 });
  }

  distantGunshot() {
    this._burst({ dur: 0.5, volume: 0.16, freq: 500, slide: 120, gain: 1 });
    this._tone(48, 0.7, 'sine', { volume: 0.1 });
  }

  impactGround(dist = 0) {
    const v = Math.max(0.12, 0.42 * (1 - Math.min(1, dist / 700)));
    this._burst({ dur: 0.2, volume: v, freq: 300, slide: 90 });
  }

  impactTank(dist = 0) {
    const v = Math.max(0.2, 0.6 * (1 - Math.min(1, dist / 700)));
    this._burst({ dur: 0.14, volume: v, freq: 1500, slide: 220 });
    this._burst({ dur: 0.34, volume: v * 0.7, freq: 320, slide: 60 });
  }

  explosion(dist = 0) {
    const v = Math.max(0.15, 0.9 * (1 - Math.min(1, dist / 900)));
    this._burst({ dur: 1.3, volume: v, freq: 520, slide: 60, gain: 1 });
    this._tone(44, 1.6, 'sine', { volume: v * 0.8, slide: 26 });
    this._burst({ dur: 0.5, volume: v * 0.8, freq: 1400, slide: 200, at: 0.05 });
  }

  reloadTick() {
    this._burst({ dur: 0.03, volume: 0.3, freq: 2600 });
    this._tone(1200, 0.02, 'square', { volume: 0.08 });
  }

  reloaded() {
    this._burst({ dur: 0.06, volume: 0.35, freq: 1800, slide: 900 });
    this._tone(660, 0.1, 'square', { volume: 0.12, slide: 990 });
  }

  hitConfirm() {
    this._tone(1500, 0.05, 'square', { volume: 0.14 });
  }

  ricochet() {
    this._burst({ dur: 0.18, volume: 0.3, freq: 3400, slide: 900 });
    this._tone(2200, 0.12, 'sawtooth', { volume: 0.1, slide: 800 });
  }

  uiTap() {
    this._tone(900, 0.04, 'triangle', { volume: 0.16 });
  }

  uiHover() {
    this._tone(1400, 0.02, 'triangle', { volume: 0.05 });
  }

  playerDeath() {
    this._burst({ dur: 0.9, volume: 0.6, freq: 600, slide: 80 });
    this._tone(60, 1.1, 'sine', { volume: 0.5, slide: 30 });
  }

  matchStart() {
    this._tone(440, 0.18, 'square', { volume: 0.2 });
    this._tone(660, 0.24, 'square', { volume: 0.2, at: 0.2 });
  }

  countdown(final) {
    this._tone(final ? 620 : 320, final ? 0.3 : 0.14, 'square', { volume: 0.16 });
  }

  // ---------------------------------------------------------------- ambient

  _startAmbient() {
    if (!this.ctx) return;
    const loop = () => {
      if (!this.enabled) return;
      // faint wind
      this._burst({ dur: 2.4, volume: 0.05, freq: 240, slide: 300, loop: true, offset: Math.random() });
      // distant shelling, irregular
      const next = 5 + Math.random() * 16;
      this._ambientTimer = setTimeout(() => {
        if (this.enabled) {
          this.distantGunshot();
          if (Math.random() < 0.35) setTimeout(() => this.distantGunshot(), 80 + Math.random() * 300);
        }
        loop();
      }, next * 1000);
    };
    // don't run until the game is actually active
    this._ambientQueue = loop;
  }

  startAmbient() {
    if (this._ambientTimer || !this._ambientQueue || !this.enabled) return;
    this._ambientQueue();
  }

  stopAmbient() {
    if (this._ambientTimer) clearTimeout(this._ambientTimer);
    this._ambientTimer = null;
  }
}

export default AudioManager;