// Data files the stage's plugins use by name, kept out of the package: they live
// on a release of slidev-videos, are fetched at dev and build time (under Node: a
// browser cannot fetch a release asset, which sends no CORS header), checked
// against the sha256 pinned here, cached, and served or emitted at stage-data/.
// A build's output (the Pages site, `build:portable`'s venue zip) carries them.
//
//   src: lhcb        → stage-data/lhcb-grains.bin        (+ its NOTICE)
//   src: lhcb-dense  → stage-data/lhcb-grains-dense.bin  (+ its NOTICE)
//
// The cache: $SLIDEV_STAGE_CACHE, else $XDG_CACHE_HOME/slidev-addon-stage, else
// ~/.cache/slidev-addon-stage. Warm once (any build or dev run that uses them),
// it serves offline. A file that cannot be fetched or does not match fails the
// build, naming the file and the cache: never a silent empty form.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const RELEASE = 'https://github.com/MindaugasSarpis/slidev-videos/releases/download';
export const FILES = {
  'lhcb-grains.bin': { release: 'geometry-lhcb', size: 744000, sha256: 'd816eaf6af4c2b44348da5fb0f1b7a26485e491572e03bd2523ee483588bf490' },
  'lhcb-grains-dense.bin': { release: 'geometry-lhcb', size: 3571200, sha256: 'a2c895bfa102bea9ff82315fd79f11f4667e81f9510bf4c04d1640ebfdb52df9' },
  'lhcb-grains.NOTICE.txt': { release: 'geometry-lhcb', size: 948, sha256: '73407e0b426ee9c12ccd013c4dbfdc0e2e2f5db6d086a0b01bae4bb1f28e3b49' },
};
// a name a deck writes → the files it brings (the data, then its notice)
export const NAMES = {
  lhcb: ['lhcb-grains.bin', 'lhcb-grains.NOTICE.txt'],
  'lhcb-dense': ['lhcb-grains-dense.bin', 'lhcb-grains.NOTICE.txt'],
};

export const cacheDir = (env = process.env) =>
  env.SLIDEV_STAGE_CACHE || join(env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'slidev-addon-stage');

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

// The names a deck uses: `src: lhcb` / `"src": "lhcb-dense"` in its markdown or in
// the JSON under public/ (its space.json), two levels deep at most.
export function usedNames(root) {
  const found = new Set();
  const re = /["']?src["']?\s*:\s*["']?(lhcb(?:-dense)?)["']?\s*[,}\n\r]/g;
  const scan = (text) => { for (const m of text.matchAll(re)) found.add(m[1]); };
  const walk = (dir, depth) => {
    let names = [];
    try { names = readdirSync(dir); } catch { return; }
    for (const n of names) {
      if (n === 'node_modules' || n.startsWith('.')) continue;
      const p = join(dir, n);
      let st; try { st = statSync(p); } catch { continue; }
      if (st.isDirectory()) { if (depth > 0) walk(p, depth - 1); }
      else if (/\.json$/.test(n) && st.size < 5e6) scan(readFileSync(p, 'utf8'));
    }
  };
  for (const n of (() => { try { return readdirSync(root); } catch { return []; } })()) if (/\.md$/.test(n)) scan(readFileSync(join(root, n), 'utf8'));
  walk(join(root, 'public'), 2);
  return [...found].sort();
}
export const filesFor = (names) => [...new Set(names.flatMap((n) => NAMES[n] || []))];

// The file's bytes from the cache, fetching it first if need be. Throws a clear error.
export async function ensure(file, { dir = cacheDir(), fetchImpl = globalThis.fetch, base = RELEASE, tries = 2 } = {}) {
  const meta = FILES[file];
  if (!meta) throw new Error(`slidev-addon-stage: no data file named ${file}`);
  const path = join(dir, `${meta.sha256.slice(0, 16)}-${file}`);
  if (existsSync(path)) {
    const buf = readFileSync(path);
    if (sha(buf) === meta.sha256) return buf;
  }
  const url = `${base}/${meta.release}/${file}`;
  let why = '';
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(120000) });
      if (!r.ok) { why = `HTTP ${r.status}`; continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      const got = sha(buf);
      if (got !== meta.sha256) { why = `sha256 ${got.slice(0, 12)}…, pinned ${meta.sha256.slice(0, 12)}…`; continue; }
      mkdirSync(dir, { recursive: true });
      writeFileSync(path + '.part', buf); renameSync(path + '.part', path);
      return buf;
    } catch (e) { why = e?.message || String(e); }
  }
  throw new Error(`slidev-addon-stage: could not get ${file} (${why}) from ${url}. ` +
    `The deck uses it (src: ${Object.keys(NAMES).find((n) => NAMES[n].includes(file)) || file}). ` +
    `The cache is ${dir}: run a build once with the network on, or put the file there as ${meta.sha256.slice(0, 16)}-${file}.`);
}

// The vite plugin: fetch what the deck uses before the build starts; serve it in dev;
// emit it into the build at stage-data/.
export function stageData() {
  let root = process.cwd(), base = '/', files = [], bytes = new Map();
  const load = async () => {
    files = filesFor(usedNames(root));
    for (const f of files) if (!bytes.has(f)) bytes.set(f, await ensure(f));
  };
  return {
    name: 'slidev-addon-stage:data',
    configResolved(c) { root = c.root || root; base = c.base || '/'; },
    async buildStart() { await load(); },
    configureServer(server) {
      const prefix = (base.endsWith('/') ? base : base + '/') + 'stage-data/';
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url || '').split('?')[0];
        if (!url.startsWith(prefix) && !url.startsWith('/stage-data/')) return next();
        const f = decodeURIComponent(url.slice(url.lastIndexOf('/') + 1));
        if (!FILES[f]) return next();
        try {
          const buf = bytes.get(f) || await ensure(f);
          bytes.set(f, buf);
          res.setHeader('Content-Type', f.endsWith('.txt') ? 'text/plain; charset=utf-8' : 'application/octet-stream');
          res.end(buf);
        } catch (e) { res.statusCode = 502; res.end(String(e.message || e)); server.config.logger.error(String(e.message || e)); }
      });
    },
    generateBundle() {
      for (const f of files) this.emitFile({ type: 'asset', fileName: `stage-data/${f}`, source: bytes.get(f) });
    },
  };
}
