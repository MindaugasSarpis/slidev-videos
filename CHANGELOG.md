# Changelog

One tag covers the whole repo: `vX.Y.Z` is the `slidev-videos` CLI and
`slidev-addon-videos` at that version, and `slidev-addon-stage` at its own
version, given beside the heading. Dates are those of the release commit.
`scripts/release.py` moves the Unreleased entries under the new version.

## Unreleased

<!-- Rewritten on 2026-10-08 from the commits on the open branches
(`git log origin/feat/effects-v2..<branch>`). The comment above each entry
names the branch it comes from: before a release, drop the entries of a
branch that did not land. release.py leaves every comment out. -->

### stage: headless review

<!-- feat/shots-v2 -->
- `slidev-stage-shots` settles each slide on a clock it drives (the camera
  lands, the forms gather, `--settle` engine-seconds pass) instead of
  waiting a fixed time; `--wait` becomes a cap. Randomness is seeded:
  two runs with `--seed` and `--no-halo` give byte-identical pictures.
<!-- feat/shots-v2 -->
- One NDJSON line per frame, written as the run goes: the settle, the
  renderer and backend, overflow, page errors, failed requests, and every
  visible text box with its size and the luminance behind it. Exit 0
  clean, 3 problems, 1 the run failed, 2 bad arguments.
<!-- feat/shots-v2 -->
- `--changed` (only frames whose slide, CSS or public files changed, the
  files keyed by their bytes), `--sheet`, `--clicks`, `--base`, `--jobs`
  (default 2), `--probe`, `--draft`, `--burst`/`--every`, `--dev`, `--gl`,
  `--seed`, `--no-halo`, `--console`.
<!-- feat/shots-v2 -->
- Runs queue on `/tmp/slidev-stage-shots.lock`. A signal stops the whole
  run, browser included, writes the report so far and frees the lock.
<!-- feat/shots-v2 -->
- `window.__stage`, one documented probe for headless tools (`state()`,
  `settle()`, `fps()`, `holdQuality()`); `canvas.__space` and the other
  handles stay as aliases.
<!-- fix/stage-addon -->
- `canvas.__space.options`: the stage options as the engine resolved them
  (a deck's `reach`, say), for probes.

### stage: one browser for the tools

<!-- feat/shots-v2 and feat/broadcast (the same file) -->
- `bin/lib/chromium.mjs` starts Chromium for shots, record, safe and the
  smoke test, on the best WebGL it reaches: a native NVIDIA driver, WSL's
  GPU through Mesa's d3d12 driver in a private prefix
  (`SLIDEV_STAGE_MESA_D3D12`), llvmpipe, then SwiftShader with a warning.
  A backend counts only when the page's renderer string confirms it.
  `SLIDEV_STAGE_GL` or `--gl` forces one; `SLIDEV_STAGE_CHROMIUM`,
  `SLIDEV_STAGE_CHROMIUM_ARGS` and `SLIDEV_STAGE_CHROMIUM_ENV` adjust the
  launch. Every report carries the renderer and the backend.
<!-- feat/shots-v2 and feat/broadcast (the same lines and lockfile) -->
- playwright-chromium is pinned to `~1.59.1` (Chromium 147): in WSL the
  headless shells of Chromium 151 and 153 fell back to SwiftShader.

### stage: broadcast

<!-- feat/broadcast -->
- `look: broadcast` under `stage:`, over any palette, for a deck that is
  filmed, recorded or streamed: no film grain or colour fringes, fewer and
  larger dust grains, calmer streaks and bloom, slower flights, a capped
  nebula, no halo, the ground lifted off near-black in its own hue, and no
  frame-rate guard. `options` in the headmatter still win.
<!-- feat/broadcast -->
- The CSS kit's type scales with `--stage-type-scale` and never goes under
  `--stage-type-min`. Under the broadcast look no line is under 16 canvas
  px, and what sits against the slide's edges keeps to title-safe.
<!-- feat/broadcast -->
- `slidev-stage-record`: a built deck to per-slide MP4s on a fake clock,
  so each frame lands on time however long it takes to draw. `NN.mp4`, one
  file per click, `--plate` (the same frames without the slide's text) and
  `index.json` as the edit list. NVENC when it works, else x264. It takes
  no lock of its own.
<!-- feat/broadcast -->
- `slidev-stage-safe`: the smallest type and every line outside the safe
  area, per slide and click; `--broadcast` for the on-air rules, `--json`.
<!-- feat/broadcast -->
- Engine options `twinkle` and `guard: false`;
  `definePalette(name, colours, look)`; the palette's dust and nebula
  reach CSS as `--stage-dust` and `--stage-nebula`.

### stage: addon fixes

<!-- fix/stage-addon -->
- One builder registry per page however many copies of the package load,
  so the builders and palettes a deck registers in `setup/main.ts` reach
  the world under `slidev dev`.
<!-- fix/stage-addon -->
- The addon ships its own `vite.config.js`: the addon and three stay out
  of the pre-bundle, and three is deduped when the deck has its own. Talks
  can drop their `vite.config.ts`.
<!-- fix/stage-addon -->
- Printed and exported pages draw the static gradient and open no WebGL
  context.
<!-- fix/stage-addon -->
- `StageCount`: a number that counts with its slide, or with a named form
  (`for`). It takes every prop of the talks' `setup/Count.vue` with the
  same defaults (`from`, `to`, `ms` 2900, `delay` 1000, `name`, `group`,
  `decimals`), plus `plain`, `lang` and `for`. Groups of three are set
  apart by a narrow no-break space; `lt` groups from five digits and
  writes a decimal comma, `en` from four with a decimal point. There is no
  `Count` alias: talks rename the tag.
<!-- fix/stage-addon -->
- `slidev-stage-check` gives every problem its slide, line and a code
  (`--json` prints them), finds the types a deck registers in `setup/`,
  and warns of a `<Count>` tag the deck no longer registers.
<!-- fix/stage-addon -->
- No shader calls `smoothstep` with its edges reversed, which GLSL leaves
  undefined.
<!-- fix/stage-addon -->
- `pnpm stage:smoke:dev` (in `test:all` and CI) runs the example deck,
  which now registers a builder of its own, under `slidev dev`.

### player

<!-- fix/stage-addon -->
- The dust sheet's grain no longer calls `smoothstep` with its edges
  reversed.

### videos CLI

<!-- fix/cli-hardening -->
- `--prune` compares with the whole manifest (`--only` with `--prune`
  exits 2) and deletes only with `--yes`; a dry run no longer creates a
  missing release.
<!-- fix/cli-hardening -->
- ffmpeg and ffprobe resolve to a pair that reads HTTPS (the static Linux
  builds crash on it), preferring one with NVENC.
  `SLIDEV_VIDEOS_FFMPEG_DIR` or `[defaults].ffmpeg_dir` names one.
<!-- fix/cli-hardening -->
- `slidev-videos doctor`, `--version`, and `--json` on check, preflight,
  frames and doctor; `--project` before or after the subcommand. Exit 0
  ok, 1 problems, 2 usage or setup.
<!-- fix/cli-hardening -->
- `preflight` probes what the player would serve, in the player's order
  (`--mode remote-first` for a deployed deck), several clips at once and
  from a cache; a silent track is reported as silent.
<!-- fix/cli-hardening -->
- `frames` downloads into a temporary directory and stops cleanly on
  SIGTERM; it cuts from the local web copy before the releases.
<!-- fix/cli-hardening -->
- `venue` builds the bundle with `VITE_VIDEOS_LOCAL_FIRST=1`, whatever the
  talk's `build:portable` says.
<!-- fix/cli-hardening -->
- `slidev-videos contact-sheet <file|url>`: a candidate clip tiled into
  one PNG.
<!-- fix/cli-hardening -->
- The NVENC web profiles match libx264 `slow` at the same crf on SSIM and
  XPSNR in smaller files: `cq` 27, 30, 28 and 25 (standard,
  standard-tight, silent-loop, high-motion) with `-multipass fullres
  -rc-lookahead 20`. A clip picks this up when it is next encoded.

### repo

<!-- chore/release-tooling -->
- `scripts/release.py`, this changelog, a test that the version strings
  agree, and a CLAUDE.md for the repo.
<!-- chore/release-tooling -->
- `slidev_videos.__version__` is the package version (it said 0.1.0
  through v0.5.0).
<!-- chore/release-tooling; fix/stage-addon and feat/broadcast, their bins -->
- The stage's bins are committed executable, so a checkout linked into a
  talk stays clean.

## v0.5.0 — 2026-09-29 (stage 0.2.0)

### stage

- `galaxy` and `collider`: forms made of grains of light, of a piece with
  the dust.
- A form gathers when the camera arrives at its own station, not only at the
  hero; `c` builds again what stands at the camera.
- Flight streaks: while the camera flies, dust grains are drawn out along
  their path across the screen.
- Dust tint: the dust takes a colour for a few seconds, such as the mean
  colour of a clip leaving as dust.
- Sound: a whoosh for each flight and a rising tone as a clip condenses,
  beside the hum (`sound: { hum, flight, clip, level }`). The hum follows
  the station the pose is at.
- The collider's spray is a short burst at the meeting point;
  `constellation` takes `coreSize` and `coreAlpha`.

### videos

- A dust sheet lives in a small world with its own camera. Arriving, grains
  gather onto a plane standing off and turned aside, which swings square and
  flies to the frame; leaving, the picture steps back and breaks up past the
  camera. `videos.dustMs` sets the two durations (1900 and 1700 ms).
- A leaving clip is handed to its sheet over 0.2 s, not at once.
- While a sheet stands off, its dark parts are see-through.
- A clip that opens on black arrives as its first lit frame of the opening
  12 s, and plays from there; `videos.dustFrom: start` keeps the opening.

## v0.4.0 — 2026-09-29 (stage 0.1.0)

### videos

- Transitions: `cut` (the default), `fade` and `dust`, from
  `videos.transition` or `transition=` on one clip. Sound ramps with the
  picture.
- `slidev-videos frames` writes a strip of small frames per clip into
  `public/video-frames/`, the dust's colours for a deployed deck (release
  assets have no CORS headers). `check` lists dust clips without a strip.
- `frames` downloads a release URL that ffprobe cannot read: the static
  Linux ffmpeg builds crash on HTTPS input.
- `check`, `preflight` and `frames` find `src` anywhere in a
  `<VideoPlayer>` tag.
- Window events `slidev-videos:transition` and `slidev-videos:cover`.
- `venue`'s RUN_ME named a script that no longer exists.

### stage (new)

- `slidev-addon-stage`, Startertalk's world as a package: one persistent 3D
  world under a deck, a camera that flies on each slide's `space:`
  frontmatter, the render chain, the dust, the halo borders, the hum and the
  hero slide.
- Palettes (`classic`, `blue`, `ember` or the deck's own) drive every colour
  and reach CSS as `--stage-*`; `blue` and `ember` bring a nebula.
- A builder registry (`registerBuilder`), the hadron plugin, and the
  `constellation`, `orbs` and `label` types.
- `slidev-stage-check` validates the space file and every pose;
  `slidev-stage-shots` photographs a built deck and reports overflow,
  camera position and page errors. playwright-chromium is an optional peer.

### repo

- The README presents the repo as a toolkit. CI gains a stage job (unit
  tests, the validator, build, headless smoke) and installs ffmpeg.

## v0.3.3 — 2026-09-09

- Player: a `<source>` is attached only inside a sliding window (the live
  slide, the three ahead, the one just passed). Chrome caps the media
  elements loaded per page, and a 32-clip reel froze at its 9th clip.

## v0.3.2 — 2026-09-09

- Library clips are full length: six course-reel trims removed and
  re-encoded. A deck that wants a shorter cut trims in its own manifest.

## v0.3.1 — 2026-09-08

- `check`: with a shared raw bank, sibling talks' raws are no longer this
  talk's orphans.
- Three library clips whose audio was digital silence are re-encoded as
  `silent-loop`.

## v0.3.0 — 2026-09-08

- The shared library has 43 clips (nine promoted from the outreach decks).
- `slidev-videos discover`: archive search (CDS, NASA, Wikimedia Commons,
  ESO, ESA/Hubble, ESA/Webb, NOIRLab) moved here from outreach_talks.
- Player: a placeholder instead of a `<video>` in the overview and the
  next-slide preview; the production look-ahead attaches the source instead
  of `<link rel=preload as=video>`.
- README: the table of clips renamed when the outreach decks moved onto the
  library.

Earlier: v0.2.0 (2026-09-08) and v0.1.0 (2026-09-03), described in their
tag messages.
