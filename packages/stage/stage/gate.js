// The stage gate: heavy work a deck holds back until it says go (a fetch and a long
// build kept out of the first slide's fly-in, where a long task shows as a stall).
// setStageGate((start) => unsubscribe): `start` once the deck is ready for the work.
// The lhcb plugin's forms and <StageDepthGrains> wait on it; with none set, at once.
import { shared } from './shared.js';

const gate = shared('gate', () => ({ fn: null }));
export function setStageGate(fn) { gate.fn = typeof fn === 'function' ? fn : null; }
// run fn when the gate opens (now, with none); returns an unsubscribe
export function whenGateOpen(fn, own = null) {
  const g = own || gate.fn;
  if (!g) { fn(); return () => {}; }
  return g(fn) || (() => {});
}
