# slidev-videos

Release-hosted video pipeline for Slidev decks, in one repo:

- **`slidev-videos`** (Python ≥3.11, stdlib only) — manifest-driven CLI:
  `fetch · sync · encode · encode-hq · publish · publish-hq · pull · pull-hq ·
  check · shared-check · clean · preflight · venue · build`. Web tier is
  1080p H.264 with EBU R128 loudness normalisation; clips are hosted as
  GitHub Release assets.
- **`slidev-addon-videos`** — the full-bleed `VideoPlayer` component with a
  local → own-release → shared-release fallback chain, slide-driven playback,
  look-ahead preload and custom controls.
- **The shared clip library** — `src/slidev_videos/shared.toml` (registry) +
  this repo's `videos-shared` Release (the encodes).

## Install (per consumer repo)

    pip install "slidev-videos @ git+https://github.com/MindaugasSarpis/slidev-videos@v0.1.0"
    pnpm add -D github:MindaugasSarpis/slidev-videos#v0.1.0

Enable the addon and configure the player in the deck headmatter:

    addons:
      - slidev-addon-videos
    videos:
      repo: You/your-course          # own release lives here
      release: videos-web
      shared: MindaugasSarpis/slidev-videos@videos-shared   # or false
      fit: cover                      # or contain

`VITE_VIDEO_REPO / VITE_VIDEO_RELEASE / VITE_VIDEO_SHARED_REPO /
VITE_VIDEO_SHARED_RELEASE` work as an env fallback for decks that prefer
`.env` files.

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

## Day to day

    slidev-videos fetch <url> --name Clip --used-in L05
    slidev-videos encode && slidev-videos publish
    slidev-videos check          # manifest vs slides vs raw/web
    slidev-videos preflight      # what will the deployed deck actually serve?
    slidev-videos pull           # restore local web copies from the release

Run from anywhere inside a project (`videos.toml` is found by walking up), or
pass `--project <dir>`.

## New course, three steps

1. `videos.toml` at the repo root (see above) + an empty `videos/manifest.toml`.
2. Install both packages, add the `addons:` and `videos:` headmatter.
3. Embed clips as `<VideoPlayer src="name.mp4" />` — shared-library names
   stream from this repo's `videos-shared` release with no further setup.

Design spec: `CERN_lessons_on_data_analysis/docs/superpowers/specs/2026-09-01-video-pipeline-package-design.md`.
