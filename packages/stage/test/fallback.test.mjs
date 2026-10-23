// The fallback layers (stage/fallback.js, components/StagePlate.vue, and
// what Stage.vue wires): where the world cannot run, which of a recorded
// plate, the living still and the still alone takes its place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fallbackLayer, plateName, plateUrls, plateRelease, platesDir, plateLocalFirst, plateEntry, plateStep, handOverWithout, capShowsWord, LAYERS, PLATE_REASONS } from '../stage/fallback.js';
import { STAGE_OVER_WORLD, PLATE_HIDDEN, recorderHooks } from '../bin/lib/record-page.mjs';
import { FALLBACK_REASONS } from '../stage/diagnose.js';
import { STAGE_KEYS } from '../stage/types.js';

const here = (p) => new URL(p, import.meta.url);
const read = (p) => readFileSync(here(p), 'utf8');

// ---- which layer ---------------------------------------------------------------------------
test('every reason, every motion, plates on and off: one layer each', () => {
  assert.deepEqual(LAYERS, ['world', 'world-floor', 'plate', 'living', 'still']);
  assert.deepEqual(PLATE_REASONS, ['no-webgl2', 'no-float-target', 'plugin', 'data', 'init', 'context-lost']);
  assert.deepEqual([...PLATE_REASONS, 'reduced-motion'].sort(), [...FALLBACK_REASONS].sort());   // diagnose.js's list, whole
  const motions = ['respect', 'floor', undefined, 'bogus'];
  const on = ['videos', 'plates', undefined], off = [false, '', null];
  for (const motion of motions) {
    // reduced motion: the world at its floor when the deck says so (T1 makes the
    // engine honour it), else the still alone — a plate and a drifting still are motion too
    for (const plates of [...on, ...off]) {
      assert.equal(fallbackLayer('reduced-motion', { motion, plates }), motion === 'floor' ? 'world-floor' : 'still', `reduced-motion ${motion} ${plates}`);
    }
    for (const reason of PLATE_REASONS) {
      for (const plates of on) assert.equal(fallbackLayer(reason, { motion, plates }), 'plate', `${reason} ${motion} ${plates}`);
      for (const plates of off) assert.equal(fallbackLayer(reason, { motion, plates }), 'living', `${reason} ${motion} ${plates}`);
    }
    // a reason the table does not know is still a world that cannot run: the plate, else the living still
    assert.equal(fallbackLayer('shader', { motion, plates: 'videos' }), 'plate');
    assert.equal(fallbackLayer('shader', { motion, plates: false }), 'living');
  }
  // no reason: the world runs
  for (const none of ['', null, undefined]) assert.equal(fallbackLayer(none, { motion: 'respect', plates: 'videos' }), 'world');
  // the defaults: motion respect, plates on
  assert.equal(fallbackLayer('no-webgl2'), 'plate');
  assert.equal(fallbackLayer('reduced-motion'), 'still');
  assert.equal(fallbackLayer('no-webgl2', {}), 'plate');
});

// ---- the plates' names and URLs -----------------------------------------------------------------
test('a plate is named as the recorder names it, two digits', () => {
  assert.equal(plateName(3), '03-plate.mp4');
  assert.equal(plateName(12), '12-plate.mp4');
  assert.equal(plateName('7'), '07-plate.mp4');
  assert.equal(plateName(101), '101-plate.mp4');
  for (const bad of [0, -1, NaN, null, undefined, '']) assert.equal(plateName(bad), '', String(bad));
});

test('the plates\' folder is read as the stills\' is', () => {
  assert.equal(platesDir(undefined), 'videos');
  assert.equal(platesDir(''), 'videos');
  assert.equal(platesDir('  '), 'videos');
  assert.equal(platesDir('plates'), 'plates');
  assert.equal(platesDir('/videos/plates/'), 'videos/plates');
  for (const off of [false, 'false', null]) assert.equal(platesDir(off), '', String(off));
});

test('the chain of a plate is the player\'s: local and the release, the deck\'s base first, local first in dev', () => {
  const base = '/cern_outreach_talks/2026_10_23_Innoday/';
  const remote = 'https://github.com/MindaugasSarpis/cern_outreach_talks/releases/download/videos-2026-10-00-innoday';
  const local = `${base}videos/09-plate.mp4`;
  assert.deepEqual(plateUrls('videos', 9, { base, remote, localFirst: true }), [local, `${remote}/09-plate.mp4`]);
  assert.deepEqual(plateUrls('videos', 9, { base, remote, localFirst: false }), [`${remote}/09-plate.mp4`, local]);
  assert.deepEqual(plateUrls('videos', 9, { base, remote }), [`${remote}/09-plate.mp4`, local]);          // a deploy: the release first
  assert.deepEqual(plateUrls('videos', 9, { base, remote: '', localFirst: false }), [local]);               // no release configured: local only
  assert.deepEqual(plateUrls('videos', 9, { base }), [local]);
  // the base and the release with or without their trailing slash, the folder with or without its own
  assert.deepEqual(plateUrls('videos', 9, { base: base.slice(0, -1), remote: `${remote}/`, localFirst: true }), [local, `${remote}/09-plate.mp4`]);
  assert.deepEqual(plateUrls('/videos/', 9, { base, localFirst: true }), [local]);
  assert.deepEqual(plateUrls('videos', 9, {}), ['/videos/09-plate.mp4']);
  // plates off, or no slide: nothing to try
  assert.deepEqual(plateUrls('', 9, { base, remote }), []);
  assert.deepEqual(plateUrls(false, 9, { base, remote }), []);
  assert.deepEqual(plateUrls('videos', 0, { base, remote }), []);
  assert.deepEqual(plateUrls('videos', NaN, { base, remote }), []);
});

test('the release the plates are pulled from: stage.platesRelease, else the videos addon\'s', () => {
  const videos = { repo: 'MindaugasSarpis/cern_outreach_talks', release: 'videos-2026-10-00-innoday' };
  const dl = 'https://github.com/MindaugasSarpis/cern_outreach_talks/releases/download/videos-2026-10-00-innoday';
  assert.equal(plateRelease(undefined, videos, {}), dl);
  assert.equal(plateRelease('', videos, {}), dl);
  assert.equal(plateRelease(undefined, { repo: videos.repo }, {}), dl.replace('videos-2026-10-00-innoday', 'videos'));   // the addon's default tag
  assert.equal(plateRelease(undefined, {}, { VITE_VIDEO_REPO: 'o/r', VITE_VIDEO_RELEASE: 'v1' }), 'https://github.com/o/r/releases/download/v1');
  assert.equal(plateRelease(undefined, { release: 'v2' }, { VITE_VIDEO_REPO: 'o/r' }), 'https://github.com/o/r/releases/download/v2');   // headmatter beats env
  assert.equal(plateRelease(undefined, undefined, {}), '');           // no repo anywhere: local only
  assert.equal(plateRelease(undefined, {}, undefined), '');
  // the deck's own: a URL, or owner/repo@tag; false turns the remote off
  assert.equal(plateRelease('https://cdn.example.org/plates/', videos, {}), 'https://cdn.example.org/plates');
  assert.equal(plateRelease('o/r@plates-1', videos, {}), 'https://github.com/o/r/releases/download/plates-1');
  assert.equal(plateRelease(false, videos, {}), '');
  assert.equal(plateRelease('nonsense', videos, {}), '');            // not a URL, not a release: no remote
});

test('local first in dev, or when the build says so', () => {
  assert.equal(plateLocalFirst({ DEV: true }), true);
  assert.equal(plateLocalFirst({ DEV: false, VITE_VIDEOS_LOCAL_FIRST: '1' }), true);
  assert.equal(plateLocalFirst({ VITE_VIDEOS_LOCAL_FIRST: '0' }), false);
  assert.equal(plateLocalFirst({}), false);
  assert.equal(plateLocalFirst(undefined), false);
});

// ---- how a plate enters ---------------------------------------------------------------------
test('only a forward step from the slide before replays a plate\'s arrival; a back-step, a jump or a mount mid-deck holds the settled world', () => {
  assert.equal(plateEntry(8, 9), 'replay');
  assert.equal(plateEntry('8', '9'), 'replay');     // as a dataset would hand them
  assert.equal(plateEntry(10, 9), 'hold');           // a back-step: the flight the audience saw, the other way — and after a clip slide, the clip's end again
  assert.equal(plateEntry(9, 8), 'hold');
  assert.equal(plateEntry(8, 10), 'hold');           // a jump
  assert.equal(plateEntry(3, 12), 'hold');
  assert.equal(plateEntry(12, 3), 'hold');
  assert.equal(plateEntry(9, 9), 'hold');            // no step at all
  // the layer mounting: the deck's opening at slide 1 is an arrival; mid-deck (a reload, a late fallback) the settled world
  assert.equal(plateEntry(null, 1), 'replay');
  assert.equal(plateEntry(undefined, 1), 'replay');
  assert.equal(plateEntry(null, 2), 'hold');
  assert.equal(plateEntry(undefined, 7), 'hold');
  for (const bad of [NaN, 'x', {}]) { assert.equal(plateEntry(bad, 1), 'hold', String(bad)); assert.equal(plateEntry(1, bad), 'hold', String(bad)); }
});

// A back-step 10→9 at Innoday (v0.8.2, forced no-webgl2) read data-stage-plate="playing": sync()
// let go of the hold as soon as the seek to the end was *issued*, and in the same call, the seek
// not landed (el.ended still false), played the plate. A slide entered to hold never plays on that
// visit: the seek is made once, and it rests until the seek lands and it is ended (`held`).
test('plateStep: a slide to hold is seeked to its end once and never played on that visit, landed or not', () => {
  const base = { current: true, hold: true, sought: false, covered: false, hidden: false, ended: false };
  assert.deepEqual(plateStep(base), { seek: true, run: 'pause' });                           // the back-step: seek, rest
  assert.deepEqual(plateStep({ ...base, sought: true }), { seek: false, run: 'pause' });    // the seek in flight (the bug: played here)
  assert.deepEqual(plateStep({ ...base, sought: true, ended: true }), { seek: false, run: 'pause' });   // landed: held
  // a forward step replays; covered, hidden or ended rests; a slide not on screen rests where it stands
  assert.deepEqual(plateStep({ ...base, hold: false }), { seek: false, run: 'play' });
  for (const k of ['covered', 'hidden', 'ended']) assert.deepEqual(plateStep({ ...base, hold: false, [k]: true }), { seek: false, run: 'pause' }, k);
  assert.deepEqual(plateStep({ ...base, current: false }), { seek: false, run: 'pause' });
  assert.deepEqual(plateStep({ ...base, current: false, hold: false }), { seek: false, run: 'pause' });
});

// ---- what a plate holds ---------------------------------------------------------------------
test('a plate is the world alone: the recorder\'s text-free pass hides what the stage draws live over it, as --stills does, and the push overlay', () => {
  // what the stage draws over the world, live, over a plate and a still alike: baked in, the scrim would be drawn twice (the world at dim² of its light)
  assert.deepEqual(STAGE_OVER_WORLD, ['.stage .scrim', '.stage .grain', '.stage .hud']);
  for (const s of STAGE_OVER_WORLD) assert.ok(PLATE_HIDDEN.includes(s), s);
  // the slide's own layer (its clip with it), the halo, and the videos addon's push and dust overlay (components/VideoDust.vue's class names): a plate never holds a push
  for (const s of ['.slidev-layout', '.halo-layer', '.video-dust', '.video-zoom']) assert.ok(PLATE_HIDDEN.includes(s), s);
  assert.equal(new Set(PLATE_HIDDEN).size, PLATE_HIDDEN.length);
  const dust = read('../../../components/VideoDust.vue');
  for (const c of ['video-dust', 'video-zoom']) assert.match(dust, new RegExp(`class="${c}"`), c);
  // addInitScript serialises the hooks: the list reaches the page as their argument, and the recorder passes it
  const hooks = recorderHooks.toString();
  assert.match(hooks, /^function recorderHooks\(\{ hidden = \[\] \} = \{\}\)/);
  assert.match(hooks, /hidden\.map\(\(s\) => `html\[data-rec-plate\] \$\{s\}`\)\.join\(', '\)\} \{ visibility: hidden !important; \}/);
  assert.doesNotMatch(hooks, /html\[data-rec-plate\] \.slidev-layout/);   // no list of its own
  assert.match(read('../bin/record.mjs'), /addInitScript\(recorderHooks, \{ hidden: PLATE_HIDDEN \}\)/);
  // --stills hides the same of the stage, from the same list
  const shots = read('../bin/shots.mjs');
  assert.match(shots, /import \{ STAGE_OVER_WORLD \} from '\.\/lib\/record-page\.mjs'/);
  assert.match(shots, /addInitScript\(pageInit, \{[^}]*\bover: STAGE_OVER_WORLD\b[^}]*\}\)/);
  assert.match(shots, /\$\{cfg\.over\.join\(', '\)\}, \.stage-debug \{ visibility: hidden !important; \}/);
  assert.doesNotMatch(shots, /\.stage \.scrim, \.stage \.grain/);           // no list of its own either
});

// ---- v0.9.0's hand-over without a world ----------------------------------------------------
// <StageDepthGrains> opens on a clip's last frame and fades it into grains of the world. The
// recorder's text-free pass hides the slide (the still with it), so a plate of that slide begins
// on the world with no grains yet and films them come in: the still must fade onto it as live,
// not cover it. Without a plate the still stays, as v0.9.0 has it.
test('the hand-over without a world: the still stays unless a plate plays under it; it fades as the plate plays, and is gone once the plate holds', () => {
  for (const layer of ['living', 'still', 'world-floor', 'world', '', undefined]) {
    for (const plate of ['none', 'loading', 'playing', 'paused', 'held', undefined]) {
      assert.deepEqual(handOverWithout(layer, plate), { still: 'stay', word: true }, `${layer}/${plate}`);
    }
  }
  assert.deepEqual(handOverWithout('plate', 'none'), { still: 'stay', word: true });       // no plate for this slide: the living still comes
  assert.deepEqual(handOverWithout('plate', undefined), { still: 'stay', word: true });
  assert.deepEqual(handOverWithout('plate', 'loading'), { still: 'stay', word: false });   // a plate with no frame yet is transparent: the still covers it
  assert.deepEqual(handOverWithout('plate', 'playing'), { still: 'fade', word: false });   // the arrival the recorder filmed: the grains come in under the fading still
  assert.deepEqual(handOverWithout('plate', 'paused'), { still: 'fade', word: false });
  assert.deepEqual(handOverWithout('plate', 'held'), { still: 'gone', word: true });       // the settled world (a back-step, a jump, the plate's end): the word  // a plate that stalls once it has played (venue Wi-Fi, readyState down to 2) still has its frame: the
  // fade goes on, the clip's last frame does not come back over the half-pulled-back world
  assert.deepEqual(handOverWithout('plate', 'loading', { played: true }), { still: 'fade', word: false });
  assert.deepEqual(handOverWithout('plate', 'loading', { played: false }), { still: 'stay', word: false });
  // … but a plate given up (the layer drops to the living still) brings the still back, played or not
  assert.deepEqual(handOverWithout('living', 'none', { played: true }), { still: 'stay', word: true });
  assert.deepEqual(handOverWithout('plate', 'none', { played: true }), { still: 'stay', word: true });
});

// The 8 s cap is for a plate that never loads (a hanging URL). A plate that plays is
// the arrival the recorder filmed, and its word comes with its end (held): the cap
// showed it at 8 s on example-lhcb's slide 5, a 17 s plate still playing. A plate
// that stalls past the cap, or never played, gets the word by it as before.
test('the 8 s cap shows the word unless the plate is playing', () => {
  assert.equal(capShowsWord('playing', true), false);
  for (const plate of ['loading', 'paused', 'none', 'held', undefined]) {
    assert.equal(capShowsWord(plate, true), true, `played/${plate}`);
    assert.equal(capShowsWord(plate, false), true, `not played/${plate}`);
  }
});

test('StageDepthGrains reads the layer and the plate off <html> where the world cannot run, and follows them', () => {
  const src = read('../components/StageDepthGrains.vue');
  assert.match(src, /import \{[^}]*\bhandOverWithout\b[^}]*\} from '\.\.\/stage\/fallback\.js'/);
  assert.match(src, /dataset\.stageLayer/);
  assert.match(src, /dataset\.stagePlate\b/);
  // it follows them as they change (loading → playing → held, or the plate given up for the living still)
  assert.match(src, /new MutationObserver\(/);
  assert.match(src, /attributeFilter: \['data-stage-layer', 'data-stage-plate'\]/);
  // the fade waits the live hand-over's `hold` and takes its `fade`: the plate was filmed on that timeline
  assert.match(src, /props\.hold/);
  // its first read waits a task: on slide enter <html> may still carry the slide before's
  // plate (`held` at its end) until StagePlate's own watch has published this slide's
  assert.match(src, /later\(0, follow\)/);
  assert.doesNotMatch(src, /attributeFilter[^\n]*\n\s*follow\(\)/);
  // once the plate has played, a stall is no reason to cover it again
  assert.match(src, /handOverWithout\(html\.dataset\.stageLayer, html\.dataset\.stagePlate, \{ played \}\)/);
  // a plate that never loads: the word by v0.9.0's 8 s all the same, not wordBy's 34
  assert.match(src, /later\(LOADING_CAP, /);
  // … and waits while the plate plays, looking again until it is not
  assert.match(src, /const cap = \(\) => \{\n\s+if \(id !== run\) return\n\s+if \(!capShowsWord\(html\.dataset\.stagePlate, played\)\) return later\(500, cap\)\n\s+word\.value = true\n\s+\}\n\s+later\(LOADING_CAP, cap\)/);
  assert.match(src, /const LOADING_CAP = 8000\b/);
  // a fallback after the hand-over began (a context lost for good, a rebuild that fails): followed at once
  assert.match(src, /addEventListener\('slidev-stage:fallback', onFallback\)/);
  assert.match(src, /removeEventListener\('slidev-stage:fallback', onFallback\)/);
  // the observer goes when the slide is left or the component unmounts
  assert.match(src, /\.disconnect\(\)/);
});

// ---- the components -------------------------------------------------------------------------
test('StagePlate plays the slide\'s plate muted, holds its last frame, says on <html> what it has, and keeps a slide each side', () => {
  const src = read('../components/StagePlate.vue');
  const propsBlock = /defineProps\(\{([\s\S]*?)\n\}\)/.exec(src)[1];
  const props = Object.fromEntries([...propsBlock.matchAll(/^\s+(\w+): \{ type: (\w+)(?:, default: ([^}]+?))? \},?$/gm)].map((m) => [m[1], { type: m[2], def: m[3]?.trim() }]));
  assert.deepEqual(props, {
    slide: { type: 'Number', def: '1' },
    total: { type: 'Number', def: '0' },
    dir: { type: 'String', def: "'videos'" },
    base: { type: 'String', def: "'/'" },
    remote: { type: 'String', def: "''" },
    localFirst: { type: 'Boolean', def: 'false' },
    covered: { type: 'Boolean', def: 'false' },
  });
  assert.match(src, /defineEmits\(\['state', 'exhausted'\]\)/);
  const tpl = /<template>([\s\S]*?)<\/template>/.exec(src)[1];
  const videos = [...tpl.matchAll(/<video\b[\s\S]*?<\/video>/g)].map((m) => m[0]);
  assert.equal(videos.length, 1);                                          // one element per slide of the window, from one tag
  const video = videos[0];
  assert.match(video, /\bv-for="no in slots"/);
  assert.match(video, /:key="no"/);                                        // keyed by the slide: a step keeps the elements it has
  assert.match(video, /\bmuted\b/);
  assert.match(video, /\bplaysinline\b/);
  assert.match(video, /preload="auto"/);
  assert.doesNotMatch(video, /\bloop\b/);                                 // ended: the last frame holds
  assert.doesNotMatch(video, /\bposter\b/);                               // the living still under it is the poster, and a held plate before it (continuity)
  assert.doesNotMatch(video, /\bautoplay\b/);                             // play() is the stage's own call, after the cover and the tab are read
  assert.doesNotMatch(video, /\bcontrols\b/);
  assert.match(src, /plateUrls\(/);                                         // the chain, fall-through on error
  assert.match(src, /@error="/);
  assert.match(src, /@canplay="/);
  assert.match(src, /@ended="/);
  assert.match(src, /@loadedmetadata="sync"/);                             // a slide to hold is seeked as soon as it has its duration
  assert.match(src, /@seeked="sync"/);                                     // and says `held` once the seek has landed
  assert.match(src, /dataset\.stagePlate = /);
  assert.match(src, /dataset\.stagePlateNext = String\(/);
  assert.match(src, /delete html\.dataset\.stagePlateNext/);
  assert.match(src, /delete html\.dataset\.stagePlate\b/);
  assert.match(src, /document\.hidden/);
  assert.match(src, /props\.covered/);
  assert.match(src, /visibilitychange/);
  assert.match(src, /const KEEP_BEHIND = 1\b/);                             // n−1 stays loaded for a back-step
  assert.match(src, /const PRELOAD_AHEAD = 1\b/);                           // n+1 loads under this slide
  // how a plate enters is plateEntry's: a forward step replays from 0, anything else seeks to the end and holds; the next slide's element goes back to its start while hidden
  assert.match(src, /import \{[^}]*\bplateEntry\b[^}]*\} from '\.\.\/stage\/fallback\.js'/);
  assert.match(src, /watch\(\(\) => props\.slide, \(n, was\) => \{/);
  assert.match(src, /if \(plateEntry\(was, n\) === 'hold'\) hold\.add\(n\); else hold\.delete\(n\)/);
  assert.match(src, /if \(plateEntry\(null, props\.slide\) === 'hold'\) hold\.add\(props\.slide\)/);   // mounted mid-deck
  assert.match(src, /el\.currentTime = el\.duration/);
  assert.match(src, /if \(el && el\.readyState > 0 && !hold\.has\(n\)\) \{ try \{ el\.currentTime = 0 \}/);
  assert.match(src, /const ahead = els\.get\(n \+ 1\)\n\s+if \(ahead && ahead\.readyState > 0 && ahead\.currentTime > 0\) \{ try \{ ahead\.currentTime = 0 \}/);
  // each element's step is plateStep's; the hold lasts the visit (it is not let go when the seek is issued), the seek is made once per visit
  assert.match(src, /const step = plateStep\(\{ current: no === props\.slide, hold: hold\.has\(no\), sought: sought\.has\(no\), covered: props\.covered, hidden, ended: el\.ended \}\)/);
  assert.match(src, /if \(step\.seek && seekEnd\(no\)\) sought\.add\(no\)/);
  assert.doesNotMatch(src, /hold\.delete\(no\)/);
  assert.match(src, /sought\.delete\(n\)/);                                // a new visit seeks again
  assert.match(src, /emit\('exhausted'/);
  assert.match(src, /emit\('state'/);
  assert.doesNotMatch(src, /\bconfigs\b/);                                  // it reads no headmatter: Stage.vue hands it everything
  assert.doesNotMatch(src, /#[0-9a-f]{3,8}\b/i);
  // the states it publishes
  for (const s of ['loading', 'playing', 'paused', 'held', 'none']) assert.match(src, new RegExp(`'${s}'`), s);
});

test('Stage.vue wires the layers: the still, the living still, the plate, then the scrim; the reason on <html> and on window', () => {
  const src = read('../components/Stage.vue');
  assert.match(src, /import StageLiving from '\.\/StageLiving\.vue'/);
  assert.match(src, /import StagePlate from '\.\/StagePlate\.vue'/);
  assert.match(src, /import \{[^}]*\bfallbackLayer\b[^}]*\} from '\.\.\/stage\/fallback\.js'/);
  // the order in the template: still, living, plate, scrim, grain
  const tpl = /<template>([\s\S]*?)<\/template>/.exec(src)[1];
  const at = (re) => { const m = re.exec(tpl); assert.ok(m, String(re)); return m.index; };
  const still = at(/<img v-if="[^"]*stillShown[^"]*" class="still"/), living = at(/<StageLiving\b/), plate = at(/<StagePlate\b/), scrim = at(/<div class="scrim"/), grain = at(/class="grain"/);
  assert.ok(still < living && living < plate && plate < scrim && scrim < grain, 'still < living < plate < scrim < grain');
  // the living still: the slide's still, its number as the seed, rests under a cover, the deck's motion, a missing still reported as the stage's own
  const livingTag = /<StageLiving\b([^>]*)\/>/.exec(tpl)[1];
  for (const p of [':src="', ':seed="nav.currentSlideNo.value"', ':covered="', ':motion="MOTION"', '@error="onStillError"']) assert.ok(livingTag.includes(p), p);
  const plateTag = /<StagePlate\b([^>]*)\/>/.exec(tpl)[1];
  for (const p of [':slide="nav.currentSlideNo.value"', ':total="', ':dir="PLATES"', ':base="', ':remote="PLATE_REMOTE"', ':local-first="PLATE_LOCAL_FIRST"', ':covered="covered"', '@state="', '@exhausted="']) assert.ok(plateTag.includes(p), p);
  // the plate stays mounted while the base layer is plate: a slide without one drops to the living still, the loaded neighbours stay
  assert.match(plateTag, /v-if="[^"]*layerBase === 'plate'/);
  assert.match(livingTag, /v-if="livingOn"/);
  assert.match(src, /const livingOn = computed\(\(\) => !printing\.value && \(layerBase\.value === 'plate' \|\| layerBase\.value === 'living'\)\)/);
  assert.match(tpl, /<img v-if="stillShown && !livingOn" class="still"/);     // the still is drawn once: the living still carries its own
  // the reason on <html> (T4's player reads it) and on window (the talks' LhcOpening listens), cleared on a rebuild and on unmount
  assert.match(src, /html\.dataset\.stageFallback = reason/);
  assert.match(src, /new CustomEvent\('slidev-stage:fallback', \{ detail: \{ reason, detail, layer/);
  assert.match(src, /dataset\.stageLayer = /);
  assert.equal((src.match(/delete html\.dataset\.stageFallback/g) || []).length >= 2, true);    // rebuild and unmount
  assert.equal((src.match(/delete html\.dataset\.stagePlateNext/g) || []).length, 1);          // unmount alone: a rebuild has no StagePlate to take it from (the layer is `still` while restoring)
  assert.equal((src.match(/delete html\.dataset\.stageLayer/g) || []).length >= 1, true);
  // the new keys, read where the validator can see them
  for (const k of ['motion', 'plates', 'platesRelease']) assert.match(src, new RegExp(`CFG\\.${k}\\b`), k);
  assert.match(src, /plateRelease\(CFG\.platesRelease, configs(?:\s*&&\s*configs|\?\.)?\.videos, import\.meta\.env\)/);
  // reduced motion with motion: floor runs the world (at its floor once T1 lands) rather than stopping it
  assert.match(src, /world-floor/);
  // covered became a ref (the living still and the plate take it as a prop)
  assert.match(src, /const covered = ref\(false\)/);
  assert.doesNotMatch(src, /let covered\b/);
});

test('the stage keys the new config reads are the validator\'s', () => {
  for (const k of ['motion', 'plates', 'platesRelease']) assert.ok(STAGE_KEYS.includes(k), k);
});

// ---- the SFCs compile -----------------------------------------------------------------------
// @vue/compiler-sfc is vue's own (a peer of the addon), reachable here only
// through the workspace's pnpm store; where it is not installed the check is
// skipped, not failed.
function compilerSfc() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const store = join(dir, 'node_modules', '.pnpm');
    if (existsSync(store)) {
      const hit = readdirSync(store).filter((d) => d.startsWith('@vue+compiler-sfc@')).sort().pop();
      if (hit) {
        const pkg = join(store, hit, 'node_modules', '@vue', 'compiler-sfc');
        return createRequire(pathToFileURL(join(pkg, 'package.json')))(pkg);
      }
    }
    dir = dirname(dir);
  }
  return null;
}

test('Stage.vue, StagePlate.vue, StageLiving.vue and StageDepthGrains.vue compile', (t) => {
  const sfc = compilerSfc();
  if (!sfc) { t.skip('@vue/compiler-sfc not installed'); return; }
  for (const f of ['Stage.vue', 'StagePlate.vue', 'StageLiving.vue', 'StageDepthGrains.vue']) {
    const { descriptor, errors } = sfc.parse(read(`../components/${f}`), { filename: f });
    assert.deepEqual(errors, [], f);
    const id = f.replace(/\W/g, '');
    const script = sfc.compileScript(descriptor, { id, inlineTemplate: false });
    assert.ok(script.content.length > 0, f);
    const tpl = sfc.compileTemplate({ id, filename: f, source: descriptor.template.content, compilerOptions: { bindingMetadata: script.bindings } });
    assert.deepEqual(tpl.errors, [], f);
    for (const s of descriptor.styles) assert.deepEqual(sfc.compileStyle({ id, filename: f, source: s.content, scoped: s.scoped }).errors, [], f);
  }
});
