// How far grains swell and fade as they shine: one uniform for every grain
// material on the page (GRAIN_GLSL's, the forms', the constellations', the
// hero's, the depth grains'), so a slide that asks for calm (`space.steady`)
// gets it from every form at once. The engine sets it each frame from
// `options.twinkle` and the slide's steady; a deck's own material shares it by
// putting `uTwinkle: twinkleUniform` among its uniforms. From Užsikrauk
// karjerai's finale (Oct 2026): the point cloud's own `steady` held, and the
// grains of another form went on twinkling over it.
import { shared } from './shared.js';

export const twinkleUniform = shared('twinkle', () => ({ value: 1 }));

// the deck's twinkle (0 steady … 1), gone as steady (0..1) comes in
export const twinkleAt = (base, steady) =>
  Math.max(0, Number(base) || 0) * (1 - Math.min(1, Math.max(0, Number(steady) || 0)));
