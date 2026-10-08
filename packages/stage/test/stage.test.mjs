// node --test test/   — what can be held to account without a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CORE_TYPES, PLUGIN_TYPES, STAGE_KEYS, OPTION_KEYS, SPACE_KEYS, anchorIds } from '../stage/types.js';
import { resolvePalette, PALETTES, DEFAULT_PALETTE, LOOKS, hexToRgb, rgbTriplet, paletteVars, definePalette } from '../stage/palette.js';
import { checkStage, readStageConfig, deckPoses, deckSlides, deckTypes, deckComponents, readYaml, main as checkMain } from '../bin/check.mjs';
import { formatCount, countRun, countAt, countSpan, COUNT_DOWN_MS } from '../stage/count.js';
import { deckHasThree } from '../vite.config.js';
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
const exampleOwn = deckTypes(readFileSync(here('../example/setup/main.ts'), 'utf8'));
test('the example deck passes', () => {
  assert.deepEqual(exampleOwn.types, { tally: ['pos', 'name'] });
  const r = checkStage({ space: exampleSpace, records: exampleRecords, deck: exampleDeck, deckOwn: exampleOwn.types });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.stations, 5);
  assert.equal(r.slides, 7);
  assert.ok(r.poses >= 6 && r.stops === 2);
  // without the deck's own types the tally is unknown
  assert.ok(checkStage({ space: exampleSpace, deck: exampleDeck }).issues.some((p) => p.code === 'unknown-type' && p.station === 'tally'));
});

test('the forms of grains are core types', () => {
  assert.deepEqual(CORE_TYPES.galaxy, ['pos', 'radius']);
  assert.deepEqual(CORE_TYPES.collider, ['pos', 'radius']);
  const space = { stations: [{ id: 's', pos: [0, 0, 0], look: { dist: 9 }, objects: [{ type: 'galaxy', pos: [0, 0, 0] }, { type: 'collider', pos: [0, 0, 0], radius: 7 }] }] };
  assert.deepEqual(checkStage({ space }).problems, ['s/galaxy: missing radius']);
});

test('headmatter stage block is read', () => {
  assert.deepEqual(readStageConfig(exampleDeck), { space: 'data/space.json', records: 'data/records.json', palette: 'blue', sound: true });
  const cfg = readStageConfig('---\ntitle: x\nstage:\n  space: "data/s.json"   # the world\n  plugins: [hadron, other]\n  humAt:\n    - hero\n    - close\nvideos:\n  repo: a/b\n---\n');
  assert.deepEqual(cfg, { space: 'data/s.json', plugins: ['hadron', 'other'], humAt: ['hero', 'close'] });
  assert.equal(readStageConfig('---\ntitle: x\n---\n'), null);
  assert.equal(readStageConfig('# no headmatter'), null);
});

test('poses and stops are found in both frontmatter forms', () => {
  const deck = '---\nspace:\n  at: wide\n---\n\n---\nspace: { at: [1, 2.5, -3], dist: 4 }\n---\n\n---\nspace: { at: decay, dim: 0.2 }   # comment\n---\n\n---\nspace:\n  at: marks\n  stops: [a, "b"]\n---\n';
  assert.deepEqual(deckPoses(deck), { at: ['wide', '[1, 2.5, -3]', 'decay', 'marks'], stops: ['a', 'b'] });
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
  has('slide 1: space.at does not resolve: elsewhere');
  has('slide 2: stop is not an anchor in the space: ghost');
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

// ---- slides, codes, the deck's own types -------------------------------------------
test('slides are counted as Slidev counts them', () => {
  const deck = [
    '---', 'title: x', 'space: { at: a }', '---', '', '# one', '',
    '---', 'hide: true', 'space: { at: hidden }', '---', '', '# not counted', '',
    '```md', '---', 'space: { at: fenced }', '---', '```', '',
    '<!--', '---', 'space: { at: commented }', '---', '-->', '',
    '---', '', '# two, no frontmatter', '',
    '---', 'space:', '  at: b   # a comment', '  stops: [c, "d"]', '---', '# three',
  ].join('\n');
  const slides = deckSlides(deck);
  assert.deepEqual(slides.map((s) => s.no), [1, 2, 3]);
  assert.deepEqual(slides.map((s) => s.fm.space?.at ?? null), ['a', null, 'b']);
  assert.deepEqual(slides[2].fm.space.stops, ['c', 'd']);
  assert.equal(slides[2].line, 31);
});

test('a little YAML', () => {
  assert.deepEqual(readYaml('a: 1\nb: [x, "y, z", 2.5]\nc: { d: [1, -2, 3e1], e: \'#f00\' }   # note\nf:\n  - g\n  - h: 1\n    i: true\nj: |\n  line one\n  line: two\nk: ~'), {
    a: 1, b: ['x', 'y, z', 2.5], c: { d: [1, -2, 30], e: '#f00' }, f: ['g', { h: 1, i: true }], j: 'line one\nline: two', k: null,
  });
  assert.equal(readYaml(''), null);
});

const typo = (patch) => {
  const space = { hero: 'h', poses: { far: { station: 'galaxy', dist: 30 } }, stations: [
    { id: 'h', pos: [0, 0, 0], look: { dist: 10 }, objects: [{ type: 'orbs', pos: [0, 0, 0], items: [{ id: 'mark', pos: [1, 0, 0] }] }] },
    { id: 'galaxy', pos: [40, 0, 0], look: { dist: 17, yaw: -20, pitch: 40 }, objects: [{ type: 'galaxy', pos: [0, 0, 0], radius: 6 }] },
  ] };
  const deck = ['---', 'stage:', '  palette: blue', '---', '', '---', 'space: { at: galaxy }', '---', '', '---', 'space: { at: mark, stops: [mark] }', '---', ''].join('\n');
  return checkStage({ space, ...patch({ deck }) });
};
test('a typo in a slide names the slide and a code', () => {
  const r = typo(({ deck }) => ({ deck: deck.replace('at: galaxy', 'at: galaxyy').replace('stops: [mark]', 'stops: [mrak]') }));
  const codes = r.issues.map((p) => [p.slide, p.code]);
  assert.deepEqual(codes, [[2, 'unknown-station'], [3, 'missing-anchor']]);
  assert.match(r.problems[0], /^slide 2: space\.at does not resolve: galaxyy .*did you mean galaxy\?/);
  assert.match(r.problems[1], /did you mean mark\?/);
  assert.equal(typo(({ deck }) => ({ deck: deck.replace('at: galaxy', 'at: farr') })).issues[0].code, 'unknown-pose');
  assert.deepEqual(typo((d) => d).issues, []);
});

test('palettes and options are held to the engine\'s lists', () => {
  const head = (stage) => `---\nstage:\n${stage}\n---\n`;
  const run = (stage, palettes = []) => typo(() => ({ deck: head(stage), palettes })).issues.map((p) => p.code);
  assert.deepEqual(run('  palette: bleu'), ['unknown-palette']);
  assert.deepEqual(run('  palette: venue', ['venue']), []);
  assert.deepEqual(run("  palette: { base: blue, accent: '#ff0', glow: '#fff', dust: red }"), ['unknown-palette', 'bad-colour']);
  assert.deepEqual(run('  options: { blom: 0.4, reach: 20 }'), ['unknown-option']);
  assert.deepEqual(run('  options:\n    bloom: 0.4\n    nebula: 0'), []);
  assert.deepEqual(run('  pallete: blue'), ['unknown-key']);   // a warning
  assert.equal(typo(() => ({ deck: head('  pallete: blue') })).problems.length, 0);
  assert.deepEqual(run('  plugins: [nope]'), ['unknown-plugin']);
});

test('a camera inside a form is a warning, not a failure', () => {
  const r = typo(({ deck }) => ({ deck: deck.replace('at: galaxy }', 'at: galaxy, dist: 3, pitch: 95, stop: x }') }));
  assert.deepEqual(r.issues.map((p) => [p.code, p.level]), [['unknown-key', 'warning'], ['bad-pose', 'error'], ['camera-inside-form', 'warning']]);
  const w = typo(({ deck }) => ({ deck: deck.replace('at: galaxy }', 'at: galaxy, dist: 3 }') }));
  assert.deepEqual(w.problems, []);
  assert.match(w.warnings[0], /^slide 2: the camera at galaxy stands inside galaxy of station galaxy/);
});

test('a deck\'s own types and palettes are read from its setup files', () => {
  const src = [
    "export function install(registerBuilder) {",
    "  registerBuilder('lineup', buildLineup, { fields: ['pos', 'name', 'balls'] })",
    "  registerBuilder(\"streams\", buildStreams, { fields: ['pos', 'name', 'to'] })",
    "}",
    "registerBuilder('beacon', (o, ctx) => { return { group } }, { fields: ['pos', 'colour'] })",
    "definePalette('venue', { accent: '#ff5c8a' })",
  ].join('\n');
  assert.deepEqual(deckTypes(src), { types: { lineup: ['pos', 'name', 'balls'], streams: ['pos', 'name', 'to'], beacon: ['pos'] }, palettes: ['venue'] });
});

test('--json reports every problem with its slide and code', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stage-check-'));
  try {
    mkdirSync(join(dir, 'public/data'), { recursive: true });
    mkdirSync(join(dir, 'setup'));
    writeFileSync(join(dir, 'public/data/space.json'), JSON.stringify({ stations: [{ id: 'store', pos: [0, 0, 0], look: { dist: 8 }, objects: [{ type: 'lineup', pos: [0, 0, 0], name: 'open' }] }] }));
    writeFileSync(join(dir, 'setup/grains.js'), "export const install = (registerBuilder) => registerBuilder('lineup', buildLineup, { fields: ['pos', 'name', 'balls'] })\n");
    writeFileSync(join(dir, 'deck.md'), '---\nstage:\n  space: data/space.json\n---\n\n# one\n\n---\nspace: { at: stroe }\n---\n\n# two\n');
    const out = [], log = console.log;
    console.log = (s) => out.push(s);
    let code;
    try { code = checkMain([dir, '--json']); } finally { console.log = log; }
    const r = JSON.parse(out.join('\n'));
    assert.equal(code, 1);
    assert.equal(r.ok, false);
    assert.deepEqual(r.problems.map((p) => ({ slide: p.slide, code: p.code })), [{ slide: undefined, code: 'missing-field' }, { slide: 2, code: 'unknown-station' }]);
    assert.equal(r.problems[0].station, 'store');
    assert.deepEqual(r.stats.deckTypes, ['lineup']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a <Count> tag the deck no longer registers is a warning', () => {
  const space = { stations: [{ id: 'store', pos: [0, 0, 0], look: { dist: 8 } }] };
  const deck = '---\ninfo: |\n  the numbers count, `<Count>` counts with them\n---\n\n# one\n\n---\n\n<div class="big"><Count name="open" :to="800" /></div>\n';
  const warned = (components) => checkStage({ space, deck, components }).issues.filter((p) => p.code === 'unknown-component');
  assert.deepEqual(warned([]).map((p) => [p.slide, p.line, p.level]), [[2, 10, 'warning']]);
  assert.match(warned([])[0].msg, /<StageCount>/);
  assert.deepEqual(warned(['Count']), []);
  assert.deepEqual(warned(null), []);   // not asked
  assert.equal(checkStage({ space, deck, components: [] }).problems.length, 0);   // it does not fail the check
  assert.deepEqual(deckComponents(["import Count from './Count.vue'\nexport default ({ app }) => {\n  app.component('Count', Count)\n  app.component(\"Grains\", Grains)\n}"]), ['Count', 'Grains']);
  const dir = mkdtempSync(join(tmpdir(), 'stage-components-'));
  try {
    mkdirSync(join(dir, 'components'));
    writeFileSync(join(dir, 'components/Count.vue'), '<template><span /></template>\n');
    assert.deepEqual(deckComponents([], dir), ['Count']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('three resolves from the deck when the deck has its own', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stage-three-'));
  try {
    mkdirSync(join(dir, 'talks/a'), { recursive: true });
    assert.equal(deckHasThree(join(dir, 'talks/a')), deckHasThree(tmpdir()));   // nothing of its own: what lies above tmp decides
    mkdirSync(join(dir, 'node_modules/three'), { recursive: true });
    writeFileSync(join(dir, 'node_modules/three/package.json'), '{"name":"three"}\n');
    assert.equal(deckHasThree(join(dir, 'talks/a')), true);   // a workspace's, above the deck
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- the lists the validator holds the deck to ----------------------------------------------
test('the validator\'s key lists are the keys the code reads', async () => {
  const { DEFAULTS } = await import('../stage/space.js');
  assert.deepEqual(OPTION_KEYS, [...Object.keys(DEFAULTS), 'poses', 'hero']);
  for (const [look, opts] of Object.entries(LOOKS)) for (const k of Object.keys(opts)) assert.ok(OPTION_KEYS.includes(k), `${look}.${k}`);
  const read = new Set();
  for (const f of ['../components/Stage.vue', '../components/StageHalo.vue', '../components/StageCount.vue', '../global-top.vue', '../global-bottom.vue']) {
    for (const m of readFileSync(here(f), 'utf8').matchAll(/\b(?:CFG|cfg)\.(\w+)/g)) read.add(m[1]);
  }
  assert.deepEqual([...read].filter((k) => !STAGE_KEYS.includes(k)), []);
  const stage = readFileSync(here('../components/Stage.vue'), 'utf8') + readFileSync(here('../stage/space.js'), 'utf8');
  for (const k of SPACE_KEYS) assert.ok(new RegExp(`\\b(sp|p|frontmatterSpace\\.value\\?)\\.${k}\\b`).test(stage), `space.${k} is read`);
});

// ---- the counter ---------------------------------------------------------------------------
test('a count is written the way its language writes numbers', () => {
  const nb = '\u202f';
  assert.equal(formatCount(55000, { lang: 'lt' }), `55${nb}000`);
  assert.equal(formatCount(1844, { lang: 'lt' }), '1844');
  assert.equal(formatCount(9999, { lang: 'lt', span: 55000 }), `9${nb}999`);   // a count that ends grouped is grouped throughout
  assert.equal(formatCount(9999.6, { lang: 'lt' }), `10${nb}000`);            // grouped on what is written, not on 9999.6
  assert.equal(formatCount(12.345, { lang: 'lt', decimals: 1 }), '12,3');
  assert.equal(formatCount(1234567.891, { lang: 'lt-LT', decimals: 2 }), `1${nb}234${nb}567,89`);
  assert.equal(formatCount(1844, { lang: 'en' }), `1${nb}844`);
  assert.equal(formatCount(600000, { lang: 'en' }), `600${nb}000`);
  assert.equal(formatCount(999.96, { lang: 'en', decimals: 1 }), `1${nb}000.0`);
  assert.equal(formatCount(1234567.891, { lang: 'en', decimals: 2 }), `1${nb}234${nb}567.89`);
  assert.equal(formatCount(2026, { lang: 'en', plain: true }), '2026');
  assert.equal(formatCount(20260, { lang: 'lt', plain: true }), '20260');
  assert.equal(formatCount(-0.2), '0');
  assert.equal(formatCount(-12000, { lang: 'lt' }), `-12${nb}000`);
  assert.equal(formatCount(799.6), '800');
  assert.equal(formatCount(5, { lang: 'fr' }), '5');   // what is not lt is written the English way
});

test('group: the language\'s rule, always, or never', () => {
  const nb = '\u202f';
  assert.equal(formatCount(1844, { lang: 'lt', group: 'auto' }), '1844');
  assert.equal(formatCount(1844, { lang: 'lt', group: true }), `1${nb}844`);
  assert.equal(formatCount(1844, { lang: 'lt', group: 'true' }), `1${nb}844`);
  assert.equal(formatCount(2015, { lang: 'lt', group: false }), '2015');
  assert.equal(formatCount(20150, { lang: 'en', group: 'false' }), '20150');
  assert.equal(formatCount(20150, { lang: 'en', group: true, plain: true }), '20150');   // plain wins: it is group false
  assert.equal(formatCount(999, { lang: 'lt', group: true }), '999');
});

test('a count runs the way the talks\' Count.vue ran it', () => {
  // first arrival: wait `delay`, then a smoothstep over `ms`
  const up = countRun({ from: 800, to: 4000 });
  assert.deepEqual(up, { from: 800, to: 4000, delay: 1000, ms: 2900, down: false });
  assert.equal(countAt(up, 0), 800);
  assert.equal(countAt(up, 1000), 800);
  assert.equal(countAt(up, 1000 + 2900 / 2), 2400);   // the smoothstep's middle
  assert.equal(countAt(up, 1000 + 2900), 4000);
  assert.equal(countAt(up, 99999), 4000);
  // a name entered again starts from what it last landed on
  assert.deepEqual(countRun({ from: 800, to: 4000, last: 4000 }), { from: 4000, to: 4000, delay: 0, ms: 0, down: false });
  assert.equal(countAt(countRun({ from: 800, to: 4000, last: 4000 }), 0), 4000);   // an unchanged form: at once
  // going back: down at once, over 1.1 s, easing out
  const back = countRun({ from: 1, to: 800, last: 4000 });
  assert.deepEqual(back, { from: 4000, to: 800, delay: 0, ms: COUNT_DOWN_MS, down: true });
  assert.equal(COUNT_DOWN_MS, 1100);
  assert.equal(countAt(back, 0), 4000);
  assert.equal(countAt(back, 550), 4000 - 3200 * (1 - 0.5 ** 3));
  assert.equal(countAt(back, 1100), 800);
  // without a name, `from` above `to` counts down the same way
  assert.equal(countRun({ from: 100, to: 0 }).down, true);
  assert.equal(countRun({ from: 0, to: 13, ms: 1400 }).ms, 1400);
});

test('a count is grouped throughout while it runs, and lands as its number alone', () => {
  const nb = '\u202f';
  const at = (run, t) => formatCount(countAt(run, t), { lang: 'lt', span: countSpan(run, countAt(run, t)) });
  const up = countRun({ from: 800, to: 55000 });
  assert.match(at(up, 1000 + 2900 * 0.2), new RegExp(`^\\d${nb}\\d{3}$`));   // under 10 000, grouped: it ends grouped
  assert.equal(at(up, 99999), `55${nb}000`);
  // back from 55 000 to 4000 (a name entered again): grouped on the way, 4000 on landing, as Count.vue wrote it
  const back = countRun({ from: 800, to: 4000, last: 55000 });
  assert.equal(at(back, 0), `55${nb}000`);
  assert.match(at(back, 900), new RegExp(`^\\d${nb}\\d{3}$`));
  assert.equal(at(back, COUNT_DOWN_MS), '4000');
  assert.equal(at(countRun({ to: 4000, last: 4000 }), 0), '4000');
});

test('StageCount takes every prop of the talks\' Count.vue, with the same defaults', () => {
  const src = readFileSync(here('../components/StageCount.vue'), 'utf8');
  const block = /defineProps\(\{([\s\S]*?)\n\}\)/.exec(src)[1];
  const props = {};
  for (const m of block.matchAll(/^\s*(\w+): \{ type: ([^,]+(?:, \w+\])?), (?:default: (.+?)|(required: true)) \},?$/gm)) props[m[1]] = m[4] ? 'required' : m[3];
  // OpenData and Uzsikrauk karjerai (identical), with karjerai's group and decimals
  const talks = { from: '0', to: 'required', ms: '2900', delay: '1000', name: "''", group: "'auto'", decimals: '0' };
  // Innoday: plain (years); its own ms 2600 and delay 350 are not the defaults
  Object.assign(talks, { plain: 'false' });
  for (const [k, v] of Object.entries(talks)) assert.equal(props[k], v, k);
  assert.deepEqual(Object.keys(props).filter((k) => !(k in talks)), ['lang', 'for']);
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
