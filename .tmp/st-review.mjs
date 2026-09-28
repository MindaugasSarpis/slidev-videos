// st-review.mjs <dist> <out> <spec.json>: crops of every .ol on the listed slides, then settled
// frames (visit `from`, then `to`, then `clicks`), with optional element crops per frame.
import { createServer } from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { chromium } from 'playwright-chromium';
const [DIST, OUT, SPEC] = process.argv.slice(2);
const spec = JSON.parse(await readFile(SPEC, 'utf8'));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };
const srv = createServer(async (req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html'; try { await stat(join(DIST, p)); } catch { p = '/index.html'; } res.setHeader('Content-Type', MIME[extname(p)] || 'application/octet-stream'); res.end(await readFile(join(DIST, p))); }).listen(8777);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
const go = async (n, wait) => { await page.evaluate((n) => { location.hash = '#/' + n; }, n); await page.waitForTimeout(wait); };
await page.goto('http://localhost:8777/#/1'); await page.waitForTimeout(3000);
const crops = [];
for (const n of spec.ol || []) {
  await go(n, 2500);
  const rects = await page.evaluate((n) => [...document.querySelectorAll(`.slidev-page[data-slidev-no="${n}"] .ol`)].map((e) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; }), n);
  let i = 0;
  for (const r of rects) {
    if (!r.w) continue;
    const x = Math.max(0, r.x - 170), y = Math.max(0, r.y - 22);
    const path = `${OUT}/ol-${String(n).padStart(2, '0')}-${i++}.png`;
    await page.screenshot({ path, clip: { x, y, width: Math.min(1600 - x, r.w + 340), height: Math.min(900 - y, r.h + 44) } });
    crops.push(path);
  }
}
for (const s of spec.shots || []) {
  if (s.from) await go(s.from, s.fromWait || 7000);
  await go(s.to, s.wait || 10000);
  for (let c = 0; c < (s.clicks || 0); c++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(s.clickWait || 12000); }
  await page.screenshot({ path: `${OUT}/${s.name}.png` });
  const ov = await page.evaluate((n) => { const lay = document.querySelector(`.slidev-page[data-slidev-no="${n}"] .slidev-layout`); if (!lay) return null; const rb = lay.getBoundingClientRect(); let mb = 0; for (const el of lay.querySelectorAll('*')) { if (el.closest('.src')) continue; const b = el.getBoundingClientRect(); if (b.width > 0 && b.height > 0) mb = Math.max(mb, b.bottom); } const src = lay.querySelector('.src'); return { overflowPx: Math.round(mb - rb.bottom), gapToSrcPx: src ? Math.round(src.getBoundingClientRect().top - mb) : null }; }, s.to);
  console.log(s.name, JSON.stringify(ov));
  for (const sel of s.crops || []) {
    let i = 0;
    for (const el of await page.$$(sel)) {
      const b = await el.boundingBox(); if (!b || !b.width) continue;
      const path = `${OUT}/${s.name}-crop${i++}-${sel.replace(/[^a-z]/gi, '')}.png`;
      await page.screenshot({ path, clip: { x: b.x, y: b.y, width: b.width, height: b.height } }); crops.push(path);
    }
  }
}
await writeFile(`${OUT}/crops.json`, JSON.stringify(crops));
console.log(JSON.stringify({ crops: crops.length, errors }));
await browser.close(); srv.close();
