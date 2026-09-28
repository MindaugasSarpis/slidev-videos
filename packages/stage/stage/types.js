// The object types of the general stage and the fields each must carry.
// Plain data, no three.js: the validator (bin/check.mjs) reads it under node.
// builders.js registers these same types; test/types.test.mjs holds the two
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
};

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
