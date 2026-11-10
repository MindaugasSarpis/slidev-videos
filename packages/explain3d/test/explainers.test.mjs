// node --test "test/*.test.mjs"   — every explainer the package ships: its spec is
// sound, its data is what its script makes from its input, its golden picture
// is its opening view, and its numbers are the ones the slide quotes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EXPLAINERS, GOLDEN } from '../explainers/index.js';
import { validateSpec, prepareScene, drawFrame } from '../engine/scene.js';
import { checkOne, makeData, renderOne } from '../bin/explain3d.mjs';

const dir = (name, file = '') => fileURLToPath(new URL(`../explainers/${name}/${file}`, import.meta.url));
const readJSON = (name, file) => JSON.parse(readFileSync(dir(name, file), 'utf8'));

test('the list names every folder of explainers/, and each has its five files', () => {
  const folders = readdirSync(dir('')).filter((f) => !f.includes('.')).sort();
  assert.deepEqual([...EXPLAINERS].sort(), folders);
  for (const name of EXPLAINERS) for (const f of ['spec.json', 'make.mjs', 'input.json', 'data.json', 'golden.svg']) assert.ok(existsSync(dir(name, f)), `${name}/${f}`);
});

for (const name of EXPLAINERS) {
  test(`${name}: the spec is sound and is named as its folder`, () => {
    const spec = readJSON(name, 'spec.json');
    assert.deepEqual(validateSpec(spec, readJSON(name, 'data.json')), []);
    assert.equal(spec.name, name);
  });

  test(`${name}: the input names its source file and that file's SHA-256`, async () => {
    const input = readJSON(name, 'input.json');
    const m = await import(`../explainers/${name}/make.mjs`);
    assert.equal(input.source.file, m.source.file);
    assert.match(input.source.sha256, /^[0-9a-f]{64}$/);
  });

  test(`${name}: data.json and golden.svg are what the scripts give`, async () => {
    assert.deepEqual(await checkOne(name), []);
    assert.equal(JSON.stringify(await makeData(name)), JSON.stringify(await makeData(name)));   // no clock, no random numbers
  });

  test(`${name}: the picture is vector only, at every named view and state`, () => {
    const spec = readJSON(name, 'spec.json');
    const views = [{}, ...(spec.views || []).map((v) => ({ azim: v.azim, elev: v.elev }))];
    for (const s of spec.states || [{}]) {
      for (const v of views) {
        const svg = renderOne(name, s.id ? { ...v, state: { a: s.id } } : v);
        assert.equal((svg.match(/<image\b/g) || []).length, 0);
        assert.ok(!/NaN|undefined|Infinity/.test(svg), `${name}: a bad number in the picture`);
        assert.ok((svg.match(/<path /g) || []).length > 10);
      }
    }
  });

  test(`${name}: every path lies inside the picture at the opening view`, () => {
    const scene = prepareScene(readJSON(name, 'spec.json'), readJSON(name, 'data.json'));
    const f = drawFrame(scene, {}, GOLDEN);
    for (const it of f.items) {
      for (const m of it.d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)) {
        assert.ok(Number(m[1]) >= 0 && Number(m[1]) <= GOLDEN.width && Number(m[2]) >= 0 && Number(m[2]) <= GOLDEN.height, `${m[0]} is outside`);
      }
    }
  });
}

test('the CLI: list, check, and a view to stdout', () => {
  const bin = fileURLToPath(new URL('../bin/explain3d.mjs', import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', maxBuffer: 64e6 });
  assert.deepEqual(run('list').stdout.trim().split('\n'), EXPLAINERS);
  const check = run('check');
  assert.equal(check.status, 0, check.stderr);
  const one = run('render', EXPLAINERS[0], '--azim', '10', '--elev', '20', '--width', '640', '--height', '360');
  assert.ok(one.stdout.startsWith('<svg') && one.stdout.trimEnd().endsWith('</svg>') && one.stdout.includes('viewBox="0 0 640 360"'));
  assert.equal(run('make', 'nope').status, 2);
  assert.equal(run().status, 2);
});

// ---- line-fit-valley: the numbers of Lecture 9, "The Path Downhill" -------------------------
test('line-fit-valley: the ten yearly means give the line, the lowest S and the path the slide quotes', async () => {
  const m = await import('../explainers/line-fit-valley/make.mjs');
  const input = readJSON('line-fit-valley', 'input.json');
  const data = readJSON('line-fit-valley', 'data.json');
  assert.deepEqual(input.years, [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]);
  assert.equal(input.hours.reduce((a, b) => a + b, 0), 87552);            // the measured hours of the log
  const mean = input.means.reduce((a, b) => a + b, 0) / 10;
  assert.equal(mean.toFixed(2), '7.16');
  const n = data.numbers;
  assert.equal(n.slope_per_decade.toFixed(2), '-0.56');
  assert.equal(n.intercept.toFixed(2), '7.41');
  assert.equal((n.S_min / 0.7 ** 2).toFixed(2), '8.56');                  // χ² at the minimum, σ = 0.70
  assert.equal(data.path_a.length, 501);
  assert.deepEqual([data.path_a[0], data.path_b[0]], [0, 7]);
  assert.deepEqual(n.end.map((v) => v.toFixed(2)), ['-0.56', '7.41']);    // 500 steps reach the lowest point
  for (let i = 1; i < data.path_S.length; i++) assert.ok(data.path_S[i] <= data.path_S[i - 1], `S rises at step ${i}`);
  // the surface is S on the grid: its lowest height is just above S_min, and the markers of the spec sit on it
  assert.ok(Math.min(...data.S) >= n.S_min && Math.min(...data.S) < n.S_min + 0.001);
  const spec = readJSON('line-fit-valley', 'spec.json');
  const marks = spec.layers.filter((l) => l.type === 'marker').map((l) => l.at);
  assert.deepEqual(marks, [[0, 7, n.S_start], [n.slope_per_decade, n.intercept, n.S_min]]);
  // reduce: a year's mean leaves out the hours marked −999
  const r = m.reduce('time,temp_c,humidity_pct,wind_ms\n2016-01-01T00:00,2.0,90,1\n2016-01-01T01:00,-999,90,1\n2016-01-01T02:00,4.0,90,1\n2017-01-01T00:00,-1.5,90,1\n');
  assert.deepEqual(r, { years: [2016, 2017], hours: [2, 1], means: [3, -1.5] });
});

// ---- neuron-plane: the numbers of Lecture 10, "The Decision Boundary Is a Line" ----------------
test('neuron-plane: 3646 evenings, and the two neurons get right what the slide says', async () => {
  const m = await import('../explainers/neuron-plane/make.mjs');
  const n = readJSON('neuron-plane', 'data.json').numbers;
  assert.equal(n.evenings, 3646);
  assert.equal((1 - n.frost / n.evenings).toFixed(3), '0.663');            // "never frost" is right 66.3 % of the time
  assert.deepEqual([n.upright.right, n.tilted.right], [3490, 3494]);
  assert.deepEqual(n.tonight, { date: '2025-12-08', x1: 2.6, x2: 0.85, frost: 1 });
  assert.deepEqual([n.upright.z_tonight, n.tilted.z_tonight], [1.2, 1.4]);
  const spec = readJSON('neuron-plane', 'spec.json');
  assert.deepEqual(spec.layers.filter((l) => l.type === 'marker').map((l) => l.at), [[2.6, 0.85, 1.2], [2.6, 0.85, 1.4]]);
  assert.equal(m.saysFrost(1e-16), false);                                // an evening on the line is "no frost"
  // reduce: 18:00 beside 06:00 of the next day; a missing hour drops the evening
  const day = (d, t18, t06) => Array.from({ length: 24 }, (_, h) => `${d}T${String(h).padStart(2, '0')}:00,${h === 18 ? t18 : h === 6 ? t06 : 5},80,1`).join('\n');
  const r = m.reduce(`time,temp_c,humidity_pct,wind_ms\n${day('2025-12-07', 3, 9)}\n${day('2025-12-08', 2.6, -1)}\n${day('2025-12-09', -999, 1)}\n${day('2025-12-10', 1, -4)}\n`);
  assert.deepEqual(r, { temp: [3, 2.6], humidity: [80, 80], frost: [1, 0], tonight: 1 });
});

// ---- xor-ridge: the numbers of Lecture 11, "XOR Learned from Random Weights" ---------------------
test('xor-ridge: 2000 steps from the course\'s nine starting weights reach the loss and the hidden outputs of the slide', async () => {
  const m = await import('../explainers/xor-ridge/make.mjs');
  const input = readJSON('xor-ridge', 'input.json');
  const n = readJSON('xor-ridge', 'data.json').numbers;
  assert.equal(input.start.length, 9);
  assert.equal(input.start[0], 0.6888437030500962);                       // random.Random(0).uniform(-1, 1), the first draw
  assert.deepEqual([n.loss_start.toFixed(3), n.loss_end.toFixed(3)], ['0.696', '0.003']);
  assert.deepEqual(n.h1, [0.03, 0.98, 0.98, 1]);                           // an OR
  assert.deepEqual(n.h2, [0, 0.05, 0.05, 0.93]);                           // an AND
  assert.deepEqual(n.y.map((v) => Math.round(v)), m.XOR);
  assert.throws(() => m.reduce('[1, 2]'), /nine numbers/);
  const spec = readJSON('xor-ridge', 'spec.json');
  const marks = spec.layers.filter((l) => l.type === 'marker');
  assert.equal(marks.length, 12);
  for (const mk of marks) {
    const k = m.GATE.findIndex(([a, b]) => a === mk.at[0] && b === mk.at[1]);
    assert.equal(mk.at[2], n[mk.in[0]][k], `${mk.in[0]} at ${mk.at}`);
  }
});

// ---- hours-columns: the numbers of Lecture 8, "Temperature and Humidity of Every Hour" -------------
test('hours-columns: every measured hour is in a cell, and r is the slide\'s', async () => {
  const m = await import('../explainers/hours-columns/make.mjs');
  const d = readJSON('hours-columns', 'data.json');
  const n = d.numbers;
  assert.deepEqual([n.hours, n.in_cells, n.outside], [87552, 87552, 0]);
  assert.equal(n.r.toFixed(2), '-0.70');
  assert.equal(n.mean_t.toFixed(2), '7.16');
  assert.equal(Math.max(...d.counts), n.tallest.count);
  const spec = readJSON('hours-columns', 'spec.json');
  const mark = spec.layers.find((l) => l.type === 'marker');
  assert.deepEqual(mark.at, [...n.tallest.at, n.tallest.count]);
  assert.ok(mark.label.startsWith(`${n.tallest.count} hours`));
  const r = m.reduce('time,temp_c,humidity_pct,wind_ms\n2016-01-01T00:00,-1.0,83,1\n2016-01-01T01:00,-999,90,1\n2016-01-01T02:00,33.9,100,1\n2016-01-01T03:00,-20,26,1\n');
  assert.deepEqual([r.hours, r.outside, r.counts[0], r.counts.at(-1), r.counts.reduce((a, b) => a + b, 0)], [3, 0, 1, 1, 3]);
});
