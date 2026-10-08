// node --test test/   — what can be held to account without a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { CORE_TYPES, PLUGIN_TYPES, anchorIds } from '../stage/types.js';
import { resolvePalette, PALETTES, DEFAULT_PALETTE, hexToRgb, rgbTriplet, paletteVars, definePalette } from '../stage/palette.js';
import { checkStage, readStageConfig, deckPoses } from '../bin/check.mjs';
import { parseSlides } from '../bin/shots.mjs';

const here = (p) => new URL(p, import.meta.url);
const exampleSpace = JSON.parse(readFileSync(here('../example/public/data/space.json'), 'utf8'));
const exampleRecords = JSON.parse(readFileSync(here('../example/public/data/records.json'), 'utf8'));
const exampleDeck = readFileSync(here('../example/slides.md'), 'utf8');

// ---- the type table and the builders say the same ---------------------------
test('every core type has a builder with the same fields', async () => {
  const b = await import('../stage/builders.js');
  assert.deepEqual([...b.builderTypes()].sort(), Object.keys(CORE_TYPES).sort());
  for (const [type, fields] of Object.entries(CORE_TYPES)) assert.deepEqual(b.builderFields(type), fields, type);
});

test('the hadron plugin installs the types the table lists', async () => {
  const plugin = await import('../stage/plugins/hadron.js');
  assert.deepEqual(plugin.types, PLUGIN_TYPES.hadron);
  const seen = new Map();
  let segmenter = null;
  plugin.install({ registerBuilder: (t, fn, o) => seen.set(t, [typeof fn, o.fields]), setLabelSegmenter: (f) => { segmenter = f; } });
  assert.deepEqual([...seen.keys()].sort(), Object.keys(PLUGIN_TYPES.hadron).sort());
  for (const [t, [kind, fields]] of seen) { assert.equal(kind, 'function', t); assert.deepEqual(fields, PLUGIN_TYPES.hadron[t]); }
  assert.deepEqual(segmenter('Λb⁰ → J/ψ p K⁻')[1], { t: 'b', sub: true });
});

test('usePlugin refuses what it does not know and installs once', async () => {
  const { usePlugin, hasBuilder, shippedPlugins } = await import('../index.js');
  assert.deepEqual(shippedPlugins(), Object.keys(PLUGIN_TYPES));
  const warn = console.warn; console.warn = () => {};
  try {
    assert.equal(await usePlugin('nope'), false);
    assert.equal(await usePlugin({ name: 'broken' }), false);
  } finally { console.warn = warn; }
  let installs = 0;
  const mine = { name: 'mine', install: ({ registerBuilder }) => { installs++; registerBuilder('beacon', () => ({ group: null })); } };
  assert.equal(await usePlugin(mine), true);
  assert.equal(await usePlugin(mine), true);
  assert.equal(installs, 1);
  assert.ok(hasBuilder('beacon'));
});

test('registerBuilder wants a function', async () => {
  const { registerBuilder } = await import('../index.js');
  assert.throws(() => registerBuilder('bad', 'not a function'), TypeError);
});

// Two copies of the package on one page (a deck's pre-bundled import beside
// the addon's own source in `slidev dev`) see one registry. A query string
// gives node a second instance of the same module.
test('two copies of the package share one registry', async () => {
  const a = await import('../stage/builders.js');
  const b = await import('../stage/builders.js?copy=2');
  assert.notEqual(a.registerBuilder, b.registerBuilder);
  b.registerBuilder('twin', () => ({ group: null }), { fields: ['pos', 'name'] });
  assert.ok(a.hasBuilder('twin'));
  assert.deepEqual(a.builderFields('twin'), ['pos', 'name']);
  const pa = await import('../stage/palette.js');
  const pb = await import('../stage/palette.js?copy=2');
  pb.definePalette('test-twin', { accent: '#123456' });
  assert.equal(pa.resolvePalette('test-twin').accent, '#123456');
  assert.equal(pa.PALETTES, pb.PALETTES);
  const ia = await import('../index.js');
  const ib = await import('../index.js?copy=2');
  let installs = 0;
  const plugin = { name: 'twin-plugin', install() { installs++; } };
  assert.equal(await ib.usePlugin(plugin), true);
  assert.equal(await ia.usePlugin(plugin), true);
  assert.equal(installs, 1);
  assert.ok(globalThis[Symbol.for('slidev-addon-stage/registry')] instanceof Map);
});

test('a station calls its builders\' dispose and names their forms', async () => {
  const { Group } = await import('three');
  const { registerBuilder, buildStation, helpers } = await import('../stage/builders.js');
  const calls = [];
  const api = { arm() {}, assemble() {}, value: () => 7 };
  registerBuilder('test-disposing', (o) => ({ group: new Group(), api, dispose: () => calls.push(o.name) }));
  registerBuilder('test-broken-dispose', () => ({ group: new Group(), dispose: () => { throw new Error('boom'); } }));
  const ctx = { palette: resolvePalette(), records: new Map(), asset: (s) => s, helpers };
  const st = buildStation({ id: 's', pos: [0, 0, 0], objects: [
    { type: 'test-disposing', pos: [0, 0, 0], name: 'one' },
    { type: 'test-broken-dispose', pos: [0, 0, 0] },
    { type: 'test-disposing', pos: [0, 0, 0], name: 'two' },
  ] }, ctx);
  assert.equal(st.named.get('one'), api);
  assert.equal(st.named.get('one').value(), 7);
  const warn = console.warn; const warned = []; console.warn = (...a) => warned.push(a.join(' '));
  try { st.dispose(); } finally { console.warn = warn; }
  assert.deepEqual(calls, ['one', 'two']);
  assert.ok(warned.some((w) => w.includes('test-broken-dispose')));
});

// ---- palettes ------------------------------------------------------------------
test('a palette resolves by name, by base and override, and falls back', () => {
  assert.deepEqual(resolvePalette(), DEFAULT_PALETTE);
  assert.deepEqual(resolvePalette('blue'), PALETTES.blue);
  assert.deepEqual(resolvePalette('no-such'), DEFAULT_PALETTE);
  const p = resolvePalette({ base: 'blue', accent: '#ff0000', dust: 'not a colour', bogus: '#123456' });
  assert.equal(p.accent, '#ff0000');
  assert.equal(p.dust, PALETTES.blue.dust);       // malformed: the base's stays
  assert.equal(p.bogus, undefined);               // unknown keys are dropped
  assert.equal(p.bg, PALETTES.blue.bg);
});

test('every shipped palette is complete and well-formed', () => {
  for (const [name, p] of Object.entries(PALETTES)) {
    assert.deepEqual(Object.keys(p).sort(), Object.keys(DEFAULT_PALETTE).sort(), name);
    for (const [k, v] of Object.entries(p)) assert.match(v, /^#[0-9a-f]{6}$/i, `${name}.${k}`);
  }
});

test('the blue palette is bluer than the classic', () => {
  const blueness = (hex) => { const [r, g, b] = hexToRgb(hex); return b - (r + g) / 2; };
  assert.ok(blueness(PALETTES.blue.dust) > blueness(PALETTES.classic.dust));
  assert.ok(blueness(PALETTES.blue.accent) > blueness(PALETTES.classic.accent));
});

test('colour helpers', () => {
  assert.deepEqual(hexToRgb('#fff'), [1, 1, 1]);
  assert.deepEqual(hexToRgb('#000000'), [0, 0, 0]);
  assert.equal(rgbTriplet('#7dd3fc'), '125, 211, 252');
  const vars = paletteVars(PALETTES.blue);
  assert.equal(vars['--stage-accent'], PALETTES.blue.accent);
  assert.equal(vars['--stage-accent-rgb'], rgbTriplet(PALETTES.blue.accent));
  const mine = definePalette('test-mine', { accent: '#112233' });
  assert.equal(mine.accent, '#112233');
  assert.equal(mine.bg, DEFAULT_PALETTE.bg);
  assert.deepEqual(resolvePalette('test-mine'), mine);
});

// ---- the validator -----------------------------------------------------------------
test('the example deck passes', () => {
  const r = checkStage({ space: exampleSpace, records: exampleRecords, deck: exampleDeck });
  assert.deepEqual(r.problems, []);
  assert.equal(r.stations, 4);
  assert.ok(r.poses >= 5 && r.stops === 2);
});

test('the forms of grains are core types', () => {
  assert.deepEqual(CORE_TYPES.galaxy, ['pos', 'radius']);
  assert.deepEqual(CORE_TYPES.collider, ['pos', 'radius']);
  const space = { stations: [{ id: 's', pos: [0, 0, 0], look: { dist: 9 }, objects: [{ type: 'galaxy', pos: [0, 0, 0] }, { type: 'collider', pos: [0, 0, 0], radius: 7 }] }] };
  assert.deepEqual(checkStage({ space }).problems, ['s/galaxy: missing radius']);
});

test('headmatter stage block is read', () => {
  assert.deepEqual(readStageConfig(exampleDeck), { space: 'data/space.json', records: 'data/records.json', palette: 'blue', sound: 'true' });
  const cfg = readStageConfig('---\ntitle: x\nstage:\n  space: "data/s.json"   # the world\n  plugins: [hadron, other]\n  humAt:\n    - hero\n    - close\nvideos:\n  repo: a/b\n---\n');
  assert.deepEqual(cfg, { space: 'data/s.json', plugins: ['hadron', 'other'], humAt: ['hero', 'close'] });
  assert.equal(readStageConfig('---\ntitle: x\n---\n'), null);
  assert.equal(readStageConfig('# no headmatter'), null);
});

test('poses and stops are found in both frontmatter forms', () => {
  const deck = '---\nspace:\n  at: wide\n---\n\n---\nspace: { at: [1, 2.5, -3], dist: 4 }\n---\n\n---\nspace: { at: decay, dim: 0.2 }   # comment\n---\n\n---\nspace:\n  at: marks\n  stops: [a, "b"]\n---\n';
  assert.deepEqual(deckPoses(deck), { at: ['wide', 'marks', '[1, 2.5, -3]', 'decay'], stops: ['a', 'b'] });
});

test('problems are named', () => {
  const space = {
    hero: 'nowhere',
    poses: { lost: { station: 'gone' } },
    stations: [
      { id: 'a', pos: [0, 0, 0], look: { dist: 5 }, objects: [
        { type: 'ring', pos: [0, 0, 0] },                        // radius missing
        { type: 'mystery', pos: [0, 0, 0] },
        { type: 'page', src: 'figures/x.png', pos: [0, 0], width: 1, height: 1 },
        { type: 'cluster', pos: [0, 0, 0], radius: 1, quarks: [] },   // a plugin type, plugin not loaded
      ] },
      { id: 'a', pos: [0, 0, 0] },
    ],
  };
  const deck = '---\nspace: { at: elsewhere }\n---\n\n---\nspace:\n  at: a\n  stops: [ghost]\n---\n';
  const { problems } = checkStage({ space, deck });
  const has = (s) => assert.ok(problems.some((p) => p.includes(s)), `expected a problem mentioning "${s}" in\n${problems.join('\n')}`);
  has('a/ring: missing radius');
  has('unknown object type mystery');
  has('unknown object type cluster');
  has('src must start with /');
  has('a/page: pos must be [x, y, z]');
  has('station id missing or duplicate: a');
  has('look.dist missing');
  has('space.hero is not a station: nowhere');
  has('pose lost: station gone does not exist');
  has('deck space.at does not resolve: elsewhere');
  has('deck stop is not an anchor in the space: ghost');
});

test('plugin and deck-own types are accepted when named', () => {
  const space = { stations: [{ id: 's', pos: [0, 0, 0], look: { dist: 5 }, objects: [
    { type: 'cluster', pos: [0, 0, 0], radius: 1, quarks: [], id: 'theta' },
    { type: 'beacon', pos: [0, 0, 0] },
  ] }] };
  assert.deepEqual(checkStage({ space, plugins: ['hadron'], extraTypes: ['beacon'], deck: '---\nspace: { at: theta }\n---\n' }).problems, []);
  assert.ok(checkStage({ space, plugins: ['nope'] }).problems.some((p) => p.includes('unknown plugin: nope')));
  // with records given, an object standing for a record must find it
  assert.ok(checkStage({ space, plugins: ['hadron'], extraTypes: ['beacon'], records: { states: [] } }).problems.some((p) => p.includes('no record with id theta')));
});

test('an empty space is a problem, not a crash', () => {
  assert.deepEqual(checkStage({ space: {} }).problems, ['space: no stations']);
  assert.deepEqual(checkStage({ space: null }).problems, ['space: no stations']);
});

test('anchors', () => {
  assert.deepEqual(anchorIds({ type: 'orbs', items: [{ id: 'a' }, { pos: [0, 0, 0] }, { id: 7 }] }), ['a', '7']);
  assert.deepEqual(anchorIds({ type: 'ring', id: 'r' }), ['r']);
  assert.deepEqual(anchorIds({ type: 'text', id: 'ignored' }), []);
});

// ---- shaders -------------------------------------------------------------------------------
// GLSL leaves smoothstep(a, b, x) undefined for a >= b; a falling edge is
// written 1.0 - smoothstep(b, a, x).
test('no shader calls smoothstep with its edges reversed', () => {
  const files = (dir) => readdirSync(here(dir), { recursive: true }).filter((f) => /\.(js|vue)$/.test(f)).map((f) => `${dir}${f}`);
  const bad = [];
  for (const f of [...files('../stage/'), ...files('../components/')]) {
    const src = readFileSync(here(f), 'utf8');
    for (const m of src.matchAll(/smoothstep\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,/g)) if (Number(m[1]) >= Number(m[2])) bad.push(`${f}: ${m[0]}`);
  }
  assert.deepEqual(bad, []);
});

// ---- the shots tool ---------------------------------------------------------------------
test('slide ranges', () => {
  assert.deepEqual(parseSlides('1-3,7', 10), [1, 2, 3, 7]);
  assert.deepEqual(parseSlides('9-12', 10), [9, 10]);
  assert.deepEqual(parseSlides('3-1, 3', 10), [1, 2, 3]);
  assert.deepEqual(parseSlides(null, 3), [1, 2, 3]);
  assert.deepEqual(parseSlides('x, 2', 5), [2]);
});
