// Serving a built deck to a headless browser, for the recorder and the safe
// check: a static server that falls back to index.html (the deck is a
// single-page app), answers media in byte ranges, and can serve the deck
// under the base it was built for (`slidev build --base /talks/x/`), so a
// Pages build loads as it does on the web.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.mp4': 'video/mp4', '.webm': 'video/webm', '.ico': 'image/x-icon',
};

// The base a deck was built for, read from the asset paths in its index.html:
// '/' for `--base /`, '/talks/x/' for a Pages build.
export function detectBase(dist) {
  let html = '';
  try { html = readFileSync(join(dist, 'index.html'), 'utf8'); } catch { return '/'; }
  const m = /(?:src|href)="(\/[^"]*?)assets\//.exec(html);
  return m ? m[1] : '/';
}

// '/x' | 'x/' | 'auto' → '/x/'
export function normaliseBase(base, dist) {
  if (!base || base === 'auto') return detectBase(dist);
  return `/${String(base).replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/');
}

// serve(dist, { base }) → { server, port, url, misses }: `url` is the deck's
// root; `misses` collects requests that fell through to index.html although
// they named a file (an asset the build expects and the dist lacks).
export function serve(dist, { base = '/' } = {}) {
  if (!existsSync(join(dist, 'index.html'))) return Promise.reject(new Error(`${dist}: no index.html (build the deck first)`));
  const misses = [];
  const server = createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (base !== '/' && p.startsWith(base)) p = '/' + p.slice(base.length);
    if (p.endsWith('/')) p += 'index.html';
    try {
      if (!(await stat(join(dist, p))).isFile()) p = '/index.html';
    } catch {
      if (extname(p)) misses.push(p);
      p = '/index.html';
    }
    try {
      const body = await readFile(join(dist, p));
      const type = MIME[extname(p)] || 'application/octet-stream';
      const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (m) {
        const start = m[1] ? Number(m[1]) : 0;
        const end = m[2] ? Math.min(Number(m[2]), body.length - 1) : body.length - 1;
        res.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${body.length}`, 'content-length': end - start + 1 });
        res.end(body.subarray(start, end + 1));
        return;
      }
      res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': body.length });
      res.end(body);
    } catch { res.writeHead(404); res.end('not found'); }
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    ok({ server, port, url: `http://127.0.0.1:${port}${base}`, misses });
  }));
}

// "1-3,7" → [1, 2, 3, 7]
export function parseSlides(spec, total) {
  if (!spec) return Array.from({ length: total }, (_, i) => i + 1);
  const out = new Set();
  for (const part of String(spec).split(',')) {
    const m = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part);
    if (!m) continue;
    const a = Number(m[1]), b = Number(m[2] || m[1]);
    for (let n = Math.min(a, b); n <= Math.max(a, b); n++) if (n >= 1 && n <= total) out.add(n);
  }
  return [...out].sort((x, y) => x - y);
}

// --slides as typed: slides and ranges, "2-5,8". A part that is neither, or a
// list with no slide in it, is a usage error, not a run that does nothing.
export function checkSlides(spec) {
  const s = String(spec ?? '');
  const ok = s.split(',').every((part) => /^\s*\d+\s*(?:-\s*\d+\s*)?$/.test(part)) && parseSlides(s, 500).length > 0;
  if (!ok) throw new Error(`--slides wants slides and ranges from 1 to 500, e.g. 2-5,8 (got ${spec})`);
  return s;
}

// '1920x1080' → [1920, 1080]
export function parseSize(spec) {
  const m = /^(\d+)x(\d+)$/.exec(String(spec || ''));
  if (!m) throw new Error(`--size wants WxH, e.g. 1920x1080 (got ${spec})`);
  return [Number(m[1]), Number(m[2])];
}

// How many slides a built deck has. A build does not say, and Slidev mounts
// only the slides near the current one: step through until a slide does not
// appear. `page` is open on the deck, without a fake clock.
export async function countSlides(page, { max = 500 } = {}) {
  let n = 0;
  for (let k = 1; k <= max; k++) {
    await page.evaluate((k) => { location.hash = `#/${k}`; }, k);
    const there = await page.waitForSelector(`.slidev-page[data-slidev-no="${k}"]`, { state: 'attached', timeout: 4000 }).then(() => true, () => false);
    const on = there && await page.evaluate((k) => Number((/^#\/(\d+)/.exec(location.hash) || [])[1]) === k, k);
    if (!on) break;
    n = k;
  }
  return n;
}
