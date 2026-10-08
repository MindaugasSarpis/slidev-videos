# slidev-videos

Tools for keynote-grade Slidev talks, in one repo. It began as the video
pipeline and is growing into a toolkit: each tool is its own package, a deck
takes the ones it wants.

| tool | where | what it is |
| --- | --- | --- |
| **`slidev-videos`** | `src/` (Python ≥3.11, stdlib only) | manifest-driven CLI: `fetch · sync · encode · encode-hq · publish · publish-hq · pull · pull-hq · check · shared-check · frames · clean · preflight · venue · build · discover · doctor`. Web tier is 1080p H.264 with EBU R128 loudness normalisation; clips are hosted as GitHub Release assets |
| **`slidev-addon-videos`** | repo root | the full-bleed `VideoPlayer`: a local → own-release → shared-release fallback chain, slide-driven playback, look-ahead preload, `cut` / `fade` / `dust` transitions, native auto-hide controls, keyboard volume |
| **`slidev-addon-stage`** | [`packages/stage`](packages/stage/README.md) | one persistent 3D world under a whole deck: stations in a field of dust, a camera that flies from slide to slide, palettes, a builder registry, halo borders, a validator and a screenshot tool |
| **the shared clip library** | `src/slidev_videos/shared.toml` | the registry, with the encodes on this repo's `videos-shared` Release |

The two addons know of each other only through window events: a clip that
arrives as dust draws the stage's dust with it, and the stage rests its
renderer under a clip that covers the slide. Either works alone.

## Install (per consumer repo)

    pip install "slidev-videos @ git+https://github.com/MindaugasSarpis/slidev-videos@v0.5.0"
    pnpm add -D github:MindaugasSarpis/slidev-videos#v0.5.0
    pnpm add -D "github:MindaugasSarpis/slidev-videos#v0.5.0&path:/packages/stage"   # the stage, if wanted

## The player (`slidev-addon-videos`)

Enable the addon and point it at your release in the deck headmatter:

    ---
    addons:
      - slidev-addon-videos
    videos:
      repo: You/your-course     # GitHub repo whose release hosts the clips
      release: videos-web       # release tag (default: videos)
      shared: MindaugasSarpis/slidev-videos@videos-shared   # or `false`
      fit: cover                # cover | contain (default cover)
      hq: false                 # try public/videos-hq/<src> first (default false)
      volume: 1                 # 0..1 default playback level (default 1)
      transition: cut           # cut | fade | dust (default cut)
      dust: '#7dd3fc'           # colour of the grains in flight (dust only)
    ---

    <VideoPlayer src="clip_name.mp4" />

`VITE_VIDEO_REPO`, `VITE_VIDEO_RELEASE`, `VITE_VIDEO_SHARED_REPO` and
`VITE_VIDEO_SHARED_RELEASE` are the env fallbacks for the same values.

**Props:** `src` (bare filename, required), `fallback` (explicit URL for the
own-release step), `autoplay` (default `true`; `false` = the presenter starts
the clip by hand, it still preloads), `loop`, `muted`, `controls` (default
`true`), `autoHideControls` (default `true`: the native bar appears only while
the pointer is over the bottom strip or for a few seconds after a click/tap),
`hq`, `volume`, `fit`, `transition`, `dust`. Prop beats headmatter beats env
beats built-in.

**Source chain**, front to back: a production build tries the own release,
then the shared release, then `videos/` and `videos-hq/` under the deck's
`public/` (only present in a keep-videos build — the offline fallback);
`slidev` dev mode tries the local copies first. Setting
`VITE_VIDEOS_LOCAL_FIRST=1` at build time makes a keep-videos build
local-first too. Each `<source>` failure advances the chain; when it is
exhausted the slide shows `Video not available: <src>`.

**Playback** is slide-driven: rewind + play on activation (muted first, then
unmuted unless `muted`), pause + rewind on deactivation. A `<source>` is only
attached inside a sliding window — the live slide, the three ahead (preloaded
early, in dev and production alike) and the one just passed; every other
player is detached and `load()`ed empty so the browser frees its media
pipeline. Chrome caps the number of media elements loaded at once (~10 per
page on desktop) and beyond that a `load()` silently never completes, which
is what froze a 32-clip reel from its 9th clip on (v0.3.3).

**Transitions.** How a clip arrives and leaves with its slide
(`videos.transition`, or `transition=` on one clip):

| | arriving | leaving |
| --- | --- | --- |
| `cut` | on when ready (the default, as before v0.4) | off at once |
| `fade` | the picture dissolves in over 0.45 s, the sound over 0.6 s | both fade out; the clip plays on unseen for the 0.4 s its sound takes to go |
| `dust` | grains adrift in depth gather onto a plane standing some way off, turned aside, each taking its pixel's colour as it lands; the plane swings square and flies to the camera until it fills the frame (1.9 s); the clip dissolves in over it and starts | the picture stands back and breaks up from its edges in, its grains thrown toward and past the camera (1.7 s), keeping the picture's colours, while the next slide shows through |

With a transition the player has no black ground: what is under the slide
shows until the picture is up. The grains are drawn by an overlay the addon
mounts itself (its `global-top.vue`; plain WebGL2, created on first use), so
the deck must load the package as an addon, not symlink its `components/`.
While a clip is slow to arrive the assembled sheet holds its first frame. A
clip that opens on black gives the grains nothing to gather into, so its
sheet is made of the first lit frame of its opening twelve seconds and the
clip plays from that moment (`videos.dustFrom: start` keeps the opening).
The sheet is seen through a camera like the stage's (the same field of view),
so over the stage it belongs to that world. `videos.dustMs: [1900, 1700]`
sets the two durations.

The grains need the picture's pixels. Release assets are served without CORS
headers, so a deployed deck can play a clip but not read it; **`slidev-videos
frames`** writes a small strip of frames per clip into
`public/video-frames/` (one 320 px tile every 4 s, at most 64, about
150–350 KB a clip) for the deck to commit. Arriving uses the first tile,
leaving the tile at the moment the presenter moved on. Where the clip is
same-origin (dev mode, venue and portable builds) the frame on screen is read
directly instead. No strip, no overlay, no WebGL2 or `prefers-reduced-motion`:
the clip fades. `check` lists the `dust` clips that have no strip. `frames`
cuts from the local copy if there is one, else from the release; where
ffmpeg cannot read HTTPS (the static Linux builds crash on it) the clip is
downloaded, cut and removed.

Other addons can follow along on `window`: `slidev-videos:transition`
`{ phase: 'enter' | 'leave', mode, src, duration, color }` and
`slidev-videos:cover` `{ covered, src, fit }`. `color` is the mean colour of
the frame a leaving `dust` clip broke up from (`[r, g, b]`, weighted toward
its lit and coloured parts); the stage tints its dust with it.

**Overview and previews.** In Slidev's overview grid (`o`) and the presenter's
next-slide preview the player renders a static placeholder, not a `<video>`:
the overview mounts every slide at once, and its copy of the current slide
would otherwise re-download the clip being watched.

**Keyboard**, on the active slide's clip, without revealing the control bar:

| key | action |
| --- | --- |
| `p` | play / pause |
| `+` (also `=`) | volume up 10% |
| `-` (also `_`) | volume down 10% |

The level set with `+` / `-` sticks for every later clip in the browser
(shared across players, kept in `localStorage`), so one adjustment at the
venue carries through the whole talk. A small `🔊 NN%` badge confirms the
level for about a second. Rationale: a Mac over HDMI ignores keyboard and room
volume controls (digital output), so the in-page level is the only handle.

Smoke test: `pnpm make:clip && pnpm build:example && pnpm smoke` (Playwright,
headless) checks the headmatter reaches the chain, the fallback order,
`videos.volume`, the three keys and the sticky level, and watches the `dust`
transition end to end on a generated clip (`make:clip` needs ffmpeg; without
the clip those checks are skipped with a note). `pnpm test:all` runs this and
the stage's tests.

## videos.toml (project root)

    [project]                # optional — defaults are the classic talk layout
    slides_dir = "lectures/content/slides"
    public_dir = "lectures/content/public"

    [defaults]
    repo          = "You/your-course"   # default: origin remote
    release_tag   = "videos-web"
    source_remote = "gdrive:your/raws"  # for `sync`
    # web_long_edge_px = 1920, max_size_mb = 200, loudnorm = true, ...
    # ffmpeg_dir = "~/micromamba/envs/talks/bin"   # optional, see below

**Which ffmpeg.** `$SLIDEV_VIDEOS_FFMPEG_DIR`, then `[defaults].ffmpeg_dir`,
name the directory holding the ffmpeg and ffprobe to use. After those the CLI
looks in `$CONDA_PREFIX/bin`, `~/micromamba/envs/*/bin` (also miniforge3,
mambaforge, miniconda3) and every PATH entry. It skips a build that crashes
on an offline HTTPS probe, as the static Linux builds do, and among the builds
it finds on its own it prefers one with NVENC. Each build is probed once; the
result is cached in `~/.cache/slidev-videos/tools.json` until the binary
changes. Choosing a binary does not change how it encodes: `encode` still
test-encodes `h264_nvenc` on the chosen ffmpeg to decide between NVENC and
libx264. `slidev-videos doctor` shows the pair in use, the ones passed over
and why.

Manifest (`videos/manifest.toml`) entries:

    [[videos]]
    name    = "clip.mp4"
    profile = "standard"          # remux | standard | standard-tight | silent-loop | high-motion
    used_in = ["L01"]
    trim    = ["0:20", "1:50"]    # optional; remux trims on keyframes
    notes   = "what it shows"

## The shared library

`src/slidev_videos/shared.toml` lists 43 clips served from this repo's
`videos-shared` release. Consumers reference them by name; `check` reports
them as inherited. `scripts/fetch-shared-raws.sh` rebuilds the local raw
bank (`videos/raw/`, ~15 GB) from the Drive masters.

Library clips are **full length**. A deck that wants a shorter cut lists the
clip in its own manifest with a `trim` and publishes to its own release; the
talk release wins the player's chain over the library, and the raw stays
whole. (Until 2026-09-09 six entries carried a course reel's 90 s trims.)

Names changed when the outreach decks moved onto the library (2026-09-08):

| old name (outreach decks) | library name |
|---|---|
| cern_video_2019_050_008_1080ph265.mp4 | cern_video_2019_050_008.mp4 |
| cassini.mov | cassini_grand_finale.mp4 |
| perseverence_rover_landing_nasa.mp4 | perseverance_rover_landing_nasa.mp4 |
| cern_footage_2022_013_001_1080p_lhc.mp4 | cern_footage_2022_013_001.mp4 |
| drone_climbing_mountain_2.mp4 | drone_climbing_mountain.mp4 |
| expansion_funnel_h264_1080p.webm | expansion_funnel.webm |
| lhcb_aciu.mov | lhcb_aciu.mp4 |
| sm.mov | standard_model.mp4 (silent) |
| atoms.mov | atoms.mp4 |
| mountain.mov | mountain.mp4 |

## Day to day

    slidev-videos fetch <url> --name Clip --used-in L05
    slidev-videos encode && slidev-videos publish
    slidev-videos check          # manifest vs slides vs raw/web (and dust clips without a strip)
    slidev-videos frames         # frame strips for the dust transition -> public/video-frames/ (commit them)
    slidev-videos preflight      # probe what the deck will really play (--mode remote-first: the deployed deck)
    slidev-videos pull           # restore local web copies from the release
    slidev-videos discover "cloud chamber" lhc --source cds,nasa   # find new clips; prints [[videos]] snippets
    slidev-videos doctor         # CLI version and install, the ffmpeg in use, gh, rclone, the deck's addon versions

Run from anywhere inside a project (`videos.toml` is found by walking up), or
pass `--project <dir>`, before or after the subcommand.

`preflight` follows the player's chain for each clip: the local HQ copy only
when the clip opts into `hq`, then the local web copy, the talk's release and
the shared release; local copies first by default (dev, the venue bundle),
releases first with `--mode remote-first`. It probes `--jobs` clips at once
(default 6) and caches each probe and loudness reading in
`~/.cache/slidev-videos/probe.json` under the file's path and mtime or the
release asset's version, so a re-run reads only what changed. A track that
measures `-inf` LUFS is reported as silent (use the `silent-loop` profile),
not as a loudness miss.

`check`, `preflight`, `frames` and `doctor` take `--json`: one JSON object on
stdout, the usual text on stderr. Exit codes: 0 when all is well, 1 when
problems were found, 2 for usage and setup errors (a bad flag, no
`videos.toml`, a missing tool). `slidev-videos --version` prints the installed
version and the directory it runs from. rclone's `--progress` is passed only
when stdout is a terminal.

`--prune` (on `publish`, `publish-hq`, `pull`, `pull-hq`) deletes what the
whole manifest no longer lists: release assets for the publish commands, local
files for the pull commands. It cannot be combined with `--only`, and it
deletes only with `--yes`; `--dry-run` lists what it would delete and changes
nothing (a dry run does not create a missing release either):

    slidev-videos publish --prune --dry-run
    slidev-videos publish --prune --yes
    pnpm videos:publish -- --prune --yes   # through a talk's pnpm script

## New course, three steps

1. `videos.toml` at the repo root (see above) + an empty `videos/manifest.toml`.
2. Install both packages, add the `addons:` and `videos:` headmatter.
3. Embed clips as `<VideoPlayer src="name.mp4" />` — shared-library names
   stream from this repo's `videos-shared` release with no further setup.
   `src` may stand anywhere in the tag; `check`, `preflight` and `frames`
   find it.
4. For `transition: dust`: `slidev-videos frames`, and commit
   `public/video-frames/`.

## Adding a tool

A new tool is a new directory under `packages/` with its own `package.json`
(the workspace picks it up), README, tests and example deck; a Slidev addon
puts `components/`, `styles/` and its `global-top.vue` / `global-bottom.vue`
at its package root, where Slidev looks for them. Keep a tool configurable
from the deck's headmatter, keep talk content out of it, and let tools meet
through window events rather than imports, so a deck can take one without
the others. `slidev-addon-videos` stays at the repo root so that existing
`#v0.3.x` installs keep resolving.

Design spec: [2026-09-01 video pipeline package design](https://github.com/MindaugasSarpis/CERN_lessons_on_data_analysis/blob/main/docs/superpowers/specs/2026-09-01-video-pipeline-package-design.md) (in the course repo).
