// Per-slide stills for print and the fallback (stage/stills.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stillsDir, stillUrl, stillName, inPrint, rangeList } from '../stage/stills.js';

test('stills live under public/stills by default, a deck may move or turn them off', () => {
  assert.equal(stillsDir(undefined), 'stills');
  assert.equal(stillsDir('figures/stills/'), 'figures/stills');
  assert.equal(stillsDir(false), '');
  assert.equal(stillUrl('stills', 3, '/'), '/stills/03.jpg');
  assert.equal(stillUrl('stills', 12, '/cern_outreach_talks/2026_10_00_Innoday'), '/cern_outreach_talks/2026_10_00_Innoday/stills/12.jpg');
  assert.equal(stillUrl('stills', 104, '/'), '/stills/104.jpg');
  assert.equal(stillUrl('', 3, '/'), '');
  assert.equal(stillName(7), '07.jpg');
});

test('a print page is known by its container, html.print or ?print', () => {
  const doc = (print) => ({ documentElement: { classList: { contains: (c) => print && c === 'print' } } });
  assert.equal(inPrint({ closest: (s) => (s === '.print-slide-container' ? {} : null) }, { search: '' }, doc(false)), true);
  assert.equal(inPrint(null, { search: '' }, doc(true)), true);
  assert.equal(inPrint(null, { search: '?print=true&range=2-3' }, doc(false)), true);
  assert.equal(inPrint({ closest: () => null }, { search: '?stage-debug' }, doc(false)), false);
});

test('--range reads as Slidev reads it', () => {
  assert.deepEqual(rangeList('2-4', 6), [2, 3, 4]);
  assert.deepEqual(rangeList('1,4,6-9', 7), [1, 4, 6, 7]);
  assert.deepEqual(rangeList('5-', 7), [5, 6, 7]);
  assert.deepEqual(rangeList('all', 3), [1, 2, 3]);
  assert.deepEqual(rangeList('', 2), [1, 2]);
  assert.deepEqual(rangeList('x', 5), []);
});

test('--stills takes one frame of the world per slide', async () => {
  const { parseArgs } = await import('../bin/shots.mjs');
  const o = parseArgs(['dist', 'public/stills', '--stills', '--clicks', 'all', '--burst', '3']);
  assert.equal(o.stills, true);
  assert.equal(o.clicks, 'none');
  assert.equal(o.burst, 1);
  assert.equal(o.halo, false);
  assert.deepEqual(o.errors, []);
});
