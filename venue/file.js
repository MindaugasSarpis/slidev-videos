// A venue build that opens from file://: double-click index.html, on any
// Windows or Mac, with nothing installed and no launcher for SmartScreen or
// Gatekeeper to refuse. `slidev-videos venue` turns it on (VIDEOS_VENUE_FILE=1,
// see vite.config.js). From file:// a browser
//   - runs an inline module script, but none it has to fetch: the code goes
//     into index.html, in one chunk (no dynamic imports to fetch either);
//   - loads a classic <script src> and plays a <video> or <audio> from a
//     sibling file, but fetch() and XHR refuse file:// URLs;
//   - taints the canvas and WebGL with any sibling image or video, and feeds
//     Web Audio silence from a sibling audio file. A blob the page made is its
//     own: readable, uploadable, audible.
// So public/ (but the clips) rides in venue-assets.js, a classic script beside
// index.html, and venueShim hands those files to fetch(), <img> and <audio> as
// blobs. Clips stay files: a <video> plays them from file:// as it is, and the
// player already treats a clip it cannot read as cross-origin (the dust takes
// its colours from the frame strips), as on the deployed site. Served over http
// (the RUN_ME.bat backup, a dev server) the shim does nothing.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, extname } from 'node:path';

export const SIDECAR = 'venue-assets.js';

const CLIPS = new Set(['.mp4', '.m4v', '.webm', '.mov', '.mkv', '.avi']);
const NOT_CARRIED = new Set(['.html', '.map', '.txt', '.md', '.command', '.bat', '.ps1']);
const TYPES = {
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.avif': 'image/avif', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.ktx2': 'image/ktx2', '.wasm': 'application/wasm',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.csv': 'text/csv', '.vtt': 'text/vtt',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav', '.flac': 'audio/flac',
};

// The type a built file rides in the sidecar with; null for what stays a file
// (a clip) or is not the page's to fetch (the pages, the sidecar itself,
// _redirects and other host files).
export function carriedType(rel) {
  const ext = extname(rel).toLowerCase();
  if (CLIPS.has(ext) || NOT_CARRIED.has(ext) || rel === SIDECAR || /^_[^/]*$/.test(rel) || rel.startsWith('videos-hq/')) return null;
  return TYPES[ext] || 'application/octet-stream';
}

// entries: { 'data/space.json': [type, Buffer] } → the sidecar's source
export function sidecarSource(entries) {
  const map = {};
  for (const [rel, [type, bytes]] of Object.entries(entries)) map[rel] = [type, Buffer.from(bytes).toString('base64')];
  return `window.__venueAssets = ${JSON.stringify(map)}\n`;
}

// Runs in the page, first thing in <head>, as `(venueShim)(window)`: it is
// serialised, so it uses nothing from this module.
export function venueShim(w) {
  if (w.location.protocol !== 'file:') return;
  const A = w.__venueAssets;
  if (!A) {
    // index.html opened from inside the zip (Windows' Explorer extracts the one
    // file to a temporary folder): no sidecar, and no clips either
    const show = () => {
      const d = w.document.createElement('div');
      Object.assign(d.style, { position: 'fixed', inset: '0', zIndex: '2147483647', background: '#111', color: '#eee', font: '22px/1.5 system-ui, sans-serif', padding: '12vh 12vw' });
      d.innerHTML = '<h1 style="font-size:1.6em;margin:0 0 1em">Extract the zip first</h1>'
        + '<p>This deck was opened from inside the zip, so its videos and data are not beside it.</p>'
        + '<p>Close this window. On Windows, right-click the zip and choose <b>Extract All</b>; on a Mac, double-click the zip. '
        + 'Then open <b>index.html</b> in the extracted folder.</p>';
      w.document.body.append(d);
    };
    if (w.document.readyState === 'loading') w.document.addEventListener('DOMContentLoaded', show);
    else show();
    return;
  }
  const here = new URL('.', w.location.href);
  const key = (u) => {
    try {
      const h = new URL(String(u), w.location.href);
      if (h.protocol !== 'file:' || !h.pathname.startsWith(here.pathname)) return null;
      const k = decodeURIComponent(h.pathname.slice(here.pathname.length));
      return Object.prototype.hasOwnProperty.call(A, k) ? k : null;
    } catch { return null; }
  };
  const bytes = (k) => {
    const s = w.atob(A[k][1]);
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  };
  const blobs = new Map();
  const blob = (k) => {
    if (!blobs.has(k)) blobs.set(k, w.URL.createObjectURL(new w.Blob([bytes(k)], { type: A[k][0] })));
    return blobs.get(k);
  };
  const fetch0 = w.fetch;
  w.fetch = function fetch(input, init) {
    const k = key(input && typeof input === 'object' && 'url' in input ? input.url : input);
    if (!k) return fetch0.apply(this, arguments);
    return Promise.resolve(new w.Response(bytes(k), { status: 200, headers: { 'content-type': A[k][0] } }));
  };
  const hook = (proto, from) => {
    const d = Object.getOwnPropertyDescriptor(from, 'src');
    Object.defineProperty(proto, 'src', {
      configurable: true, enumerable: d.enumerable, get: d.get,
      set(v) { const k = key(v); d.set.call(this, k ? blob(k) : v); },
    });
  };
  hook(w.HTMLImageElement.prototype, w.HTMLImageElement.prototype);
  // audio only: a clip stays the file it is
  hook(w.HTMLAudioElement.prototype, w.HTMLMediaElement.prototype);
  // new Audio(url) sets its src inside the constructor, past the setter
  const Audio0 = w.Audio;
  const Audio = function Audio(src) { const a = new Audio0(); if (src !== undefined) a.src = src; return a; };
  Audio.prototype = Audio0.prototype;
  w.Audio = Audio;
  w.__venueFile = { files: Object.keys(A).length };
}

// Slidev's index.html with the entry chunk and the stylesheet inlined; the
// sidecar and the shim go first in <head>. → { html, used: Set of inlined files }
export function inlineHtml(html, bundle) {
  const used = new Set();
  let out = html.replace(/<script\b[^>]*\bsrc="(?:\.?\/)?([^"]+\.js)"[^>]*><\/script>/g, (m, f) => {
    const c = bundle[f];
    if (!c || c.type !== 'chunk') return m;
    used.add(f);
    // __VITE_PRELOAD__: the dynamic-import preload list, filled in per chunk; with
    // one chunk there is none, and the bare marker would throw
    const code = c.code.replace(/__VITE_PRELOAD__/g, 'void 0').replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
    return `<script type="module">${code}</script>`;
  });
  out = out.replace(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="(?:\.?\/)?([^"]+\.css)"[^>]*>/g, (m, f) => {
    const c = bundle[f];
    if (!c) return m;
    used.add(f);
    return `<style>${String(c.source).replace(/<\/(style)/gi, '<\\/$1')}</style>`;
  });
  out = out.replace(/<link\b[^>]*\brel="modulepreload"[^>]*>\n?/g, '');
  out = out.replace(/<head\b[^>]*>/, (h) => `${h}\n<script src="${SIDECAR}"></script>\n<script>(${venueShim})(window)</script>`);
  return { html: out, used };
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

export function venueFile() {
  let outDir = null;
  return {
    name: 'slidev-addon-videos:venue-file',
    apply: 'build',
    enforce: 'post',
    config: () => ({
      base: './',
      build: { assetsInlineLimit: () => true, cssCodeSplit: false, modulePreload: false },
    }),
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
      // Slidev splits vendor chunks (manualChunks); one chunk wants none. Rolldown
      // (Vite 8) says so with codeSplitting, Rollup (Vite 7: the talks' Slidev
      // 52.14) with inlineDynamicImports
      const rolldown = 'rolldownOptions' in c.build;
      const key = rolldown ? 'rolldownOptions' : 'rollupOptions';
      const ro = c.build[key] || (c.build[key] = {});
      const outs = [].concat(ro.output || (ro.output = {}));
      for (const o of outs) {
        delete o.manualChunks; delete o.advancedChunks;
        if (rolldown) o.codeSplitting = false;
        else o.inlineDynamicImports = true;
      }
    },
    generateBundle(_, bundle) {
      for (const file of Object.values(bundle)) {
        if (!file.fileName.endsWith('.html')) continue;
        const { html, used } = inlineHtml(String(file.source), bundle);
        file.source = html;
        for (const f of used) delete bundle[f];
      }
    },
    // after the write (Vite has copied public/ by then); not closeBundle, which
    // Rollup also calls on a failed build, where it would hide the error
    writeBundle(opts) {
      const dir = opts?.dir || outDir;
      if (!dir) return;
      const entries = {};
      let raw = 0;
      for (const p of walk(dir)) {
        const rel = relative(dir, p).split('\\').join('/');
        const type = carriedType(rel);
        if (!type) continue;
        const b = readFileSync(p);
        raw += b.length;
        entries[rel] = [type, b];
      }
      writeFileSync(join(dir, SIDECAR), sidecarSource(entries));
      console.log(`venue: index.html opens from file://; ${Object.keys(entries).length} public files (${(raw / 1e6).toFixed(1)} MB) ride in ${SIDECAR}`);
    },
  };
}
