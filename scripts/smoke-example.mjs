// Serve dist/ and assert the VideoPlayer on slide 2 resolved its source URL
// from the `videos:` headmatter (custom-config passthrough — spec §6).
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { chromium } from 'playwright-chromium'

const ROOT = new URL('../example/dist', import.meta.url).pathname  // slidev resolves --out against the entry dir
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' }
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (p.endsWith('/')) p += 'index.html'
  try {
    const body = await readFile(join(ROOT, p))
    res.writeHead(200, { 'content-type': MIME[extname(p)] || 'application/octet-stream' })
    res.end(body)
  } catch {
    res.writeHead(404); res.end('not found')
  }
})
await new Promise((r) => server.listen(4180, r))

const expected = 'https://github.com/ExampleOwner/example-repo/releases/download/videos-example/clip_example.mp4'
let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto('http://localhost:4180/#/2', { waitUntil: 'load' })
await page.waitForSelector('.video-player', { timeout: 15000 })
// Give the active-slide watcher a beat to attach the <source>.
await page.waitForFunction(() => {
  const s = document.querySelector('.video-player video source')
  return s && s.getAttribute('src')
}, null, { timeout: 15000 })
const src = await page.evaluate(() => document.querySelector('.video-player video source').getAttribute('src'))
check('component rendered', true)
check('headmatter videos: config reached the chain', src === expected, `src=${src}`)
// shared: false must keep the shared release out of the chain entirely.
const preloads = await page.evaluate(() => [...document.querySelectorAll('link[rel="preload"][as="video"]')].map(l => l.href))
check('no shared-release preload when shared: false', !preloads.some(u => u.includes('slidev-videos')), preloads.join(','))

await browser.close()
server.close()
if (failures) { console.error(`${failures} smoke failure(s)`); process.exit(1) }
console.log('SMOKE PASS')
