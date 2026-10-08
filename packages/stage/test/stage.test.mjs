// node --test test/   — what can be held to account without a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, utimes, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CORE_TYPES, PLUGIN_TYPES, anchorIds } from '../stage/types.js';
import { resolvePalette, PALETTES, DEFAULT_PALETTE, hexToRgb, rgbTriplet, paletteVars, definePalette } from '../stage/palette.js';
import { checkStage, readStageConfig, deckPoses } from '../bin/check.mjs';
import { parseSlides, parseArgs, detectBase, clicksFor, frameName, parseProcLocks, problemsOf, split, serve, staticKey } from '../bin/shots.mjs';

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

// ---- the shots tool ---------------------------------------------------------------------
test('slide ranges', () => {
  assert.deepEqual(parseSlides('1-3,7', 10), [1, 2, 3, 7]);
  assert.deepEqual(parseSlides('9-12', 10), [9, 10]);
  assert.deepEqual(parseSlides('3-1, 3', 10), [1, 2, 3]);
  assert.deepEqual(parseSlides(null, 3), [1, 2, 3]);
  assert.deepEqual(parseSlides('x, 2', 5), [2]);
});

test('options', () => {
  const o = parseArgs(['dist', 'out', '--slides', '2-4', '--clicks', 'all', '--settle', '4', '--wait', '9000', '--burst', '3', '--every', '0.5', '--no-halo', '--no-lock', '--draft', '--jobs', '2']);
  assert.deepEqual(o.errors, []);
  assert.equal(o.dist, 'dist'); assert.equal(o.out, 'out');
  assert.equal(o.clicks, 'all'); assert.equal(o.settle, 4); assert.equal(o.wait, 9000);
  assert.equal(o.burst, 3); assert.equal(o.every, 0.5); assert.equal(o.halo, false); assert.equal(o.lock, null);
  assert.equal(o.draft, true); assert.equal(o.jobs, 2);
  assert.deepEqual(parseArgs(['d', 'o']).size, [1600, 900]);
  assert.equal(parseArgs(['d', 'o']).lock, '/tmp/slidev-stage-shots.lock');
  // the older click map and --click-wait still parse
  const old = parseArgs(['d', 'o', '--clicks', '{"9":3}', '--click-wait', '45000']);
  assert.deepEqual(old.clickMap, { 9: 3 }); assert.equal(old.wait, 45000);
  // --dev takes the deck; the one positional is the out dir
  const dev = parseArgs(['--dev', 'deck.md', 'shots']);
  assert.equal(dev.dev, 'deck.md'); assert.equal(dev.out, 'shots'); assert.equal(dev.dist, null);
  assert.equal(parseArgs(['--base', 'repo/talk', 'd', 'o']).base, '/');
  assert.equal(parseArgs(['--base', '/repo/talk', 'd', 'o']).base, '/repo/talk/');
});

test('bad options are errors, not positionals', () => {
  assert.match(parseArgs(['d', 'o', '--frobnicate']).errors.join(), /unknown option --frobnicate/);
  assert.match(parseArgs(['d', 'o', '--clicks', 'some']).errors.join(), /--clicks/);
  assert.match(parseArgs(['d', 'o', '--size', '1600']).errors.join(), /--size/);
  assert.match(parseArgs(['d', 'o', '--gl', 'metal']).errors.join(), /--gl/);
  assert.match(parseArgs(['d']).errors.join(), /usage/);
  assert.deepEqual(parseArgs(['--help']).errors, []);
});

test('the base a deck was built for', () => {
  assert.equal(detectBase('<script type="module" crossorigin src="/assets/index-a.js"></script>'), '/');
  assert.equal(detectBase('<script type="module" crossorigin src="/cern_outreach_talks/2026_10_00_OpenData/assets/index-a.js"></script>'), '/cern_outreach_talks/2026_10_00_OpenData/');
  assert.equal(detectBase('<link rel="stylesheet" href="./assets/index-a.css">'), '/');
  assert.equal(detectBase('<html></html>'), '/');
});

test('which clicks a slide is photographed at', () => {
  assert.deepEqual(clicksFor({ clicks: 'none' }, 3, 2), [0]);
  assert.deepEqual(clicksFor({ clicks: 'last' }, 3, 2), [2]);
  assert.deepEqual(clicksFor({ clicks: 'last' }, 3, 0), [0]);
  assert.deepEqual(clicksFor({ clicks: 'all' }, 3, 2), [0, 1, 2]);
  assert.deepEqual(clicksFor({ clickMap: { 9: 3 } }, 9, 0), [0, 1, 2, 3]);
  assert.deepEqual(clicksFor({ clickMap: { 9: 3 } }, 4, 5), [0]);
  assert.equal(frameName(3), '03'); assert.equal(frameName(12, 2), '12-c2'); assert.equal(frameName(4, 0, 1), '04-b1');
});

test('the shared lock is read off /proc/locks', () => {
  const locks = parseProcLocks([
    '5: FLOCK  ADVISORY  WRITE 1014497 08:30:1176715 0 EOF',
    '5: -> FLOCK  ADVISORY  WRITE 1022143 08:30:1176715 0 EOF',
    '6: POSIX  ADVISORY  READ 2201 00:1a:42 0 EOF',
  ].join('\n'));
  assert.deepEqual(locks, [
    { waiting: false, kind: 'FLOCK', pid: 1014497, inode: 1176715 },
    { waiting: true, kind: 'FLOCK', pid: 1022143, inode: 1176715 },
    { waiting: false, kind: 'POSIX', pid: 2201, inode: 42 },
  ]);
});

test('what makes a run exit 3', () => {
  assert.deepEqual(problemsOf({ settled: true, overflowPx: -10, overflowRightPx: 1, pageErrors: [], httpErrors: [{ status: 404, local: false }] }), []);
  assert.deepEqual(problemsOf({ settled: false }), ['not settled']);
  assert.deepEqual(problemsOf({ overflowPx: 12 }), ['runs 12px off the bottom']);
  assert.deepEqual(problemsOf({ pageErrors: ['x'], httpErrors: [{ status: 404, local: true }] }), ['1 page error(s)', '1 failed request(s)']);
  assert.deepEqual(problemsOf({ error: 'timeout' }), ['failed: timeout']);
});

test('slides are split into contiguous runs, one per page', () => {
  assert.deepEqual(split([1, 2, 3, 4, 5], 2), [[1, 2, 3], [4, 5]]);
  assert.deepEqual(split([1, 2], 4), [[1], [2]]);
  assert.deepEqual(split([1, 2, 3], 1), [[1, 2, 3]]);
});

test('a deck is served under the base it was built for', async () => {
  const dist = new URL('../example/public', import.meta.url).pathname;   // any directory with files
  const { server, port } = await serve(dist, { base: '/repo/talk/' });
  try {
    const at = (p) => fetch(`http://127.0.0.1:${port}${p}`).then((r) => r.status);
    assert.equal(await at('/repo/talk/data/space.json'), 200);
    assert.equal(await at('/data/space.json'), 404);           // outside the base
    assert.equal(await at('/repo/talk/data/missing.json'), 404);
    assert.equal(await at('/repo/talk/../../etc/passwd'), 404);
  } finally { server.close(); }
});

test('--changed keys public files by their bytes, not their time', async () => {
  const dist = await mkdtemp(join(tmpdir(), 'shots-key-'));
  try {
    await mkdir(join(dist, 'assets')); await mkdir(join(dist, 'data'));
    await writeFile(join(dist, 'index.html'), '<script src="/assets/index-a1.js"></script>');
    await writeFile(join(dist, 'assets', 'index-a1.css'), 'x');
    await writeFile(join(dist, 'data', 'space.json'), '{"stations":[]}');
    await writeFile(join(dist, '_redirects'), '/* /index.html 200');
    const clip = Buffer.alloc(300 << 10, 7);
    await writeFile(join(dist, 'clip.mp4'), clip);
    const o = parseArgs(['d', 'o']);
    const key = () => staticKey(dist, o, 'r', 200 << 10);   // the clip counts as big: its size, first and last 64 KB
    const k0 = await key();
    // a rebuild copies public/ and writes _redirects again: the same bytes, new times
    const later = new Date(Date.now() + 60000);
    for (const f of ['data/space.json', '_redirects', 'clip.mp4', 'index.html']) await utimes(join(dist, f), later, later);
    assert.equal(await key(), k0);
    await writeFile(join(dist, 'index.html'), '<script src="/assets/index-b2.js"></script>');   // new chunk names: the slides' own business
    assert.equal(await key(), k0);
    await writeFile(join(dist, 'data', 'space.json'), '{"stations":[1]}');
    const k1 = await key();
    assert.notEqual(k1, k0);
    clip[10] = 8;
    await writeFile(join(dist, 'clip.mp4'), clip);
    const k2 = await key();
    assert.notEqual(k2, k1);
    await rename(join(dist, 'assets', 'index-a1.css'), join(dist, 'assets', 'index-b2.css'));   // restyled
    assert.notEqual(await key(), k2);
  } finally { await rm(dist, { recursive: true, force: true }); }
});
