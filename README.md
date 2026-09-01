# slidev-videos

Release-hosted video pipeline for Slidev decks: a Python CLI (`slidev-videos`)
to fetch/encode/publish/check clips against a TOML manifest, a Slidev addon
(`slidev-addon-videos`) that ships the full-bleed `VideoPlayer` component, and
the shared clip library (`shared.toml` registry + the `videos-shared` GitHub
Release of 1080p H.264 encodes).

Status: scaffold only — the implementation lands per the design spec in
`CERN_lessons_on_data_analysis/docs/superpowers/specs/2026-09-01-video-pipeline-package-design.md`
(§3–§6). Consumers: the CERN lessons course, cern_outreach_talks, World of Particles.

Install (once released):

    pip install "slidev-videos @ git+https://github.com/MindaugasSarpis/slidev-videos@v0.1.0"
    pnpm add -D github:MindaugasSarpis/slidev-videos#v0.1.0
