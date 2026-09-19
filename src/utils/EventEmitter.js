// Minimal event emitter used for all core game events (fire, damage, death,
// impact, ...). Systems subscribe to these instead of calling each other
// directly, keeping rendering / physics / gameplay decoupled.

export class EventEmitter {
  constructor() {
    this._listeners = new Map();
  }

  on(event, handler) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(handler);
    return () => this.off(event, handler);
  }

  once(event, handler) {
    const wrapper = (...args) => {
      this.off(event, wrapper);
      handler(...args);
    };
    return this.on(event, wrapper);
  }

  off(event, handler) {
    const set = this._listeners.get(event);
    if (set) set.delete(handler);
  }

  emit(event, ...args) {
    const set = this._listeners.get(event);
    if (!set) return;
    // Copy so handlers can unsubscribe mid-dispatch safely.
    for (const handler of [...set]) handler(...args);
  }

  removeAll(event) {
    if (event === undefined) this._listeners.clear();
    else this._listeners.delete(event);
  }
}
