// The living still (stage/living.js, components/StageLiving.vue): what a
// slide's still does where the world cannot run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { livingPose, livingGrains, livingColours, LIVING_PERIOD, LIVING_SCALE, LIVING_PAN, GRAIN_BIG } from '../stage/living.js';
import { PALETTES, hexToRgb } from '../stage/palette.js';
import { STAGE_KEYS } from '../stage/types.js';

const here = (p) => new URL(p, import.meta.url);
const close = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// ---- the drift -----------------------------------------------------------------------------
test('the still breathes out over 48 s and back, at rest again at 96 s', () => {
  assert.equal(LIVING_PERIOD, 48);
  assert.deepEqual(livingPose(0, 1), { scale: 1, dx: 0, dy: 0 });
  const out = livingPose(LIVING_PERIOD, 1);
  assert.ok(close(out.scale, 1 + LIVING_SCALE));
  assert.ok(close(Math.hypot(out.dx, out.dy), LIVING_PAN));            // full pan at the turn, in the seed's direction
  const back = livingPose(2 * LIVING_PERIOD, 1);
  assert.ok(close(back.scale, 1) && close(back.dx, 0) && close(back.dy, 0));
  const again = livingPose(2 * LIVING_PERIOD + 12, 1);                  // and the next breath is the first's
  assert.deepEqual(again, livingPose(12, 1));
  // the way out is monotone, the way back its mirror
  for (let t = 1; t <= LIVING_PERIOD; t++) {
    assert.ok(livingPose(t, 1).scale > livingPose(t - 1, 1).scale, `t ${t}`);
    assert.ok(close(livingPose(2 * LIVING_PERIOD - t, 1).scale, livingPose(t, 1).scale), `mirror ${t}`);
  }
  // nothing before the still came up, and nothing for a clock that is not a number
  assert.deepEqual(livingPose(-5, 1), livingPose(0, 1));
  assert.deepEqual(livingPose(NaN, 1), livingPose(0, 1));
});

test('the drift is continuous: no frame at 60 fps moves the still by more than a hair, the turn included', () => {
  for (const seed of [0, 1, 7]) {
    let maxStep = 0, prev = livingPose(0, seed);
    for (let f = 1; f <= 2 * LIVING_PERIOD * 60; f++) {
      const p = livingPose(f / 60, seed);
      maxStep = Math.max(maxStep, Math.abs(p.scale - prev.scale), Math.abs(p.dx - prev.dx), Math.abs(p.dy - prev.dy));
      prev = p;
    }
    assert.ok(maxStep < 1e-4, `seed ${seed}: step ${maxStep}`);   // 0.045 over 48 s, eased: ≤ 2.4e-5 a frame
    assert.ok(maxStep > 1e-6, `seed ${seed}: it moves`);
    // either side of the turn the still is all but still (smoothstep is flat there)
    const a = livingPose(LIVING_PERIOD - 1 / 60, seed), b = livingPose(LIVING_PERIOD + 1 / 60, seed);
    assert.ok(Math.abs(a.scale - b.scale) < 1e-7);
  }
});

test('the pan never bares an edge: it stays inside what the scale hides', () => {
  for (const seed of [0, 3, 11]) {
    for (let t = 0; t <= 2 * LIVING_PERIOD; t += 0.25) {
      const { scale, dx, dy } = livingPose(t, seed);
      const room = (scale - 1) / 2;
      assert.ok(Math.abs(dx) <= room + 1e-12 && Math.abs(dy) <= room + 1e-12, `seed ${seed} t ${t}`);
      assert.ok(Math.abs(dx) <= LIVING_PAN + 1e-12 && Math.abs(dy) <= LIVING_PAN + 1e-12);
    }
  }
});

test('a seed picks the direction, and the same seed the same drift', () => {
  assert.deepEqual(livingPose(30, 5), livingPose(30, 5));
  const a = livingPose(30, 1), b = livingPose(30, 2);
  assert.ok(close(a.scale, b.scale));                                   // the breath is every slide's
  assert.ok(Math.hypot(a.dx - b.dx, a.dy - b.dy) > 1e-4);               // the way it leans is the slide's own
  assert.deepEqual(livingPose(30), livingPose(30, 0));
});

// ---- the grains ------------------------------------------------------------------------------
test('the grains are seeded, inside the frame, a few of them bright', () => {
  const a = livingGrains(600, 3), b = livingGrains(600, 3), c = livingGrains(600, 4);
  assert.equal(a.length, 600);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  for (const g of a) {
    assert.deepEqual(Object.keys(g).sort(), ['phase', 'size', 'speed', 'x', 'y']);
    assert.ok(g.x >= 0 && g.x < 1 && g.y >= 0 && g.y < 1, `in the frame: ${g.x}, ${g.y}`);
    assert.ok(g.size > 0 && g.size < 2, `a point, not a shape: ${g.size}`);
    assert.ok(g.phase >= 0 && g.phase < Math.PI * 2);
    assert.ok(g.speed > 0 && g.speed < 2);
  }
  const bright = a.filter((g) => g.size >= GRAIN_BIG).length;
  assert.ok(bright / a.length > 0.05 && bright / a.length < 0.2, `bright share ${bright / a.length}`);
  // and they are spread, not bunched: every sixth of the frame has some
  for (let i = 0; i < 6; i++) assert.ok(a.filter((g) => Math.floor(g.x * 6) === i).length > 40, `column ${i}`);
  assert.deepEqual(livingGrains(0, 1), []);
  assert.deepEqual(livingGrains(-3, 1), []);
  assert.deepEqual(livingGrains(NaN, 1), []);
  assert.equal(livingGrains(2.7, 1).length, 2);
});

// ---- the colours -----------------------------------------------------------------------------
test('the grains take the palette\'s dust, at rest and at speed, and no colour of the layer\'s own', () => {
  const warm = ([r, g, b]) => r / 255 > b / 255 + 0.15 && g > b;   // amber, gold, orange: stage.test.mjs's never-gold rule
  const rgb255 = (hex) => hexToRgb(hex).map((v) => Math.round(v * 255));
  for (const name of ['classic', 'blue']) {
    const p = PALETTES[name];
    const [lo, hi] = livingColours(p);
    assert.deepEqual(lo, rgb255(p.dust), `${name} dust`);
    assert.deepEqual(hi, rgb255(p.dustBright), `${name} dustBright`);
    assert.ok(!warm(lo) && !warm(hi), name);
    for (const c of [lo, hi]) for (const v of c) assert.ok(Number.isInteger(v) && v >= 0 && v <= 255);
  }
  // by name, by object, and nothing at all: classic's
  assert.deepEqual(livingColours('blue'), livingColours(PALETTES.blue));
  assert.deepEqual(livingColours(undefined), livingColours(PALETTES.classic));
  assert.deepEqual(livingColours('no-such'), livingColours(PALETTES.classic));
  // a warm accent never reaches the layer: the dust does, the accent does not
  const [lo, hi] = livingColours({ base: 'classic', accent: '#ffb168' });
  assert.ok(!warm(lo) && !warm(hi));
  assert.deepEqual([lo, hi], livingColours(PALETTES.classic));
  // a malformed dust falls to the base's, never to a colour of the layer's own
  assert.deepEqual(livingColours({ dust: 'gold', dustBright: '#ffd700x' }), livingColours(PALETTES.classic));
  // ember keeps its amber in the dust by design (never-gold is the rule for text): the layer follows the palette there, as the world does
  assert.deepEqual(livingColours('ember'), [rgb255(PALETTES.ember.dust), rgb255(PALETTES.ember.dustBright)]);
  assert.ok(warm(livingColours('ember')[0]));
});

// ---- the component ---------------------------------------------------------------------------
test('StageLiving takes src, seed, covered and motion; draws additive at 30 fps, rests when hidden, covered or under reduced motion', () => {
  const src = readFileSync(here('../components/StageLiving.vue'), 'utf8');
  const propsBlock = /defineProps\(\{([\s\S]*?)\n\}\)/.exec(src)[1];
  const props = Object.fromEntries([...propsBlock.matchAll(/^\s+(\w+): \{ type: (\w+)(?:, default: ([^}]+?))? \},?$/gm)].map((m) => [m[1], { type: m[2], def: m[3]?.trim() }]));
  assert.deepEqual(props, {
    src: { type: 'String', def: "''" },
    seed: { type: 'Number', def: '0' },
    covered: { type: 'Boolean', def: 'false' },
    motion: { type: 'String', def: "'respect'" },
  });
  assert.match(src, /globalCompositeOperation = 'lighter'/);
  assert.match(src, /const GRAINS = 600\b/);
  assert.match(src, /const FPS = 30\b/);
  assert.match(src, /document\.hidden/);
  assert.match(src, /props\.covered/);
  assert.match(src, /prefers-reduced-motion: reduce/);
  assert.match(src, /props\.motion !== 'floor'/);                        // respect (and anything unknown) stops under reduced motion
  assert.match(src, /livingColours\(CFG\.palette\)/);                     // the palette's dust, nothing of its own
  assert.doesNotMatch(src, /#[0-9a-f]{3,8}\b/i);                          // no colour written into the layer
  assert.doesNotMatch(src, /fillRect|strokeRect|lineTo|rect\(/);          // points of light, no shapes
  assert.match(src, /cancelAnimationFrame\(raf\)/);
  // it reads no stage key the validator does not know (the rule of stage.test.mjs for every component)
  const read = [...src.matchAll(/\b(?:CFG|cfg)\.(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(read.filter((k) => !STAGE_KEYS.includes(k)), []);
});
