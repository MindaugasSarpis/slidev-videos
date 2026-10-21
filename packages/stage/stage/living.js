// The living still: what a slide's still does where the world cannot run (no
// WebGL2, no float targets, a lost context, a plugin or data failure).
// stage/stills.js gives the still; this gives it breath. The still drifts as
// a camera at rest would: over 48 s it eases out to 1.045 and 1.2 % of the
// frame off centre, then as slowly back, at rest again at 96 s; over it some
// hundreds of grains of the palette's dust drift and twinkle, drawn additive
// on a 2D canvas (components/StageLiving.vue). Nothing here is a shape, and
// no colour is the layer's own: it must read as the still breathing, not as
// an effect. Pure, so node can hold it to account (test/living.test.mjs).

import { resolvePalette, hexToRgb } from './palette.js';

export const LIVING_PERIOD = 48;      // s out, and as many back: at rest at 0 and at 96
export const LIVING_SCALE = 0.045;    // the still at full breath: 1.045
export const LIVING_PAN = 0.012;      // … and this much of the frame off centre, the way the seed leans
export const GRAIN_BIG = 0.85;        // px at the 980-wide canvas: a grain this large takes the dust's bright colour

const TAU = Math.PI * 2;
// smoothstep on 0..1: flat at both ends, so the turn at 48 s has no jolt
const smooth = (x) => x * x * (3 - 2 * x);

// Deterministic, so a slide drifts the same way on every machine and a test
// can hold it still (stage/hero/core.js has the same).
const mulberry32 = (a) => () => {
  a |= 0; a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// t seconds since the still came up, seed the slide's number → { scale, dx,
// dy }: the scale to draw the still at, and its offset as a fraction of the
// frame. A ping-pong: 0 → 1 over the period and back over the next, eased.
// The pan grows with the scale and never exceeds what the scale hides
// (|dx|, |dy| ≤ (scale − 1) / 2), so no edge of the frame is ever bare.
export function livingPose(t, seed = 0) {
  const s = Number(t);
  const u = Number.isFinite(s) && s > 0 ? 1 - Math.abs(((s / LIVING_PERIOD) % 2) - 1) : 0;
  const e = smooth(u);
  const a = mulberry32(seed)() * TAU;
  // + 0: at rest a negative cosine times zero would read -0
  return { scale: 1 + LIVING_SCALE * e, dx: LIVING_PAN * Math.cos(a) * e + 0, dy: LIVING_PAN * Math.sin(a) * e + 0 };
}

// n grains over the frame, seeded: x, y in 0..1 (fractions of the frame),
// size in px at the 980-wide canvas — most sub-pixel, one in ten a touch
// larger and in the bright colour, so the field reads at a distance, as the
// halo's grains do — phase on the circle, speed 0.4..1.2 (how fast it drifts
// and how fast its light swells).
export function livingGrains(n, seed = 0) {
  const count = Math.max(0, Math.floor(Number(n) || 0));
  const rand = mulberry32(seed);
  const out = [];
  for (let i = 0; i < count; i++) {
    const big = rand() < 0.1;
    out.push({
      x: rand(), y: rand(),
      size: big ? GRAIN_BIG + rand() * 0.5 : 0.28 + rand() * 0.42,
      phase: rand() * TAU,
      speed: 0.4 + rand() * 0.8,
    });
  }
  return out;
}

// The two colours the grains take, 0..255 each: the palette's dust at rest
// and at speed, as the engine's field mixes them (space.js uDustLo/uDustHi).
// A name, a palette or overrides over one, as resolvePalette reads them, so
// a malformed colour falls to the base's and nothing is the layer's own: a
// deck's warm accent never reaches it. Ember keeps its amber in the dust by
// design (never-gold is the rule for text), and the layer follows the
// palette there as the world does.
export function livingColours(palette) {
  const p = resolvePalette(palette);
  return [p.dust, p.dustBright].map((hex) => hexToRgb(hex).map((v) => Math.round(v * 255)));
}
