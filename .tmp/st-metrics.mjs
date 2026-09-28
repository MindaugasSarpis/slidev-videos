// Measure Space Grotesk (and the Greek fallback) in the built deck: font ascent/descent and glyph tops, in em.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { chromium } from 'playwright-chromium';
const DIST = process.argv[2];
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };
const srv = createServer(async (req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html'; try { await stat(join(DIST, p)); } catch { p = '/index.html'; } res.setHeader('Content-Type', MIME[extname(p)] || 'application/octet-stream'); res.end(await readFile(join(DIST, p))); }).listen(8776);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto('http://localhost:8776/#/15'); await page.waitForTimeout(4000);
const r = await page.evaluate(async () => {
  await document.fonts.ready;
  const c = document.createElement('canvas').getContext('2d');
  c.font = '400 100px "Space Grotesk", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const mm = (s) => { const m = c.measureText(s); return { A: +(m.fontBoundingBoxAscent / 100).toFixed(3), D: +(m.fontBoundingBoxDescent / 100).toFixed(3), top: +(m.actualBoundingBoxAscent / 100).toFixed(3), w: +(m.width / 100).toFixed(3) }; };
  const cap = document.querySelector('.slidev-page[data-slidev-no="15"] .caption');
  const ol = document.querySelector('.slidev-page[data-slidev-no="15"] .ol');
  const scale = (() => { const l = document.querySelector('.slidev-page[data-slidev-no="15"] .slidev-layout'); return l.getBoundingClientRect().width / l.offsetWidth; })();
  return { loaded: document.fonts.check('16px "Space Grotesk"'), p: mm('p'), x: mm('x'), H: mm('H'), Lambda: mm('Λ'), captionFont: cap && getComputedStyle(cap).fontFamily, olSpan: ol && { heightEm: +(ol.getBoundingClientRect().height / scale / parseFloat(getComputedStyle(ol).fontSize)).toFixed(3) } };
});
console.log(JSON.stringify(r, null, 1));
await browser.close(); srv.close();
