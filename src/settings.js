// User settings, persisted to localStorage. Loaded before the game boots so
// camera / audio / graphics choices survive reloads and affect the first frame.

const KEY = 'tankfield.settings.v1';

export const DEFAULTS = {
  name: 'Tanker',
  graphics: 'high',            // low | medium | high
  sensitivity: 1.0,
  invertY: false,
  shake: true,
  trackDust: true,
  holdToFire: false,           // false = click to fire, true = hold to auto-fire
  server: '',                  // game server override ('' = same origin as the page)
  volume: {
    master: 0.8,
    sfx: 1.0,
    music: 0.45
  },
  colorblind: false
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULTS,
      ...parsed,
      volume: { ...DEFAULTS.volume, ...(parsed.volume || {}) }
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // storage unavailable (private mode) — settings just won't persist.
  }
}