// Screenshot every slide (and each click of stop slides) of a built Slidev deck; report overflow.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { chromium } from 'playwright-chromium';
const [DIST, OUT, TOTAL] = process.argv.slice(2);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };
const srv = createServer(async (req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html'; try { await stat(join(DIST, p)); } catch { p = '/index.html'; } res.setHeader('Content-Type', MIME[extname(p)] || 'application/octet-stream'); res.end(await readFile(join(DIST, p))); }).listen(8769);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message.slice(0, 160)));
await page.goto('http://localhost:8769/#/1'); await page.waitForTimeout(3000);
const clicksOf = JSON.parse(process.env.CLICKS || '{}');
const report = [];
for (let n = 1; n <= Number(TOTAL); n++) {
  await page.evaluate((n) => { location.hash = '#/' + n }, n);
  await page.waitForTimeout(Number(process.env.SLIDE_WAIT || 4200));
  const shot = async (suffix) => {
    const info = await page.evaluate((n) => {
      const pg = document.querySelector(`.slidev-page[data-slidev-no="${n}"]`); const lay = pg?.querySelector('.slidev-layout');
      const at = document.querySelector('.hadron-space')?.dataset.spaceAt;
      if (!lay) return { at, overflow: null };
      const r = lay.getBoundingClientRect(); let maxBottom = 0;
      for (const el of lay.querySelectorAll('*')) { const b = el.getBoundingClientRect(); if (b.height > 0 && b.width > 0) maxBottom = Math.max(maxBottom, b.bottom); }
      return { at, overflowPx: Math.round(maxBottom - r.bottom), textChars: lay.innerText.length };
    }, n);
    const name = `${String(n).padStart(2, '0')}${suffix}`;
    await page.screenshot({ path: `${OUT}/${name}.png` });
    report.push({ slide: n, frame: name, ...info });
  };
  await shot('');
  for (let c = 1; c <= (clicksOf[n] || 0); c++) { await page.keyboard.press('ArrowRight'); await page.waitForTimeout(Number(process.env.CLICK_WAIT || 9000)); await shot(`-c${c}`); }
}
console.log(JSON.stringify({ report, errors: errors.slice(0, 5) }, null, 0));
await browser.close(); srv.close();
