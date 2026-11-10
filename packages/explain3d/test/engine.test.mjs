// node --test "test/*.test.mjs"   — the engine without a browser: projection, depth order,
// surfaces, specs, motion, the presenter sync, the SVG it writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCamera, project, projectMany, turnBounds, viewBounds, viewport, toScreen, wrapAzim, nearAzim } from '../engine/camera.js';
import { axisMap, boxFrame, fmt } from '../engine/axes.js';
import { buildSurface, clipZ } from '../engine/surface.js';
import { validateSpec, prepareScene, drawFrame } from '../engine/scene.js';
import { toSVG, diffSVG } from '../engine/svg.js';
import { createMotion, GLIDE_MS, MORPH_MS, HOME } from '../engine/motion.js';
import { openSync } from '../engine/sync.js';
import { createPainter } from '../engine/paint.js';
import { ramp, color } from '../engine/palette.js';

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} is not ${b}`);
const SIZE = { width: 960, height: 540 };

// A small scene: a bowl over a 2 × 2 floor, a line across it, points, a marker, two states.
function bowl(extra = {}) {
  const nx = 9, ny = 9, z = [], flat = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const x = -1 + i / 4, y = -1 + j / 4; z.push(x * x + y * y); flat.push(0.5); }
  const spec = {
    explain3d: 1, name: 'bowl', label: 'a bowl',
    axes: [{ label: 'x', lo: -1, hi: 1, len: 1, ticks: [-1, 0, 1] }, { label: 'y', lo: -1, hi: 1, len: 1, ticks: [0] }, { label: 'z', lo: 0, hi: 1, len: 1, ticks: [0, 1] }],
    view: { azim: -60, elev: 30 },
    views: [{ id: 'above', label: 'from above', azim: -90, elev: 90 }],
    states: [{ id: 'bowl', label: 'bowl' }, { id: 'flat', label: 'flat' }],
    layers: [
      { type: 'surface', grid: { nx, ny }, z: { bowl: 'data:z', flat: 'data:flat' } },
      { type: 'line', x: 'data:lx', y: 0, z: 'data:lz', color: 'c1' },
      { type: 'points', x: 'data:px', y: 'data:py', z: 0, group: 'data:pg', colors: ['accent', 'c1'] },
      { type: 'marker', at: [0, 0, 0], label: 'lowest', in: ['bowl'] },
    ],
    ...extra,
  };
  const data = { z, flat, lx: [-0.5, 0, 0.5], lz: [0.25, 0, 0.25], px: [-0.9, 0.9, 0.9], py: [-0.9, 0.9, -0.9], pg: [0, 1, 1] };
  return { spec, data };
}

// ---- projection ---------------------------------------------------------------------
test('the camera looks at the origin from azim, elev, as matplotlib does', () => {
  const c = makeCamera(0, 0, 5);            // from +x, level
  assert.deepEqual(c.v.map((v) => Math.round(v * 1e9) / 1e9), [1, 0, 0]);
  const p = project(c, 0, 1, 0);            // +y is to the right, in the screen's plane
  near(p.x, 1); near(p.y, 0); near(p.d, 0); near(p.k, 1);
  near(project(c, 0, 0, 1).y, 1);           // +z is up
  const top = makeCamera(-90, 90, 5);       // from above, x to the right, y up
  near(project(top, 1, 0, 0).x, 5 / 5); near(project(top, 0, 1, 0).y, 1);
});

test('perspective: a point nearer the eye is drawn larger, and its depth says so', () => {
  const c = makeCamera(0, 0, 5);
  const front = project(c, 1, 1, 0), back = project(c, -1, 1, 0);
  assert.ok(front.d > back.d);
  near(front.x, 5 / 4); near(back.x, 5 / 6);
  near(front.k, 1.25);
});

test('projectMany agrees with project through a viewport', () => {
  const c = makeCamera(-60, 30, 5);
  const vp = viewport(viewBounds([1, 1, 1], -60, 30, 5), { x: 0, y: 0, w: 400, h: 300 });
  const P = Float64Array.from([0.2, -0.4, 0.3, -0.5, 0.5, -0.5]);
  const X = new Float64Array(2), Y = new Float64Array(2), D = new Float64Array(2);
  projectMany(c, vp, P, 2, X, Y, D);
  for (let i = 0; i < 2; i++) {
    const s = toScreen(c, vp, P[3 * i], P[3 * i + 1], P[3 * i + 2]);
    near(X[i], s.x, 1e-9); near(Y[i], s.y, 1e-9); near(D[i], s.d, 1e-12);
  }
});

test('the scale of a turn holds every azimuth, and the viewport keeps the box inside its rectangle', () => {
  const lens = [1.6, 1.2, 1];
  const b = turnBounds(lens, 25, 5);
  for (const az of [0, 15, 100, -55]) {
    const v = viewBounds(lens, az, 25, 5);
    assert.ok(v[0] >= b[0] - 1e-9 && v[1] <= b[1] + 1e-9 && v[2] >= b[2] - 1e-9 && v[3] <= b[3] + 1e-9);
  }
  const rect = { x: 40, y: 20, w: 800, h: 470 };
  const vp = viewport(b, rect);
  const c = makeCamera(100, 25, 5);
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    const p = toScreen(c, vp, sx * 0.8, sy * 0.6, sz * 0.5);
    assert.ok(p.x >= rect.x && p.x <= rect.x + rect.w && p.y >= rect.y && p.y <= rect.y + rect.h);
  }
});

test('azimuths wrap, and a glide goes the short way round', () => {
  assert.equal(wrapAzim(190), -170);
  assert.equal(wrapAzim(-180), -180);
  assert.equal(wrapAzim(540), -180);
  assert.equal(nearAzim(170, -170), 190);
  assert.equal(nearAzim(-10, 20), 20);
});

// ---- axes ---------------------------------------------------------------------------
test('an axis maps its range onto its length about the centre; numbers use a real minus', () => {
  const m = axisMap({ lo: 4, hi: 6, len: 0.9 });
  near(m(4), -0.45); near(m(5), 0); near(m(6), 0.45);
  assert.equal(fmt(-0.5, 1), '−0.5');
  assert.equal(fmt(-0.04, 1), '0.0');
});

test('the box: twelve edges, three axes read on outer edges; from above the height axis is left out', () => {
  const { spec, data } = bowl();
  const scene = prepareScene(spec, data);
  const f = drawFrame(scene, {}, SIZE);
  assert.equal(f.edges.length, 12);
  assert.deepEqual(f.axes.map((a) => a.k), [0, 1, 2]);
  assert.deepEqual(f.axes[0].ticks.map((t) => t.text), ['−1', '0', '1']);
  const above = drawFrame(scene, { azim: -90, elev: 90 }, SIZE);
  assert.deepEqual(above.axes.map((a) => a.k), [0, 1]);
});

// ---- surfaces -------------------------------------------------------------------------
test('clipZ cuts a polygon at a height and keeps what is on the right side', () => {
  const quad = [0, 0, 0, 1, 0, 0, 1, 1, 2, 0, 1, 2];           // rises from 0 to 2 along y
  const cut = clipZ(quad, 1, 1);
  assert.equal(cut.length / 3, 4);
  for (let i = 2; i < cut.length; i += 3) assert.ok(cut[i] <= 1 + 1e-12);
  near(Math.max(...cut.filter((_, i) => i % 3 === 1)), 0.5);  // the cut runs at y = 0.5
  assert.deepEqual(clipZ(quad, 5, 1), quad);                    // all below: untouched
  assert.deepEqual(clipZ(quad, -1, 1), []);                     // all above: gone
  assert.equal(clipZ([0, 0, 0, 1, 0, 0, 1, 1, 2], 1, 1).length / 3, 4);   // a triangle loses a corner: four
});

test('a surface: one polygon per cell, cut at the top of the box, coloured from the palette', () => {
  const { spec, data } = bowl();
  const maps = spec.axes.map(axisMap);
  const full = buildSurface({ grid: { nx: 9, ny: 9, x: [-1, 1], y: [-1, 1] }, z: data.z, maps, zBox: [-0.5, 0.5] });
  assert.ok(full.n < 64 && full.n > 40, `${full.n} polygons`);  // the corners rise above z = 1 and are cut away
  assert.equal(full.off.length, full.n + 1);
  for (let i = 2; i < full.P.length; i += 3) assert.ok(full.P[i] <= 0.5 + 1e-9 && full.P[i] >= -0.5 - 1e-9);
  assert.ok(full.fill.every((f) => /^rgb\(\d+,\d+,\d+\)$/.test(f)));
  const coarse = buildSurface({ grid: { nx: 9, ny: 9, x: [-1, 1], y: [-1, 1] }, z: data.z, maps, zBox: [-0.5, 0.5], step: 2 });
  assert.ok(coarse.n <= 16);
  assert.throws(() => buildSurface({ grid: { nx: 9, ny: 8, x: [-1, 1], y: [-1, 1] }, z: data.z, maps, zBox: [-0.5, 0.5] }), /72 heights, got 81/);
});

test('a palette is a ramp between its stops; a token follows the deck when live', () => {
  const r = ramp(['#000000', '#ffffff'], 3);
  assert.deepEqual(r, [[0, 0, 0], [127.5, 127.5, 127.5], [255, 255, 255]]);
  assert.equal(ramp('viridis', 64).length, 64);
  assert.throws(() => ramp('nope'), /no palette/);
  assert.equal(color('accent'), '#7dd3fc');
  assert.equal(color('accent', true), 'var(--x3d-accent, var(--accent, #7dd3fc))');
  assert.equal(color('#123456', true), '#123456');
});

// ---- depth order ------------------------------------------------------------------------
test("the painter's order: every path is drawn after those farther from the eye", () => {
  const { spec, data } = bowl();
  const f = drawFrame(prepareScene(spec, data), {}, SIZE);
  for (let i = 1; i < f.items.length; i++) assert.ok(f.items[i].key >= f.items[i - 1].key);
});

test('two floors, one above the other: seen from above the upper one is drawn last, from below the lower one', () => {
  const z0 = [0, 0, 0, 0], z1 = [1, 1, 1, 1];
  const spec = {
    explain3d: 1, name: 'floors', label: 'two floors',
    axes: [{ lo: 0, hi: 1, len: 1 }, { lo: 0, hi: 1, len: 1 }, { lo: -0.5, hi: 1.5, len: 1 }],
    view: { elevRange: [-85, 85] },
    layers: [{ type: 'surface', grid: { nx: 2, ny: 2 }, z: z1, color: '#ff0000', shade: false }, { type: 'surface', grid: { nx: 2, ny: 2 }, z: z0, color: '#0000ff', shade: false }],
  };
  const scene = prepareScene(spec, {});
  const last = (elev) => drawFrame(scene, { azim: 30, elev }, SIZE).items.at(-1).fill;
  assert.equal(last(40), 'rgb(255,0,0)');
  assert.equal(last(-40), 'rgb(0,0,255)');
});

test('a line on a surface is lifted towards the eye in the order; points come in depth bands, far bands dimmer', () => {
  const { spec, data } = bowl();
  const f = drawFrame(prepareScene(spec, data), {}, SIZE);
  const lines = f.items.filter((i) => i.stroke === '#f8b64f' && !i.fill);
  assert.equal(lines.length, 2);                                 // three points, two segments
  const bands = f.items.filter((i) => i.fill === '#7dd3fc' || (i.fill === '#f8b64f' && !i.stroke));
  assert.ok(bands.length >= 2);
  const sorted = [...bands].sort((a, b) => a.key - b.key);
  assert.ok(sorted[0].op < sorted.at(-1).op);
});

// ---- specs ---------------------------------------------------------------------------------
test('a sound spec has nothing wrong; a broken one says everything that is', () => {
  const { spec, data } = bowl();
  assert.deepEqual(validateSpec(spec, data), []);
  const bad = validateSpec({
    explain3d: 2, name: 'Bad Name', axes: [{ lo: 1, hi: 0, len: 1 }, { lo: 0, hi: 1, len: 0 }, { lo: 0, hi: 1, len: 1, ticks: [3] }],
    view: { dist: 1 }, states: [{ id: 'a', label: 'A' }, { id: 'a', label: 'A' }], views: [{ id: 'v', label: 'V' }],
    layers: [{ type: 'cube' }, { type: 'surface', grid: { nx: 3, ny: 3 }, z: 'data:none' }, { type: 'line', x: 'data:x', y: 0, z: 'data:short' },
      { type: 'points', x: 1, y: 1, z: 1 }, { type: 'marker', at: [1, 2] }, { type: 'marker', at: [0, 0, 0], in: ['nowhere'] }],
    key: {},
  }, { x: [1, 2, 3], short: [1] });
  const all = bad.join('\n');
  for (const want of ['reads version 1', 'not kebab-case', 'label:', 'axes[0]: lo < hi', 'axes[1]: len > 0', 'tick 3 is outside', 'view.dist', '"a" twice', '"v" needs azim and elev',
    'layers[0].type: "cube"', 'layers[1].z: no heights', 'layers[2].z: 1 values, the other columns have 3', 'layers[3]: at least one of x, y, z must be a list', 'layers[4].at', 'no state "nowhere"']) {
    assert.ok(all.includes(want), `missing: ${want}\n${all}`);
  }
  assert.throws(() => prepareScene({ explain3d: 1, name: 'x', label: 'x', axes: [], layers: [] }, {}), /explain3d: x: axes: three are needed/);
});

test('a surface with states needs heights for each; a key needs a surface coloured by height', () => {
  const { spec, data } = bowl();
  spec.layers[0].z = { bowl: 'data:z' };
  assert.ok(validateSpec(spec, data).some((m) => m.includes('no heights for state "flat"')));
  const b = bowl({ key: { label: 'z' } });
  b.spec.layers[0].color = 'accent';
  assert.ok(validateSpec(b.spec, b.data).some((m) => m.startsWith('key:')));
});

// ---- states ---------------------------------------------------------------------------------
test('a state decides which heights are drawn and which layers show; between two states the heights blend', () => {
  const { spec, data } = bowl();
  const scene = prepareScene(spec, data);
  const a = drawFrame(scene, { state: { a: 'bowl' } }, SIZE);
  const b = drawFrame(scene, { state: { a: 'flat' } }, SIZE);
  assert.equal(a.active, 'bowl');
  assert.equal(a.labels.length, 1);                              // the marker is `in: ['bowl']`
  assert.equal(b.labels.length, 0);
  assert.equal(b.items.filter((i) => /^rgb/.test(i.fill)).length, 64);     // flat: nothing cut away
  const mid = drawFrame(scene, { state: { a: 'bowl', b: 'flat', u: 0.5 } }, SIZE);
  assert.equal(mid.active, 'flat');
  assert.notEqual(mid.items.find((i) => /^rgb/.test(i.fill)).d, b.items.find((i) => /^rgb/.test(i.fill)).d);
  // the coarse mesh: every second grid line
  const c = drawFrame(scene, { state: { a: 'flat' } }, SIZE, { coarse: true });
  assert.equal(c.items.filter((i) => /^rgb/.test(i.fill)).length, 16);
});

// ---- the SVG ------------------------------------------------------------------------------
test('a frame as SVG: vector only, the same text every time, and a key when the scene has one', () => {
  const { spec, data } = bowl({ key: { label: 'z', ticks: [0, 0.5, 1], decimals: 1 } });
  const draw = () => toSVG(drawFrame(prepareScene(spec, data), {}, SIZE), SIZE, { label: spec.label });
  const svg = draw();
  assert.equal(svg, draw());
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 540"'));
  assert.equal((svg.match(/<image\b/g) || []).length, 0);
  assert.ok(!/<canvas|<foreignObject|NaN|undefined/.test(svg));
  assert.ok(svg.includes('<linearGradient id="x3d-key"'));
  assert.ok(svg.includes('>lowest</text>') && svg.includes('aria-label="a bowl"'));
});

test('diffSVG lets a coordinate differ by a rounding step and nothing else', () => {
  const a = '<path d="M10.1 20L30 40.5Z" fill="rgb(1,2,3)"/>';
  assert.equal(diffSVG(a, a), null);
  assert.equal(diffSVG(a, a.replace('10.1', '10.2')), null);
  assert.match(diffSVG(a, a.replace('10.1', '10.4')), /10.1 against 10.4/);
  assert.match(diffSVG(a, a.replace('rgb(1,2,3)', 'rgb(1,2,4)')), /3 against 4/);
  assert.match(diffSVG(a, a.replace('Z', '')), /structure differs/);
});

// ---- motion ---------------------------------------------------------------------------------
test('it turns by itself at one turn per `turn` seconds, only while allowed; reduced motion never turns', () => {
  const { spec, data } = bowl();
  const scene = prepareScene(spec, data);
  const m = createMotion(scene, { turn: 40 });
  assert.equal(m.spinning, true);
  m.step(1000); m.step(1050);
  near(m.azim, -60 + 9 * 0.05, 1e-9);
  assert.equal(m.step(1100, false), false);                      // the slide is not shown
  near(m.azim, -60 + 0.45, 1e-9);
  assert.equal(createMotion(scene, { reduceMotion: true }).spinning, false);
  assert.equal(createMotion(scene, { turn: 0 }).canTurn, false);
});

test('a drag turns and tilts within the limits, and ends the turning', () => {
  const { spec, data } = bowl();
  const m = createMotion(prepareScene(spec, data));
  m.drag(0.1, 0.1);
  near(m.azim, -90); near(m.elev, 41);
  assert.equal(m.spinning, false);
  assert.equal(m.touched, true);
  m.drag(0, 5);
  assert.equal(m.elev, 85);
  m.drag(0, -5);
  assert.equal(m.elev, 5);
});

test('a button glides to a named view the short way round; a double-click glides home', () => {
  const { spec, data } = bowl();
  const m = createMotion(prepareScene(spec, data));
  m.toView('above', 0);
  assert.equal(m.view, 'above');
  assert.equal(m.spinning, false);
  assert.equal(m.step(GLIDE_MS / 2), true);
  assert.ok(m.elev > 30 && m.elev < 90);
  m.step(GLIDE_MS);
  near(m.azim, -90); near(m.elev, 90);
  assert.equal(m.step(GLIDE_MS + 16), false);
  m.toView(null, 2000);
  assert.equal(m.view, HOME);
  m.step(2000 + GLIDE_MS);
  near(m.azim, -60); near(m.elev, 30);
  const still = createMotion(prepareScene(spec, data), { reduceMotion: true });
  still.toView('above', 0);
  assert.equal(still.elev, 90);                                   // reduced motion: there at once
});

test('a state button morphs the heights over MORPH_MS', () => {
  const { spec, data } = bowl();
  const m = createMotion(prepareScene(spec, data), { turn: 0 });
  m.toState('flat', 0);
  assert.deepEqual([m.state.a, m.state.b], ['bowl', 'flat']);
  m.step(MORPH_MS / 2);
  near(m.state.u, 0.5);
  m.step(MORPH_MS);
  assert.deepEqual(m.state, { a: 'flat', b: 'flat', u: 0 });
  m.toState('flat', 5000);                                        // already there
  assert.equal(m.state.t0, undefined);
  m.toState('nope', 5000);
  assert.equal(m.state.b, 'flat');
});

// ---- presenter ↔ audience ----------------------------------------------------------------------
test('two windows: a drag in one is the view of the other, and a window opened late is told', () => {
  const rooms = [];
  class Channel {
    constructor() { rooms.push(this); }
    postMessage(data) { for (const r of rooms) if (r !== this && !r.closed) r.onmessage?.({ data: structuredClone(data) }); }
    close() { this.closed = true; }
  }
  const { spec, data } = bowl();
  const scene = prepareScene(spec, data);
  const open = (m, key = 'k') => openSync({ key, get: () => m.snapshot(), set: (s) => m.apply(s, 0), hasMoved: () => m.touched, Channel });
  const a = createMotion(scene), b = createMotion(scene);
  const sa = open(a), sb = open(b);
  assert.equal(sa.post(), false);                                 // nothing has changed yet
  a.drag(0.1, 0.05);
  assert.equal(sa.post(), true);
  assert.deepEqual([b.azim, b.elev, b.spinning], [a.azim, a.elev, false]);
  a.toView('above', 0); sa.post();
  assert.equal(b.view, 'above');
  a.toState('flat', 0); sa.post();
  assert.equal(b.state.b, 'flat');
  const late = createMotion(scene);
  open(late);                                                     // says hello; a answers
  assert.equal(late.view, 'above');
  const other = createMotion(scene);
  open(other, 'another figure');
  assert.equal(other.touched, false);
  sb.close(); sa.close();
  assert.equal(openSync({ key: 'k', get: () => ({}), set() {}, hasMoved: () => false, Channel: null }), null);
});

// ---- the page's painter -------------------------------------------------------------------------
test('the painter reuses its paths, writes an attribute only when it changes, and hides the spare ones', () => {
  let writes = 0;
  const el = () => ({ attrs: {}, style: {}, setAttribute(k, v) { writes++; this.attrs[k] = String(v); }, removeAttribute(k) { writes++; delete this.attrs[k]; } });
  const g = { children: [], appendChild(c) { this.children.push(c); } };
  const p = createPainter(g, { createElementNS: el });
  p.paint([{ d: 'M0 0', fill: 'red' }, { d: 'M1 1', stroke: 'blue', sw: 2, op: 0.5 }]);
  assert.equal(g.children.length, 2);
  assert.deepEqual(g.children[1].attrs, { d: 'M1 1', fill: 'none', stroke: 'blue', 'stroke-width': '2', opacity: '0.5' });
  writes = 0;
  p.paint([{ d: 'M0 1', fill: 'red' }]);
  assert.equal(writes, 1);                                        // only the first path's d
  assert.equal(g.children[1].style.display, 'none');
  assert.equal(p.count(), 1);
  p.paint([{ d: 'M0 1', fill: 'red' }, { d: 'M2 2', fill: 'green' }]);
  assert.equal(g.children.length, 2);
  assert.equal(g.children[1].style.display, '');
  assert.deepEqual(g.children[1].attrs, { d: 'M2 2', fill: 'green' });
});
