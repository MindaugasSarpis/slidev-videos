// node --test test/   — the broadcast look, the recorder's and the safe check's
// pure parts (the browser runs are in the README's verification).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LOOKS, PALETTES, resolveLook, resolvePalette, liftGround, definePalette, paletteVars } from '../stage/palette.js';
import { parseArgs as recordArgs, main as recordMain, glMode, trackClip, clipEntry, embedEntry } from '../bin/record.mjs';
import { parseArgs as safeArgs, main as safeMain, judge, RULES } from '../bin/safe.mjs';
import { detectBase, normaliseBase, parseSlides, checkSlides, parseSize } from '../bin/lib/record-serve.mjs';
import { findFlashes } from '../bin/lib/record-flash.mjs';
import { ffmpegCandidates, PROFILES, pickEncoder, plateEncoder, ffmpegArgs } from '../bin/lib/record-ffmpeg.mjs';

const here = (p) => new URL(p, import.meta.url);

// ---- the look ----------------------------------------------------------------------
test('the broadcast look sits over any palette and caps its nebula', () => {
  const blue = resolveLook('blue', 'broadcast');
  assert.equal(blue.nebula, 0.3);                  // blue brings 0.8
  assert.equal(blue.grain, 0);
  assert.equal(blue.aberration, 0);
  assert.equal(blue.guard, false);
  assert.equal(blue.halo, false);
  assert.deepEqual(blue.flight, [2.5, 5]);
  assert.equal(blue.max, undefined);               // the caps are not an option
  assert.equal(resolveLook('classic', 'broadcast').nebula, 0);   // a cap never adds
  assert.equal(resolveLook({ base: 'ember' }, 'broadcast').nebula, 0.3);
  assert.equal(resolveLook(undefined, 'broadcast').nebula, undefined);
  assert.deepEqual(resolveLook('blue'), { nebula: 0.8 });          // no look: the palette's, as before
  assert.deepEqual(resolveLook('blue', 'no-such'), { nebula: 0.8 });
});

test('the broadcast dust is half again the default grain', () => {
  const src = readFileSync(here('../stage/space.js'), 'utf8');
  const def = Number(/dustSize: ([\d.]+)/.exec(src)[1]);
  assert.ok(Math.abs(LOOKS.broadcast.dustSize - def * 1.5) < 0.01);
});

test('definePalette may bring a look', () => {
  definePalette('test-venue', { accent: '#ff5c8a' }, { nebula: 0.5, bloom: 0.4 });
  assert.deepEqual(resolveLook('test-venue'), { nebula: 0.5, bloom: 0.4 });
  assert.equal(resolveLook('test-venue', 'broadcast').nebula, 0.3);
  definePalette('test-plain', { accent: '#112233' });
  assert.deepEqual(resolveLook('test-plain'), {});
});

test('the ground is lifted in its own hue, whatever the accent', () => {
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  assert.equal(liftGround(PALETTES.blue, LOOKS.broadcast.lift).bg, '#090f1d');
  assert.equal(liftGround(PALETTES.blue, 0), PALETTES.blue);
  assert.equal(liftGround(PALETTES.blue, undefined), PALETTES.blue);
  assert.equal(liftGround(PALETTES.blue, 1).bg, '#ffffff');
  assert.equal(liftGround(PALETTES.blue, 0.06).accent, PALETTES.blue.accent);
  // a gold accent and violet dust over blue's ground: the ground stays blue
  const gold = resolvePalette({ base: 'blue', accent: '#ffc05a', dust: '#5b4fd6', nebula: '#3a2a9e', nebulaAlt: '#0f6e86' });
  const up = rgb(liftGround(gold, LOOKS.broadcast.lift).bg);
  assert.equal(liftGround(gold, LOOKS.broadcast.lift).bg, liftGround(PALETTES.blue, LOOKS.broadcast.lift).bg);
  assert.ok(up[2] > up[1] && up[1] > up[0], `still blue: ${up}`);
  for (const k of [0.06, 0.12, 0.3]) {
    const [r, g, b] = rgb(liftGround(gold, k).bg);
    assert.ok(b > g && g > r, `blue at ${k}: ${[r, g, b]}`);
  }
  // a warm ground stays warm, a near-neutral one near-neutral
  const [er, eg, eb] = rgb(liftGround(PALETTES.ember, 0.06).bg);
  assert.ok(er > eg && eg > eb, `ember: ${[er, eg, eb]}`);
  const c = rgb(liftGround(PALETTES.classic, 0.06).bg);
  assert.ok(Math.max(...c) - Math.min(...c) <= 5, `classic: ${c}`);
  // lifted further, lighter
  let last = 0;
  for (const k of [0.03, 0.06, 0.12, 0.5, 0.9]) {
    const y = rgb(liftGround(gold, k).bg).reduce((s, v) => s + v, 0);
    assert.ok(y > last, `${k}`);
    last = y;
  }
  const vars = paletteVars(PALETTES.blue);
  assert.equal(vars['--stage-dust'], PALETTES.blue.dust);
  assert.equal(vars['--stage-nebula'], PALETTES.blue.nebula);
});

test('every type size of the CSS kit follows the scale and the floor', () => {
  const css = readFileSync(here('../styles/index.css'), 'utf8');
  const sizes = [...css.matchAll(/font-size:\s*([^;!]+)/g)].map((m) => m[1].trim());
  assert.ok(sizes.length > 20);
  for (const s of sizes) assert.match(s, /^max\(var\(--stage-type-min, 0px\), [\d.]+px \* var\(--stage-type-scale, 1\)\)$/, s);
  assert.match(css, /html\[data-stage-look="broadcast"\] \{[^}]*--stage-type-min: 16px/);
});

// ---- the recorder --------------------------------------------------------------------
test('record arguments', () => {
  const o = recordArgs(['dist', 'out']);
  assert.equal(o.fps, 50);
  assert.deepEqual(o.size, [1920, 1080]);
  assert.equal(o.hold, 8);
  assert.equal(o.clicks, 'all');
  assert.equal(o.base, 'auto');
  const p = recordArgs(['d', 'o', '--fps', '25', '--size', '1280x720', '--slides', '2-4', '--plate', '--hold', '3', '--clicks', '{"3":1}', '--flash']);
  assert.deepEqual([p.fps, p.size, p.slides, p.plate, p.hold, p.clicks, p.flash], [25, [1280, 720], '2-4', true, 3, { 3: 1 }, true]);
  assert.equal(recordArgs(['d', 'o', '--clicks', 'none']).clicks, 'none');
  // --plate-only: the plates alone (it implies --plate); the texted pipe is not shot
  assert.deepEqual([o.plate, o.plateOnly], [false, false]);
  assert.deepEqual([p.plate, p.plateOnly], [true, false]);
  const q = recordArgs(['d', 'o', '--plate-only']);
  assert.deepEqual([q.plate, q.plateOnly], [true, true]);
  // the shared launcher's backends, all but none (the recorder draws every frame)
  assert.equal(recordArgs(['d', 'o']).gl, 'auto');
  for (const gl of ['gpu-nvidia', 'd3d12', 'llvmpipe', 'swiftshader', 'gl']) assert.equal(recordArgs(['d', 'o', '--gl', gl]).gl, gl);
  assert.throws(() => recordArgs(['d', 'o', '--gl', 'none']), /--gl wants/);
  // --force is slidev-stage-shots' (a rehearsed fallback leaves the recorder nothing to film)
  assert.throws(() => recordArgs(['d', 'o', '--force', 'no-webgl2']), /--force: nothing to record/);
  assert.throws(() => recordArgs(['d', 'o', '--force']), /--force: nothing to record/);
  // --encoder picks the codec for the takes and the plates alike (the plates on their own profile)
  assert.equal(recordArgs(['d', 'o']).encoder, 'auto');
  for (const e of ['auto', 'nvenc', 'x264']) assert.equal(recordArgs(['d', 'o', '--encoder', e]).encoder, e);
  assert.throws(() => recordArgs(['d', 'o', '--fps', '0']));
  assert.throws(() => recordArgs(['d', 'o', '--size', '1920']));
});

// The takes are silent: the edit list says where in a take a clip played, so
// whoever cuts the take (slidev-videos pptx) can lay the source clip's sound
// under it.
test('a clip\'s sound is logged where it played in the take', () => {
  const fps = 50;
  const clip = (t, o = {}) => ({ src: 'http://127.0.0.1:4000/videos/a.mp4', playing: true, t, muted: false, volume: 1, loop: false, ...o });
  let tr = null;
  // frames 0-9: the arrival, the clip not yet started (a sheet of dust)
  for (let i = 0; i < 10; i++) tr = trackClip(tr, i, fps, clip(0, { playing: false }));
  assert.equal(tr, null);
  // the player starts it muted and lifts the sound a frame later (as VideoPlayer does)
  tr = trackClip(tr, 10, fps, clip(0, { muted: true, volume: 0 }));
  assert.deepEqual(tr, { start: 0.2, t: 0, end: 0.2, muted: true, volume: 0, loop: false });
  for (let i = 11; i < 60; i++) tr = trackClip(tr, i, fps, clip((i - 10) / fps, { volume: i < 20 ? 0.25 : 0.5 }));
  // ended: it plays no more, the take holds its last frame
  for (let i = 60; i < 70; i++) tr = trackClip(tr, i, fps, clip(1, { playing: false }));
  assert.deepEqual(tr, { start: 0.2, t: 0, end: 1.18, muted: false, volume: 0.5, loop: false });
  // a slide with no clip, or a frame without one, leaves the track as it was
  assert.equal(trackClip(null, 0, fps, undefined), null);
  assert.equal(trackClip(tr, 70, fps, null), tr);
  // a clip already running when the take begins (a click on a clip slide) or seeked into: t is its own second
  const late = trackClip(null, 0, 25, clip(12.345678));
  assert.deepEqual([late.start, late.t], [0, 12.346]);
  // a muted clip stays muted
  let m = null;
  for (let i = 0; i < 5; i++) m = trackClip(m, i, fps, clip(i / fps, { muted: true }));
  assert.equal(m.muted, true);
  // the segment's clip entry: src (by its path in the dist), recorded, and the sound
  const named = (src) => src.replace('http://127.0.0.1:4000/', '');
  assert.deepEqual(clipEntry(clip(0), tr, named), { src: 'videos/a.mp4', recorded: true, sound: { start: 0.2, t: 0, end: 1.18, muted: false, volume: 0.5, loop: false } });
  // a clip that never played (a poster only) has no sound entry
  assert.deepEqual(clipEntry(clip(0), null, named), { src: 'videos/a.mp4', recorded: true, sound: null });
  assert.equal(clipEntry(null, null, named), null);
  // the page reports what the track needs of each clip
  const page = readFileSync(here('../bin/lib/record-page.mjs'), 'utf8');
  assert.match(page, /muted: v\.muted/);
  assert.match(page, /volume: v\.volume/);
});

// --skip-clips: a clip slide is not filmed (a 4-minute clip at 50 fps took 53
// minutes, frame by frame); the edit list names the clip for whoever cuts the
// takes (slidev-videos pptx embeds the clip file itself), with how it plays.
test('--skip-clips leaves a clip slide to the clip itself', () => {
  assert.equal(recordArgs(['d', 'o']).skipClips, false);
  assert.equal(recordArgs(['d', 'o', '--skip-clips']).skipClips, true);
  assert.equal(recordArgs(['d', 'o', '--skip-clips', '--plate']).plate, true);
  const named = (src) => src.replace('http://127.0.0.1:4000/', '');
  const clip = { src: 'http://127.0.0.1:4000/videos/a.mp4', player: true, playing: true, t: 0.4, duration: 148.2, loop: false, muted: false, volume: 0.05 };
  const track = { start: 2.1, t: 0, end: 2.9, muted: false, volume: 0.05, loop: false };
  const s = { at: 'collision', station: '3' };
  assert.deepEqual(embedEntry(8, 0, clip, track, named, s), {
    slide: 8, clicks: 0, file: null, plate: null, embed: true,
    clip: { src: 'videos/a.mp4', recorded: false, embed: true, duration: 148.2, loop: false, muted: false, volume: 0.05, start: 0 },
    at: 'collision', station: '3',
  });
  // the player's sound as it played (it ramps in from 0); a muted clip stays muted
  assert.equal(embedEntry(8, 0, clip, { ...track, muted: true, volume: 0 }, named, s).clip.muted, true);
  // where the player started it (a dust sheet seeks past a black opening): the clip's own second
  assert.equal(embedEntry(8, 0, clip, { ...track, t: 5.04 }, named, s).clip.start, 5.04);
  // a clip that did not play in the sampled window (autoplay off): the player holds every clip
  // muted until it plays, so its sound is unknown here (pptx reads the deck's tag)
  const still = embedEntry(2, 0, { ...clip, playing: false, muted: true, volume: 1 }, null, named, s).clip;
  assert.deepEqual([still.muted, still.volume, still.start], [null, null, 0]);
  // a release URL stays a URL (pptx takes the local copy first, then downloads it)
  assert.equal(embedEntry(2, 0, { ...clip, src: 'https://github.com/o/r/releases/download/t/a.mp4' }, null, named, s).clip.src,
    'https://github.com/o/r/releases/download/t/a.mp4');
  // only a VideoPlayer's clip makes a slide its clip (a raw <video> beside text is filmed);
  // the stub comes before the cross-origin and the decoding checks; the sample runs until
  // the clip has played past the player's 600 ms sound ramp (a dust sheet takes 1.9 s first),
  // 6 s at most; the rest of a clip slide's clicks go with it
  const rec = readFileSync(here('../bin/record.mjs'), 'utf8');
  assert.ok(rec.indexOf('o.skipClips') < rec.indexOf('const undecodable'), 'the stub comes first');
  assert.match(rec, /o\.skipClips && !opened && clip && clip\.player/);
  assert.match(rec, /const EMBED_WAIT = 6000/);
  assert.match(rec, /const EMBED_PLAYED = 0\.7/);
  assert.match(rec, /if \(seg\.embed\) break/);
  assert.match(rec, /\[--skip-clips\]/);
  // a plate-only segment keeps its place in the cut (its file is the plate)
  assert.match(rec, /if \(!s\.skipped && \(s\.file \|\| s\.plate\)\)/);
  const page = readFileSync(here('../bin/lib/record-page.mjs'), 'utf8');
  assert.match(page, /player: !!v\.closest\('\.video-player'\)/);
});

test('the recorder refuses no WebGL from the environment as well as from --gl', async () => {
  // worked out as the launcher does: --gl, else $SLIDEV_STAGE_GL, else auto
  assert.equal(glMode({ gl: 'auto' }, {}), 'auto');
  assert.equal(glMode({ gl: 'auto' }, { SLIDEV_STAGE_GL: '' }), 'auto');
  assert.equal(glMode({ gl: 'auto' }, { SLIDEV_STAGE_GL: 'd3d12' }), 'd3d12');
  assert.equal(glMode({ gl: 'llvmpipe' }, { SLIDEV_STAGE_GL: 'none' }), 'llvmpipe');   // --gl wins
  assert.throws(() => glMode({ gl: 'auto' }, { SLIDEV_STAGE_GL: 'none' }), /SLIDEV_STAGE_GL=none leaves nothing to record/);
  // a value the launcher does not know: the message lists what the recorder takes, which is not none
  assert.throws(() => glMode({ gl: 'auto' }, { SLIDEV_STAGE_GL: 'vulkan' }), (e) => /got vulkan/.test(e.message) && !/\bnone\b/.test(e.message));
  // from the command line: exit 2, before any server, browser or out dir
  const out = join(mkdtempSync(join(tmpdir(), 'stage-rec-')), 'rec');
  const was = process.env.SLIDEV_STAGE_GL, quiet = console.error;
  let said = '';
  console.error = (s) => { said += s; };
  try {
    for (const v of ['none', 'vulkan']) {
      process.env.SLIDEV_STAGE_GL = v;
      assert.equal(await recordMain(['missing-dist', out, '--slides', '4']), 2, v);
      assert.equal(existsSync(out), false, v);
    }
  } finally {
    console.error = quiet;
    if (was === undefined) delete process.env.SLIDEV_STAGE_GL; else process.env.SLIDEV_STAGE_GL = was;
  }
  assert.match(said, /unset it or pass --gl/);
});

test('a record or safe command line that cannot mean what it says is a usage error', async () => {
  for (const bad of [['--slides', 'x'], ['--slides', '0'], ['--slides', '2-4,x'], ['--slides'], ['--platee'], ['--gl', 'vulkan'],
    ['--encoder', 'hevc'], ['--clicks', 'some'], ['--clicks', '[1]'], ['--clicks', '{"3":-1}'], ['--fps'], ['--seed', 'x'], ['extra']]) {
    assert.throws(() => recordArgs(['d', 'o', ...bad]), undefined, bad.join(' '));
  }
  for (const bad of [['--size', '1920'], ['--size'], ['--broadcst'], ['--slides', 'x'], ['--base', '--json'], ['extra']]) {
    assert.throws(() => safeArgs(['d', ...bad]), undefined, bad.join(' '));
  }
  assert.equal(checkSlides('2-5, 8'), '2-5, 8');
  assert.deepEqual(recordArgs(['d', 'o', '--slides', '99', '--seed', '-3']).slides, '99');   // in range for the parser; the deck says if it is there
  // exit 2, before any browser is started
  const quiet = console.error;
  console.error = () => {};
  try {
    assert.equal(await safeMain(['d', '--size', '1920']), 2);
    assert.equal(await safeMain(['d', '--broadcst']), 2);
    assert.equal(await recordMain(['d', 'o', '--slides', 'x']), 2);
  } finally { console.error = quiet; }
});

test('a deck is served under the base it was built for', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stage-base-'));
  writeFileSync(join(dir, 'index.html'), '<script type="module" src="/talks/x/assets/index-1.js"></script>');
  assert.equal(detectBase(dir), '/talks/x/');
  assert.equal(normaliseBase('auto', dir), '/talks/x/');
  writeFileSync(join(dir, 'index.html'), '<link rel="stylesheet" href="/assets/index-1.css">');
  assert.equal(detectBase(dir), '/');
  assert.equal(normaliseBase('/', dir), '/');
  assert.equal(normaliseBase('a/b', dir), '/a/b/');
  assert.equal(detectBase(join(dir, 'missing')), '/');
  assert.deepEqual(parseSlides('3,1-2,9', 5), [1, 2, 3]);
  assert.deepEqual(parseSize('1280x720'), [1280, 720]);
});

test('ffmpeg is looked for in the named dir first', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stage-ff-'));
  writeFileSync(join(dir, 'ffmpeg'), '');
  const c = ffmpegCandidates({ SLIDEV_VIDEOS_FFMPEG_DIR: dir, PATH: '' });
  assert.equal(c[0], join(dir, 'ffmpeg'));
});

test('a plate is rate-capped at 4 Mbit/s; a broadcast take is encoded as before', () => {
  // the broadcast profile, unchanged: visually lossless, the broadcaster re-encodes
  assert.deepEqual(PROFILES.broadcast.h264_nvenc, ['-preset', 'p7', '-tune', 'hq', '-rc', 'constqp', '-qp', '16']);
  assert.deepEqual(PROFILES.broadcast.libx264, ['-preset', 'medium', '-crf', '14']);
  // the plate profile: the stage pulls a plate from the release and streams it, so it is capped
  assert.deepEqual(PROFILES.plate.h264_nvenc, ['-preset', 'p5', '-tune', 'hq', '-rc', 'vbr', '-cq', '27', '-b:v', '0', '-maxrate', '4M', '-bufsize', '8M', '-profile:v', 'high', '-pix_fmt', 'yuv420p']);
  assert.deepEqual(PROFILES.plate.libx264, ['-preset', 'medium', '-crf', '23', '-maxrate', '4M', '-bufsize', '8M', '-pix_fmt', 'yuv420p']);
  for (const name of ['h264_nvenc', 'libx264']) {
    const p = PROFILES.plate[name], at = (k) => p[p.indexOf(k) + 1];
    assert.equal(at('-maxrate'), '4M', name);
    assert.equal(at('-bufsize'), '8M', name);
    assert.ok(!p.includes('constqp') && !p.includes('-qp'), name);
    assert.ok(!PROFILES.broadcast[name].includes('-maxrate'), name);
  }
  // --encoder x264 needs no test encode, so no ffmpeg; nvenc asked for and not working is an error
  const x264 = pickEncoder('/no/ffmpeg', 'x264');
  assert.deepEqual(x264, { name: 'libx264', profile: 'broadcast', args: ['-c:v', 'libx264', ...PROFILES.broadcast.libx264] });
  assert.deepEqual(pickEncoder('/no/ffmpeg', 'x264', { plate: true }), { name: 'libx264', profile: 'plate', args: ['-c:v', 'libx264', ...PROFILES.plate.libx264] });
  assert.throws(() => pickEncoder('/no/ffmpeg', 'nvenc'), /h264_nvenc does not work/);
  // the plate profile on the encoder already picked: one test encode a run, the same codec for both
  assert.deepEqual(plateEncoder(x264), { name: 'libx264', profile: 'plate', args: ['-c:v', 'libx264', ...PROFILES.plate.libx264] });
  assert.deepEqual(plateEncoder({ name: 'h264_nvenc', profile: 'broadcast', args: [] }), { name: 'h264_nvenc', profile: 'plate', args: ['-c:v', 'h264_nvenc', ...PROFILES.plate.h264_nvenc] });
  // the pipe around either: PNG frames in, BT.709 4:2:0 out, a key frame a second, faststart (a plate streams over HTTP)
  const a = ffmpegArgs(plateEncoder(x264), { fps: 25, out: 'p.mp4' });
  assert.deepEqual(a.slice(a.indexOf('-g')), ['-g', '25', '-movflags', '+faststart', 'p.mp4']);
  assert.ok(a.indexOf('-vf') < a.lastIndexOf('-c:v') && a.lastIndexOf('-c:v') < a.indexOf('-maxrate'));   // the first -c:v is the PNG decoder
  assert.deepEqual(a.slice(0, 2), ['-hide_banner', '-loglevel']);
  const b = ffmpegArgs(x264, { fps: 50, out: 'b.mp4' });
  assert.ok(b.includes('-crf') && !b.includes('-maxrate'));
  assert.deepEqual(b.slice(-5), ['-g', '50', '-movflags', '+faststart', 'b.mp4']);
});

test('the flash check counts bursts over a quarter of the frame', () => {
  const w = 8, h = 4, fps = 50, frame = (y) => Buffer.alloc(w * h * 3, y);
  const flicker = Array.from({ length: 100 }, (_, i) => frame(Math.floor(i / 5) % 2 ? 230 : 20));   // 5 Hz, whole frame
  assert.ok(findFlashes(flicker, { w, h, fps }).warnings.length > 0);
  const once = Array.from({ length: 100 }, (_, i) => frame(i > 50 && i < 60 ? 230 : 20));
  const r = findFlashes(once, { w, h, fps });
  assert.equal(r.transitions.length, 2);
  assert.deepEqual(r.warnings, []);
  // the same flicker in one corner (an eighth of the frame) is not a flash
  const corner = Array.from({ length: 100 }, (_, i) => { const b = frame(20); if (Math.floor(i / 5) % 2) for (const p of [0, 1, 8, 9]) b.fill(230, p * 3, p * 3 + 3); return b; });
  assert.equal(findFlashes(corner, { w, h, fps }).transitions.length, 0);
});

// ---- the safe check --------------------------------------------------------------------
test('safe arguments and rules', () => {
  assert.deepEqual(safeArgs(['dist', '--broadcast', '--json']), { dist: 'dist', broadcast: true, json: true, slides: null, size: [1920, 1080], base: 'auto' });
  const b = RULES.broadcast.box;
  assert.deepEqual([Math.round(b[0] * 980), Math.round(b[2] * 980)], [98, 882]);
  assert.deepEqual([Math.round(b[1] * 551.25), Math.round(b[3] * 551.25)], [55, 408]);
});

test('the broadcast rules flag the kit\'s small source line and kicker', () => {
  const state = { W: 980, H: 551.25, lines: [
    { text: 'slidev-addon-stage · packages/stage/example', tag: 'div.src', font: 12, box: [44, 513, 323, 529] },
    { text: 'A form of grains', tag: 'h1', font: 12.5, box: [110, 300, 240, 316] },
    { text: 'Inside and large enough', tag: 'p', font: 40, box: [120, 120, 600, 170] },
    { text: 'Where the logo goes', tag: 'p', font: 20, box: [800, 60, 870, 80] },
  ] };
  const out = judge(state, RULES.broadcast);
  const by = Object.fromEntries(out.map((p) => [p.text, p.problems.map((x) => x.kind)]));
  assert.deepEqual(by['slidev-addon-stage · packages/stage/example'], ['small', 'outside', 'corner']);
  assert.deepEqual(by['A form of grains'], ['small']);
  assert.equal(by['Inside and large enough'], undefined);
  assert.deepEqual(by['Where the logo goes'], ['corner']);
  assert.deepEqual(judge(state, RULES.hall), []);   // in a hall, 12 px on the slide is allowed
});
