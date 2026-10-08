# Changelog

One tag covers the whole repo: `vX.Y.Z` is the `slidev-videos` CLI and
`slidev-addon-videos` at that version, and `slidev-addon-stage` at its own
version, given beside the heading. Dates are those of the release commit.
`scripts/release.py` moves the Unreleased entries under the new version.

## Unreleased

<!-- Written ahead of the merges, from the scopes of feat/shots-v2,
feat/broadcast, fix/stage-addon and fix/cli-hardening. Before a release,
drop what did not land. release.py leaves this comment out. -->

### stage: headless review

- `slidev-stage-shots` settles each slide (the engine's clock, the halo,
  counters and CSS animations run to rest) instead of waiting a fixed time;
  `--wait` becomes a cap.
- One NDJSON line per frame (slide, png, station, overflow, page errors,
  renderer). Exit codes: 0 clean, 3 overflow or page errors, 1 crash; a
  partial report is always written.
- `--sheet` (a labelled contact sheet), `--changed` (only slides whose HTML
  or CSS changed), `--jobs N`.

### stage: broadcast

- `look: broadcast`: no film grain or chromatic aberration, fewer and larger
  dust grains, softer bloom, title-safe padding and a type floor, for a deck
  that is streamed at a low bitrate and shrunk into a frame.
- `slidev-stage-record`: per-slide MP4s of a built deck on a fixed clock.
- `slidev-stage-safe`: text under the type floor or outside the title-safe
  area.

### stage: addon fixes

- The addon ships its own `vite.config.js`, so `slidev dev` no longer
  pre-bundles a second copy of the addon and of three; talks can drop
  theirs.
- One builder registry however many times the module is loaded.
- `StageCount`: a counter on the engine's clock, with Lithuanian and English
  number formats.
- No world in print or PDF export.
- `slidev-stage-check --json`.

### videos CLI

- `--only X --prune` no longer deletes the talk release's other assets.
- ffmpeg and ffprobe resolve to a build that reads HTTPS (the static Linux
  builds crash on it), preferring one with NVENC.
- `slidev-videos doctor` and `--version`; `--json` on the reporting
  commands.
- `venue` builds local-first (`VITE_VIDEOS_LOCAL_FIRST=1`) whatever the
  talk's `build:portable` says.
- `preflight` probes clips in parallel.

### repo

- `scripts/release.py`, this changelog, a test that the version strings
  agree, and a CLAUDE.md for the repo.
- `slidev_videos.__version__` is the package version (it said 0.1.0 through
  v0.5.0).

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
