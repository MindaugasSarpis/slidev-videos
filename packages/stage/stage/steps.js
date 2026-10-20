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
export const stepWaiting = (name) => [...pending].some((p) => p.name === name);

// A builder's view of one name: { step, prev, fresh, off }. `fresh` turns true on
// each change (and at once when the name already has a step); the builder clears
// it once it has applied the step on a frame.
export function stepper(name, initial = 0) {
  const s = { step: state.get(name) ?? initial, prev: initial, fresh: state.has(name), off: () => {} };
  s.off = onStep(name, (k) => { s.prev = s.step; s.step = k; s.fresh = true; });
  return s;
}

// tests only
export function _resetSteps() { state.clear(); pending.clear(); clock.t = 0; }
