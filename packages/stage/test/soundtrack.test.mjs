// The deck's music (stage/soundtrack.js, components/StageSoundtrack.vue): one player
// per page, its clock read off the AudioContext, its fades and accents scheduled
// there rather than stepped on animation frames. From Užsikrauk karjerai's finale
// (Oct 2026): an accent timed off the world's clock missed the music whenever a
// frame ran long. Web Audio is faked here: a context whose time the test moves, gain
// params that record what was scheduled, audio elements with a settable time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMusic, equalPower, anchorOf, needsReanchor } from '../stage/soundtrack.js';
import { SPACE_KEYS } from '../stage/types.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

function param(v = 1) {
  const p = { value: v, calls: [] };
  p.setValueAtTime = (x, t) => { p.calls.push(['set', x, t]); p.value = x; };
  p.cancelScheduledValues = (t) => { p.calls.push(['cancel', t]); };
  p.setValueCurveAtTime = (c, t, d) => { p.calls.push(['curve', [...c], t, d]); p.value = c[c.length - 1]; };
  return p;
}
function fakeContext(t = 100) {
  return {
    currentTime: t, state: 'running', destination: {},
    createGain() { return { gain: param(1), connect() {} }; },
    createMediaElementSource() { return { connect() {} }; },
  };
}
// an element whose `playing` comes when the test says (fire), as a real one's comes once its first sample sounds
function fakeAudio() {
  const e = { currentTime: 0, paused: true, ended: false, volume: 1, src: '', plays: 0, on: {} };
  e.play = () => { e.paused = false; e.plays++; return Promise.resolve(); };
  e.pause = () => { e.paused = true; };
  e.load = () => {};
  e.addEventListener = (k, f) => { (e.on[k] ||= []).push(f); };
  e.fire = (k) => { for (const f of e.on[k] || []) f(); };
  return e;
}
function rig({ ctx = fakeContext(), level = () => 1 } = {}) {
  const made = [];
  const m = createMusic({ context: () => ctx, out: () => null, audio: (url) => { const e = fakeAudio(); e.src = url; made.push(e); return e; }, level });
  return { m, ctx, made };
}
// begun and sounding
const playing = (m, src, lvl) => { const t = m.begin(src, lvl); t.e.fire('playing'); return t; };

test('equalPower keeps the loudness of a cross-fade', () => {
  const up = equalPower(0, 1, 33), down = equalPower(1, 0, 33);
  assert.equal(up[0], 0); assert.equal(up[32], 1); assert.equal(down[32], 0);
  assert.ok(Math.abs(up[16] ** 2 + down[16] ** 2 - 1) < 1e-6);
});

test('the anchor and when to take it again', () => {
  assert.equal(anchorOf(100, 12), 88);
  assert.ok(!needsReanchor(12.2, 12)); assert.ok(needsReanchor(12.5, 12)); assert.ok(needsReanchor(11.6, 12));
});

test('no clock without a playing track', () => {
  const { m } = rig();
  assert.equal(m.musicClock(), null);
  const t = m.track('audio/a.m4a');
  assert.equal(m.musicClock(), null);                 // loaded, not begun
  m.begin('audio/a.m4a', 0.5);
  assert.notEqual(m.musicClock(), null);
  t.e.pause(); assert.equal(m.musicClock(), null);    // paused
  t.e.paused = false; t.e.ended = true; assert.equal(m.musicClock(), null);   // ended
});

test('musicClock runs on the context’s time between element updates', () => {
  const { m, ctx } = rig();
  const t = playing(m, 'audio/a.m4a', 0.5);
  t.e.currentTime = 12;
  assert.equal(m.musicClock(), 12);
  ctx.currentTime = 100.2;                              // the element has not moved yet
  assert.ok(Math.abs(m.musicClock() - 12.2) < 1e-9);
  t.e.currentTime = 30; ctx.currentTime = 100.6;        // a seek: taken again from the element
  assert.equal(m.musicClock(), 30);
});

test('musicClock(src) names a playing track by its path', () => {
  const { m } = rig();
  playing(m, 'audio/starfire_finale.m4a', 0.5).e.currentTime = 4;
  assert.equal(m.musicClock('starfire_finale'), 4);
  assert.equal(m.musicClock('aphelion'), null);
});

test('a suspended context: the element’s own time', () => {
  const ctx = fakeContext(); ctx.state = 'suspended';
  const { m } = rig({ ctx });
  m.begin('audio/a.m4a', 0.5).e.currentTime = 7;
  assert.equal(m.musicClock(), 7);
});

test('a fade is one curve on the context’s clock, not frames', () => {
  const { m, ctx } = rig();
  const t = m.begin('audio/a.m4a', 0.5);
  const curve = t.gain.gain.calls.find((c) => c[0] === 'curve');
  assert.ok(curve, 'a curve was scheduled');
  assert.equal(curve[2], ctx.currentTime); assert.equal(curve[3], 2);   // begin fades in over 2 s
  assert.ok(Math.abs(curve[1][curve[1].length - 1] - 0.5) < 1e-9);
});

test('an accent is a gain change at the context time of its music second', () => {
  const { m } = rig();
  const t = playing(m, 'audio/a.m4a', 0.4);
  t.e.currentTime = 12;                                 // ctx 100 → anchor 88
  m.accent('audio/a.m4a', 16.02, { level: 1 });
  const set = t.gain.gain.calls.filter((c) => c[0] === 'set').pop();
  assert.deepEqual(set, ['set', 1, 104.02]);
});

test('an accent waits for its track to play', () => {
  const { m } = rig();
  const t = m.track('audio/peak.m4a');
  const cancel = m.accent('audio/peak.m4a', 3, { level: 1 });
  assert.equal(t.gain.gain.calls.filter((c) => c[0] === 'set' && c[2] > 100).length, 0);
  cancel();
});

test('a cross-fade takes the old track down and pauses it after', async () => {
  const { m } = rig();
  const a = m.begin('audio/a.m4a', 0.5);
  const b = m.crossfade('audio/b.m4a', 0.6, 10);
  assert.equal(m.current, b); assert.equal(b.e.currentTime, 0); assert.ok(!b.e.paused);
  const down = a.gain.gain.calls.filter((c) => c[0] === 'curve').pop();
  assert.equal(down[1][down[1].length - 1], 0);
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(a.e.paused);
});

test('StageSoundtrack plays only in the audience window, enters by whenEntered', () => {
  const src = read('../components/StageSoundtrack.vue');
  assert.match(src, /\$renderContext\?\.value === 'slide'/);
  assert.match(src, /whenEntered\(useIsSlideActive\(\)/);
  assert.doesNotMatch(src, /requestAnimationFrame\(step\)/);   // no rAF fades
  assert.match(src, /music\.accent\(/);
});

test('clock: music is a slide key the stage wires to the engine', () => {
  assert.ok(SPACE_KEYS.includes('clock'));
  assert.match(read('../components/Stage.vue'), /setClockSource\(/);
  assert.match(read('../stage/space.js'), /stepReal\(/);
});

// ---- the review's findings (v0.11 fix pass) ---------------------------------------------------
const curves = (t) => t.gain.gain.calls.filter((c) => c[0] === 'curve');

test('review #5a: a fade cut short starts from where the level is, not from the last target', () => {
  const { m } = rig();
  const t = playing(m, 'audio/a.m4a', 0.9);
  t.gain.gain.value = 0.3;                              // half-way up the 2 s fade-in
  m.fadeTo(0.5, 100);
  assert.ok(Math.abs(curves(t).pop()[1][0] - 0.3) < 1e-6);
});

test('review #5b: an accent sets the level when it lands; a fade before it starts quiet and drops it', async () => {
  const { m, ctx } = rig();
  const t = playing(m, 'audio/a.m4a', 0.4);
  t.e.currentTime = 12;
  m.accent('audio/a.m4a', 16.02, { level: 1 });
  assert.equal(t.level, 0.4);                           // not yet: the peak is 4 s away
  t.gain.gain.value = 0.4;
  m.fadeTo(0, 100);
  assert.ok(Math.abs(curves(t).pop()[1][0] - 0.4) < 1e-6);
  assert.equal(t.accent, null);
  ctx.currentTime = 104.1; await new Promise((r) => setTimeout(r, 10));
  assert.notEqual(t.level, 1);
});

test('review #5c: + / - mid-fade keeps fading, to the new level, over what is left; an accent ahead survives', () => {
  const L = { v: 1 };
  const { m, ctx } = rig({ level: () => L.v });
  const t = playing(m, 'audio/a.m4a', 0.5);             // a 2 s fade-in from ctx 100
  t.e.currentTime = 1;
  m.accent('audio/a.m4a', 30, { level: 0.8 });          // ctx 129
  ctx.currentTime = 101; t.gain.gain.value = 0.35; L.v = 1.5;
  m.relevel();
  const c = curves(t).pop();
  assert.ok(Math.abs(c[1][0] - 0.35) < 1e-6); assert.ok(Math.abs(c[1][c[1].length - 1] - 0.75) < 1e-6);
  assert.ok(Math.abs(c[3] - 1) < 1e-6);                 // the second left of the fade
  const later = t.gain.gain.calls.filter((x) => x[0] === 'set' && x[2] > 120).pop();
  assert.deepEqual(later, ['set', 0.8 * 1.5, 129]);
});

test('review #6: an accent waits for the track to sound, and follows a seek', () => {
  const { m, ctx } = rig();
  const t = m.begin('audio/peak.m4a', 0.4);             // play() called, no sample yet
  const cancel = m.accent('audio/peak.m4a', 16.02, { level: 1 });
  assert.equal(t.gain.gain.calls.filter((c) => c[0] === 'set' && c[2] > 100).length, 0);
  ctx.currentTime = 100.2; t.e.currentTime = 0.05; t.e.fire('playing');
  assert.deepEqual(t.gain.gain.calls.filter((c) => c[0] === 'set').pop(), ['set', 1, 100.15 + 16.02]);
  ctx.currentTime = 101; t.e.currentTime = 5; t.e.fire('seeked');
  assert.deepEqual(t.gain.gain.calls.filter((c) => c[0] === 'set').pop(), ['set', 1, 96 + 16.02]);
  cancel();
  assert.equal(t.accent, null);
});

test('review #16: a drop counts on the slide’s clip when it has one, else on the music (the talks’ default kept)', () => {
  assert.match(read('../components/StageSoundtrack.vue'), /const mode = d\.clock \|\| \(clipOf\(\) \? 'clip' : 'music'\)/);
});
