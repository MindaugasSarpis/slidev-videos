// Serve example/dist and assert, headless:
//   1. the VideoPlayer on slide 2 resolved its source URL from the `videos:`
//      headmatter (custom-config passthrough — spec §6), falls back to the
//      local tier when the remote fails, and reports an exhausted chain;
//   2. `shared: false` keeps the shared release out of the chain;
//   3. `videos.volume` is applied on activation;
//   4. `+` / `-` step the volume (clamped), show the badge, persist to
//      localStorage, and the level carries over to the next clip;
//   5. `p` toggles play/pause (a paused clip with no media still flips
//      `paused` back and forth via play()/pause());
//   6. the `dust` transition: the one real clip (scripts/make-example-clip.mjs)
//      is held back while its particle sheet assembles, is handed the screen,
//      fades its sound in, and leaves as particles; a clip that never loads
//      gives the sheet up and shows the error. Skipped, with a note, when the
//      clip was not generated (no ffmpeg).
// Media requests are aborted so the missing clips never stall the run.
// No fixed sleeps: every assertion polls for the state it expects (`until`),
// so a slow CI runner only makes the run slower, not flaky.
import { createServer } from 'node:http'
import { readFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join } from 'node:path'
import { chromium } from 'playwright-chromium'

const ROOT = new URL('../example/dist', import.meta.url).pathname  // slidev resolves --out against the entry dir
const REAL_CLIP = 'clip_dust.webm'
const HAVE_CLIP = existsSync(join(ROOT, 'videos', REAL_CLIP))
const SHOTS = process.env.SMOKE_SHOTS || ''     // a directory: keep screenshots of the transition
const MIME = { '.webm': 'video/webm', '.jpg': 'image/jpeg', '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' }
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (p.endsWith('/')) p += 'index.html'
  try {
    const body = await readFile(join(ROOT, p))
    const type = MIME[extname(p)] || 'application/octet-stream'
    // media elements ask for byte ranges; answer them, or Chromium will not seek
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '')
    if (m) {
      const start = m[1] ? Number(m[1]) : 0
      const end = m[2] ? Math.min(Number(m[2]), body.length - 1) : body.length - 1
      res.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${body.length}`, 'content-length': end - start + 1 })
      res.end(body.subarray(start, end + 1))
      return
    }
    res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': body.length })
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

// SwiftShader gives the headless browser a WebGL2 context for the dust overlay.
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const isMedia = (r) => r.resourceType() === 'media' || /\.(mp4|webm|mov)(\?|$)/i.test(r.url())
// the one real clip is served from the local tier; every other media request is aborted
const isRealClip = (r) => new URL(r.url()).pathname === `/videos/${REAL_CLIP}`
await page.route('**/*', (route) =>
  isMedia(route.request()) && !isRealClip(route.request()) ? route.abort() : route.continue())

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
// PROD look-ahead: slide 2 is within 3 slides of slide 1, so its clip must be
// requested while slide 1 is still up.
for (let i = 0; i < 100 && !mediaRequests.includes(expected); i++) await new Promise((r) => setTimeout(r, 100))
check('prod look-ahead requests the next clip before its slide is active', mediaRequests.includes(expected), mediaRequests.join(','))
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
const links = await page.evaluate(() => document.querySelectorAll('link[rel="preload"][as="video"]').length)
check('no <link rel=preload as=video> (Chrome rejects it)', links === 0, `links=${links}`)

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

// --- overview grid renders placeholders, not <video> elements --------------
// Slidev keeps the main view's slides mounted (that is what the look-ahead
// relies on), so the invariant is: opening the overview adds placeholders
// and not one more <video>.
const vidsBefore = await page.evaluate(() => document.querySelectorAll('video').length)
await press('o')
await page.waitForFunction(() => document.querySelectorAll('.video-placeholder').length >= 2, null, { timeout: 10000 }).catch(() => {})
const ov = await page.evaluate(() => ({ ph: document.querySelectorAll('.video-placeholder').length, vids: document.querySelectorAll('video').length }))
check('overview shows placeholders instead of videos', ov.ph >= 2 && ov.vids === vidsBefore, `placeholders=${ov.ph} videos=${ov.vids} (before overview: ${vidsBefore})`)
await press('Escape')
await page.waitForFunction(() => document.querySelectorAll('.video-placeholder').length === 0, null, { timeout: 10000 }).catch(() => {})

// --- Slidev navigation keys are untouched -----------------------------------
await press('ArrowLeft')
await page.waitForFunction(() => location.hash === '#/2', null, { timeout: 5000 }).catch(() => {})
const hash = await page.evaluate(() => location.hash)
check('arrow navigation still works', hash === '#/2', `hash=${hash}`)

// --- the dust transition ----------------------------------------------------
const dust = (n) => page.evaluate((n) => {
  const pg = document.querySelector(`.slidev-page[data-slidev-no="${n}"]`)
  const wrap = pg?.querySelector('.video-player')
  const v = pg?.querySelector('video')
  const c = document.querySelector('canvas.video-dust')
  return {
    overlay: !!c, sheets: c?.dataset.dust ?? null, source: c?.dataset.dustSource ?? null, count: Number(c?.dataset.dustCount || 0),
    shownCanvas: c ? getComputedStyle(c).display !== 'none' : false,
    mode: wrap ? [...wrap.classList].find((k) => /^video-(cut|fade|dust)$/.test(k)) : null,
    phase: wrap?.dataset.videoPhase ?? null,
    opacity: v ? Number(getComputedStyle(v).opacity) : null,
    paused: v?.paused, muted: v?.muted, volume: v?.volume, time: v?.currentTime, ready: v?.readyState,
    error: !!pg?.querySelector('.video-error'),
  }
}, n)
const untilDust = async (n, pred, timeout = 15000) => {
  const deadline = Date.now() + timeout
  let s = await dust(n)
  while (!pred(s) && Date.now() < deadline) {
    await page.waitForTimeout(25)
    s = await dust(n)
  }
  return s
}
const shot = async (name) => {
  if (!SHOTS) return
  await mkdir(SHOTS, { recursive: true })
  await page.screenshot({ path: join(SHOTS, `${name}.png`) })
}

let d = await dust(2)
check('addon global layer mounted the dust overlay', d.overlay, JSON.stringify(d))
check('overlay is off screen while no clip asks for it', d.overlay && !d.shownCanvas && d.sheets === 'idle', `display shown=${d.shownCanvas} sheets=${d.sheets}`)
check('default transition is cut', d.mode === 'video-cut', `mode=${d.mode}`)

if (!HAVE_CLIP) {
  console.log(`note dust playback checks skipped — example/dist/videos/${REAL_CLIP} is missing (run scripts/make-example-clip.mjs, needs ffmpeg)`)
} else {
  await goto(4)
  d = await untilDust(4, (s) => (s.sheets || '').includes('enter'))
  check('dust: a sheet assembles on arrival', (d.sheets || '').includes('enter') && d.shownCanvas, JSON.stringify(d))
  check('dust: the picture is held back under the sheet', d.phase === 'held' && d.opacity === 0, `phase=${d.phase} opacity=${d.opacity}`)
  await page.waitForTimeout(700)
  await shot('dust-enter-mid')
  d = await untilDust(4, (s) => s.phase === 'shown' && s.opacity === 1 && s.sheets === 'idle')
  check('dust: the clip is handed the screen and the sheet goes', d.phase === 'shown' && d.opacity === 1 && d.sheets === 'idle' && !d.shownCanvas, JSON.stringify(d))
  check('dust: the clip plays from its first frame', d.paused === false && d.time < 3, `paused=${d.paused} time=${d.time}`)
  d = await untilDust(4, (s) => near(s.volume, 0.7) && s.muted === false)
  check('dust: the sound fades in to the session level', near(d.volume, 0.7) && d.muted === false, `volume=${d.volume} muted=${d.muted}`)
  await shot('dust-playing')

  const before4 = d.count
  await goto(5)
  d = await untilDust(4, (s) => (s.sheets || '').includes('leave'))
  check('dust: the picture leaves as a sheet', (d.sheets || '').includes('leave') && d.count === before4 + 1, JSON.stringify(d))
  check('dust: leaving reads the frame on screen (same-origin clip)', d.source === 'live', `source=${d.source}`)
  // it goes in 0.2 s as the sheet comes up over it, not at once (a sheet put up whole over a sharp frame showed as a drop in quality)
  check('dust: the picture is handed to the sheet', d.phase === 'held', `phase=${d.phase}`)
  d = await untilDust(4, (s) => s.opacity === 0, 3000)
  check('dust: the <video> is gone under the sheet', d.opacity === 0 && (d.sheets || '').includes('leave'), `opacity=${d.opacity} sheets=${d.sheets}`)
  await page.waitForTimeout(350)
  await shot('dust-leave-mid')
  d = await untilDust(4, (s) => s.sheets === 'idle' && s.paused === true)
  check('dust: the sheet scatters and the clip rests', d.sheets === 'idle' && d.paused === true && d.muted === true && d.time === 0, JSON.stringify(d))

  // back onto the clip while it is resting: it arrives again
  await goto(4)
  d = await untilDust(4, (s) => s.phase === 'shown' && s.paused === false && s.sheets === 'idle')
  check('dust: a second arrival plays again', d.phase === 'shown' && d.paused === false, JSON.stringify(d))
  await goto(5)
  await untilDust(4, (s) => s.sheets === 'idle' && s.paused === true)
}

// A `fade` clip that never loads: nothing is held, the error shows.
await goto(5)
d = await untilDust(5, (s) => s.error)
check('fade: a clip that cannot load shows the error', d.error && d.mode === 'video-fade', JSON.stringify(d))
check('fade: no sheet is raised', d.sheets === 'idle', `sheets=${d.sheets}`)

await browser.close()
server.close()
if (failures) { console.error(`${failures} smoke failure(s)`); process.exit(1) }
console.log('SMOKE PASS')
