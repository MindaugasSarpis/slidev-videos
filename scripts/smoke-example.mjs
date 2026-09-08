// Serve example/dist and assert, headless:
//   1. the VideoPlayer on slide 2 resolved its source URL from the `videos:`
//      headmatter (custom-config passthrough — spec §6), falls back to the
//      local tier when the remote fails, and reports an exhausted chain;
//   2. `shared: false` keeps the shared release out of the chain;
//   3. `videos.volume` is applied on activation;
//   4. `+` / `-` step the volume (clamped), show the badge, persist to
//      localStorage, and the level carries over to the next clip;
//   5. `p` toggles play/pause (a paused clip with no media still flips
//      `paused` back and forth via play()/pause()).
// Media requests are aborted so the missing clips never stall the run.
// No fixed sleeps: every assertion polls for the state it expects (`until`),
// so a slow CI runner only makes the run slower, not flaky.
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
await new Promise((r) => server.listen(0, r))
const port = server.address().port

const expected = 'https://github.com/ExampleOwner/example-repo/releases/download/videos-example/clip_example.mp4'
let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}
const near = (a, b) => Math.abs(a - b) < 1e-6

const browser = await chromium.launch()
const page = await browser.newPage()
await page.route('**/*', (route) =>
  route.request().resourceType() === 'media' || /\.(mp4|webm|mov)(\?|$)/i.test(route.request().url())
    ? route.abort() : route.continue())

const state = (n) => page.evaluate((n) => {
  const pg = document.querySelector(`.slidev-page[data-slidev-no="${n}"]`)
  const v = pg?.querySelector('video')
  return {
    volume: v?.volume, muted: v?.muted, paused: v?.paused,
    badge: pg?.querySelector('.volume-badge')?.textContent?.trim() ?? null,
    stored: localStorage.getItem('slidev-addon-videos:volume'),
  }
}, n)
// Poll slide n's state until `pred` holds (or the deadline passes); returns
// the last observed state either way so the caller's check() can report it.
const until = async (n, pred, timeout = 5000) => {
  const deadline = Date.now() + timeout
  let s = await state(n)
  while (!pred(s) && Date.now() < deadline) {
    await page.waitForTimeout(25)
    s = await state(n)
  }
  return s
}
const press = async (key, times = 1) => { for (let i = 0; i < times; i++) await page.keyboard.press(key) }
const goto = async (n) => {
  await page.evaluate((n) => { location.hash = '#/' + n }, n)
  await page.waitForSelector(`.slidev-page[data-slidev-no="${n}"] video`, { state: 'attached', timeout: 15000 })
}

// Every media URL the player asks for, in order — the chain is observed
// through the requests it makes (the aborted remote advances it to the local
// tier, so reading <source src> after the fact would only show the fallback).
const mediaRequests = []
page.on('request', (r) => { if (r.resourceType() === 'media' || /\.(mp4|webm|mov)(\?|$)/i.test(r.url())) mediaRequests.push(r.url()) })

await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' })
await page.waitForSelector('.slidev-layout', { timeout: 30000 })
await goto(2)
// The chain is remote → local in a production build; both are aborted, so it
// must exhaust and report the clip as unavailable.
await page.waitForSelector('.slidev-page[data-slidev-no="2"] .video-error', { timeout: 15000 })
check('component rendered', true)
const first = mediaRequests.find((u) => u.includes('clip_example'))
check('headmatter videos: config reached the chain', first === expected, `first request=${first}`)
const local = mediaRequests.find((u) => /^http:\/\/localhost:\d+\/videos\/clip_example\.mp4$/.test(u))
check('remote failure falls back to the local tier', !!local, mediaRequests.join(','))
const errText = await page.evaluate(() => document.querySelector('.slidev-page[data-slidev-no="2"] .video-error').textContent.trim())
check('exhausted chain shows "Video not available"', /Video not available: ?clip_example\.mp4/.test(errText), errText)
// shared: false must keep the shared release out of the chain entirely.
const preloads = await page.evaluate(() => [...document.querySelectorAll('link[rel="preload"][as="video"]')].map(l => l.href))
check('no shared-release preload when shared: false', !preloads.some(u => u.includes('slidev-videos')), preloads.join(','))

// --- volume: config default, keys, clamps, badge, persistence -------------
let s = await until(2, (s) => near(s.volume, 0.4))
check('videos.volume applied on activation', near(s.volume, 0.4), `volume=${s.volume}`)
check('no badge before any key', s.badge === null && s.stored === null)

await press('+')
s = await until(2, (s) => near(s.volume, 0.5) && s.badge !== null && s.stored !== null)
check('`+` steps volume up by 0.1', near(s.volume, 0.5), `volume=${s.volume}`)
check('`+` shows the badge', s.badge === '🔊 50%', `badge=${s.badge}`)
check('`+` persists the level', s.stored === '0.5', `stored=${s.stored}`)

await press('=')
s = await until(2, (s) => near(s.volume, 0.6))
check('`=` counts as `+`', near(s.volume, 0.6), `volume=${s.volume}`)

await press('-', 8)
s = await until(2, (s) => s.volume === 0 && s.badge === '🔇 0%')
check('`-` clamps at 0 and shows the muted badge', s.volume === 0 && s.badge === '🔇 0%', `volume=${s.volume} badge=${s.badge}`)

await press('+', 12)
s = await until(2, (s) => s.volume === 1)
check('`+` clamps at 1', s.volume === 1, `volume=${s.volume}`)

// The badge must be seen at the new level first, then disappear on its own.
await press('-', 3)
s = await until(2, (s) => near(s.volume, 0.7) && s.badge === '🔊 70%')
check('badge shows the stepped level', s.badge === '🔊 70%', `badge=${s.badge} volume=${s.volume}`)
s = await until(2, (s) => s.badge === null)
check('badge fades after ~1 s', s.badge === null && near(s.volume, 0.7), `badge=${s.badge} volume=${s.volume}`)

// --- `p` toggles play/pause on the active clip ------------------------------
const before = await state(2)
await press('p')
const afterP = await until(2, (s) => s.paused !== before.paused)
await press('p')
const afterPP = await until(2, (s) => s.paused === before.paused)
check('`p` toggles paused', afterP.paused !== before.paused && afterPP.paused === before.paused, `start=${before.paused} p=${afterP.paused} pp=${afterPP.paused}`)

// --- the level carries over to the next clip ---------------------------------
await goto(3)
s = await until(3, (s) => near(s.volume, 0.7))
check('session level applied to the next clip', near(s.volume, 0.7), `volume=${s.volume}`)

// --- Slidev navigation keys are untouched -----------------------------------
await press('ArrowLeft')
await page.waitForFunction(() => location.hash === '#/2', null, { timeout: 5000 }).catch(() => {})
const hash = await page.evaluate(() => location.hash)
check('arrow navigation still works', hash === '#/2', `hash=${hash}`)

await browser.close()
server.close()
if (failures) { console.error(`${failures} smoke failure(s)`); process.exit(1) }
console.log('SMOKE PASS')
