// How a scene moves: it turns by itself, a drag turns and tilts it, a button
// glides it to a named view or morphs it to another state. No DOM here: the
// component feeds it pointer deltas and the time, and draws what it holds.
import { clamp, ease, nearAzim, wrapAzim } from './camera.js';

export const GLIDE_MS = 700;
export const MORPH_MS = 1300;
export const HOME = '@home';       // the view id of the opening view, after a reset

export function createMotion(scene, { reduceMotion = false, azim, elev, turn } = {}) {
  const home = { azim: azim ?? scene.view.azim, elev: elev ?? scene.view.elev };
  const [elLo, elHi] = scene.view.elevRange;
  const period = turn ?? scene.view.turn;
  const first = scene.states[0] ?? null;
  const m = {
    azim: home.azim,
    elev: home.elev,
    spinning: !reduceMotion && period > 0,   // turns by itself until the first drag or button
    view: null,                              // the id of the named view it shows or glides to (HOME: the opening view)
    state: { a: first, b: first, u: 0 },
    touched: false,                          // the room has moved it: a late window asks for this
    glide: null,
    last: 0,

    canTurn: period > 0,
    /** A drag by (dx, dy), as fractions of the picture's width and height. */
    drag(dx, dy) {
      m.glide = null;
      m.view = null;
      m.spinning = false;
      m.touched = true;
      m.azim = wrapAzim(m.azim - dx * 300);
      m.elev = clamp(m.elev + dy * 110, elLo, elHi);
    },
    /** Glide to a named view; null: back to the opening view. */
    toView(id, now) {
      const w = id == null ? home : scene.views.find((v) => v.id === id);
      if (!w) return;
      m.touched = true;
      m.view = id ?? HOME;
      m.spinning = false;
      const to = { azim: nearAzim(m.azim, w.azim), elev: w.elev };
      if (reduceMotion) { m.azim = wrapAzim(to.azim); m.elev = to.elev; m.glide = null; } else m.glide = { a0: m.azim, e0: m.elev, a1: to.azim, e1: to.elev, t0: now, T: GLIDE_MS };
    },
    /** Morph to another state. */
    toState(id, now) {
      if (!scene.states.includes(id)) return;
      if (id === m.state.b) return;
      m.touched = true;
      if (reduceMotion) m.state = { a: id, b: id, u: 0 };
      else m.state = { a: m.state.u >= 0.5 ? m.state.b : m.state.a, b: id, u: 0, t0: now };
    },
    toggleSpin() {
      if (!m.canTurn) return;
      m.spinning = !m.spinning;
      m.touched = true;
      if (m.spinning) { m.view = null; m.glide = null; }
    },
    /** Advance to `now` (ms). allowed: the slide is shown, so it may turn. Returns whether it moved. */
    step(now, allowed = true) {
      const dt = m.last ? Math.min(0.1, (now - m.last) / 1000) : 0;
      m.last = now;
      let moving = false;
      if (m.glide) {
        const g = m.glide;
        const u = Math.min(1, (now - g.t0) / g.T);
        const e = ease(u);
        m.azim = g.a0 + (g.a1 - g.a0) * e;
        m.elev = g.e0 + (g.e1 - g.e0) * e;
        if (u >= 1) { m.glide = null; m.azim = wrapAzim(m.azim); }
        moving = true;
      } else if (m.spinning && allowed) {
        m.azim = wrapAzim(m.azim + (360 / period) * dt);
        moving = true;
      }
      if (m.state.t0 != null) {
        const u = Math.min(1, (now - m.state.t0) / MORPH_MS);
        if (u >= 1) m.state = { a: m.state.b, b: m.state.b, u: 0 };
        else m.state.u = u;
        moving = true;
      }
      if (!moving) m.last = 0;
      return moving;
    },
    /** What another window needs to show the same. */
    snapshot() {
      return { az: Math.round(m.azim * 100) / 100, el: Math.round(m.elev * 100) / 100, spin: m.spinning, view: m.view, state: m.state.b };
    },
    apply(s, now) {
      m.touched = true;
      if (s.state !== m.state.b) m.toState(s.state, now);
      if (s.view !== m.view && s.view != null) m.toView(s.view === HOME ? null : s.view, now);
      else if (s.view == null) { m.view = null; m.glide = null; m.azim = s.az; m.elev = s.el; }
      m.spinning = s.spin;
    },
  };
  return m;
}
