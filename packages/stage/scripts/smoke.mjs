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
//   6. a form of grains gathers when the camera arrives at its station, and
//      not for a pose out in the open dust; grains streak during a flight
//      and only then; the dust takes a leaving clip's colour and lets it go;
//   7. the deck's own builder (example/setup/) stands in the world, and a
//      <StageCount for> follows the number its form shows as it builds;
//   8. nothing on the page threw.
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
    atStation: st?.dataset.spaceAtStation ?? null, flights: Number(st?.dataset.flights || 0), assemblies: Number(st?.dataset.assemblies || 0),
    flying: !!st?.__space?.flying,
    streak: c?.__space?.field.material.uniforms.uStreak.value ?? null,
    tint: c?.__space?.field.material.uniforms.uTint.value.w ?? null,
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

const built = s.assemblies
await goto(2)
s = await until((s) => s.at === '11.5,-2.6,0')
check('frontmatter steers the camera', s.at === '11.5,-2.6,0' && s.station === 'galaxy', `at=${s.at} station=${s.station}`)
check('frontmatter sets the scrim', s.scrim === 0.08, `scrim=${s.scrim}`)
check('a pose near a station is at it', s.atStation === 'galaxy', `atStation=${s.atStation}`)
check('the flight is announced', s.flights === 1, `flights=${s.flights}`)
s = await until((s) => s.flying && s.streak > 0.05, 20000)
check('grains streak while the camera flies', s.flying && s.streak > 0.05, `flying=${s.flying} streak=${s.streak}`)
s = await until((s) => !s.flying && s.assemblies > built && s.assembled === '1', 90000)
check('the form gathers on arrival', s.assemblies === built + 1 && s.assembled === '1', `assemblies ${built} → ${s.assemblies} assembled=${s.assembled}`)
check('no streak once the camera has landed', s.streak === 0, `streak=${s.streak}`)

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

const beforeFar = s.assemblies
await goto(4)
s = await until((s) => s.at === 'far' && s.stop === null && s.hud === null)
check('leaving the slide clears the stop', s.stop === null && s.hud === null, JSON.stringify(s))
check('a named pose resolves to its station', s.at === 'far' && s.station === 'ring' && s.atStation === 'ring', `at=${s.at} station=${s.station} atStation=${s.atStation}`)
s = await until((s) => !s.flying && s.assemblies > beforeFar && s.assembled === '1', 90000)
check('the ring gathers on arrival', s.assemblies === beforeFar + 1, `assemblies ${beforeFar} → ${s.assemblies}`)
// the next slide stands at the same station: nothing is scattered and built again
await goto(5)
s = await until((s) => s.at === 'ring' && !s.flying, 60000)
check('a second pose at the same station leaves the form whole', s.assemblies === beforeFar + 1 && s.atStation === 'ring', `assemblies=${s.assemblies} atStation=${s.atStation}`)
// a pose out in the open dust is at no station
await page.evaluate(() => document.querySelector('.stage').__space.setPose({ at: [52, 30, -60], dist: 10 }))
s = await until((s) => s.atStation === '' && !s.flying, 60000)
check('a pose in the open dust is at no station', s.atStation === '' && s.assemblies === beforeFar + 1, `atStation=${JSON.stringify(s.atStation)} assemblies=${s.assemblies}`)
await page.keyboard.press('c')
await page.waitForTimeout(300)
s = await state()
check('`c` builds nothing out in the open', s.assemblies === beforeFar + 1, `assemblies=${s.assemblies}`)
await goto(4)
await until((s) => s.at === 'far' && !s.flying && s.assembled === '1', 90000)
const beforeC = (await state()).assemblies
await page.keyboard.press('c')
s = await until((s) => s.assemblies > beforeC)
check('`c` builds again what stands at the station', s.assemblies === beforeC + 1, `assemblies ${beforeC} → ${s.assemblies}`)
await until((s) => s.assembled === '1', 60000)

// --- the dust takes a colour and lets it go ------------------------------------------
await page.evaluate(() => window.dispatchEvent(new CustomEvent('slidev-videos:transition', { detail: { phase: 'leave', mode: 'dust', duration: 1700, color: [0.1, 0.2, 0.9] } })))
s = await until((s) => s.tint > 0.2)
check('the dust takes a leaving clip\'s colour', s.tint > 0.2, `tint=${s.tint}`)
s = await until((s) => s.tint === 0, 60000)
check('and lets it go', s.tint === 0, `tint=${s.tint}`)
await page.evaluate(() => window.dispatchEvent(new CustomEvent('slidev-videos:transition', { detail: { phase: 'leave', mode: 'fade', duration: 450, color: null } })))
await page.waitForTimeout(300)
s = await state()
check('a clip that only fades leaves no colour', s.tint === 0, `tint=${s.tint}`)

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

// --- the deck's own builder, and a count that moves with it ----------------------------
await goto(6)
const counts = new Set()
const tally = () => page.evaluate(() => ({
  at: document.querySelector('.stage')?.dataset.spaceAt ?? null,
  flying: !!document.querySelector('.stage')?.__space?.flying,
  built: !!document.querySelector('.stage canvas.field')?.__space?.scene.getObjectByName('tally'),
  value: document.querySelector('.stage')?.__space?.value('grains') ?? null,
  count: document.querySelector('.slidev-page[data-slidev-no="6"] .stage-count')?.textContent ?? null,
}))
let t = await tally()
const until6 = Date.now() + 120000
while (!(t.at === 'tally' && !t.flying && t.value === 400 && t.count === '400') && Date.now() < until6) {
  if (t.count != null) counts.add(t.count)
  await page.waitForTimeout(50)
  t = await tally()
}
counts.add(t.count)
check('the deck\'s own builder stands in the world', t.built, `built=${t.built}`)
check('its form reports what it shows', t.value === 400, `value=${t.value}`)
const between = [...counts].filter((c) => Number(c) > 0 && Number(c) < 400)
check('the count moves with the form and lands with it', t.count === '400' && between.length > 0, `counts seen: ${[...counts].slice(0, 12).join(', ')}`)

check('nothing on the page threw', errors.length === 0, errors.join(' | '))

await browser.close()
server.close()
if (failures) { console.error(`${failures} smoke failure(s)`); process.exit(1) }
console.log('STAGE SMOKE PASS')
