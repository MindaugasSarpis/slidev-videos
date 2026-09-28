// Serve example/dist and assert, headless (WebGL2 on SwiftShader):
//   1. the addon's global layers mounted the stage and the halo from the
//      headmatter `stage:` block alone, with the palette on <html>;
//   2. the world draws (frames advance) and the cover's title waits for the
//      hero to assemble;
//   3. a slide's `space:` frontmatter steers the camera (pose and station);
//   4. a click on a stop slide raises the HUD with the record, and the slide
//      steps back; leaving the slide clears it;
//   5. a covering clip (slidev-addon-videos' window events) rests the
//      renderer, and its leaving wakes it;
//   6. nothing on the page threw.
// Every assertion polls for the state it expects, so a slow runner is only slow.
import { chromium } from 'playwright-chromium'
import { serve, GL_ARGS } from '../bin/shots.mjs'

const DIST = new URL('../example/dist', import.meta.url).pathname
const { server, port } = await serve(DIST)

let failures = 0
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) failures++
}

const browser = await chromium.launch({ args: GL_ARGS })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
const errors = []
page.on('pageerror', (e) => { if (!/Wake Lock/i.test(e.message)) errors.push(e.message.slice(0, 200)) })
page.on('console', (m) => { if (m.type() === 'error' && !/Wake Lock|favicon/i.test(m.text())) errors.push(m.text().slice(0, 200)) })

const state = () => page.evaluate(() => {
  const html = document.documentElement
  const st = document.querySelector('.stage')
  const c = st?.querySelector('canvas.field')
  const cover = document.querySelector('.slidev-page[data-slidev-no="1"] .slidev-layout h1')
  const hud = st?.querySelector('.hud')
  const layout = document.querySelector('.slidev-page:not([style*="display: none"]) .slidev-layout')
  return {
    stage: html.dataset.stage ?? null,
    accent: html.style.getPropertyValue('--stage-accent'),
    mounted: !!st, ready: !!st?.classList.contains('ready'), staticBg: !!st?.classList.contains('static-bg'),
    frames: c?.__space?.frames ?? 0,
    at: st?.dataset.spaceAt ?? null, station: st?.dataset.spaceStation ?? null, paused: st?.dataset.spacePaused ?? null,
    assembled: html.dataset.spaceAssembled ?? null,
    coverOpacity: cover ? Number(getComputedStyle(cover).opacity) : null,
    stop: html.dataset.spaceStop ?? null,
    hud: hud ? { name: hud.querySelector('.hud-name')?.textContent.trim(), rows: [...hud.querySelectorAll('dt')].map((d) => d.textContent.trim()) } : null,
    layoutOpacity: layout ? Number(getComputedStyle(layout).opacity) : null,
    halo: !!document.querySelector('.halo-layer canvas'),
    scrim: Number(st?.querySelector('.scrim')?.style.opacity ?? -1),
  }
})
const until = async (pred, timeout = 30000) => {
  const deadline = Date.now() + timeout
  let s = await state()
  while (!pred(s) && Date.now() < deadline) {
    await page.waitForTimeout(50)
    s = await state()
  }
  return s
}
const goto = (n) => page.evaluate((n) => { location.hash = `#/${n}` }, n)

await page.goto(`http://localhost:${port}/`, { waitUntil: 'load' })
await page.waitForSelector('.slidev-layout', { timeout: 60000 })

let s = await until((s) => s.ready && s.frames > 5)
check('the addon mounted the stage from the headmatter', s.mounted && s.stage === '1', JSON.stringify(s))
check('the world draws', s.ready && !s.staticBg && s.frames > 5, `ready=${s.ready} static=${s.staticBg} frames=${s.frames}`)
check('the palette is on <html>', s.accent === '#5b93ff', `--stage-accent=${s.accent}`)
check('the halo layer is mounted', s.halo)
check('the cover opens on the hero', s.at === 'wide' && s.station === 'hero', `at=${s.at} station=${s.station}`)

s = await until((s) => s.assembled === '1' && s.coverOpacity === 1, 60000)
check('the cover title lands with the assembly', s.assembled === '1' && s.coverOpacity === 1, `assembled=${s.assembled} opacity=${s.coverOpacity}`)
check('display layouts keep the world open', s.scrim === 0.15, `scrim=${s.scrim}`)

await goto(2)
s = await until((s) => s.at === 'path')
check('frontmatter steers the camera', s.at === 'path' && s.station === 'path', `at=${s.at} station=${s.station}`)
check('frontmatter sets the scrim', s.scrim === 0.2, `scrim=${s.scrim}`)

await goto(3)
s = await until((s) => s.at === 'marks')
check('a stop slide starts on its pose', s.at === 'marks' && s.hud === null && s.stop === null, JSON.stringify(s))
await page.keyboard.press('ArrowRight')
s = await until((s) => s.hud !== null && s.layoutOpacity === 0, 60000)
check('a click flies to the stop and raises its record', s.at === 'first' && s.hud?.name === 'The first mark', JSON.stringify(s.hud))
check('the record shows its rows', JSON.stringify(s.hud?.rows) === JSON.stringify(['found', 'by', 'status']), JSON.stringify(s.hud?.rows))
check('the slide steps back behind the stop', s.stop === '1' && s.layoutOpacity === 0, `stop=${s.stop} opacity=${s.layoutOpacity}`)
await page.keyboard.press('ArrowRight')
s = await until((s) => s.hud?.name === 'The second mark', 60000)
check('the next click moves to the next stop', s.at === 'second' && s.hud?.name === 'The second mark', JSON.stringify(s.hud))
check('a record without rows lists its fields', (s.hud?.rows || []).includes('status') && !(s.hud?.rows || []).includes('id'), JSON.stringify(s.hud?.rows))

await goto(4)
s = await until((s) => s.at === 'far' && s.stop === null && s.hud === null)
check('leaving the slide clears the stop', s.stop === null && s.hud === null, JSON.stringify(s))
check('a named pose resolves to its station', s.at === 'far' && s.station === 'grid', `at=${s.at} station=${s.station}`)

// --- a covering clip rests the world ----------------------------------------------
const cover = (covered, fit = 'cover') => page.evaluate(([covered, fit]) => {
  window.dispatchEvent(new CustomEvent('slidev-videos:cover', { detail: { covered, fit, src: 'x.mp4' } }))
}, [covered, fit])
await cover(true)
s = await until((s) => s.paused === '1')
const f0 = s.frames
await page.waitForTimeout(400)
s = await state()
check('a covering clip rests the renderer', s.paused === '1' && s.frames === f0, `paused=${s.paused} frames ${f0} → ${s.frames}`)
await cover(false)
s = await until((s) => s.paused === '0' && s.frames > f0)
check('the clip leaving wakes it', s.paused === '0' && s.frames > f0, `paused=${s.paused} frames=${s.frames}`)
await cover(true, 'contain')
await page.waitForTimeout(900)
s = await state()
check('a letterboxed clip does not rest the world', s.paused === '0', `paused=${s.paused}`)
await cover(false)

// --- a video transition stirs the dust (no throw, world keeps drawing) ---------------
const f1 = (await state()).frames
await page.evaluate(() => {
  window.dispatchEvent(new CustomEvent('slidev-videos:transition', { detail: { phase: 'enter', mode: 'dust', duration: 1400 } }))
  window.dispatchEvent(new CustomEvent('slidev-videos:transition', { detail: { phase: 'leave', mode: 'dust', duration: 1000 } }))
})
s = await until((s) => s.frames > f1 + 3)
check('a video transition stirs the dust', s.frames > f1 + 3, `frames ${f1} → ${s.frames}`)

check('nothing on the page threw', errors.length === 0, errors.join(' | '))

await browser.close()
server.close()
if (failures) { console.error(`${failures} smoke failure(s)`); process.exit(1) }
console.log('STAGE SMOKE PASS')
