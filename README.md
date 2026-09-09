# slidev-videos

Release-hosted video pipeline for Slidev decks, in one repo:

- **`slidev-videos`** (Python ≥3.11, stdlib only) — manifest-driven CLI:
  `fetch · sync · encode · encode-hq · publish · publish-hq · pull · pull-hq ·
  check · shared-check · clean · preflight · venue · build`. Web tier is
  1080p H.264 with EBU R128 loudness normalisation; clips are hosted as
  GitHub Release assets.
- **`slidev-addon-videos`** — the full-bleed `VideoPlayer` component with a
  local → own-release → shared-release fallback chain, slide-driven playback,
  look-ahead preload, native auto-hide controls and keyboard volume.
- **The shared clip library** — `src/slidev_videos/shared.toml` (registry) +
  this repo's `videos-shared` Release (the encodes).

## Install (per consumer repo)

    pip install "slidev-videos @ git+https://github.com/MindaugasSarpis/slidev-videos@v0.3.2"
    pnpm add -D github:MindaugasSarpis/slidev-videos#v0.3.2

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
    ---

    <VideoPlayer src="clip_name.mp4" />

`VITE_VIDEO_REPO`, `VITE_VIDEO_RELEASE`, `VITE_VIDEO_SHARED_REPO` and
`VITE_VIDEO_SHARED_RELEASE` are the env fallbacks for the same values.

**Props:** `src` (bare filename, required), `fallback` (explicit URL for the
own-release step), `autoplay` (default `true`; `false` = the presenter starts
the clip by hand, it still preloads), `loop`, `muted`, `controls` (default
`true`), `autoHideControls` (default `true`: the native bar appears only while
the pointer is over the bottom strip or for a few seconds after a click/tap),
`hq`, `volume`, `fit`. Prop beats headmatter beats env beats built-in.

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

Smoke test: `pnpm build:example && pnpm smoke` (Playwright, headless) checks
the headmatter reaches the chain, the fallback order, `videos.volume`, the
three keys and the sticky level.

## videos.toml (project root)

    [project]                # optional — defaults are the classic talk layout
    slides_dir = "lectures/content/slides"
    public_dir = "lectures/content/public"

    [defaults]
    repo          = "You/your-course"   # default: origin remote
    release_tag   = "videos-web"
    source_remote = "gdrive:your/raws"  # for `sync`
    # web_long_edge_px = 1920, max_size_mb = 200, loudnorm = true, ...

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
    slidev-videos check          # manifest vs slides vs raw/web
    slidev-videos preflight      # what will the deployed deck actually serve?
    slidev-videos pull           # restore local web copies from the release
    slidev-videos discover "cloud chamber" lhc --source cds,nasa   # find new clips; prints [[videos]] snippets

Run from anywhere inside a project (`videos.toml` is found by walking up), or
pass `--project <dir>`.

## New course, three steps

1. `videos.toml` at the repo root (see above) + an empty `videos/manifest.toml`.
2. Install both packages, add the `addons:` and `videos:` headmatter.
3. Embed clips as `<VideoPlayer src="name.mp4" />` — shared-library names
   stream from this repo's `videos-shared` release with no further setup.

Design spec: [2026-09-01 video pipeline package design](https://github.com/MindaugasSarpis/CERN_lessons_on_data_analysis/blob/main/docs/superpowers/specs/2026-09-01-video-pipeline-package-design.md) (in the course repo).
