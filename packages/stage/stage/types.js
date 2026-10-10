// The object types of the general stage and the fields each must carry.
// Plain data, no three.js: the validator (bin/check.mjs) reads it under node.
// builders.js registers these same types; test/stage.test.mjs holds the two
// in step.
export const CORE_TYPES = {
  page: ['src', 'pos', 'width', 'height'],
  text: ['text', 'pos', 'height'],
  label: ['text', 'pos'],
  ring: ['pos', 'radius'],
  tracks: ['pos', 'tracks'],
  orbs: ['pos', 'items'],
  grid: ['pos', 'from', 'to', 'step'],
  bar: ['pos', 'length', 'label'],
  constellation: ['pos', 'radius', 'nodes'],
  galaxy: ['pos', 'radius'],
  collider: ['pos', 'radius'],
};

// Forms a camera may stand inside (a ring it flies through): slidev-stage-check
// does not warn camera-inside-form for them. A deck's own builder says so with
// registerBuilder(type, fn, { enterable: true }) (a floor, enveloping strands),
// an object in space.json with "enterable": true. A galaxy is not one: from
// inside, every grain of it is drawn across the screen.
export const ENTERABLE = ['ring'];

// Shipped plugins' types (stage/plugins/*.js export the same table as `types`).
export const PLUGIN_TYPES = {
  hadron: {
    pentaquark: ['pos', 'radius', 'quarks'],
    cluster: ['pos', 'radius', 'quarks'],
    molecule: ['pos', 'separation', 'a', 'b'],
    spheres: ['pos', 'ids', 'origin', 'scale', 'rows'],
    planes: ['pos', 'planes', 'origin', 'scale', 'height', 'depth'],
  },
};

// The ids an object offers as anchors: places a pose (`at:`) or a stop can name.
export function anchorIds(o) {
  const ids = [];
  if (o.id != null && ['ring', 'cluster'].includes(o.type)) ids.push(String(o.id));
  if (o.type === 'orbs') for (const it of o.items || []) if (it && it.id != null) ids.push(String(it.id));
  if (o.type === 'spheres') for (const id of o.ids || []) ids.push(String(id));
  return ids;
}

// The keys of a headmatter `stage:` block (what Stage.vue, StageHalo,
// StageCount and the global layers read), of `stage.options` (the engine's
// DEFAULTS in space.js, plus `poses` and `hero`), and of a slide's `space:`.
// The tests hold each list to the code that reads it.
export const STAGE_KEYS = ['space', 'records', 'palette', 'look', 'plugins', 'hero', 'sound', 'humAt', 'videos', 'options', 'auto', 'halo', 'haloOn', 'dim', 'layoutDim', 'hud', 'tint', 'lang', 'stills', 'tier'];
export const OPTION_KEYS = ['fov', 'pose', 'gather', 'pulseKick', 'stopOffset', 'maxBufferWidth', 'bloom', 'vignette', 'grain', 'aberration', 'exposure', 'dustSize', 'dustGain', 'density', 'nebula', 'streak', 'reach', 'flight', 'twinkle', 'guard', 'poses', 'hero', 'lift'];
export const SPACE_KEYS = ['at', 'dist', 'yaw', 'pitch', 'sway', 'stops', 'dim', 'asof', 'flight', 'rate', 'rateEase', 'cameraRate', 'path', 'hum'];
