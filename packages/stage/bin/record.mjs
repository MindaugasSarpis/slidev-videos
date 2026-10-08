#!/usr/bin/env node
// Record a built deck to video, one file per slide: the flight in, the
// world settling, then a hold. For a broadcaster's editor, or as the fallback
// when the live laptop cannot be used. Frames are stepped, not filmed: the
// page runs on a fake clock that moves exactly 1/fps per frame, so a frame
// that takes two seconds to render still lands on time, and two runs on the
// same renderer give the same pictures.
//
//   slidev-stage-record <dist> <out-dir> [--fps 50] [--size 1920x1080] [--slides 2-5]
//                       [--plate] [--hold 8] [--max 40] [--clicks all|none|'{"3":1}']
//                       [--base auto] [--seed 1] [--flash] [--gl auto|gl|swiftshader]
//                       [--chromium path] [--encoder auto|nvenc|x264]
//
//   NN.mp4        slide NN as it arrives: the flight, the settle, then --hold seconds
//   NN-cK.mp4     the same slide after its K-th click (a stop), when it has clicks
//   NN-plate.mp4  with --plate: the same frames without the slide's text, the
//                 halo or the stop HUD (the world alone, for the editor to set
//                 their own type over); the scrim stays, so the two cut together
//   index.json    the edit list: every file, its length, where the camera
//                 stood, the clips it shows or could not record, flash warnings
//
//   --hold    seconds held once a slide has settled (camera landed, forms
//             built, type risen in); a clip slide holds for the rest of its clip
//   --max     seconds at most per file
//   --base    the base the deck was built for; auto reads it from index.html
//   --flash   a rough flash check of each file (see lib/record-flash.mjs)
//
// A clip slide is recorded when the clip is served from the deck itself
// (build with VITE_VIDEOS_LOCAL_FIRST=1 and the clips in public/videos/): the
// clip is set to its time on the fake clock each frame. A clip from elsewhere
// (a release URL) cannot be stepped that way; the slide is skipped and the
// edit list names the clip, for the editor to cut in from the source.
//
// Needs playwright-chromium and ffmpeg. Software WebGL: llvmpipe where the
// browser reaches it, SwiftShader otherwise (see lib/record-browser.mjs).
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { serve, normaliseBase, parseSlides, parseSize } from './lib/record-serve.mjs';
import { loadChromium, launchBrowser } from './lib/record-browser.mjs';
import { resolveFfmpeg, pickEncoder, encoder, decodeSmall } from './lib/record-ffmpeg.mjs';
import { seedRandom, recorderHooks } from './lib/record-page.mjs';
import { findFlashes } from './lib/record-flash.mjs';

const USAGE = "usage: slidev-stage-record <dist> <out-dir> [--fps 50] [--size 1920x1080] [--slides 2-5] [--plate] [--hold 8] [--max 40] [--clicks all|none|'{\"3\":1}'] [--base auto] [--seed 1] [--flash] [--gl auto|gl|swiftshader] [--chromium path] [--encoder auto|nvenc|x264]";
const PREROLL_STEP = 83;     // ms: the engine's own frame-time clamp (12 fps), so the world gets there in the fewest frames
const NOISE = /Wake Lock/;   // page errors that say nothing about the deck

export function parseArgs(argv) {
  const o = { dist: null, out: null, fps: 50, size: [1920, 1080], slides: null, plate: false, hold: 8, max: 40, clicks: 'all', base: 'auto', seed: 1, flash: false, gl: 'auto', chromium: '', encoder: 'auto' };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--fps') o.fps = Number(argv[++i]);
    else if (a === '--size') o.size = parseSize(argv[++i]);
    else if (a === '--slides') o.slides = argv[++i];
    else if (a === '--plate') o.plate = true;
    else if (a === '--hold') o.hold = Number(argv[++i]);
    else if (a === '--max') o.max = Number(argv[++i]);
    else if (a === '--clicks') { const v = argv[++i]; o.clicks = v === 'all' || v === 'none' ? v : JSON.parse(v); }
    else if (a === '--base') o.base = argv[++i];
    else if (a === '--seed') o.seed = Number(argv[++i]);
    else if (a === '--flash') o.flash = true;
    else if (a === '--gl') o.gl = argv[++i];
    else if (a === '--chromium') o.chromium = argv[++i];
    else if (a === '--encoder') o.encoder = argv[++i];
    else if (a === '-h' || a === '--help') o.help = true;
    else rest.push(a);
  }
  [o.dist, o.out] = rest;
  if (!(o.fps > 0 && o.fps <= 120)) throw new Error('--fps wants a number of frames a second, 1-120');
  if (!(o.hold >= 0) || !(o.max > 0)) throw new Error('--hold and --max want seconds');
  return o;
}

const pad = (n) => String(n).padStart(2, '0');
const snap = (cdp) => cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true }).then((r) => Buffer.from(r.data, 'base64'));
const look = (page, n) => page.evaluate((n) => ({ ...window.__rec.sync(), ...window.__rec.state(n) }), n);
// A seek that takes over 30 s is let go with a warning: the frame shows the clip where it stands.
const seeked = (page, warn) => page.waitForFunction(() => window.__rec.seeked(), null, { polling: 10, timeout: 30000 })
  .catch(async () => { const srcs = await page.evaluate(() => window.__rec.seeking()); warn?.(`a clip did not seek in 30 s: ${srcs.join(', ')}`); });

// A fresh page on the deck at slide `n`, its clock paused at load: nothing
// moves until the recorder moves it.
async function openDeck(browser, o, url, n, errors) {
  const context = await browser.newContext({ viewport: { width: o.size[0], height: o.size[1] }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.on('pageerror', (e) => { if (!NOISE.test(e.message)) errors.push(`pageerror: ${e.message.slice(0, 200)}`); });
  page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text())) errors.push(m.text().slice(0, 200)); });
  await page.clock.install({ time: 0 });
  await page.clock.pauseAt(1000);
  await page.addInitScript(seedRandom, o.seed);
  await page.addInitScript(recorderHooks);
  await page.goto(`${url}#/${n}`);
  // the world boots on the paused clock (data and shaders load in real time)
  await page.waitForFunction(() => window.__rec && window.__rec.state(0).ready, null, { polling: 50, timeout: 90000 });
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await page.evaluate(() => window.__rec.holdQuality());
  // the clock starts where load left it, a few ms in: square it to 100 ms, so
  // whatever reads the absolute time reads the same in every run
  const t = await page.evaluate(() => performance.now());
  if (t % 100) await page.clock.fastForward(100 - (t % 100));
  const cdp = await context.newCDPSession(page);
  return { context, page, cdp };
}

// Slidev's own navigation, by the URL: the slide, and how many of its clicks.
async function goTo(page, n, clicks = 0) {
  await page.evaluate(([n, c]) => { location.hash = c ? `#/${n}?clicks=${c}` : `#/${n}`; }, [n, clicks]);
  // wait until Slidev has taken it in (clicks included): the clock does not move before
  return page.waitForFunction(([n, c]) => { const s = window.__rec.state(n); return s.slide === n && s.shown && (!s.stage || s.clicks === c); }, [n, clicks], { polling: 20, timeout: 10000 }).then(() => true, () => false);
}

// Run the world forward until slide n stands still (flown, built, type risen),
// at 12 frames a second and without a picture. A slide under a clip counts
// as still once the clip covers it.
async function settle(page, n, { min = 1.5, max = 30 } = {}) {
  let t = 0;
  while (t < max * 1000) {
    await page.clock.fastForward(PREROLL_STEP);
    t += PREROLL_STEP;
    const s = await look(page, n);
    if (s.seeking) await seeked(page);
    const clip = s.clips.some((c) => c.src);
    if (t >= min * 1000 && s.running === 0 && ((!s.flying && s.assembled) || (clip && s.cover))) break;
  }
  return t / 1000;
}

// Frames of the slide on screen until it has settled and held, into one file
// (and its plate). → the segment's entry for the edit list, or a skip.
async function recordSegment({ page, cdp }, n, k, o, ff, enc) {
  const name = k ? `${pad(n)}-c${k}` : pad(n);
  const file = join(o.out, `${name}.mp4`), plateFile = join(o.out, `${name}-plate.mp4`);
  const step = 1000 / o.fps;
  let pipe = null, platePipe = null;
  const hash = createHash('sha1'), plateHash = createHash('sha1');
  let i = 0, settledAt = -1, holdFrames = Math.round(o.hold * o.fps), capped = false, last = null, clip = null;
  const warnings = [];
  const t0 = Date.now();
  try {
    for (;;) {
      await page.clock.fastForward(Math.round((i + 1) * step) - Math.round(i * step));
      const s = await look(page, n);
      last = s;
      clip = s.clips.find((c) => c.src) || clip;
      // a clip this browser cannot decode, or one from another origin, cannot be
      // stepped: hand the editor the source instead
      const undecodable = s.clips.find((c) => c.src && !c.decodable);
      if (undecodable || (clip && !clip.sameOrigin)) {
        pipe?.kill(); platePipe?.kill();
        await rm(file, { force: true }); await rm(plateFile, { force: true });
        const note = undecodable
          ? 'this browser cannot decode the clip: cut in the source clip, or record with --chromium pointing at a build that can'
          : 'the clip comes from another origin and cannot be stepped frame by frame: cut in the source clip';
        return { slide: n, clicks: k, skipped: true, note, clip: { src: (undecodable || clip).src }, at: s.at, station: s.station };
      }
      if (s.seeking) await seeked(page, (w) => warnings.push(`frame ${i}: ${w}`));
      if (!pipe) {
        pipe = encoder(ff, enc, { fps: o.fps, out: file });
        // a clip is the picture itself: no plate for a clip slide
        if (o.plate && !clip) platePipe = encoder(ff, enc, { fps: o.fps, out: plateFile });
      }
      const png = await snap(cdp);
      hash.update(png);
      await pipe.write(png);
      if (platePipe) {
        await page.evaluate(() => window.__rec.plate(true));
        const plain = await snap(cdp);
        await page.evaluate(() => window.__rec.plate(false));
        plateHash.update(plain);
        await platePipe.write(plain);
      }
      i++;
      if (settledAt < 0 && s.running === 0 && ((!s.flying && s.assembled && !clip) || (clip && s.cover))) {
        settledAt = i;
        // a clip that plays to its end holds for the rest of it
        if (clip && !clip.loop && clip.duration) holdFrames = Math.max(1, Math.ceil((clip.duration - clip.t) * o.fps));
      }
      if (settledAt >= 0 && i - settledAt >= holdFrames) break;
      if (i >= Math.round(o.max * o.fps)) { capped = true; break; }
    }
    await pipe.close();
    if (platePipe) await platePipe.close();
  } catch (e) {
    pipe?.kill(); platePipe?.kill();
    throw e;
  }
  const seconds = (Date.now() - t0) / 1000;
  return {
    slide: n, clicks: k, file: `${name}.mp4`, plate: platePipe ? `${name}-plate.mp4` : null,
    frames: i, seconds: +(i / o.fps).toFixed(3), settle: settledAt >= 0 ? +(settledAt / o.fps).toFixed(3) : null, capped,
    at: last?.at ?? null, station: last?.station ?? null,
    clip: clip ? { src: clip.src, recorded: true } : null,
    sha1: hash.digest('hex'), plateSha1: platePipe ? plateHash.digest('hex') : null,
    secondsPerFrame: +(seconds / i).toFixed(3),
    ...(warnings.length ? { warnings: warnings.slice(0, 10) } : {}),
  };
}

export async function record(o, log = console.log) {
  const chromium = await loadChromium('slidev-stage-record');
  const dist = resolve(o.dist);
  o.out = resolve(o.out);
  await mkdir(o.out, { recursive: true });
  const ff = resolveFfmpeg();
  const enc = pickEncoder(ff, o.encoder);
  const base = normaliseBase(o.base, dist);
  const { server, url, misses } = await serve(dist, { base });
  const { browser, renderer, executablePath, version } = await launchBrowser(chromium, { gl: o.gl, executable: o.chromium || undefined });
  log(`renderer: ${renderer}\nbrowser:  ${executablePath} (${version})\nffmpeg:   ${ff} (${enc.name})`);
  const errors = [];
  const report = {
    deck: dist, base, size: o.size, fps: o.fps, seed: o.seed, hold: o.hold, renderer, browser: version, ffmpeg: ff, encoder: enc.name,
    look: null, segments: [],
  };
  const save = () => writeFile(join(o.out, 'index.json'), JSON.stringify(report, null, 2) + '\n');
  const clicksFor = (n, total) => {
    if (o.clicks === 'none') return 0;
    if (o.clicks && typeof o.clicks === 'object') return Number(o.clicks[n] ?? 0);
    return total;
  };
  let frames = 0, wall = 0;
  try {
    for (const n of parseSlides(o.slides, 500)) {
      // each slide starts fresh, from the slide before it (at its last click),
      // settled: the arrival is the one a presenter's audience would see
      const from = Math.max(1, n - 1);
      const deck = await openDeck(browser, o, url, from, errors);
      try {
        if (n > 1) {
          const before = await look(deck.page, from);
          if (before.slide !== from) { log(`slide ${from} not found: the deck ends there`); break; }
          if (before.clicksTotal) await goTo(deck.page, from, before.clicksTotal);
          await settle(deck.page, from);
          if (!(await goTo(deck.page, n))) { log(`slide ${n} not found: the deck ends at ${from}`); break; }
        }
        const first = await look(deck.page, n);
        report.look = first.look;
        const total = clicksFor(n, first.clicksTotal);
        for (let k = 0; k <= total; k++) {
          if (k > 0) {
            await deck.page.keyboard.press('ArrowRight');
            await deck.page.waitForFunction((k) => window.__rec.state(0).clicks >= k, k, { polling: 20, timeout: 10000 }).catch(() => {});
          }
          const t0 = Date.now();
          const seg = await recordSegment(deck, n, k, o, ff, enc);
          if (!seg.skipped) {
            if (o.flash) {
              const small = await decodeSmall(ff, join(o.out, seg.file));
              const { transitions, warnings } = findFlashes(small, { w: 48, h: 27, fps: o.fps });
              seg.flash = { transitions: transitions.length, warnings };
            }
            frames += seg.frames; wall += (Date.now() - t0) / 1000;
            log(`${seg.file}  ${seg.frames} frames  ${seg.seconds} s  settled at ${seg.settle ?? '-'} s${seg.capped ? ' (capped by --max)' : ''}  ${seg.secondsPerFrame} s/frame${seg.flash?.warnings.length ? `  FLASH: ${seg.flash.warnings.map((w) => `${w.flashes}/s at ${w.t} s`).join(', ')}` : ''}${seg.warnings ? `\n  ${seg.warnings.join('\n  ')}` : ''}`);
          } else log(`${pad(n)}${k ? `-c${k}` : ''}  skipped: ${seg.note} (${seg.clip.src})`);
          report.segments.push(seg);
          await save();
        }
      } finally {
        await deck.context.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  // where each file falls in a straight cut of them all, in order
  let at = 0;
  for (const s of report.segments) if (!s.skipped) { s.start = +at.toFixed(3); at += s.seconds; }
  report.secondsPerFrame = frames ? +(wall / frames).toFixed(3) : null;
  report.errors = [...new Set(errors)].slice(0, 20);
  report.missing = [...new Set(misses)].slice(0, 20);
  await save();
  return report;
}

export async function main(argv = process.argv.slice(2)) {
  let o;
  try { o = parseArgs(argv); } catch (e) { console.error(e.message); console.log(USAGE); return 2; }
  if (o.help || !o.dist || !o.out) { console.log(USAGE); return o.help ? 0 : 2; }
  let r;
  try { r = await record(o); } catch (e) { console.error(e.message || e); return 1; }
  if (r.errors.length) console.log(`\npage errors:\n  ${r.errors.join('\n  ')}`);
  if (r.missing.length) console.log(`\nnot in the dist: ${r.missing.join(', ')}`);
  const done = r.segments.filter((s) => !s.skipped);
  console.log(`\n${done.length} file(s), ${r.segments.length - done.length} skipped, ${r.secondsPerFrame ?? '-'} s a frame, in ${o.out} (index.json)`);
  return 0;
}

const invoked = (() => { try { return pathToFileURL(realpathSync(process.argv[1] || '')).href; } catch { return ''; } })();
if (import.meta.url === invoked) process.exit(await main());
