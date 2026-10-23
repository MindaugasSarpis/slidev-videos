// A venue zip opens by double-clicking index.html: no server, no Python, no
// launcher for Gatekeeper or SmartScreen to refuse. From file:// a browser runs
// no module script it has to fetch, fetch() nothing, and taints the canvas and
// WebGL with any sibling image or video. So the venue build (VIDEOS_VENUE_FILE=1)
// inlines the code into index.html, carries public/ (but the clips) in a classic
// script beside it, and a shim hands those files to fetch(), <img> and <audio>
// as blobs the page made itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inlineHtml, carriedType, venueShim, sidecarSource, venueFile, SIDECAR } from '../venue/file.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<script type="module" crossorigin src="./assets/index-abc.js"></script>
<link rel="modulepreload" crossorigin href="./assets/modules/vue-x.js">
<link rel="stylesheet" crossorigin href="./assets/index-def.css">
</head>
<body><div id="app"></div></body>
</html>`;

test('the code and the styles go into index.html, the sidecar and the shim first', () => {
  const bundle = {
    'assets/index-abc.js': { type: 'chunk', code: 'const a = __VITE_PRELOAD__; const s = "</script>"; console.log(a, s)' },
    'assets/index-def.css': { type: 'asset', source: 'body{color:red}' },
  };
  const { html, used } = inlineHtml(HTML, bundle);
  assert.deepEqual([...used].sort(), ['assets/index-abc.js', 'assets/index-def.css']);
  assert.doesNotMatch(html, /src="\.\/assets|href="\.\/assets|modulepreload/);
  assert.match(html, /<style>body\{color:red\}<\/style>/);
  // a module script inline runs from file://; one fetched by src does not
  const mod = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  assert.ok(mod, 'one inline module script');
  assert.doesNotMatch(mod[1], /__VITE_PRELOAD__/);           // no chunks to preload: the marker would throw
  assert.match(mod[1], /"<\\\/script>"/);                     // a closing tag in the code does not end the element
  // the sidecar (a classic script: file:// loads those) and the shim run before the deck
  const side = html.indexOf(`<script src="${SIDECAR}"></script>`);
  const shim = html.indexOf('<script>(');
  assert.ok(side > 0 && shim > side && html.indexOf('<script type="module">') > shim);
});

test('the sidecar carries public/ but the clips, the pages and the build', () => {
  for (const [rel, type] of [
    ['data/space.json', 'application/json'], ['stills/05.jpg', 'image/jpeg'], ['figures/a b.png', 'image/png'],
    ['video-frames/index.json', 'application/json'], ['data/lhcb-mesh.glb', 'model/gltf-binary'],
    ['data/grains.bin', 'application/octet-stream'], ['audio/drone.mp3', 'audio/mpeg'], ['audio/x.m4a', 'audio/mp4'],
  ]) assert.equal(carriedType(rel), type, rel);
  // clips stay files (a <video> plays them from file://, and they are most of the zip)
  for (const rel of ['videos/close.mp4', 'videos/a.webm', 'videos/b.mov', 'videos-hq/c.mp4'])
    assert.equal(carriedType(rel), null, rel);
  for (const rel of ['index.html', '404.html', '_redirects', SIDECAR, 'RUN_ME.txt', 'assets/x.js.map'])
    assert.equal(carriedType(rel), null, rel);
});

test('the sidecar is a classic script that sets the asset map', () => {
  const src = sidecarSource({ 'data/a.json': ['application/json', Buffer.from('{"x":1}')] });
  const w = {};
  new Function('window', src)(w);
  assert.deepEqual(w.__venueAssets, { 'data/a.json': ['application/json', Buffer.from('{"x":1}').toString('base64')] });
});

// a window just big enough for the shim
function fakeWindow(href, assets) {
  const made = [];
  class Img { set src(v) { this._src = v; } get src() { return this._src; } }
  class Media { set src(v) { this._src = v; } get src() { return this._src; } }
  class AudioEl extends Media {}
  const w = {
    location: new URL(href), __venueAssets: assets,
    fetch: async (u) => ({ passedThrough: String(u) }),
    HTMLImageElement: Img, HTMLMediaElement: Media, HTMLAudioElement: AudioEl,
    Audio: function Audio(src) { const a = new AudioEl(); if (src !== undefined) a._src = src; a.viaConstructorOnly = true; return a; },
    URL: { createObjectURL: (b) => { made.push(b); return `blob:null/${made.length}`; } },
    Blob, Response, atob,
    document: { readyState: 'loading', addEventListener: (e, f) => { w._dcl = f; }, body: { kids: [], append(k) { this.kids.push(k); } }, createElement: () => ({ style: {}, set innerHTML(v) { this.html = v; } }) },
  };
  w.Audio.prototype = AudioEl.prototype;
  return { w, made };
}
const ASSETS = {
  'data/space.json': ['application/json', Buffer.from('{"ok":true}').toString('base64')],
  'stills/01.jpg': ['image/jpeg', Buffer.from('JPEG').toString('base64')],
  'my figures/ä.png': ['image/png', Buffer.from('PNG').toString('base64')],
  'audio/drone.mp3': ['audio/mpeg', Buffer.from('MP3').toString('base64')],
};
const DECK = 'file:///C:/Users/Some%20One/Downloads/talk-venue/index.html#/3';

test('on file://, fetch() of a carried file answers from the sidecar; anything else goes through', async () => {
  const { w } = fakeWindow(DECK, ASSETS);
  venueShim(w);
  const r = await w.fetch('./data/space.json');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/json');
  assert.deepEqual(await r.json(), { ok: true });
  assert.deepEqual(await (await w.fetch(new URL('data/space.json', w.location.href))).json(), { ok: true });
  assert.deepEqual(await w.fetch('https://github.com/o/r/releases/download/v/a.mp4'), { passedThrough: 'https://github.com/o/r/releases/download/v/a.mp4' });
  assert.deepEqual(await w.fetch('./data/missing.json'), { passedThrough: './data/missing.json' });
  // outside the deck's folder: not ours, even with the same name
  assert.deepEqual(await w.fetch('file:///C:/data/space.json'), { passedThrough: 'file:///C:/data/space.json' });
});

test('on file://, an <img> or <audio> of a carried file gets a blob the page made (readable pixels, audible Web Audio)', () => {
  const { w, made } = fakeWindow(DECK, ASSETS);
  venueShim(w);
  const img = new w.HTMLImageElement();
  img.src = './stills/01.jpg';
  assert.match(img.src, /^blob:/);
  const again = new w.HTMLImageElement();
  again.src = 'stills/01.jpg';
  assert.equal(again.src, img.src, 'one blob per file');
  const fig = new w.HTMLImageElement();
  fig.src = 'my%20figures/%C3%A4.png';                       // percent-encoded, as a URL comes
  assert.match(fig.src, /^blob:/);
  const other = new w.HTMLImageElement();
  other.src = 'https://example.org/x.png';
  assert.equal(other.src, 'https://example.org/x.png');
  // new Audio(url) sets src in the constructor, past the setter: it is wrapped
  const a = new w.Audio('audio/drone.mp3');
  assert.match(a.src, /^blob:/);
  assert.ok(a instanceof w.HTMLAudioElement);
  const el = new w.HTMLAudioElement();
  el.src = './audio/drone.mp3';
  assert.match(el.src, /^blob:/);
  assert.equal(made.length, 3);
  assert.equal(made[0].type, 'image/jpeg');
});

test('served over http (the .bat backup, a dev server, Pages) the shim does nothing', async () => {
  const { w } = fakeWindow('http://127.0.0.1:8000/#/3', ASSETS);
  const fetch0 = w.fetch, Audio0 = w.Audio;
  venueShim(w);
  assert.equal(w.fetch, fetch0);
  assert.equal(w.Audio, Audio0);
  const img = new w.HTMLImageElement();
  img.src = 'stills/01.jpg';
  assert.equal(img.src, 'stills/01.jpg');
});

test('opened inside the zip (index.html alone, no sidecar beside it): a page says to extract it first', () => {
  const { w } = fakeWindow(DECK, undefined);
  venueShim(w);
  assert.equal(typeof w._dcl, 'function');
  w._dcl();
  const [note] = w.document.body.kids;
  assert.ok(note, 'a note is shown');
  assert.match(note.html, /Extract All/);
  assert.match(note.html, /index\.html/);
  assert.equal(note.style.position, 'fixed');
});

test('the venue plugin: one file, relative paths, no code splitting', () => {
  const p = venueFile();
  const cfg = p.config();
  assert.equal(cfg.base, './');
  assert.equal(cfg.build.cssCodeSplit, false);
  assert.equal(cfg.build.modulePreload, false);
  assert.equal(cfg.build.assetsInlineLimit('x.woff2', Buffer.alloc(1)), true);   // fonts and imported images go inline
});

test('one chunk under Rollup (Vite 7, the talks\' Slidev 52.14) and under Rolldown (Vite 8)', () => {
  // Slidev splits vendor chunks (manualChunks); one chunk wants none, and each
  // bundler names "no splitting" its own way
  const rollup = { root: '/deck', build: { outDir: 'dist-portable', rollupOptions: { output: { manualChunks: () => 'x' } } } };
  venueFile().configResolved(rollup);
  assert.equal(rollup.build.rollupOptions.output.manualChunks, undefined);
  assert.equal(rollup.build.rollupOptions.output.inlineDynamicImports, true);
  assert.equal('codeSplitting' in rollup.build.rollupOptions.output, false);   // Rollup does not know it
  const opts = { output: { manualChunks: () => 'x' } };
  const rolldown = { root: '/deck', build: { outDir: 'dist-portable', rollupOptions: opts, rolldownOptions: opts } };
  venueFile().configResolved(rolldown);
  assert.equal(rolldown.build.rolldownOptions.output.manualChunks, undefined);
  assert.equal(rolldown.build.rolldownOptions.output.codeSplitting, false);
  // with manualChunks gone Rolldown takes inlineDynamicImports too, but warns it away
  assert.equal('inlineDynamicImports' in rolldown.build.rolldownOptions.output, false);
});

test('the addon turns the plugin on only for a venue build', () => {
  const src = read('../vite.config.js');
  assert.match(src, /process\.env\.VIDEOS_VENUE_FILE === '1'/);
  assert.match(src, /import \{ venueFile \} from '\.\/venue\/file\.js'/);
  const pkg = JSON.parse(read('../package.json'));
  for (const f of ['vite.config.js', 'venue']) assert.ok(pkg.files.includes(f), `package.json files: ${f}`);
});
