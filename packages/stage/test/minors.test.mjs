// v0.11's deferred review findings (Minor), each pinned (v0.11.1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { plateStart, HOLD } from '../stage/recorded.js';
import { createMusic } from '../stage/soundtrack.js';
import { dustGrains, litGrains } from '../stage/budget.js';
import { checkStage } from '../bin/check.mjs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

test('#9: the slow hand-over rebuilds once the plate stands, or once it is known missing, or after 3 s', () => {
  const src = read('../components/Stage.vue');
  assert.match(src, /function slowRebuild\(\)/);
  assert.match(src, /watch\(\[plateState, plateMissing\], \(\) => \{ if \(slowWaiting/);
  assert.match(src, /restoreTimer = setTimeout\(slowRebuild, 3000\)/);
});

test('#10: a recorded slide replays only on a forward step from the slide before; else it holds', () => {
  assert.equal(plateStart(4, 5), 0);
  assert.equal(plateStart(6, 5), HOLD);     // a back-step
  assert.equal(plateStart(2, 5), HOLD);     // a jump
  assert.equal(plateStart(null, 5), HOLD);  // opened there
  assert.equal(plateStart(null, 1), 0);     // the deck's opening is an arrival
  assert.match(read('../components/Stage.vue'), /plateFrom\.value = recordedNow\(\)\?\.kind === 'plate' \? plateStart\(was, n\) : null/);
});

function fakeAudio() {
  const e = { currentTime: 0, paused: true, ended: false, volume: 1, on: {} };
  e.play = () => { e.paused = false; return Promise.resolve(); };
  e.pause = () => { e.paused = true; }; e.load = () => {};
  e.addEventListener = (k, f) => { (e.on[k] ||= []).push(f); };
  e.fire = (k) => { for (const f of e.on[k] || []) f(); };
  return e;
}

test('#11: without Web Audio an accent’s level change is cancelled with it', async () => {
  const m = createMusic({ context: () => null, audio: () => fakeAudio(), level: () => 1 });
  const t = m.begin('a.m4a', 0.4, { fade: 0 }); t.e.fire('playing'); t.e.currentTime = 5;
  const cancel = m.accent('a.m4a', 5.05, { level: 1, call: () => {} });
  cancel();
  await pause(120);
  assert.equal(t.level, 0.4);
});

test('#12: where the engine has cancelAndHoldAtTime, a fade holds the level in force instead of dropping an active curve', () => {
  const calls = [];
  const gain = { value: 0.5, setValueAtTime: (v, at) => calls.push(['set', v, at]), cancelScheduledValues: () => calls.push(['cancel']),
    cancelAndHoldAtTime: (at) => calls.push(['hold', at]), setValueCurveAtTime: (c, at, d) => calls.push(['curve', at, d]) };
  const ctx = { currentTime: 10, state: 'running', destination: {}, createGain: () => ({ gain, connect() {} }), createMediaElementSource: () => ({ connect() {} }) };
  const m = createMusic({ context: () => ctx, audio: () => fakeAudio(), level: () => 1 });
  const t = m.track('a.m4a'); m.fade(t, 0.2, 500);
  assert.deepEqual(calls.filter((c) => c[0] === 'hold' || c[0] === 'cancel').map((c) => c[0]), ['hold']);
});

test('#13: under an external clock the dust simulation still steps at most MAX_DT (world time runs on)', () => {
  const src = read('../stage/space.js');
  assert.match(src, /const simDt = Math\.min\(rd, Math\.max\(MAX_DT, globalThis\.__stageMaxDt \|\| 0\)\) \* worldRate;/);
  assert.match(src, /velMat\.uniforms\.uDt\.value = simDt; velMat\.uniforms\.uTime\.value = elapsed; posMat\.uniforms\.uDt\.value = simDt;/);
});

test('#14: the budget counts the density’s dust and says what it could not count', () => {
  assert.equal(dustGrains(0), 352 * 352);
  assert.equal(dustGrains(0, 1.5), 432 * 432);
  assert.equal(dustGrains(0, 0.6), 272 * 272);
  assert.equal(dustGrains(1, 1.5), 256 * 256);              // the tier's cap
  assert.deepEqual(litGrains({ objects: [{ type: 'mine' }, { type: 'mine2', grains: 5 }], tier: 0 }).uncounted, ['mine']);
  const deck = `---\nstage:\n  options: { density: 1.5 }\n---\n\n<StageSteps :set="{ det: 1 }" />\n`;
  const space = { stations: [{ id: 'h', pos: [0, 0, 0], look: { dist: 9 }, objects: [
    { type: 'detector', name: 'det', pos: [0, 0, 0], src: 'lhcb-dense' }, { type: 'emblem', name: 'e1', pos: [0, 0, 0], grains: 260000 }, { type: 'mine', pos: [0, 0, 0] }] }] };
  const r = checkStage({ space, deck, deckOwn: { mine: ['pos'] } });
  const w = r.issues.find((i) => i.code === 'grain-budget');
  assert.ok(w, JSON.stringify(r.issues)); assert.match(w.msg, /dust 187k/); assert.match(w.msg, /not counted: mine/);
  assert.deepEqual(r.uncounted, ['mine']);
});

test('#15: the watchdog starts its grace again when the world resumes', () => {
  assert.match(read('../stage/space.js'), /else \{ getDelta\(\); srcPrev = null; dog\.reset\(performance\.now\(\) \/ 1000\); frame\(\); \}/);
});
