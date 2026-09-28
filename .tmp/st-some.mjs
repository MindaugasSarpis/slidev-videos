// Screenshot a chosen list of slides (no clicks) of a built Slidev deck: st-some.mjs <dist> <out> 2,3,6
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { chromium } from 'playwright-chromium';
const [DIST, OUT, LIST] = process.argv.slice(2);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };
const srv = createServer(async (req, res) => { let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p === '/') p = '/index.html'; try { await stat(join(DIST, p)); } catch { p = '/index.html'; } res.setHeader('Content-Type', MIME[extname(p)] || 'application/octet-stream'); res.end(await readFile(join(DIST, p))); }).listen(8771);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto('http://localhost:8771/#/1'); await page.waitForTimeout(3000);
for (const n of LIST.split(',').map(Number)) {
  await page.evaluate((n) => { location.hash = '#/' + n }, n);
  await page.waitForTimeout(Number(process.env.SLIDE_WAIT || 5500));
  await page.screenshot({ path: `${OUT}/${String(n).padStart(2, '0')}.png` });
}
await browser.close(); srv.close();
