// node --test test/   — the broadcast look, the recorder's and the safe check's
// pure parts (the browser runs are in the README's verification).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LOOKS, PALETTES, resolveLook, liftGround, definePalette, paletteVars } from '../stage/palette.js';
import { parseArgs as recordArgs } from '../bin/record.mjs';
import { parseArgs as safeArgs, judge, RULES } from '../bin/safe.mjs';
import { detectBase, normaliseBase, parseSlides, parseSize } from '../bin/lib/record-serve.mjs';
import { findFlashes } from '../bin/lib/record-flash.mjs';
import { ffmpegCandidates } from '../bin/lib/record-ffmpeg.mjs';

const here = (p) => new URL(p, import.meta.url);

// ---- the look ----------------------------------------------------------------------
test('the broadcast look sits over any palette and caps its nebula', () => {
  const blue = resolveLook('blue', 'broadcast');
  assert.equal(blue.nebula, 0.3);                  // blue brings 0.8
  assert.equal(blue.grain, 0);
  assert.equal(blue.aberration, 0);
  assert.equal(blue.guard, false);
  assert.equal(blue.halo, false);
  assert.deepEqual(blue.flight, [2.5, 5]);
  assert.equal(blue.max, undefined);               // the caps are not an option
  assert.equal(resolveLook('classic', 'broadcast').nebula, 0);   // a cap never adds
  assert.equal(resolveLook({ base: 'ember' }, 'broadcast').nebula, 0.3);
  assert.equal(resolveLook(undefined, 'broadcast').nebula, undefined);
  assert.deepEqual(resolveLook('blue'), { nebula: 0.8 });          // no look: the palette's, as before
  assert.deepEqual(resolveLook('blue', 'no-such'), { nebula: 0.8 });
});

test('the broadcast dust is half again the default grain', () => {
  const src = readFileSync(here('../stage/space.js'), 'utf8');
  const def = Number(/dustSize: ([\d.]+)/.exec(src)[1]);
  assert.ok(Math.abs(LOOKS.broadcast.dustSize - def * 1.5) < 0.01);
});

test('definePalette may bring a look', () => {
  definePalette('test-venue', { accent: '#ff5c8a' }, { nebula: 0.5, bloom: 0.4 });
  assert.deepEqual(resolveLook('test-venue'), { nebula: 0.5, bloom: 0.4 });
  assert.equal(resolveLook('test-venue', 'broadcast').nebula, 0.3);
  definePalette('test-plain', { accent: '#112233' });
  assert.deepEqual(resolveLook('test-plain'), {});
});

test('the ground is lifted toward the accent, in its own hue', () => {
  assert.equal(liftGround(PALETTES.blue, LOOKS.broadcast.lift).bg, '#090f1e');
  assert.equal(liftGround(PALETTES.blue, 0), PALETTES.blue);
  assert.equal(liftGround(PALETTES.blue, undefined), PALETTES.blue);
  assert.equal(liftGround(PALETTES.blue, 1).bg, PALETTES.blue.accent);
  assert.equal(liftGround(PALETTES.blue, 0.07).accent, PALETTES.blue.accent);
  const vars = paletteVars(PALETTES.blue);
  assert.equal(vars['--stage-dust'], PALETTES.blue.dust);
  assert.equal(vars['--stage-nebula'], PALETTES.blue.nebula);
});

test('every type size of the CSS kit follows the scale and the floor', () => {
  const css = readFileSync(here('../styles/index.css'), 'utf8');
  const sizes = [...css.matchAll(/font-size:\s*([^;!]+)/g)].map((m) => m[1].trim());
  assert.ok(sizes.length > 20);
  for (const s of sizes) assert.match(s, /^max\(var\(--stage-type-min, 0px\), [\d.]+px \* var\(--stage-type-scale, 1\)\)$/, s);
  assert.match(css, /html\[data-stage-look="broadcast"\] \{[^}]*--stage-type-min: 16px/);
});

// ---- the recorder --------------------------------------------------------------------
test('record arguments', () => {
  const o = recordArgs(['dist', 'out']);
  assert.equal(o.fps, 50);
  assert.deepEqual(o.size, [1920, 1080]);
  assert.equal(o.hold, 8);
  assert.equal(o.clicks, 'all');
  assert.equal(o.base, 'auto');
  const p = recordArgs(['d', 'o', '--fps', '25', '--size', '1280x720', '--slides', '2-4', '--plate', '--hold', '3', '--clicks', '{"3":1}', '--flash']);
  assert.deepEqual([p.fps, p.size, p.slides, p.plate, p.hold, p.clicks, p.flash], [25, [1280, 720], '2-4', true, 3, { 3: 1 }, true]);
  assert.equal(recordArgs(['d', 'o', '--clicks', 'none']).clicks, 'none');
  assert.throws(() => recordArgs(['d', 'o', '--fps', '0']));
  assert.throws(() => recordArgs(['d', 'o', '--size', '1920']));
});

test('a deck is served under the base it was built for', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stage-base-'));
  writeFileSync(join(dir, 'index.html'), '<script type="module" src="/talks/x/assets/index-1.js"></script>');
  assert.equal(detectBase(dir), '/talks/x/');
  assert.equal(normaliseBase('auto', dir), '/talks/x/');
  writeFileSync(join(dir, 'index.html'), '<link rel="stylesheet" href="/assets/index-1.css">');
  assert.equal(detectBase(dir), '/');
  assert.equal(normaliseBase('/', dir), '/');
  assert.equal(normaliseBase('a/b', dir), '/a/b/');
  assert.equal(detectBase(join(dir, 'missing')), '/');
  assert.deepEqual(parseSlides('3,1-2,9', 5), [1, 2, 3]);
  assert.deepEqual(parseSize('1280x720'), [1280, 720]);
});

test('ffmpeg is looked for in the named dir first', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stage-ff-'));
  writeFileSync(join(dir, 'ffmpeg'), '');
  const c = ffmpegCandidates({ SLIDEV_VIDEOS_FFMPEG_DIR: dir, PATH: '' });
  assert.equal(c[0], join(dir, 'ffmpeg'));
});

test('the flash check counts bursts over a quarter of the frame', () => {
  const w = 8, h = 4, fps = 50, frame = (y) => Buffer.alloc(w * h * 3, y);
  const flicker = Array.from({ length: 100 }, (_, i) => frame(Math.floor(i / 5) % 2 ? 230 : 20));   // 5 Hz, whole frame
  assert.ok(findFlashes(flicker, { w, h, fps }).warnings.length > 0);
  const once = Array.from({ length: 100 }, (_, i) => frame(i > 50 && i < 60 ? 230 : 20));
  const r = findFlashes(once, { w, h, fps });
  assert.equal(r.transitions.length, 2);
  assert.deepEqual(r.warnings, []);
  // the same flicker in one corner (an eighth of the frame) is not a flash
  const corner = Array.from({ length: 100 }, (_, i) => { const b = frame(20); if (Math.floor(i / 5) % 2) for (const p of [0, 1, 8, 9]) b.fill(230, p * 3, p * 3 + 3); return b; });
  assert.equal(findFlashes(corner, { w, h, fps }).transitions.length, 0);
});

// ---- the safe check --------------------------------------------------------------------
test('safe arguments and rules', () => {
  assert.deepEqual(safeArgs(['dist', '--broadcast', '--json']), { dist: 'dist', broadcast: true, json: true, slides: null, size: [1920, 1080], base: 'auto' });
  const b = RULES.broadcast.box;
  assert.deepEqual([Math.round(b[0] * 980), Math.round(b[2] * 980)], [98, 882]);
  assert.deepEqual([Math.round(b[1] * 551.25), Math.round(b[3] * 551.25)], [55, 408]);
});

test('the broadcast rules flag the kit\'s small source line and kicker', () => {
  const state = { W: 980, H: 551.25, lines: [
    { text: 'slidev-addon-stage · packages/stage/example', tag: 'div.src', font: 12, box: [44, 513, 323, 529] },
    { text: 'A form of grains', tag: 'h1', font: 12.5, box: [110, 300, 240, 316] },
    { text: 'Inside and large enough', tag: 'p', font: 40, box: [120, 120, 600, 170] },
    { text: 'Where the logo goes', tag: 'p', font: 20, box: [800, 60, 870, 80] },
  ] };
  const out = judge(state, RULES.broadcast);
  const by = Object.fromEntries(out.map((p) => [p.text, p.problems.map((x) => x.kind)]));
  assert.deepEqual(by['slidev-addon-stage · packages/stage/example'], ['small', 'outside', 'corner']);
  assert.deepEqual(by['A form of grains'], ['small']);
  assert.equal(by['Inside and large enough'], undefined);
  assert.deepEqual(by['Where the logo goes'], ['corner']);
  assert.deepEqual(judge(state, RULES.hall), []);   // in a hall, 12 px on the slide is allowed
});
