// slidev-addon-explain3d: the engine, for a deck that declares its own scene
// or draws a still picture of one at build time.
export { makeCamera, project, projectMany, turnBounds, viewBounds, viewport, toScreen, wrapAzim, nearAzim } from './engine/camera.js';
export { axisMap, boxFrame, fmt } from './engine/axes.js';
export { buildSurface, clipZ } from './engine/surface.js';
export { buildBars, columnFaces } from './engine/bars.js';
export { SPEC_VERSION, LAYER_TYPES, validateSpec, prepareScene, drawFrame } from './engine/scene.js';
export { toSVG, diffSVG } from './engine/svg.js';
export { createMotion } from './engine/motion.js';
export { openSync } from './engine/sync.js';
export { createPainter } from './engine/paint.js';
export { PALETTES, TOKENS, ramp, color } from './engine/palette.js';
export { EXPLAINERS, GOLDEN } from './explainers/index.js';
