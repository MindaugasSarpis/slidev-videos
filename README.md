# slidev-videos

Release-hosted video pipeline for Slidev decks: a Python CLI (`slidev-videos`)
to fetch/encode/publish/check clips against a TOML manifest, a Slidev addon
(`slidev-addon-videos`) that ships the full-bleed `VideoPlayer` component, and
the shared clip library (`shared.toml` registry + the `videos-shared` GitHub
Release of 1080p H.264 encodes).

Status: CLI config layer + pipeline and the addon player are implemented;
CI, the tagged release and the shared library encode are still to come, per
the design spec in
`CERN_lessons_on_data_analysis/docs/superpowers/specs/2026-09-01-video-pipeline-package-design.md`
(§3–§6). Consumers: the CERN lessons course, cern_outreach_talks, World of Particles.

Install (once released):

    pip install "slidev-videos @ git+https://github.com/MindaugasSarpis/slidev-videos@v0.1.0"
    pnpm add -D github:MindaugasSarpis/slidev-videos#v0.1.0

## The player (`slidev-addon-videos`)

Add the addon and point it at your release in the deck headmatter:

    pnpm add -D github:MindaugasSarpis/slidev-videos
    
    ---
    addons: [videos]
    videos:
      repo: owner/repo          # GitHub repo whose release hosts the clips
      release: videos-web       # release tag (default: videos)
      shared: owner/repo@tag    # or `false` to skip the shared library
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
unmuted unless `muted`), pause + rewind on deactivation. The three slides ahead
are preloaded.

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
