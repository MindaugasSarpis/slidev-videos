// The step bus: a named form in the world goes to a step (0 hidden, 1, 2, …)
// when its slide asks. <StageSteps :set="{ det: 1 }" /> in a slide sets it on
// slide enter and per click; a builder reads it with onStep(name, fn) and
// stepOf(name). One bus per page, whichever copy of the package sets it.
// From MasterTalk's and Užsikrauk karjerai's setup/grains.js (Oct 2026).
import { shared } from './shared.js';

const BUS = 'slidev-stage:steps';
const state = shared('steps', () => new Map());
const pending = shared('steps-later', () => new Set());
const clock = shared('steps-clock', () => ({ t: 0 }));

export function setStep(name, step) {
  if (state.get(name) === step) return;
  state.set(name, step);
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(BUS, { detail: { name, step } }));
}
// several at once: setSteps({ det: 1, ltFlag: 0 })
export function setSteps(steps) { for (const [name, step] of Object.entries(steps || {})) setStep(name, step); }
export const stepOf = (name) => state.get(name);
// every name's step now, as a plain object (the probes' __stage.state().steps)
export const allSteps = () => Object.fromEntries(state);
export const hasStep = (name) => state.has(name);

// fn(step) each time `name` changes; returns an unsubscribe
export function onStep(name, fn) {
  if (typeof window === 'undefined') return () => {};
  const h = (e) => { if (e.detail?.name === name) fn(e.detail.step); };
  window.addEventListener(BUS, h);
  return () => window.removeEventListener(BUS, h);
}

// a step `s` seconds of world time from now (the world's clock: tickSteps(t) each frame)
export function setStepLater(name, step, s) {
  const p = { name, step, at: clock.t + s };
  pending.add(p);
  return () => pending.delete(p);
}
export function tickSteps(t) {
  clock.t = t;
  for (const p of pending) if (t >= p.at) { pending.delete(p); setStep(p.name, p.step); }
}
// the world's clock as tickSteps last saw it (0 before the world has run)
export const worldTime = () => clock.t;
export const stepWaiting = (name) => [...pending].some((p) => p.name === name);

// A builder's view of one name: { step, prev, fresh, off }. `fresh` turns true on
// each change (and at once when the name already has a step); the builder clears
// it once it has applied the step on a frame.
export function stepper(name, initial = 0) {
  const s = { step: state.get(name) ?? initial, prev: initial, fresh: state.has(name), off: () => {} };
  s.off = onStep(name, (k) => { s.prev = s.step; s.step = k; s.fresh = true; });
  return s;
}

// A slide's state that must hold however the slide is reached (opened directly, a jump, a
// back-step): its frontmatter `steps: { det: 1 }`, holding from that slide on. decls: each
// slide's `steps` in order (null where it says nothing); no: the slide's 1-based number.
// → { name: step } for every name any slide steps: from the last slide up to `no` that names
// it, 0 before its first. Worked out from the slide list, as `places:` is (place-groups.js),
// so a slide entered cold is set up as one reached in order. (MasterTalk's crossing slide was
// black opened directly: its collision ran only from the slide before it.)
export function stepsAt(decls, no) {
  const out = {};
  (decls || []).forEach((d, i) => {
    if (!d || typeof d !== 'object' || Array.isArray(d)) return;
    for (const [k, v] of Object.entries(d)) {
      if (!Number.isFinite(Number(v)) || v === null || v === '' || typeof v === 'boolean') continue;
      if (!(k in out)) out[k] = 0;
      if (i < no) out[k] = Number(v);
    }
  });
  return out;
}

// tests only
export function _resetSteps() { state.clear(); pending.clear(); clock.t = 0; }
