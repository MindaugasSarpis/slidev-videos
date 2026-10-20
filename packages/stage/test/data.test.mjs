// stage/data.mjs: which data a deck uses, the pinned fetch and its cache, the
// clear failure. The network is faked; no file is fetched for real here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FILES, NAMES, usedNames, filesFor, ensure, cacheDir, stageData } from '../stage/data.mjs';
import { DATA } from '../stage/plugins/lhcb.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'stage-data-'));

test('every name the plugin knows is a pinned file, with its notice', () => {
  for (const [name, path] of Object.entries(DATA)) {
    const files = NAMES[name];
    assert.ok(files, name);
    assert.equal(`stage-data/${files[0]}`, path);
    assert.ok(files.some((f) => /NOTICE/.test(f)), `${name} carries its notice`);
    for (const f of files) assert.match(FILES[f].sha256, /^[0-9a-f]{64}$/);
  }
});

test('usedNames finds src: lhcb in space.json and the deck, nothing else', () => {
  const root = tmp();
  mkdirSync(join(root, 'public', 'data'), { recursive: true });
  writeFileSync(join(root, 'public', 'data', 'space.json'), JSON.stringify({ stations: [{ objects: [{ type: 'detector', src: 'lhcb-dense' }, { type: 'page', src: 'figures/lhcb.png' }] }] }));
  writeFileSync(join(root, 'deck.md'), '---\nstage: {}\n---\n\n<!-- src: lhcbx -->\n');
  assert.deepEqual(usedNames(root), ['lhcb-dense']);
  writeFileSync(join(root, 'deck.md'), "---\n---\n\nspace:\n  objects: [{ type: detector, src: lhcb }]\n");
  assert.deepEqual(usedNames(root), ['lhcb', 'lhcb-dense']);
  assert.deepEqual(filesFor(usedNames(root)), ['lhcb-grains.bin', 'lhcb-grains.NOTICE.txt', 'lhcb-grains-dense.bin']);
  assert.deepEqual(usedNames(tmp()), []);
});

function fakeFile(name, bytes) {
  const saved = FILES[name];
  FILES[name] = { release: 'test', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  return () => { FILES[name] = saved; };
}

test('ensure fetches once, checks the sha, then serves from the cache offline', async () => {
  const dir = tmp(), bytes = Buffer.from('grains'), restore = fakeFile('lhcb-grains.bin', bytes);
  let calls = 0;
  const ok = async (url) => { calls++; assert.match(url, /\/test\/lhcb-grains\.bin$/); return new Response(bytes); };
  try {
    assert.deepEqual(await ensure('lhcb-grains.bin', { dir, fetchImpl: ok }), bytes);
    const offline = async () => { calls++; throw new Error('getaddrinfo ENOTFOUND github.com'); };
    assert.deepEqual(await ensure('lhcb-grains.bin', { dir, fetchImpl: offline }), bytes);   // the warm cache
    assert.equal(calls, 1);
    assert.equal(readdirSync(dir).length, 1);
  } finally { restore(); }
});

test('a missing network or a changed file fails, naming the file and the cache', async () => {
  const dir = tmp(), restore = fakeFile('lhcb-grains.bin', Buffer.from('grains'));
  try {
    await assert.rejects(ensure('lhcb-grains.bin', { dir, fetchImpl: async () => { throw new Error('ENOTFOUND'); } }),
      (e) => /lhcb-grains\.bin/.test(e.message) && e.message.includes(dir) && /ENOTFOUND/.test(e.message) && /src: lhcb/.test(e.message));
    await assert.rejects(ensure('lhcb-grains.bin', { dir, fetchImpl: async () => new Response('other bytes') }), /sha256/);
    await assert.rejects(ensure('lhcb-grains.bin', { dir, fetchImpl: async () => new Response('', { status: 404 }) }), /HTTP 404/);
    assert.equal(readdirSync(dir).length, 0);   // nothing half-written left behind
  } finally { restore(); }
});

test('the cache dir follows the environment', () => {
  assert.equal(cacheDir({ SLIDEV_STAGE_CACHE: '/x/y' }), '/x/y');
  assert.equal(cacheDir({ XDG_CACHE_HOME: '/c' }), '/c/slidev-addon-stage');
});

test('a deck that uses no data builds without any fetch', async () => {
  const p = stageData();
  p.configResolved({ root: tmp(), base: '/' });
  await p.buildStart();     // no network touched: nothing to fetch
  const emitted = [];
  p.generateBundle.call({ emitFile: (f) => emitted.push(f) });
  assert.deepEqual(emitted, []);
});
