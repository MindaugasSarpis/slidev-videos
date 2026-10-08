// node --test test/   — the broadcast look.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LOOKS, PALETTES, resolveLook, liftGround, definePalette, paletteVars } from '../stage/palette.js';

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
