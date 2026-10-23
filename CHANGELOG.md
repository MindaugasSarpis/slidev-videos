# Changelog

One tag covers the whole repo: the CLI (`slidev-videos`), the player addon
(`slidev-addon-videos`) and the stage addon (`slidev-addon-stage`, versioned
on its own). A deck pins both addons and the CLI to the same tag.

## v0.10.0 — unreleased

slidev-videos 0.10.0 · slidev-addon-stage 0.7.0 · slidev-addon-videos 0.10.0

v0.8.2 (the live fallback), v0.8.3 (the PPTX), v0.8.4 (a clip slide is
its clip in the PPTX; a `cut` clip rests the world under it) and v0.8.5 (a
venue zip opens by double-clicking `index.html`) on top of v0.9.0: the v0.8.x line merged as it is, its entries below. The tag waits on the owner's word.

**A v0.9.0 deck behaves as under v0.9.0 while its world runs**, with v0.8.2's
one exception (no `advance-on-end` within half a second of a press); without
a world it behaves as v0.8.2 says, and a v0.8.2 deck as under v0.8.2.

- **The hand-over over a plate.** v0.9.0's `<StageDepthGrains>` kept its
  still over everything once the world was down, so the slide's plate,
  filmed with the still hidden and the grains coming in, played unseen under
  it. Without a world it now follows `html[data-stage-layer]` and
  `[data-stage-plate]` (`handOverWithout`, `stage/fallback.js`): over a plate
  the still covers it while the plate has no frame, fades after `hold` as
  live while it plays, and is gone with the word shown once the plate holds
  the settled world. A stall after the plate has played keeps the fade
  going; a plate that never loads shows the word by 8 s, and one still
  playing then keeps it for its end (`capShowsWord`: the example-lhcb
  rehearsal saw the word at 8 s over slide 5's 17 s plate); a fallback during
  the hand-over is followed at once. Over the living still and the still
  alone it stays and the word shows at once, as before; it no longer waits
  8 s for a world that has fallen back. Without a world the word comes with
  the plate's end (about 5 s after live's) and no cue fires.
- **What else met.** The step bus, the gate and the lhcb plugin need no
  change under the fallback: without a world no builder runs, and a missing
  detector `.bin` stays a console warning with the world running, not a
  fallback. The plate's text-free pass hides `.slidev-layout`, so a hand-over
  slide's plate holds its grains and not its still or word. `deck.py` reads
  the lhcb example deck as Slidev numbers it.
- **Tests:** stage 145 → 150 (v0.8.3's plateStep for the back-step, v0.8.4's
  `--skip-clips`; the hand-over's rule over every layer and plate state, the
  component's wiring, the cap's rule; it joins the compile check); Python
  183 → 192 (v0.8.4's embedded clips), and `test_shared_registry` counts the
  44 clips v0.9.0's `lis_flag.mp4` made (main had failed on 43 since
  v0.9.0), 192 → 195 (v0.8.5's venue bundle and `serve.ps1`); root 11 → 22
  (v0.8.4's cut-clip cover, v0.8.5's venue plugin and shim), and v0.8.5's
  file:// smoke. example-lhcb's hand-over rehearsal passes from `file://` as
  served.

## v0.9.0 — 2026-10-20

slidev-videos 0.9.0 · slidev-addon-stage 0.6.0 · slidev-addon-videos 0.9.0

The visuals the talks built for themselves, lifted into the stage so the
next talk uses them instead of copying them.

**Every v0.8.1 deck behaves the same under v0.9.0.**
- Nothing here changes what an existing deck draws or how its steps run.
- A detector without `parts` keeps its one `color`.
- A talk's own buses (`master:grains`, `innoday:grains`) and its copies of
  these files keep working beside the kit's.
- A deck that names no data never fetches anything.

So the talks adopt this one at a time: MasterTalk first, then Tokyo; the
others after their dates.

- **The step bus** is lifted from MasterTalk's and Užsikrauk karjerai's
  `setup/grains.js`.
  - `setStep`, `setSteps`, `stepOf`, `onStep`, `stepper` and
    `setStepLater` are exported from the package for a deck's own builders.
  - `setStepLater` is a step after a delay in world seconds: the engine now
    ticks it, so a frozen world holds it.
  - `<StageSteps :set :clicks>` is the talks' `Grains.vue`. It steers the
    world only from the live slide, never from the overview or the previews.
- **Grain helpers** come from the same files: `grainMaterial`,
  `grainGeometry`, `grainPoints`, `GRAIN_GLSL`. The near fade and the size
  cap are options (`near`), not constants.
- **The gate:** `setStageGate((start) => off)` holds heavy work until a deck
  says go. It replaces Innoday's `afterCover` latch for the kit's forms.
- **`plugins: [lhcb]`**, a shipped plugin like `hadron`.
  - **`detector`** is LHCb's real Run 3 geometry as grains. It reconciles
    MasterTalk's `setup/route.js` with Innoday's `setup/detector.js`:
    MasterTalk's keys, steps and frame (lhc-collision's, `W = [z·S, y·S·T,
    x·S·T]`), plus Innoday's thinning on a lower tier, hidden while off,
    `prewarm`, `hole` and `near`.
  - **New in the detector:** `parts` colours it by sub-detector. `parts:
    lhcb` is white and light blue only, the trackers brightest and the
    magnet a frame; an object overrides single parts (Innoday's weights
    become data). Hits stay `hot`. The event's tracks come from
    `setLhcbTracks`.
  - **`emblem`, `floor` and `supports`** come from Innoday's
    `setup/emblems.js`: an image or the Lithuanian flag as grains, the
    cavern floor, the cradles.
- **The geometry's data is not in the package.** It lives on the new
  `geometry-lhcb` release: `lhcb-grains.bin` (93 000 grains, MasterTalk's
  bake) and `lhcb-grains-dense.bin` (446 400, Innoday's), with
  `lhcb-grains.NOTICE.txt`.
  - **Licence:** the grains are derived from LHCb's DD4hep description
    (GPL-3.0, © CERN for the benefit of the LHCb Collaboration) through HSF
    Phoenix's glTF (Apache-2.0), and are distributed under the GPL-3.0. The
    toolkit's code stays MIT.
  - **How a deck gets it:** `src: lhcb` / `lhcb-dense` makes a dev or build
    run fetch the file under Node (a release asset sends no CORS header),
    check it against the sha256 pinned in `stage/data.mjs` and cache it. The
    file is served in dev and written to `stage-data/` in the build, with
    its notice, so the Pages site and the venue zip carry it.
  - **Failures stop the build:** a missing network or a changed file names
    the file and the cache directory, and stops the build of that deck
    alone.
  - **Tested:** a build from a warm cache with the network off emits all
    five files, and a zip of it holds them. A cold cache offline fails with
    that message.
- **`<StageDepthGrains>`, the still-and-depth hand-over,** is lifted from
  Innoday's `<LisTakeover>`, `lisGrains.js`, and the sampling of
  `takeover.js` and `view.js`, now `stage/depth-grains.js`.
  - A clip's last frame becomes grains, each where its surface stood, at an
    anchor in the world. The camera pulls back on the slide's `path` while
    the picture shrinks to its mark.
  - **Cues** fire on the camera's distance, or once it stands: steps on the
    bus, window events, the fade-out. `reset` and `end` replace the
    talk-specific choreography.
  - The light injection system is its first use. `lis_flag.mp4` (10 s,
    silent) joins the shared library, and its last frame, depth and camera
    (`lis_last.jpg`, `lis_last.depth.png`, `lis.json`) are on
    `videos-shared` and in `stage-data` by name. All four were added; no
    asset there was replaced.
- **`tools/`** holds Blender scripts outside the packages:
  - `tools/lhcb/bake_grains.py` (with Innoday's density factor) and
    `build_scene.py`, from MasterTalk;
  - `tools/lis/lis_scene.py` and `lis_pose.py`, from Innoday.
- **The example** is a second deck, `packages/stage/example-lhcb`: the
  detector's steps, the floor, the flag and the hand-over. In headless
  Chromium (SwiftShader) it shows the sweep, the hits leaving, the 320 000
  grains of the hand-over, the detector cue at 3.2 units and the fade-out
  once the camera stands.
- **stage:check** knows the plugin's types.
- **Tests:** stage tests 98 → 119 (the bus, part colours never gold, the
  .bin's thinning and hits, the flag and image marks, the depth placement,
  the scale law, the gate, the data pins and their failures); the Python
  suite and every smoke pass.

**Not lifted yet** (still in 3–5 talks): `Count.vue`, `AfterFlight.vue`,
`WebTakeover.vue`, `CollisionStart.vue`, `OpenerStart.vue`, `Strands.vue`,
`funnel.js`, `takeover.js` (beyond its sampling), `view.js`, `strands.js`,
`plots.js`, and `components/lhc-opening`. These follow after 26 Oct.
## v0.8.5 — unreleased

slidev-videos 0.8.5 · slidev-addon-stage 0.5.4 · slidev-addon-videos 0.8.5

**A venue zip opens by double-clicking `index.html`**, on any Windows or Mac,
downloaded from the web, with nothing installed. Audience machines said
"python not installed" (Windows) and refused `RUN_ME.command` (macOS
Gatekeeper; Sequoia has no right-click Open).

- **`slidev-videos venue`** builds with `VIDEOS_VENUE_FILE=1` and
  `--router-mode hash`. slidev-addon-videos' new `vite.config.js` then turns
  on its venue plugin (`venue/file.js`): the code inlined into `index.html`,
  in one chunk; `public/` (but the clips) in `venue-assets.js`, a classic
  script beside it; and a shim that, on `file://` only, hands those files to
  `fetch()`, `<img>.src` and `<audio>` (and `new Audio`) as blobs. From
  `file://` Chromium refuses `fetch()`, and a sibling image, video or audio
  file taints the canvas and WebGL and gives Web Audio silence (Innoday's
  soundtrack runs through it); a blob the page made does neither. Clips stay
  files: a `<video>` plays them from `file://`, and the player reads them as
  it reads a release clip (the dust from the frame strips). The stage
  example and v0.10.0's example-lhcb run from `file://` as served, its
  hand-over rehearsal included; the presenter window drives the audience
  window. Innoday would carry ~36 MB in the sidecar (~48 MB as base64,
  loaded in ~0.35 s).
- **Opened from inside the zip** (Windows' Explorer extracts `index.html`
  alone to a temporary folder), the page says to extract it first.
- **`RUN_ME.bat` serves with Windows PowerShell, not Python**: `serve.ps1`,
  a socket on the loopback (no URL reservation, no admin), one runspace per
  connection, byte ranges for the clips, nothing outside the folder. It runs
  with `-ExecutionPolicy Bypass`: a `.ps1` from a downloaded zip carries the
  Mark of the Web, and RemoteSigned refuses it unsigned. `RUN_ME.command`
  stays, and `RUN_ME.txt` gives the two ways past Gatekeeper (Open Anyway,
  `xattr -dr com.apple.quarantine`). Both are backups now.
- A talk pinned to an older slidev-addon-videos builds no sidecar: `venue`
  warns, and `RUN_ME.txt` points at the launchers.
- Tests: root 13 → 22 (the plugin, the HTML rewrite, the shim); a file://
  smoke (`pnpm build:example:file && pnpm smoke:file`: from `file://`, alone,
  served); Python 191 → 194, with `serve.ps1` run under Windows PowerShell
  where WSL reaches it.

Not tested here: Safari and Firefox, and a double-click on the `.bat`
(SmartScreen may ask once).

## v0.8.4 — unreleased

slidev-videos 0.8.4 · slidev-addon-stage 0.5.4 · slidev-addon-videos 0.8.4

**A clip slide is the clip itself in the PPTX**, on the v0.8.x line (the
talks pinned there); the same change goes to `main` with v0.10.0. No deck
behaves differently: the recorder gains a flag, `pptx` a kind of segment.

- **`slidev-stage-record --skip-clips`**: a clip slide is not filmed. Frame
  by frame through the browser, Innoday's 4-minute opener took 53 minutes
  at 50 fps. A clip slide is a `VideoPlayer`'s (a bare `<video>` beside text
  is still filmed). Its segment has no file and names the clip (`embed:
  true`; `src`, `duration`, `loop`, and `muted`, `volume` and `start` as the
  player played it over its first 0.7 s, sampled for up to 6 s, past a dust
  sheet's 1.9 s and the 600 ms sound ramp; `null` sound when it did not
  play there, autoplay off), and the rest of that slide's clicks go with
  it. The next slide still arrives over the clip's last frame (its
  take opens on this slide with the clip run to its end), from another
  origin too; a cross-origin clip slide is named the same way, not skipped.
- **`slidev-videos pptx` embeds the clip file** for such a segment: from the
  build, `--clips` or `public/videos/`, else downloaded from its URL (the
  release). As it is where PowerPoint plays it so (H.264 4:2:0, 16:9, within
  `--cap`, AAC), else encoded on the profile and cover-cropped to 16:9 as the
  player fills the frame; cut where the player started it (past a black
  opening); the sound at the player's `volume`, none when `muted`, by the
  deck's `<VideoPlayer>` tag when the recorder did not hear it; the slide
  as long as the clip, with all its notes. A download is kept with
  `--keep-encodes` and not fetched again. `--json` lists them under
  `embedded`.
- **Known limit:** what a clip slide shows over or after its clip — a
  `ClipEnd` line (Innoday's 27), an `exit="push"` and `AfterFlight` stats
  (Innoday's 8) — is not in the PPTX. A filmed take ended on the clip too,
  so v0.8.3's PPTX did not have them either. A looping clip plays once and
  holds its last frame; a clip with autoplay off starts on its own.
- **A `cut` clip covers its slide** (`slidev-videos:cover`) once it has
  loaded, as a `fade` or `dust` one does, and gives it back when the slide
  is left, its clip fails or the player goes. It never said so (the cut
  path never reached `enter()`), so slidev-addon-stage drew its world under
  a cut clip for the clip's whole length (160–430 draws a second, against
  none under a fade clip) — what made a MacBook Pro M2 struggle on
  Innoday's last slide. Stepping from one cut clip to the next, the slide
  stays covered: the cover waits a tick, after the slide left has given the
  world back. The example deck gains two cut-clip slides (7 and 8), and its
  smoke checks the cover.
- **Stage smoke case 15 records what it checks.** Its observer was set on
  `<html>` before the page had one, threw, and logged nothing, so its
  back-step checks held on any build; it now watches the document, and an
  empty log fails. Run red/green on 23 Oct, v0.8.2 (c456add) holds the
  back-step headless too, on synthetic and on recorded plates: the race
  Innoday met needs a slower seek than a local server gives. The
  regression test for v0.8.3's fix is `plateStep`'s unit test.
- With outreach_talks' `talk pptx` (the recorder's `--skip-clips` by default,
  the world at 25 fps), a 31-slide deck with six clip slides comes to an
  estimated half hour (25 world takes at the 0.09 s a frame Innoday's take
  measured on d3d12), where its slide 2 alone took 53 minutes.

## v0.8.3 — 2026-10-22

slidev-videos 0.8.3 · slidev-addon-stage 0.5.3 · slidev-addon-videos 0.8.3

The PPTX of a recorded talk, on the v0.8.2 line (the talks pinned there);
the same change goes to `main` with v0.10.0. **No deck behaves differently**:
the player and the stage are untouched; the recorder only writes more into
`index.json`.

- **`slidev-videos pptx <recording-dir> --deck deck.md --out talk.pptx`**
  (`src/slidev_videos/pptx.py`): one 16:9 slide per segment of
  `slidev-stage-record`'s `index.json` — a slide's clicks each a slide —
  the take full-bleed with its first frame as the poster, starting on its
  own when the slide is shown (a main-sequence `mediacall` effect,
  `playFrom(0.0)`, as PowerPoint writes "Start: Automatically";
  `--autoplay with` for "With Previous"), holding its last frame, no media
  controls in the slide show (`p14:showMediaCtrls val="0"` in presProps);
  the deck's speaker notes as plain text, a click's under a `[click K/N]`
  line. Each take is re-encoded (`--profile pptx`: NVENC VBR CQ 24 or x264
  CRF 21 under `--cap` 6M, a 12M buffer, 4:2:0 High, a key frame a second,
  faststart; `small`: the plates' 4M; `copy`). A recorder's skipped segment
  stops the build unless `--allow-skips` (a black slide naming the clip).
  Projectless; `--json`; exit 0 / 1 (a skip, ffmpeg) / 2 (usage, no
  index.json, no python-pptx). Needs the new `pptx` extra
  (`pip install "slidev-videos[pptx]"`, python-pptx ≥ 1.0), imported only
  by this command.
- **A clip slide keeps its sound.** The takes are silent (PNG frames piped
  to ffmpeg); the recorder now logs, per segment, where its clip played in
  the take — `clip.sound: { start, t, end, muted, volume, loop }`, the take's
  seconds of the first and last frame the clip played on and the clip's own
  second at the first (`bin/record.mjs` `trackClip`; the page reports each
  clip's `muted` and `volume`) — and `pptx` lays the source clip's audio
  there (from the deck's build, `--clips` or `public/videos/`), AAC at the
  web tier's -16 LUFS without a second loudnorm, at the player's `volume`,
  none for a muted clip. World segments stay silent.
- **Known limit:** the stage's own sounds — the hum, a `Soundtrack`'s music,
  the flight — are drawn by the page's audio, which the recorder does not
  capture: they are in neither the takes nor the PPTX.
- `deck.py`: Slidev's slides (hidden ones unnumbered, as the recorder
  numbers them) and their notes, ported from the talks' `talk_deck.py`.
- **A back-step holds its plate again** (a v0.8.2 bug, seen at Innoday under
  a forced `no-webgl2`: a back-step read `data-stage-plate="playing"`).
  StagePlate let go of the slide's hold as soon as the seek to the end was
  issued, and in the same `sync()`, the seek not landed and `ended` still
  false, played the plate from where it was left. The hold now lasts the
  visit: the seek is made once, and the plate rests, `loading` while the
  seek is in flight and `held` once it lands (`plateStep`,
  `stage/fallback.js`). Smoke case 15 walks it headless on synthetic plates,
  after the plate has ended and mid-way.

## v0.8.2 — 2026-10-21

slidev-videos 0.8.2 · slidev-addon-stage 0.5.2 · slidev-addon-videos 0.8.2

A patch line from v0.8.1, for the talks pinned there (Innoday on 23 Oct,
Užsikrauk karjerai on 26 Oct): what a stage deck shows where its world cannot
run, after a venue PC left Innoday on its stills and let a clip's
advance-on-end walk the deck on its own. The same change goes to `main` as
v0.10.0, on top of v0.9.0; this line carries nothing of v0.9.0.

**Every v0.8.1 deck behaves the same under v0.8.2 while its world runs**, with
one exception; without a world it differs. Precisely:
- **A clip's `advance-on-end` no longer fires within half a second of a
  press.** A navigation key, or any pointer press outside the player (the
  nav bar, the slide; a press on the player's own controls or its picture is
  not one), in the clip's last instant is the navigation; the end that
  followed used to move the deck a second time and skip a slide.
- **Without a world** (no WebGL2, no float targets, a plugin, data or engine
  failure, a context lost for good) the slide's still breathes instead of
  standing (the living still, below), and an `advance-on-end` clip stops at
  its end — the presenter goes on by hand — unless the deck has plates. A
  deck without plates asks for each slide's once (its own `public/videos/`
  and its release), is told no, and keeps the living still. Under
  `prefers-reduced-motion` the still stands alone, as before (`stage.motion`
  defaults to `respect`).
- Print, PDF export, the overview and the presenter's preview are untouched.
- `html[data-stage-layer]` is set on every stage deck now; the other marks
  only without a world. The `generated` manifest key is optional: a manifest
  without one reads as before.
- A deck's own component that times captions to the world (Innoday's
  `LhcOpening`) can show them at once without one by reading
  `html[data-stage-fallback]`; that edit is the talks', on their side.

- **Advance-on-end is decided in one place**
  (`components/video-dust/advance.js`, `shouldAdvance`): the rules in order,
  disarmed, off, loop, context, print, inactive, under the recorder, the
  page moved, a click taken, no plate, pressed. Two are new: without a world
  the clip goes on only onto the next slide's loaded plate
  (`html[data-stage-plate-next]` = page + 1: it begins on the world as it
  stood under the clip, and the clip's fade lands on it), and a press in the
  last 500 ms ends the matter. One shot per arming, and the arming also drops when the route
  moves. `slidev-videos:advance` carries `reason`.
- **Recorded plates where the world cannot run** (`stage/fallback.js`,
  `StagePlate.vue`). `slidev-stage-record --plate-only` records each slide's
  world alone — no text, halo, HUD, scrim, paper grain or push overlay: the
  stage draws its scrim and grain over the plate as over the world —
  arriving from the slide before and holding (half the frames of `--plate`;
  `index.json` gains `plateFps` and `plateOnly` beside `hold`). A plate is
  encoded on its own rate-capped profile (`bin/lib/record-ffmpeg.mjs`:
  NVENC VBR at CQ 27 or x264 at CRF 23, both under `-maxrate 4M -bufsize
  8M`, 4:2:0, faststart) where the texted takes stay near lossless: a 28 s
  plate of the example's drifting dust came to 12.8 MiB at 3.8 Mbit/s,
  where the broadcast profile gave 73.6 MiB for 20.6 s. The stage
  plays the slide's `NN-plate.mp4` muted under the text, holding its last
  frame, three slides loaded at a time (the one before, this, the next);
  only a forward step from the slide before replays a plate's arrival, a
  back-step or a jump holds its settled world. The chain is the player's
  for a clip: `public/<stage.plates>/`
  (default `videos`, gitignored) and `stage.platesRelease` (default: the
  videos addon's release), local first in dev or with
  `VITE_VIDEOS_LOCAL_FIRST=1`, the release first on a deploy. No poster: the
  plate before holds the cut until the next's first frame, which the
  recorder began on exactly that frame. A clip slide has no plate; the next
  slide's plate begins on the world as it stood under the clip, where the
  live world would have been, and the clip's fade (or its push, where the
  overlay has WebGL2) lands on it.
- **The living still** (`stage/living.js`, `StageLiving.vue`): the still on a
  48 s eased drift (to 1.045 and 1.2 % of the frame off centre, then as
  slowly back) and 600 grains of the palette's dust, additive at 30 fps;
  under a plate while it loads, alone where there is none. No shape, no
  colour of its own; paused while hidden or covered; off under reduced
  motion with `motion: respect`.
- **The layer on `<html>`:** `data-stage-layer` = `world | world-floor |
  plate | living | still`, `data-stage-fallback` (the reason, on `<html>` as
  well as the stage root), `data-stage-plate` = `loading | playing | paused |
  held | none`, `data-stage-plate-next`; `slidev-stage:fallback` on `window`
  with `{ reason, detail, layer }`. `__stage.state()` carries `layer` and
  `plate`; the shots report carries `fallback` and `layer`.
- **`stage:` keys:** `motion` (`respect`, the default: the still alone under
  reduced motion; `floor`: the world all the same — a presenter's deck sets
  it, a venue PC's accessibility setting being the venue's choice, not the
  audience's), `plates` (the folder, or `false`), `platesRelease`. The
  engine's floor under `motion: floor` (no sway, no streaks, every pose a
  cut) is not in this line: the world runs as it does.
- **`generated = true` on a manifest entry** (the CLI): a file the toolkit
  made with no raw. `sync`, `encode`, `encode-hq` and `fetch` leave it alone
  (`fetch` refuses the name), `check` accepts it unreferenced and names the
  recorder where it is missing, `publish`, `pull`, `venue` and `preflight`
  carry it, `frames` never cuts one.
- **Seeing it before the venue:** `?stage-force=<reason>` boots into that
  fallback (`context-lost` drops a live context, so the real handler runs;
  under `no-webgl2` the videos addon's dust and push overlay declines its
  WebGL2 too, so a clip leaves by its fade onto the plate, as at the venue);
  `stage-plates=off`, `stage-motion=floor|respect`; the debug panel names a
  forced reason. `slidev-stage-shots --force REASON` photographs the deck
  that way (refused with `--stills`), each frame once what stood in has
  settled on the real clock — the plate played to its end and holding
  (`data-stage-plate` = `held`), or the living still drawn — within
  `--wait` stretched to the plate's length, a plate not held by then being
  an unsettled frame (`forcedSettled` in `bin/shots.mjs`; the report line
  carries `plate` and `forcedMs`); the recorder refuses `--force`. A
  plate's 404 under a plate or the living still is no failed request to
  `slidev-stage-shots` (the stage asks for plates it may not have; a clip
  slide has none); while the world runs it is one, and a missing still is
  one everywhere. Smoke cases 12 (the example under `?stage-force=no-webgl2`:
  the living still, drawing; `--force` reports the plates refused and counts
  the stills alone), 13 (`reduced-motion&stage-motion=floor`: the world
  draws) and 14 (`context-lost&stage-debug`: the world boots, loses its
  context past the last restore, the panel names the forced reason and
  counts the three losses).
- **The venue zip's double-click launchers** (the CLI): `venue` writes
  `RUN_ME.command` (macOS; executable in the zip whatever the filesystem
  kept of the mode) and `RUN_ME.bat` (Windows; CRLF) beside `RUN_ME.txt`,
  which names them before the `python3 -m http.server` line. Each serves the
  unzipped folder on the first free port from 8000, bound to localhost, and
  opens the deck; without python it says what to install, or to open the
  talk's live URL instead. No server binary is bundled.

**To adopt the plates, a talk** pins v0.8.2 (both addons and the CLI), sets
`stage.motion: floor` in its headmatter, records `pnpm talk record <t>
--plates` (`--plate-only --fps 25 --hold 20` into `public/videos/`, the
manifest block written; about an hour for 30 slides on llvmpipe, in the
render slot), `pnpm videos:publish --only <the plates>`, `pnpm talk ready`,
`pnpm talk deploy`; `pnpm venue` after `videos:pull` for the venue zip. Then
opens the deployed deck under `?stage-force=no-webgl2` once, and
`?stage-debug` on the venue's PC first. A deck that skips all of it gets the
living still and a clip that waits for a press.

## v0.8.1 — 2026-10-11

slidev-videos 0.8.1 · slidev-addon-stage 0.5.1 · slidev-addon-videos 0.8.1

- **A printed page's scrim is its own slide's.** On Slidev 52.14's print
  route, `nav.currentSlideRoute` stays at slide 1, and the stage read `dim`
  (and the rest of `space`) from it. A deck opening at `dim: 1` therefore
  printed every page under a near-opaque scrim: Užsikrauk karjerai's PDF,
  pages 5–15 near black. On a print page the frontmatter now comes from the
  page's own slide (its context, else the slide list by number), as the
  stills already did. In an Innoday copy on 52.14 with slide 1 at `dim: 1`,
  pages 4–7 went from a mean brightness of 5.9 / 14.3 / 8.7 / 2.8 to 31.1 /
  50.6 / 29.6 / 6.7; pages 1–3 and 8–9 are unchanged. Slidev 52.19 is
  unaffected: the example exports the same before and after.

## v0.8.0 — 2026-10-11

slidev-videos 0.8.0 · slidev-addon-stage 0.5.0 · slidev-addon-videos 0.8.0

For the opening OpenData and Užsikrauk karjerai share (out of the LHC tunnel,
into a collision in the black), and the fixes the talks' renders asked for.

- **The stage's clocks.** A slide's `space.rate` sets how fast the world runs:
  every form, the dust, each builder's `t`. It takes a number, eased over
  `rateEase` seconds, or keyframes `[[s, rate], …]` from the slide's opening;
  0 freezes the world, the maximum is 8, and a slide without one eases back
  to 1.
  - `cameraRate` gives the camera a clock of its own. Bullet time is the
    world near 0 with `cameraRate: 1`.
  - `path` flies the camera through timed keys (`[[s, { at, dist, yaw,
    pitch }], …]`) on a smooth curve.
  - `space.setRate()` and the `rate` event do the same by hand.
  - stage:check reads all three.
- **`space.ambient`** (0–1, eased the same way) takes the ground and its
  glows, the nebula, the dust field, the halo, the scrim's tint and the film
  grain to true black together; the deck's own forms stay lit. Measured on
  the example: (0, 0, 0) at 0.
- **Builders get more in `ctx`:**
  - `tier` and `budget`: grains per tier, 300k / 160k / 60k / 30k.
  - `rate()`, `cameraRate()` and `on('rate', fn)`.
  - `audio()` → `{ context, out }`, the stage's output at `sound.level`,
    which the stage's own voices now go through as well.
  - Per slide, `space.hum: false` turns the hum off.
- **`exit="push"` on a VideoPlayer** pushes the camera on into a point of the
  clip's frame (`exit-at`):
  - The live clip keeps playing as it zooms, accelerating. Grains stream
    past the lens.
  - The screen ends in black, held `exit-hold` ms (600), then lifted over
    `exit-lift` ms (500).
  - A clip from a release still plays on through the push: a 2D canvas may
    draw a video it cannot read.
- **Settling under load.** A frame `--changed` caught failing (not settled,
  failed, a page error or a failed request) is no longer cached: it is shot
  again. One slow run had blocked every later `talk ready` (OpenData,
  Užsikrauk karjerai). Settle counts seconds at rate 1, waits for the last
  rate key and the end of the path, and takes a frozen world as settled. Its
  wall cap also stretches, up to fourfold, to the pace a loaded machine
  measures. Two renders on one gluon node ran at about 2 fps.
- **Docs.**
  - The README's cover example carries no text. The talks put pictures and
    numbers on screen.
  - "Animate from `t`" now covers a slide's own timers too: a `setTimeout`
    races the headless tools.
  - A deck that opens on a clip needs `layout: default` on slide 1.

## v0.7.0 — 2026-10-09

slidev-videos 0.7.0 · slidev-addon-stage 0.4.0 · slidev-addon-videos 0.7.0

The batch of the talks' findings since v0.6.6, in one release. It carries
v0.6.9's freeze fix unchanged.

- **Stills are taken at each slide's last click** (`--stills-at last`, the
  default), the moment `slidev export` prints. Before, `--stills` shot click 0,
  and a printed slide's text could describe marks its world did not show yet.
  `--stills-at first` takes click 0 as before. One still per slide, `NN.jpg`,
  serves print and the on-screen fallback alike, so the fallback shows the
  slide's world complete. **Changed:** rerun `--stills` for a deck whose
  slides have clicks.
- **`slidev-stage-check` warns about a builder on its own clock**
  (`unsaid-clock`): a deck builder whose `assemble()` calls `onDone` at once
  and plays on after it, or that plays its steps from a listener of its own
  with no `assemble()`, and never mentions `busy`. Shots, stills and the
  cover's title take such a form as standing mid-fill. Set `api.busy` (a value
  or a function, true while it moves); `busy: false` says its steps land at
  once. The README says so in bold. Only types a station uses are warned
  about: on the talks' main as of this tag, OpenData's streams, portraits and
  collision; Užsikrauk karjerai's and Innoday's none. (As tagged, this line
  named Užsikrauk karjerai's histogram, path and quintet: that came from a
  stale checkout, and they have set `api.busy` since v0.6.6.) No
  motion probe by default: the dust drifts forever and a
  form's motion lives in its shader, so the CPU has nothing cheap to watch.

In `cern_outreach_talks` (branch `fix/live-walk-retry`, not in this tag):
`pages_check` asks a slide that is slow to appear for a second time, with
20 s more, and walks to the deck's count, so a walk that stops short fails.
`talk deploy` walks the live deck once more before it reports a failure, and
reports both attempts.

## v0.6.9 — 2026-10-09

slidev-videos 0.6.9 · slidev-addon-videos 0.6.9 · slidev-addon-stage 0.3.9

- **No freeze as a dust clip arrives.** Innoday's CERN aerial clip held the
  main thread 14–20 s (under a software renderer) as it came in as dust. Two
  causes, both fixed. The frame-strip tiles the dust reads its colours from were
  GPU-backed canvases, and every `getImageData` on them waited on the GPU; they
  are CPU-backed now (`willReadFrequently`): 7 ms instead of 2.3 s for a clip's
  first tiles. And the player copied the playing `<video>` into a canvas to
  read it before finding the canvas tainted, which a release-hosted clip always
  is: the copy is skipped for a cross-origin clip, and the strip stands in as
  it did. A CPU profile of Innoday's slide 7 → 8: 14.2 s in one `drawImage`
  before, no task over 1.6 s after.

## v0.6.8 — 2026-10-09

slidev-videos 0.6.8 · slidev-addon-videos 0.6.8 · slidev-addon-stage 0.3.8

- **Grains are sized to the frame, not in raw pixels.** On a phone's ~220 px
  slide band a grain of fixed pixel size covers several times the share of the
  picture it does at 1600×900, so grains overlapped many times over and an
  additive pile-up washed out to white (after v0.6.7's guard, the white the
  owner's iPhone showed instead of black). The field, the engine's own forms
  (galaxy, collider, constellation …) and StageHero now size grains by the
  drawing buffer's height over 900. At 1600×900 nothing changes: the example's
  stills are byte-identical to v0.6.7's. At iPhone size its galaxy is fine
  grains again instead of blurred blobs.
- A talk's builder can return `frameScale` (a `{ value }` uniform the engine
  keeps at buffer height / 900) to size its grains the same way; `pixelRatio`
  stays the device pixel ratio, so a builder that sizes its own grains, as
  Innoday's now do, is not scaled twice.

## v0.6.7 — 2026-10-09

slidev-videos 0.6.7 · slidev-addon-videos 0.6.7 · slidev-addon-stage 0.3.7

- **One over-bright pixel no longer blacks out the world.** On an iPhone
  (iOS 18.7, Apple GPU) Innoday's stage ran at 60 fps with no context lost and
  drew black, after the funnel flashed once. A pixel that overflows the
  composer's half-float target (additive grains piled past 65504, a shader
  dividing by zero) becomes Inf or NaN; bloom spreads it over the frame and
  tone mapping turns it to NaN, which shows black. A guard pass after the scene
  now makes every pixel finite (NaN 0, Inf and overflow at a ceiling of 64)
  before bloom. Reproduced in Chromium by putting one quad writing 1e20 in the
  scene: on v0.6.6 the whole world went black under the slide's text, now it
  draws.
- `?stage-debug` reports `float-linear` and `float-blend`, and three switches
  narrow a fault down on the device: `stage-post=off`, `stage-targets=half`,
  `stage-tier=0..3`.

## v0.6.6 — 2026-10-09

slidev-videos 0.6.6 · slidev-addon-videos 0.6.6 · slidev-addon-stage 0.3.6

- **What ends hidden prints hidden.** v0.6.5 printed with `animation: none`,
  which also undid animations that end hidden: Innoday's part words, which
  fade out over the photos, printed on top of them. In print every animation
  now jumps to its end and holds it (duration and delay 0, one iteration,
  fill both), so text that rises in prints and text that fades out does not.
  The kit's reduced-motion and `@media print` rule does the same. StagePhoto's
  headline still shows. On a rasterised PDF: a card rising 3 s in and a word
  fading out 2 s in; on v0.6.5 both printed, now the card prints and the word
  does not.
- Worth knowing for a deck's type: Slidev's default `h1 + p { opacity: .5 }`
  greys the line after a heading.

## v0.6.5 — 2026-10-09

slidev-videos 0.6.5 · slidev-addon-videos 0.6.5 · slidev-addon-stage 0.3.5

- **Late text prints.** Slidev's export prints with screen media, so the
  kit's `@media print` rule never ran, and a page is taken as soon as it has
  loaded: text that rose or faded in late printed empty. On print pages
  (`.print-slide-container`, `html.print`) nothing animates or transitions and
  everything stands at its end state; StagePhoto's headline and photo show.
  On a rasterised PDF of a test deck, a card rising 3 s in printed empty before
  and prints now.
- **shots: a clip found in a release is no failed request.** A local-first
  build (`VITE_VIDEOS_LOCAL_FIRST=1`, as `talk ready` builds) asks
  `videos/<clip>` first and gets a 404 when `public/videos` is empty; shots
  counted it. A clip's miss is now held and dropped once the same file answers
  from any tier, as `pages_check` treats clips. OpenData's slides 1–3: two 404s
  before, none now.

## v0.6.4 — 2026-10-09

slidev-videos 0.6.4 · slidev-addon-videos 0.6.4 · slidev-addon-stage 0.3.4

- **`enterable`: a form a camera is meant to stand in.** `slidev-stage-check`
  warned camera-inside-form for every pose inside an object's radius, so a
  floor the camera walks on or strands that wrap round it warned on every
  slide (9 warnings for OpenData's floor, 5 for Innoday's strands).
  `registerBuilder(type, fn, { fields, enterable: true })` marks a type, and
  `"enterable": true` one object in space.json; `ring` is enterable as it was.
  A galaxy still warns: from inside, its grains are drawn across the screen.
  With the one-line mark, both talks check without a warning.

## v0.6.3 — 2026-10-09

slidev-videos 0.6.3 · slidev-addon-videos 0.6.3 · slidev-addon-stage 0.3.3

- **`slidev-stage-record` under 12 fps records at the live pace.** The
  engine clamps a frame to 1/12 s (StageHero's simulation to 1/30 s), so a
  take at `--fps 6` moved the world at half speed and one at 10 fps about
  20 % slow. The recorder lifts the clamp to its own frame time
  (`globalThis.__stageMaxDt`); a page outside the recorder keeps it. The
  example's flight settles at 8.3 s of video at 6 fps and 8.1 s at 24 fps
  (16.3 s at 6 fps before).

## v0.6.2 — 2026-10-09

slidev-videos 0.6.2 · slidev-addon-videos 0.6.2 · slidev-addon-stage 0.3.2

- **A slower form is no longer photographed half built.** With several
  forms that build themselves at one station, the engine announced the
  station assembled when the first finished; now it waits for the last (the
  first still gives the dust its pulse). The headless tools' settle (shots,
  `window.__stage.settle`) reads that, and also `api.busy`, a new optional
  builder flag for a form that moves on its own clock without `assemble()`.
  The example's tally station gains a second form that starts 4 s late
  (`tally`'s new `delay`), and the smoke test checks the settle waits for it:
  before, it settled with that form at 0 of 100.

### Upgrading from v0.6.1

- `html[data-space-assembled]` now comes when the last form at a station
  finishes, not the first: talk CSS keyed to it (a cover title fading in, say)
  may appear later on a station with more than one self-building form.

## v0.6.1 — 2026-10-09

slidev-videos 0.6.1 · slidev-addon-videos 0.6.1 · slidev-addon-stage 0.3.1

- **No warm text.** A palette has a text accent, `text` (CSS
  `--stage-text-accent`), which the CSS kit's kickers, the cover's and a
  section's label, StagePanel's kicker and StageHero's kicker are set in.
  It is the accent in `classic` and `blue` (unchanged), and light blue
  `#9fd8ff` in `ember`, whose kickers were amber `#ffb168`; ember's amber dust,
  glows and lights are as they were. A palette given a new `accent` and no
  `text` carries the accent into its text, as before.

## v0.6.0 — 2026-10-09

slidev-videos 0.6.0 · slidev-addon-videos 0.6.0 · slidev-addon-stage 0.3.0

v0.5.4 with the three branches that waited beside the releases: the CLI
hardened, the stage addon fit for the talks' own builders and counters, and
headless review that settles on the engine's clock.

### Headless review (`slidev-stage-shots`, feat/shots-v2)

- **Settles each frame on the engine's clock** instead of waiting: the world
  runs fast and undrawn until the camera has landed, nothing assembles and
  `--settle` engine-seconds (default 6) have passed since the slide or click
  changed; `--wait` is a wall-time cap. Randomness is seeded, so two runs with
  `--seed` and `--no-halo` give the same pictures. Under a software renderer
  a still settles in about 2 s instead of the 7–36 s v0.5.4's real-time wait
  took (and a fixed wait caught slides mid-flight).
- **`--stills`** keeps its v0.5.3 meaning on the new engine: the world alone,
  one `NN.jpg` per slide, for print, PDF export and the static fallback.
- One NDJSON line per frame (the settle, renderer and backend, overflow, page
  errors, failed requests, every text box with the luminance behind it); exit
  0 clean, 3 problems, 1 the run failed, 2 bad arguments, 128 + n a signal.
- `--changed` (only what changed, public files keyed by their bytes),
  `--sheet`, `--clicks none|last|all`, `--base` (read from index.html by
  default: a Pages build is served under its base), `--jobs`, `--probe`,
  `--draft`, `--burst`/`--every`, `--dev deck.md`, `--gl`, `--seed`,
  `--no-halo`, `--console`. Runs queue on `/tmp/slidev-stage-shots.lock`; a
  signal stops the whole run and writes the report so far.
- `window.__stage`: one documented probe (`state()`, `settle()`, `fps()`,
  `holdQuality()`); `canvas.__space` and the other handles stay as aliases.
- `bin/lib/chromium.mjs`: one launcher for shots, record, safe and the smoke
  tests, on the best WebGL the machine reaches (a native NVIDIA driver, WSL's
  GPU through Mesa d3d12, llvmpipe, then SwiftShader with a warning);
  `SLIDEV_STAGE_GL` / `--gl` force one. playwright-chromium pinned to ~1.59.1.

### The stage addon (fix/stage-addon)

- **`slidev-stage-check` names the slide and a code** for every problem
  (`unknown-station`, `missing-anchor`, `bad-pose`, `camera-inside-form`, …),
  suggests a close name, reads slides as Slidev counts them (hidden ones not),
  and finds the types and palettes a deck registers in its own `setup/`.
  `--json` prints the problems with their codes. The v0.5.1 place checks
  carry over as `duplicate-place`, `place-is-station` and `unknown-group`.
- **`<StageCount>`**: a number that counts with its slide, or with a form's
  own value (`for="grains"`), taking every prop of the talks' `Count.vue`.
- The addon ships the Vite config the talks copied (one three.js and one
  builder registry when a deck brings its own copy); `static-ground` draws
  the gradient without the world; the probe handle carries the options as
  resolved. No shader calls `smoothstep` with reversed edges (undefined in
  GLSL; black on some GPUs).

### The CLI (fix/cli-hardening)

- **`slidev-videos doctor`**: the CLI install, ffmpeg, gh, rclone and the
  deck's addons, in one report. **`contact-sheet`** tiles a candidate clip
  into one PNG.
- `--json`, `--version`, and `--project` before or after the subcommand; an
  explicit `--project` must exist.
- ffmpeg and ffprobe are picked for reading HTTPS, not taken first on PATH,
  and never a directory with one but not the other.
- `preflight` probes what the player serves, in parallel and from a cache;
  one bad probe no longer sinks the run. `venue` builds with
  `VITE_VIDEOS_LOCAL_FIRST=1`.
- `frames` cuts from the web tier a deck plays, downloads into a temporary
  directory, and a SIGTERM removes every download (exit 143). `--prune` keeps
  the whole manifest and deletes only with `--yes`.
- NVENC web encodes reach libx264's quality at its size, not twice it.

### Upgrading from v0.5.4

- Pin `#v0.6.0` for both addons and `@v0.6.0` for the CLI.
- `slidev-stage-check` output changed shape: each line starts with its slide;
  `--json` gives `{ ok, problems: [{ slide, line, code, level, msg }] }`.
- `slidev-stage-shots`: `--wait` is now a cap, not the wait; a script that
  read `report.json` reads `<out-dir>/shots.ndjson` (or passes `--json`).
- A talk that copied the addon's Vite config (`optimizeDeps.exclude`) can drop
  its copy.

## v0.5.4 — 2026-10-09

slidev-videos 0.5.4 · slidev-addon-videos 0.5.4 · slidev-addon-stage 0.2.4

Print and export, from the talks' first v0.5.3 exports:

- **Every print page showed slide 1's still** on Slidev 52.14 (the talks'
  version): its `useNav()` returns the deck's nav, which stays at 1 on the
  print route. The stage reads each page's own slide context. Checked on
  52.14.2: three pages, three stills.
- **`html[data-stage]` went missing in print**, and with it the CSS kit and
  every deck style scoped to it (the theme's background drew over the still,
  the type fell back to the theme's font): one stage mounts per page, and the
  first to unmount removed it for all. The page-wide marks are now counted.
- **A PDF a tenth the size**: the stage's paper grain (an SVG noise filter)
  printed as a page-sized raster on every page, and a filtered StagePhoto as a
  lossless one; in print the grain is left out and photos print unfiltered.
  The halo layer's canvas is not mounted in print. Innoday: 170 MB → 12.7 MB
  for 29 slides.
- **`slidev-stage-shots` settles each slide** before the shot (the camera
  landed, the forms gathered, StagePhotos handed over, transitions done),
  `--settle` seconds at most, instead of a fixed `--wait`, which caught slides
  mid-flight under a software renderer; the report names any that had not.
- **Posters** skip a speck on black: the first frame with 5 % of it lit
  (else anything lit at all), and a manifest entry's `poster = "0:24"` names
  the moment; a changed moment cuts the poster again.

## v0.5.3 — 2026-10-09

slidev-videos 0.5.3 · slidev-addon-videos 0.5.3 · slidev-addon-stage 0.2.3

- **Print and PDF export of a stage deck.** Slidev's print route mounts the
  stage once per page; each booted a WebGL world, so a long deck ran out of
  contexts and printed blank pages slowly. The stage now draws no world in
  print and shows the slide's still under the slide's own text:
  `public/stills/NN.jpg` (`stage.stills`), written by the new
  `slidev-stage-shots --stills` from a real render of the world alone. The
  example's six pages export in about 8 s.
- **The static fallback shows the same stills** (no float targets, reduced
  motion, a lost context at the lowest tier), not only the gradient.
- **`slidev export --range` works on hash-router decks**: it printed every
  slide (Slidev read the range from the hash's query); the stage addon sets
  the print range from the address. `--range 2-4` → three pages.
- **VideoPlayer in print and export** shows the clip's first lit frame, not a
  live `<video>` (a clip the exporting browser could not decode printed as a
  blank box). **`slidev-videos frames`** writes it as `<clip>.poster.jpg` beside
  the strip (up to 1280 px; `frames --all` for every clip); without one the
  strip's first lit tile is used. Strips cut before v0.5.3 are cut again once
  to add the poster.
- **Why the stage fell back, readable from a phone.** Every fallback sets
  `data-stage-fallback` on the stage root (`reduced-motion`, `no-webgl2`,
  `no-float-target`, `plugin`, `data`, `init`, `context-lost`) and logs one
  `stage: fallback — <reason>` line. `?stage-debug` in the address shows a
  panel with the reason, the GPU, float / half-float support, the render
  targets in use, the simulation size, pixel ratio, frame rate, textures,
  programs and shader errors.
- **A lost WebGL context no longer leaves the slide on black.** The stage
  stops drawing, shows its static background, and builds the world again one
  quality tier lower on a fresh canvas (photo places go back in); after two
  losses, or one at the lowest tier, the static stage stays. Shader compile
  errors are counted and logged.
- **Quality tiers** 0 (full) … 3 (floor), picked from the device: a phone
  (coarse pointer, small screen) starts at 2, a tablet or ≤ 4 GB at 1, a GPU
  with textures under 8192 at 2; `stage.tier` pins one. A tier caps the
  simulated field, the drawing buffer and a photo place's grains and textures
  (space.js `TIERS`).
- **Photo places hold far less GPU memory**: their photo and depth map are
  uploaded at about twice the grain lattice (1200 px for 600 grains, at most
  the tier's cap), not at full size (2400 px, ~23 MB a place with mipmaps
  off). The sharp picture at the front view is the page's `<img>`, unchanged.
- **Bloom follows the buffer's width**, so a phone's small buffer, or the
  frame-rate guard's lower steps, no longer wash a bright core out white.

### Upgrading from v0.5.2

- Pin `#v0.5.3` for both addons and `@v0.5.3` for the CLI.
- For print and export: `slidev-stage-shots <dist> public/stills --stills`,
  and `slidev-videos frames --all` for the posters; commit both. A talk's own
  print stills (`.print-still` over the slide) can go.
- On a phone, `?stage-debug` says how the stage runs or why it fell back.

## v0.5.2 — 2026-10-09

slidev-videos 0.5.2 · slidev-addon-videos 0.5.2 · slidev-addon-stage 0.2.2

- **Place groups.** `<StagePhoto mode="place" group="inventions">` and a
  slide's frontmatter `places: { inventions: true | false }` show or hide
  the group from that slide on, with a 1 s fade. Before the first slide that
  names a group it is the opposite, so one line on Part II's first slide keeps
  Part I's frames clear of Part II's places. The state comes from the slide
  list, so going back or jumping is right. A place the pose stands at always
  shows. `slidev-stage-check` reports a `places:` group no place is in.
  Engine: `space.setPlaceGroups()`, `placeGroups`, `placeVisibility`.
- **StagePhoto on GitHub Pages.** The photo and its depth map are resolved
  against the deck's base, so a deck served under `/<repo>/<talk>/` finds
  `/figures/x.jpg` and `x.depth.png` (they 404ed at the domain root, and a
  place had no grains). Paths that already carry the base, relative paths and
  full URLs are left as they are.
- **`humAt: all`** (or `'*'`): the hum plays on every pose, not only within
  reach of the listed stations.

## v0.5.1 — 2026-10-08

slidev-videos 0.5.1 · slidev-addon-videos 0.5.1 · slidev-addon-stage 0.2.1

- `slidev-stage-check` accepts StagePhoto places as pose targets: it reads
  every `<StagePhoto mode="place">` in the deck and the pages it pulls in
  (`src: ./pages/x.md`), by `place-id`, else the image's file stem, and stops
  reporting `space: { at: <place-id> }` as unresolved. A place-id used twice,
  or one that is also a station id, is reported.

## v0.5.0 — 2026-10-08

slidev-videos 0.5.0 · slidev-addon-videos 0.5.0 · slidev-addon-stage 0.2.0

### Clips (`slidev-addon-videos`)

- **Dust that fills the frame.** With `transition: dust` a clip now arrives as
  grains spread over the whole frame, in the clip's own colours, that
  condense in place into the full-bleed picture; leaving, it breaks up where
  it stands. `dustStyle: flight` keeps the earlier look (a card that gathers
  off in the world and flies to the frame). Dispersed grains are capped at
  luminance 0.62 and only about a third of them show, thinner toward the
  edges, so a pale picture never veils the frame and the world shows through.
- **A clip that opens on black** arrives as its first lit frame and plays
  from there (`dustFrom: lit`, the default; `start` keeps the opening). A
  frame counts as lit on the whole, or when a small subject is lit on black
  (0.2 % of its pixels), so an animation that opens on one figure in the dark
  no longer shows a second of black.
- **advance-on-end**: `<VideoPlayer advance-on-end />` (or
  `videos.advanceOnEnd`) goes to the next slide when the clip ends, once,
  from the audience's slide only (not the presenter window, overview,
  preview, print, or under the recorder), and not after the speaker has left
  the slide or clicked on it. Sends `slidev-videos:advance`.
- A leaving clip announces the mean colour it broke up from; the stage tints
  its dust with it. `videos.dustMs: [arrive, leave]`. The dust sheet is seen
  through a camera like the stage's.

### Photographs (`StagePhoto`, new)

- `<StagePhoto src focus>…</StagePhoto>` renders the kit's `.hero` markup
  (a talk's `.hero` styles apply) and arrives and leaves as grains coloured
  from the image itself (no strip file). The slot (headline, credit) waits
  for the picture: hidden while the grains gather, in over 300 ms once the
  sharp image is up, out in 250 ms before it breaks up, so two headlines
  never show at once (`:hold-text="false"` opts out).
- `arrive="camera"`: the grains condense when the stage camera is 85 %
  through its flight to the slide's pose (at most 3 s), so the flight shows.
- `mode="place"`: the photo stands in the world as a grain cloud, each pixel
  at its depth from a depth map, a relief (`relief`, default 0.2 of its
  width). A slide's pose `space: { at: <place-id> }` flies to its front view;
  there the relief flattens and the sharp image takes over. Leaving, it rises
  back into relief, dimmer, and stays in the world. In relief the grains are
  off their lattice, soft and round, with a mild depth of field.
- Presenter, overview, preview, print and reduced motion show the plain image.
- Known limit: the grains carry the bare photo, not a talk's `.hero`
  gradient, which steps in at the hand-over.

### The CLI (`slidev-videos`)

- **`slidev-videos depth <images>`** writes `<image>.depth.png` beside each
  photo (white = near) with Depth Anything V2 Small (ONNX, Apache-2.0) on
  the CPU through onnxruntime, under a second per image. Needs the `depth`
  extra; no project (`videos.toml`) needed.

### The stage (`slidev-addon-stage` 0.2.0)

- **Everything is grains**: `galaxy` and `collider` forms; whatever builds
  itself gathers on arrival at its station; `c` builds it again.
- **Flights**: streaks while the camera flies; a whoosh and a rising tone
  beside the hum (`sound: { hum, flight, clip, level }`); a slide's pose may
  set its own flight time (`space: { …, flight: 1.6 }`); the camera sends
  `slidev-stage:arrive` and exposes `flightProgress` and `camera`.
- **Broadcast**: `stage.look: broadcast` for a deck that is filmed or
  streamed (no film grain or fringes, fewer and larger grains, calmer bloom
  and flights, a ground lifted off near-black); the CSS kit scales its type
  and keeps to title-safe on air.
- **slidev-stage-record**: a deck to one video per slide on a fake clock, a
  slide after a clip recorded from the clip's last frame, and a slide counted
  as still only once its StagePhotos have arrived. **slidev-stage-safe**: the
  smallest type and the safe area per slide.
- Places: `addPhotoPlace` / `removePhotoPlace`, places as pose targets, poses
  held `still`.
- Playwright pinned to 1.59 (Chromium 147).

### Upgrading from v0.4.0

- Pin `#v0.5.0` for both addons and `@v0.5.0` for the CLI.
- A deck with `transition: dust` gets the full-frame arrival; set
  `videos.dustStyle: flight` to keep the old one.
- Run `pnpm videos:frames` again only if clips changed; strips are as before.
- For photo places: `pip install "slidev-videos[depth]"` and
  `slidev-videos depth public/figures/<photo>.jpg`, then commit the maps.
