#!/usr/bin/env python3
"""Video asset pipeline: sync, encode, publish, check, frames, encode-hq, publish-hq.

Reads videos/manifest.toml as the source of truth. Raws live in videos/raw/;
encoded web copies are written to public/videos/ and published to a
long-lived GitHub Release (default tag: videos-<talk>). A separate
visually-lossless HQ tier is encoded into videos/hq/ for venue playback
and can be published to a parallel release (default tag: videos-hq-<talk>)
so any machine can `gh release download` the venue masters instead of
re-encoding them.

The shared registry (src/slidev_videos/shared.toml, shipped with the
package) declares clips that live in a shared GH Release and are inherited by talks at runtime
(via VideoPlayer's fallback chain). Per-talk commands (sync, encode,
publish, pull) operate ONLY on talk-owned clips; shared clips are not
downloaded or re-encoded when working on a specific talk. The `check`
command treats slide refs satisfied by the shared registry as OK.

Subcommands:
    sync           rclone manifest-listed raw files from the remote (--all: whole folder)
    encode         ffmpeg raw -> public/videos/ (web tier, idempotent)
    publish        gh release upload web files, clobbering existing assets
    pull           gh release download web files -> public/videos/
                   (--include-shared: also deck-referenced shared clips)
    check          sanity check: profiles, missing/orphaned files per tier,
                   over-budget web copies, slide-ref mismatches
    encode-hq      ffmpeg raw -> videos/hq/ (visually-lossless venue masters)
    publish-hq     gh release upload HQ files to the parallel release
    pull-hq        gh release download HQ files -> videos/hq/
                   (--include-shared: also deck-referenced shared HQ masters)
    shared-check   sanity-check the shared registry (run from the package repo)
    frames         frame strips for the `dust` transition -> public/video-frames/
    clean          delete local files whose remote copy is verified (dry-run default)
    preflight      venue lint: probe served codec/resolution/bitrate/audio/loudness
    venue          one-shot offline bundle: pull -> preflight -> build:portable -> zip
"""
from __future__ import annotations

import argparse
import contextlib
import functools
import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import tomllib
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from collections.abc import Sequence
from pathlib import Path

# Project root and layout come from videos.toml (see config.py); main()
# resolves them via config.load_project() and binds these before dispatch.
from . import config as _config
from . import tools as _tools_mod

TALK: Path = None          # project root
MANIFEST: Path = None
RAW_DIR: Path = None
WEB_DIR: Path = None       # <public_dir>/videos
HQ_DIR: Path = None
HQ_LINK_DIR: Path = None   # <public_dir>/videos-hq
SLIDES_DIR: Path = None
GH_REPO_ARGS: list[str] = []   # ["--repo", owner/repo] when configured
_PROJECT: "_config.Project" = None
_TOOLS: "_tools_mod.Tools | None" = None   # resolved on first use (tools.py)
_TOOLS_LOCK = threading.Lock()


def _init_paths(project: "_config.Project") -> None:
    global TALK, MANIFEST, RAW_DIR, WEB_DIR, HQ_DIR, HQ_LINK_DIR, SLIDES_DIR
    global GH_REPO_ARGS, _PROJECT, _TOOLS
    _PROJECT = project
    _TOOLS = None
    TALK = project.root
    MANIFEST = project.manifest
    RAW_DIR = project.raw_dir
    WEB_DIR = project.public_dir / "videos"
    HQ_DIR = project.hq_dir
    HQ_LINK_DIR = project.public_dir / "videos-hq"
    SLIDES_DIR = project.slides_dir
    repo = project.defaults.get("repo")
    GH_REPO_ARGS = ["--repo", repo] if repo else []


def _forget_project() -> None:
    """No videos.toml: a command that runs without one sees no project."""
    global _PROJECT, _TOOLS
    _PROJECT, _TOOLS = None, None


def _tools() -> "_tools_mod.Tools":
    """The ffmpeg/ffprobe pair this run uses (see tools.py), resolved once."""
    global _TOOLS
    with _TOOLS_LOCK:
        if _TOOLS is None:
            defaults = _PROJECT.defaults if _PROJECT else {}
            _TOOLS = _tools_mod.resolve(defaults.get("ffmpeg_dir"), _PROJECT.root if _PROJECT else None)
        return _TOOLS


def _ffmpeg() -> str:
    return _tools().ffmpeg or "ffmpeg"


def _ffprobe() -> str:
    return _tools().ffprobe or "ffprobe"


def _find_monorepo_root(start: Path) -> Path | None:
    for p in [start, *start.parents]:
        if (p / _config.CONFIG_NAME).exists():
            return p
    return None


def bank_manifest_names(raw_dir: Path, project_root: Path) -> set[str]:
    """Names declared by every project that shares raw_dir as a raw bank.

    When raw_dir lies outside the project (a monorepo bank such as
    <repo>/videos/raw shared by every talk), walk the bank's repo — the
    nearest ancestor of raw_dir holding a videos.toml, else raw_dir's parent —
    for other projects' manifests, so a sibling talk's raws are not reported
    as this talk's ORPHAN RAW. Empty when the bank is inside the project.
    """
    raw_dir = raw_dir.resolve()
    project_root = project_root.resolve()
    if project_root == raw_dir or project_root in raw_dir.parents:
        return set()
    top = _find_monorepo_root(raw_dir.parent) or raw_dir.parent
    names: set[str] = set()
    for cfg in top.rglob(_config.CONFIG_NAME):
        if any(part in SKIP_SCAN_DIRS for part in cfg.relative_to(top).parts):
            continue
        proj = cfg.parent
        manifest = proj / _config._read(cfg).get("project", {}).get("manifest", "videos/manifest.toml")
        if not manifest.is_file():
            continue
        try:
            with manifest.open("rb") as f:
                names |= {v["name"] for v in tomllib.load(f).get("videos", []) if "name" in v}
        except (OSError, tomllib.TOMLDecodeError):
            continue
    return names


def _load_global_defaults() -> dict:
    return dict(_PROJECT.defaults) if _PROJECT else {}


def _auto_release_tag(prefix: str) -> str:
    slug = TALK.name.lower().replace("_", "-")
    return f"{prefix}-{slug}"

# ---------------------------------------------------------------------------
# Encoder selection + profiles
# ---------------------------------------------------------------------------
#
# TWO CODECS BY TIER — this is deliberate:
#   WEB tier (standard / standard-tight / silent-loop / high-motion) is
#   H.264 — the fallback that plays in arbitrary DEPLOYED browsers (GH Pages,
#   remote viewers). HEVC does NOT hardware-decode there — Firefox has no HEVC
#   at all, and Chrome only where the OS ships a decoder — while H.264 High is
#   hardware-decoded on essentially every device made in the last decade.
#   Each web profile also carries a -maxrate/-bufsize ceiling so a high-motion
#   clip can't balloon past what a normal connection streams, and scales to
#   web_long_edge_px (default 1920) — the venue width is an HQ concern.
#
#   HQ tier (`hq-visually-lossless`) stays HEVC: it is played LOCALLY at the
#   venue on a machine that hardware-decodes HEVC, so the ~40% HEVC size win
#   at equal quality is pure upside there.
#
# Profiles are quality *targets* (constant-quality number + bitrate ceiling +
# audio policy); the concrete ffmpeg args are built per selected encoder:
#   nvenc  GPU hardware encode (RTX). `-rc vbr -cq N -b:v 0` = constant-quality
#          VBR. ~1-2 orders of magnitude faster than libx26x preset slow.
#   cpu    libx264 (web) / libx265 (HQ) preset slow — the graceful fallback for
#          machines/CI without a working NVENC.
#
# `remux` is special: `-c copy` streams the original bits through losslessly
# and just rewrites the container with +faststart. Zero quality change — use
# it only when the source is ALREADY a web-friendly H.264 (or low-bitrate
# HEVC that you accept won't play in Firefox).


@functools.lru_cache(maxsize=None)
def _encodes_with(ffmpeg: str, codec: str) -> bool:
    probe = subprocess.run(
        [ffmpeg, "-hide_banner", "-loglevel", "error",
         "-f", "lavfi", "-i", "testsrc2=size=256x144:rate=30:duration=1",
         "-c:v", codec, "-f", "null", "-"],
        capture_output=True,
    )
    return probe.returncode == 0


def nvenc_available() -> bool:
    """True iff h264_nvenc actually *encodes* here (compiled-in != runtime-ok)."""
    ffmpeg = _tools().ffmpeg
    return bool(ffmpeg) and _encodes_with(ffmpeg, "h264_nvenc")


def videotoolbox_available() -> bool:
    """True iff hevc_videotoolbox actually *encodes* here (macOS only)."""
    ffmpeg = _tools().ffmpeg
    return bool(ffmpeg) and _encodes_with(ffmpeg, "hevc_videotoolbox")


def select_encoder(entry_encoder: str | None) -> str:
    """Per-video override wins; else auto (nvenc if available, else cpu).

    `videotoolbox` is opt-in only, never auto-selected: it is Apple Silicon's
    hardware HEVC encoder, which trades a little coding efficiency for ~90x the
    speed of libx265 (measured on an M2 Pro at 4K: 50 fps vs 0.55 fps). Reach
    for it when a CPU master would not finish in the time available.

    A manifest is shared across machines, so an `encoder` a given box cannot
    run degrades to the local best rather than failing the encode: the Mac that
    needs videotoolbox and the Linux workstation that cannot run it both build
    the same manifest.
    """
    if entry_encoder == "videotoolbox":
        if videotoolbox_available():
            return "videotoolbox"
        print("  ! videotoolbox requested but unavailable here — falling back",
              file=sys.stderr)
        entry_encoder = None
    if entry_encoder == "nvenc" and not nvenc_available():
        print("  ! nvenc requested but unavailable here — falling back to cpu",
              file=sys.stderr)
        entry_encoder = None
    if entry_encoder in ("nvenc", "cpu"):
        return entry_encoder
    return "nvenc" if nvenc_available() else "cpu"


# Web H.264 quality targets: nvenc -cq / libx264 -crf, -maxrate/-bufsize
# streaming ceiling, audio bitrate (None = -an).
WEB_PROFILES: dict[str, dict] = {
    "standard":       {"cq": 23, "crf": 23, "maxrate": "6M",    "bufsize": "12M", "audio": "128k"},
    "standard-tight": {"cq": 27, "crf": 26, "maxrate": "3500k", "bufsize": "7M",  "audio": "128k"},
    "silent-loop":    {"cq": 25, "crf": 24, "maxrate": "5M",    "bufsize": "10M", "audio": None},
    "high-motion":    {"cq": 20, "crf": 22, "maxrate": "8M",    "bufsize": "16M", "audio": "192k"},
}
# HQ master HEVC quality target (visually lossless): nvenc -cq / libx265 -crf.
HQ_CQ, HQ_CRF = 18, 16
PROFILE_NAMES = {"remux", "hq-visually-lossless", *WEB_PROFILES}


def _scale(long_edge: int) -> list[str]:
    return ["-vf", f"scale='min({long_edge},iw)':-2"]


def _web_args(spec: dict, long_edge: int, encoder: str) -> list[str]:
    if encoder == "nvenc":
        v = ["-c:v", "h264_nvenc", "-preset", "p5", "-tune", "hq",
             "-rc", "vbr", "-cq", str(spec["cq"]), "-b:v", "0",
             "-profile:v", "high", "-pix_fmt", "yuv420p"]
    else:
        v = ["-c:v", "libx264", "-preset", "slow", "-crf", str(spec["crf"]),
             "-profile:v", "high", "-pix_fmt", "yuv420p"]
    v += ["-maxrate", spec["maxrate"], "-bufsize", spec["bufsize"]]
    audio = spec["audio"]
    a = ["-an"] if audio is None else ["-c:a", "aac", "-b:a", audio, "-ac", "2"]
    return v + _scale(long_edge) + a + ["-movflags", "+faststart"]


def _hq_args(cq: int, crf: int, long_edge: int, encoder: str) -> list[str]:
    if encoder == "nvenc":
        v = ["-c:v", "hevc_nvenc", "-tag:v", "hvc1", "-preset", "p7", "-tune", "hq",
             "-rc", "vbr", "-cq", str(cq), "-b:v", "0", "-pix_fmt", "yuv420p"]
    elif encoder == "videotoolbox":
        # The media engine is bitrate-driven, not CRF-driven (so hq_crf does
        # not apply), so pick a ceiling generous enough to stay visually
        # lossless: ~80 Mbps at 4K, scaled linearly by long edge (2880 -> 60M,
        # 1080p -> 40M). Deliberately well above what the material needs, and
        # still a fraction of the 130-210 Mbps editor exports these come from.
        mbps = max(12, round(80 * long_edge / 3840))
        v = ["-c:v", "hevc_videotoolbox", "-tag:v", "hvc1",
             "-b:v", f"{mbps}M", "-pix_fmt", "yuv420p"]
    else:
        v = ["-c:v", "libx265", "-tag:v", "hvc1", "-preset", "slow",
             "-crf", str(crf), "-tune", "grain", "-pix_fmt", "yuv420p"]
    return v + _scale(long_edge) + ["-c:a", "copy", "-movflags", "+faststart"]


# Audio codecs Chrome's MP4/MOV demuxer can actually decode. Anything else in
# an HQ master plays as silence in the deck.
BROWSER_SAFE_AUDIO = frozenset({"aac", "mp3", "flac", "opus", "vorbis"})


def _probe_audio_codec(path: Path) -> str | None:
    """First audio stream's codec name, or None when the file is silent."""
    out = subprocess.run(
        [_ffprobe(), "-v", "error", "-select_streams", "a:0",
         "-show_entries", "stream=codec_name", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True,
    )
    codec = out.stdout.strip().splitlines()
    return codec[0].strip() if codec and codec[0].strip() else None


def _hq_audio_args(raw: Path) -> list[str]:
    """Override `-c:a copy` when the source audio would not play in a browser.

    HQ masters are served straight off disk to VideoPlayer, so their audio has
    to survive Chrome's demuxer. Editors routinely export venue masters with
    uncompressed PCM (Resolve's default for a QuickTime master); `-c:a copy`
    carries that through happily and the slide then plays silent — a failure
    nobody notices until the room is quiet. Returns [] when copy is fine.
    """
    codec = _probe_audio_codec(raw)
    if codec is None or codec in BROWSER_SAFE_AUDIO:
        return []
    return ["-c:a", "aac", "-b:a", "320k", "-ac", "2"]


# ---------------------------------------------------------------------------
# Loudness normalization (web tier)
# ---------------------------------------------------------------------------
#
# Every web encode lands at the same integrated loudness (EBU R128), so the
# venue volume gets set once — on the first clip — instead of being chased
# clip-by-clip through the talk. -16 LUFS integrated is the common streaming
# target: loud enough for a room, with headroom for -1.5 dBTP peaks.
# Two-pass LINEAR mode applies one constant gain per clip, preserving its
# internal dynamics; single-pass "dynamic" loudnorm pumps audibly on music
# and applause. Opt out per clip (or talk-wide in [defaults]) with
# `loudnorm = false` — e.g. for a clip whose deliberately quiet ambience
# should stay quiet.

LOUDNORM_I, LOUDNORM_TP, LOUDNORM_LRA = -16.0, -1.5, 11.0
# preflight flags clips whose integrated loudness strays more than this many
# LU from LOUDNORM_I (2 LU is a clearly audible level step).
LOUDNESS_TOLERANCE_LU = 2.0


def _measure_loudness(
    src: str | Path,
    trim_in: Sequence[str] = (),
    trim_out: Sequence[str] = (),
) -> dict | None:
    """First loudnorm pass: R128 stats of the first audio stream.

    Audio-only decode (video is not touched), works on local paths and
    https URLs alike. Returns the parsed measurement dict or None when the
    source has no audio / is unreadable / measurement fails.

    `trim_in`/`trim_out` are the encode's `_trim_args` so that a trimmed
    clip is measured over the segment that will actually be encoded. Stats
    of the whole raw describe different audio: the linear gain is off by the
    segment-vs-whole difference, and a whole-clip LRA above the target (or a
    peak that the whole-clip gain would push past TP) silently drops the
    second pass into dynamic mode even when the segment itself qualifies for
    linear — which is how a 90 s cut of a 3-minute clip landed at -18.7 LUFS.
    """
    out = subprocess.run(
        [_ffmpeg(), "-hide_banner", "-nostdin", *trim_in, "-i", str(src), *trim_out,
         "-map", "0:a:0", "-af",
         f"loudnorm=I={LOUDNORM_I}:TP={LOUDNORM_TP}:LRA={LOUDNORM_LRA}:print_format=json",
         "-f", "null", "-"],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        return None
    m = re.search(r'\{\s*"input_i".*?\}', out.stderr, re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except ValueError:
        return None


def _loudnorm_args(raw: Path, entry: VideoEntry) -> list[str]:
    """Two-pass loudnorm output args for a web encode ([] = leave audio alone).

    The second pass runs linear with the measured stats. loudnorm internally
    resamples to 192 kHz, so the output rate is pinned back to 48 kHz.
    """
    if entry.loudnorm is False:
        return []
    if _probe_audio_codec(raw) is None:
        return []  # silent source
    measured = _measure_loudness(raw, *_trim_args(entry))
    if measured is None:
        print(f"  ! {entry.name}: loudness measurement failed; encoding without loudnorm",
              file=sys.stderr)
        return []
    try:
        # A silent audio track measures -inf; interpolating that into the
        # filter string breaks ffmpeg, and there is nothing to normalize.
        if not (float(measured["input_i"]) > -70.0):
            return []
    except (KeyError, ValueError):
        return []
    af = (
        f"loudnorm=I={LOUDNORM_I}:TP={LOUDNORM_TP}:LRA={LOUDNORM_LRA}"
        f":measured_I={measured['input_i']}:measured_TP={measured['input_tp']}"
        f":measured_LRA={measured['input_lra']}:measured_thresh={measured['input_thresh']}"
        f":offset={measured['target_offset']}:linear=true"
    )
    return ["-af", af, "-ar", "48000"]


@dataclass
class VideoEntry:
    name: str
    profile: str
    used_in: list[str]
    notes: str = ""
    # Venue/HQ width override for [defaults].long_edge_px. Drives the HQ tier
    # and is CAPPED to web_long_edge_px for the web tier (a venue clip encoded
    # at 3840 still ships a 1920 web copy).
    long_edge_px: int | None = None
    # Override HQ CRF per-video. hq-visually-lossless uses CRF 16 by default
    # (transparent at viewing distance); lower for more detail, higher for
    # smaller files. Useful for sources whose raw bitrate is too high for
    # browser decode, where a CRF 20 re-encode plays smoothly without visible
    # quality loss for the audience.
    hq_crf: int | None = None
    # When true, HQ tier hard-links the raw file instead of re-encoding and
    # pull-hq sources this file from [defaults].source_remote rather than the
    # parallel GH Release. Use for files whose raw is already a pixel-perfect
    # master and/or whose encoded HQ would exceed the 2 GB release asset cap.
    hq_from_raw: bool = False
    # Force the encoder for this clip: "nvenc" (GPU) or "cpu" (libx26x).
    # None = auto (nvenc if available at runtime, else cpu).
    encoder: str | None = None
    # Loudness normalization for the web encode. None/True = normalize to the
    # shared R128 target (LOUDNORM_I); False = keep the source's own level
    # (deliberately quiet ambience, pre-mastered audio). remux never
    # normalizes (stream copy can't filter).
    loudnorm: bool | None = None
    # Optional web-tier trim: ("start", "end") in seconds or M:SS; "" = open
    # end. Applied at encode (-ss input-side, -t duration output-side); the
    # remux profile cuts on keyframes.
    trim: tuple[str, str] | None = None


def _videos_from_data(data: dict) -> list[VideoEntry]:
    return [
        VideoEntry(
            name=v["name"],
            profile=v.get("profile", "remux"),
            used_in=v.get("used_in", []),
            notes=v.get("notes", ""),
            long_edge_px=v.get("long_edge_px"),
            hq_crf=v.get("hq_crf"),
            hq_from_raw=v.get("hq_from_raw", False),
            encoder=v.get("encoder"),
            loudnorm=v.get("loudnorm"),
            trim=tuple(v["trim"]) if v.get("trim") else None,
        )
        for v in data.get("videos", [])
    ]


def load_manifest() -> tuple[dict, list[VideoEntry]]:
    with MANIFEST.open("rb") as f:
        data = tomllib.load(f)
    # Merge: talk [defaults] wins over global outreach.toml [defaults].
    defaults = {**_load_global_defaults(), **data.get("defaults", {})}
    defaults.setdefault("release_tag", _auto_release_tag("videos"))
    videos = _videos_from_data(data)
    default_encoder = defaults.get("encoder")
    if default_encoder in ("nvenc", "cpu"):
        for v in videos:
            if v.encoder is None:
                v.encoder = default_encoder
    if defaults.get("loudnorm") is False:
        for v in videos:
            if v.loudnorm is None:
                v.loudnorm = False
    return defaults, videos


def load_shared_manifest() -> tuple[dict, list[VideoEntry]]:
    """Load /videos/shared.toml from the monorepo root.

    Returns ({}, []) if the file is absent. The shared registry declares
    clips inherited from a shared GH Release; talks reference them in
    decks but don't keep local raws/encodes.
    """
    src = _config.parse_shared(_load_global_defaults().get("shared"))
    if src is None:
        return {}, []
    shared = _config.shared_registry_path()
    if not shared.exists():
        return {}, []
    with shared.open("rb") as f:
        data = tomllib.load(f)
    defaults = dict(data.get("defaults", {}))
    defaults["repo"], defaults["release_tag"] = src
    return defaults, _videos_from_data(data)


def human_size(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{n} B"
        n /= 1024  # type: ignore[assignment]
    return f"{n:.1f} GB"


# ---------------------------------------------------------------------------
# fetch — download a video from a URL (yt-dlp) into raw/ + manifest entry
# ---------------------------------------------------------------------------

def cmd_fetch(args: argparse.Namespace) -> int:
    if not shutil.which("yt-dlp"):
        print("error: yt-dlp not installed. https://github.com/yt-dlp/yt-dlp", file=sys.stderr)
        return 2
    name = args.name if args.name.endswith(".mp4") else f"{args.name}.mp4"
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    raw = RAW_DIR / name
    if raw.exists() and not args.force:
        print(f"  = {name}: already in raw/ (use --force to re-download)")
    else:
        # Prefer H.264 MP4 <=1080p so the default `remux` profile is a lossless
        # container rewrite (the platform's own encode is already web-friendly).
        fmt = ("bv*[ext=mp4][vcodec^=avc1][height<=1080]+ba[ext=m4a]"
               "/b[ext=mp4][height<=1080]/bv*[height<=1080]+ba/b")
        cmd = ["yt-dlp", "-f", fmt, "--merge-output-format", "mp4",
               "--no-playlist", "-o", str(raw), args.url]
        print(" ".join(cmd))
        if subprocess.call(cmd) != 0:
            return 1

    _, videos = load_manifest()
    if any(v.name == name for v in videos):
        print(f"  = {name}: already in manifest.toml")
        return 0
    used = ", ".join(json.dumps(u) for u in args.used_in)
    with MANIFEST.open("a", encoding="utf-8") as f:
        f.write(
            f"\n[[videos]]\n"
            f'name    = "{name}"\n'
            f'profile = "{args.profile}"\n'
            f"used_in = [{used}]\n"
            f'notes   = "fetched from {args.url}"\n'
        )
    print(f"  + manifest entry appended for {name} (profile {args.profile})")
    print(f"  next: slidev-videos encode --only {name} && slidev-videos publish --only {name}")
    return 0


# ---------------------------------------------------------------------------
# sync — pull raw files from Google Drive via rclone
# ---------------------------------------------------------------------------

def _rclone_progress() -> list[str]:
    """--progress redraws in place on a terminal; in a log it repeats every block."""
    return ["--progress"] if sys.stdout.isatty() else []


def cmd_sync(args: argparse.Namespace) -> int:
    defaults, videos = load_manifest()
    remote = defaults.get("source_remote")
    if not remote:
        print("error: [defaults].source_remote not set in manifest.toml", file=sys.stderr)
        return 2
    if not shutil.which("rclone"):
        print("error: rclone not installed. brew install rclone", file=sys.stderr)
        return 2
    if not videos and not args.all:
        print("Manifest lists no [[videos]]; nothing to sync (use --all to mirror the whole remote).")
        return 0
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    # --checksum: compare by MD5 rather than rclone's default size+modtime.
    # Re-uploading a re-export under the same name is routine here, and the
    # default heuristic only notices if size or modtime moved — a re-encode
    # that happens to land on the same size, or an upload that preserves the
    # original modtime, reads as "up to date" and the stale local cut stays.
    # Drive already stores an MD5, so the compare costs one API field per file
    # and the hash of anything we'd have transferred anyway. Cheap insurance
    # against presenting last week's edit. --quick opts back into size+modtime.
    cmd = ["rclone", "sync", remote, str(RAW_DIR), *_rclone_progress(), "--transfers", "4"]
    if not args.quick:
        cmd.append("--checksum")
    if not args.all:
        # Only manifest-listed raws: the remote folder holds every talk's
        # sources, so a full mirror drags tens of GB into each talk. Filters
        # also shield unlisted local files from sync's delete pass.
        for v in videos:
            cmd += ["--include", f"/{v.name}"]
    if args.dry_run:
        cmd.append("--dry-run")
    print(" ".join(cmd))
    return subprocess.call(cmd)


# ---------------------------------------------------------------------------
# encode — ffmpeg raw -> web per manifest profile
# ---------------------------------------------------------------------------

def _profile_args(profile: str, long_edge: int, encoder: str, cq_override: int | None = None) -> list[str]:
    """Build ffmpeg output args for a profile under the selected encoder."""
    if profile == "remux":
        return ["-c", "copy", "-movflags", "+faststart"]
    if profile == "hq-visually-lossless":
        cq = cq_override if cq_override is not None else HQ_CQ
        crf = cq_override if cq_override is not None else HQ_CRF
        return _hq_args(cq, crf, long_edge, encoder)
    return _web_args(WEB_PROFILES[profile], long_edge, encoder)


def _hms(t: str) -> float:
    """'90', '1:30' or '0:01:30' -> seconds."""
    parts = [float(x) for x in str(t).split(":")]
    out = 0.0
    for p in parts:
        out = out * 60 + p
    return out


def _trim_args(entry: VideoEntry) -> tuple[list[str], list[str]]:
    """(input-side, output-side) ffmpeg args for entry.trim.

    -ss before -i seeks fast; timestamps reset to 0 after an input seek, so
    the end point becomes an output-side -t duration. remux (-c copy) cuts on
    keyframes — documented; use a re-encode profile for frame-exact cuts.
    """
    if not entry.trim:
        return [], []
    start, end = entry.trim
    pre = ["-ss", str(start)] if str(start) else []
    if not str(end):
        return pre, []
    dur = _hms(end) - (_hms(start) if str(start) else 0.0)
    if dur <= 0:
        raise SystemExit(f"error: trim end <= start for {entry.name}")
    return pre, ["-t", f"{dur:.3f}"]


def _encode_one(entry: VideoEntry, force: bool, default_long_edge: int) -> tuple[VideoEntry, str, int, int]:
    """Returns (entry, status, raw_size, web_size). status in {skipped, ok, missing, failed}."""
    raw = RAW_DIR / entry.name
    web = WEB_DIR / entry.name
    if not raw.exists():
        return entry, "missing", 0, 0
    raw_size = raw.stat().st_size
    if web.exists() and not force and web.stat().st_mtime >= raw.stat().st_mtime:
        return entry, "skipped", raw_size, web.stat().st_size

    if entry.profile not in PROFILE_NAMES:
        print(f"  ! unknown profile {entry.profile!r} for {entry.name}", file=sys.stderr)
        return entry, "failed", raw_size, 0

    encoder = select_encoder(entry.encoder)
    # default_long_edge is the WEB cap (web_long_edge_px, typically 1920). A
    # per-video long_edge_px is a venue/HQ override — honor it only when it
    # would make the web copy SMALLER, never larger than the web cap.
    long_edge = min(entry.long_edge_px or default_long_edge, default_long_edge)
    # Normalize loudness whenever the profile keeps audio (remux can't filter;
    # silent-loop strips audio anyway).
    has_audio = entry.profile in WEB_PROFILES and WEB_PROFILES[entry.profile]["audio"] is not None
    loudnorm = _loudnorm_args(raw, entry) if has_audio else []

    tmp = web.with_name(f"{web.stem}.partial{web.suffix}")
    trim_in, trim_out = _trim_args(entry)
    cmd = [
        _ffmpeg(), "-y", "-hide_banner", "-nostdin", "-loglevel", "error",
        *trim_in,
        "-i", str(raw),
        *_profile_args(entry.profile, long_edge, encoder),
        *trim_out,
        *loudnorm,
        str(tmp),
    ]
    try:
        subprocess.run(cmd, check=True)
    except subprocess.CalledProcessError as e:
        tmp.unlink(missing_ok=True)
        print(f"  ! ffmpeg failed for {entry.name}: {e}", file=sys.stderr)
        return entry, "failed", raw_size, 0
    tmp.replace(web)
    return entry, "ok", raw_size, web.stat().st_size


def _run_encode_batch(
    videos: list[VideoEntry],
    worker,
    force: bool,
    default_long_edge: int,
    label: str,
    max_mb: int | None = None,
) -> int:
    """Shared driver for cmd_encode and cmd_encode_hq.

    Splits remux (parallel) from re-encode (serial) jobs, prints per-video
    reports, and returns 0 on success / 1 on any failure.
    """
    remuxes = [v for v in videos if v.profile == "remux"]
    encodes = [v for v in videos if v.profile != "remux"]

    total_raw = 0
    total_out = 0
    failed: list[str] = []
    over_budget: list[tuple[str, int]] = []

    def report(entry, status, raw_size, out_size):
        nonlocal total_raw, total_out
        total_raw += raw_size
        total_out += out_size
        if status == "missing":
            print(f"  - {entry.name}: MISSING in raw/")
            failed.append(entry.name)
        elif status == "failed":
            print(f"  x {entry.name}: FAILED")
            failed.append(entry.name)
        elif status == "skipped":
            print(f"  = {entry.name}: skipped (up to date, {human_size(out_size)})")
        else:
            delta = raw_size - out_size
            sign = "-" if delta >= 0 else "+"
            pct = (abs(delta) / raw_size * 100) if raw_size else 0
            print(
                f"  + {entry.name}: {label} "
                f"[{human_size(raw_size)} -> {human_size(out_size)}, {sign}{pct:.0f}%]"
            )
            if max_mb is not None and out_size > max_mb * 1024 * 1024:
                over_budget.append((entry.name, out_size))

    if remuxes:
        with ThreadPoolExecutor(max_workers=4) as pool:
            futures = [pool.submit(worker, v, force, default_long_edge) for v in remuxes]
            for fut in as_completed(futures):
                report(*fut.result())

    for v in encodes:
        report(*worker(v, force, default_long_edge))

    print()
    print(f"Total raw:    {human_size(total_raw)}")
    print(f"Total {label + ':':8s} {human_size(total_out)}")
    if total_raw:
        print(f"Saved:        {human_size(total_raw - total_out)} ({(1 - total_out/total_raw)*100:.0f}%)")
    if over_budget:
        print()
        print(f"WARNING: {len(over_budget)} file(s) exceed max_size_mb={max_mb}:")
        for name, size in over_budget:
            print(f"  {name}: {human_size(size)}")
    if failed:
        print()
        print(f"FAILED: {len(failed)} file(s): {', '.join(failed)}")
        return 1
    return 0


def cmd_encode(args: argparse.Namespace) -> int:
    defaults, videos = load_manifest()
    if args.only:
        wanted = set(args.only)
        videos = [v for v in videos if v.name in wanted]
        if not videos:
            print(f"error: no manifest entries match {args.only}", file=sys.stderr)
            return 2
    if not _tools().ffmpeg:
        print("error: ffmpeg not installed. brew install ffmpeg", file=sys.stderr)
        return 2
    WEB_DIR.mkdir(parents=True, exist_ok=True)
    # The web tier caps at web_long_edge_px (default 1920), NOT the venue
    # long_edge_px — the web copy is a browser fallback, not the venue master,
    # so it never needs the venue's native width. long_edge_px drives the HQ
    # tier only (see cmd_encode_hq).
    web_long_edge = int(defaults.get("web_long_edge_px", 1920))
    max_mb = defaults.get("max_size_mb", 200)
    print(f"Encoding {len(videos)} video(s). raw -> {WEB_DIR.relative_to(TALK)} (web long edge: {web_long_edge}px)")
    return _run_encode_batch(videos, _encode_one, args.force, web_long_edge, label="web", max_mb=max_mb)


# ---------------------------------------------------------------------------
# publish — upload encoded files to GitHub Release
# ---------------------------------------------------------------------------

def _remote_assets(tag: str, repo: str | None = None) -> dict[str, dict] | None:
    """{asset_name: {"size": bytes, "url": download_url, "version": stamp}} for
    a release, or None if the release doesn't exist / gh fails. `version`
    changes whenever the asset is replaced (a re-upload is a new asset id)."""
    listing = subprocess.run(
        ["gh", "release", "view", tag, *(["--repo", repo] if repo else GH_REPO_ARGS), "--json", "assets"],
        capture_output=True, text=True,
    )
    if listing.returncode != 0:
        return None
    try:
        return {
            a["name"]: {"size": a.get("size", -1), "url": a.get("url", ""),
                        "version": f"{a.get('id', '')}@{a.get('updatedAt', '')}"}
            for a in json.loads(listing.stdout).get("assets", [])
        }
    except (ValueError, KeyError):
        return {}


def _remote_asset_sizes(tag: str, repo: str | None = None) -> dict[str, int] | None:
    """Return {asset_name: size_bytes} for a release, or None if not found."""
    assets = _remote_assets(tag, repo)
    if assets is None:
        return None
    return {name: a["size"] for name, a in assets.items()}


def _publish_tier(
    videos: list[VideoEntry],
    src_dir: Path,
    tag: str,
    release_title: str,
    release_notes: str,
    force: bool,
    dry_run: bool,
    prune: bool = False,
    protected: set[str] | None = None,
    keep: set[str] | None = None,
) -> int:
    """Upload encoded files to a GH Release.

    `protected` is a set of asset names that --prune must NEVER delete.
    Used when a talk's release tag coincides with the shared release tag —
    pruning by talk-manifest membership alone would erase shared assets that
    other talks depend on.

    `keep` is every name the whole manifest publishes to this release; --prune
    deletes only assets outside it. `videos` may be an --only subset, so it
    must never stand in for the manifest here.
    """
    protected = protected or set()
    if not shutil.which("gh"):
        print("error: gh CLI not installed. brew install gh", file=sys.stderr)
        return 2

    # Ensure release exists (a dry run only says it would create it).
    existing = subprocess.run(
        ["gh", "release", "view", tag, *GH_REPO_ARGS], capture_output=True, text=True
    )
    if existing.returncode != 0:
        if dry_run:
            print(f"Would create release {tag!r} (dry run).")
        else:
            print(f"Creating release {tag!r}...")
            subprocess.run(
                ["gh", "release", "create", tag, *GH_REPO_ARGS,
                 "--title", release_title,
                 "--notes", release_notes],
                check=True,
            )

    # Map remote asset -> size (bytes) for skip + prune.
    remote_sizes = _remote_asset_sizes(tag) or {}

    files = []
    for v in videos:
        src = src_dir / v.name
        if not src.exists():
            print(f"  ! skip {v.name}: not encoded yet")
            continue
        local_size = src.stat().st_size
        if not force and remote_sizes.get(v.name) == local_size:
            print(f"  = {v.name}: unchanged ({human_size(local_size)}), skipping")
            continue
        files.append(str(src))

    uploaded = 0
    if files:
        print(f"Uploading {len(files)} file(s) to release {tag!r}...")
        cmd = ["gh", "release", "upload", tag, *GH_REPO_ARGS, *files, "--clobber"]
        if dry_run:
            print(" ".join(cmd))
        else:
            rc = subprocess.call(cmd)
            if rc != 0:
                return rc
        uploaded = len(files)

    if prune:
        wanted = keep if keep is not None else {v.name for v in videos}
        orphans = [n for n in remote_sizes if n not in wanted and n not in protected]
        protected_skipped = sorted(
            n for n in remote_sizes if n not in wanted and n in protected
        )
        for name in protected_skipped:
            print(f"  ~ {name}: protected (in shared registry), skipping prune")
        for name in orphans:
            print(f"  - {name}: deleting from release {tag!r} (not in manifest)")
            if dry_run:
                continue
            rc = subprocess.call(
                ["gh", "release", "delete-asset", tag, *GH_REPO_ARGS, name, "--yes"]
            )
            if rc != 0:
                return rc

    if not files and not prune:
        print("Nothing to upload.")
    return 0


def _pull_tier(
    videos: list[VideoEntry],
    dst_dir: Path,
    tag: str,
    force: bool,
    dry_run: bool,
    prune: bool = False,
    protected: set[str] | None = None,
    repo: str | None = None,   # shared releases may live on another repo
    keep: set[str] | None = None,
) -> int:
    """Download release files into a local dir.

    `protected` is a set of filenames that --prune must NEVER delete locally
    (used to keep shared-registry overlap files in place when the talk's
    public/videos/ tree was populated for a previous architecture).
    `keep` is every name in the whole manifest; as in _publish_tier, --prune
    deletes only files outside it, never files outside an --only subset.
    """
    protected = protected or set()
    if not shutil.which("gh"):
        print("error: gh CLI not installed. brew install gh", file=sys.stderr)
        return 2

    dst_dir.mkdir(parents=True, exist_ok=True)
    remote_sizes = _remote_asset_sizes(tag, repo)
    if remote_sizes is None:
        print(f"error: release {tag!r} not found", file=sys.stderr)
        return 2

    wanted = keep if keep is not None else {v.name for v in videos}
    to_fetch: list[str] = []
    for v in videos:
        if v.name not in remote_sizes:
            print(f"  ! {v.name}: not in release {tag!r}")
            continue
        dst = dst_dir / v.name
        if not force and dst.exists() and dst.stat().st_size == remote_sizes[v.name]:
            print(f"  = {v.name}: up to date ({human_size(dst.stat().st_size)})")
            continue
        to_fetch.append(v.name)

    for name in to_fetch:
        print(f"  + {name}: downloading ({human_size(remote_sizes[name])})")
        if dry_run:
            continue
        rc = subprocess.call([
            "gh", "release", "download", tag,
            *(["--repo", repo] if repo else GH_REPO_ARGS),
            "--pattern", name, "--dir", str(dst_dir), "--clobber",
        ])
        if rc != 0:
            return rc

    if prune:
        for existing in dst_dir.iterdir():
            if not existing.is_file():
                continue
            if existing.name in wanted:
                continue
            if existing.name.endswith(".partial.mp4") or existing.name.endswith(".partial.mov"):
                continue
            if existing.name in protected:
                print(f"  ~ {existing.name}: protected (in shared registry), skipping prune")
                continue
            print(f"  - {existing.name}: pruning local (not in manifest)")
            if not dry_run:
                existing.unlink()

    return 0


def _prune_refused(args: argparse.Namespace, deletes: str) -> int | None:
    """Exit code when --prune must not run as asked, else None.

    --prune compares against the whole manifest, so it is refused together
    with --only: an earlier version pruned against the --only subset and
    deleted every other asset of the talk's release. A prune that really
    deletes (not --dry-run) also needs --yes.
    """
    if not getattr(args, "prune", False):
        return None
    if getattr(args, "only", None):
        print("error: --prune works on the whole manifest and cannot be combined with --only; "
              "run the --only command and the --prune command separately", file=sys.stderr)
        return 2
    if not args.dry_run and not getattr(args, "yes", False):
        print(f"error: --prune deletes {deletes} that are not in the manifest; "
              "preview with --dry-run, then re-run with --yes", file=sys.stderr)
        return 2
    return None


def _filter_videos(videos: list[VideoEntry], only: list[str] | None) -> list[VideoEntry] | int:
    if not only:
        return videos
    wanted = set(only)
    filtered = [v for v in videos if v.name in wanted]
    if not filtered:
        print(f"error: no manifest entries match {only}", file=sys.stderr)
        return 2
    return filtered


def _shared_names() -> set[str]:
    """All filenames declared by the shared registry.

    Local pulls protect these from --prune unconditionally: a local copy of
    an inherited clip (fetched via --include-shared for offline/portable
    builds) is legitimate even though the talk manifest doesn't list it.
    """
    return {v.name for v in load_shared_manifest()[1]}


def _shared_deck_videos(only: list[str] | None) -> tuple[dict, list[VideoEntry]]:
    """Shared-registry entries this talk's deck references but does not own."""
    shared_defaults, shared_videos = load_shared_manifest()
    _, talk_videos = load_manifest()
    talk_names = {v.name for v in talk_videos}
    refs = set(_slide_references())
    entries = [v for v in shared_videos if v.name in refs and v.name not in talk_names]
    if only:
        wanted = set(only)
        entries = [v for v in entries if v.name in wanted]
    return shared_defaults, entries


def _rclone_from_raw(entries: list[VideoEntry], source_remote: str | None, dry_run: bool) -> int:
    """Fetch hq_from_raw entries into videos/hq/ via rclone from the source remote."""
    if not entries:
        return 0
    if not source_remote:
        print("error: hq_from_raw entries present but source_remote not set", file=sys.stderr)
        return 2
    if not shutil.which("rclone"):
        print("error: rclone not installed. brew install rclone", file=sys.stderr)
        return 2
    for v in entries:
        src = f"{source_remote.rstrip('/')}/{v.name}"
        dst = HQ_DIR / v.name
        print(f"  + {v.name}: rclone from {src} (hq_from_raw)")
        if dry_run:
            continue
        # --checksum for the same reason as cmd_sync: a re-exported master can
        # keep its size and modtime, and these entries ARE the venue master —
        # a stale one plays on the wall.
        rc = subprocess.call(["rclone", "copyto", src, str(dst), *_rclone_progress(), "--checksum"])
        if rc != 0:
            return rc
    return 0


def _shared_protect(tier_tag: str, *, hq: bool) -> set[str]:
    """Names that prune must skip when this release tag overlaps with shared.

    Returns a set if the talk's release tag matches the shared release tag for
    the given tier, otherwise empty (talk-only release; nothing to protect).
    """
    shared_defaults, shared_videos = load_shared_manifest()
    if not shared_videos:
        return set()
    key = "release_tag_hq" if hq else "release_tag"
    shared_tag = shared_defaults.get(key)
    # archive_release_tags (shared.toml [defaults]) lists releases kept as
    # frozen archives of shared-registry encodes (e.g. the old editAI host).
    # Their shared-named assets stay prune-proof even though the live shared
    # tag has moved elsewhere.
    archive_tags = set(shared_defaults.get("archive_release_tags", []))
    if tier_tag != shared_tag and tier_tag not in archive_tags:
        return set()
    return {v.name for v in shared_videos}


def cmd_publish(args: argparse.Namespace) -> int:
    refused = _prune_refused(args, "release assets")
    if refused is not None:
        return refused
    defaults, videos = load_manifest()
    filtered = _filter_videos(videos, args.only)
    if isinstance(filtered, int):
        return filtered
    tag = defaults.get("release_tag", "videos")
    return _publish_tier(
        filtered, WEB_DIR,
        tag=tag,
        release_title="Video assets",
        release_notes="Bulk video assets for slide decks. Managed by scripts/videos.py.",
        force=args.force, dry_run=args.dry_run, prune=args.prune,
        protected=_shared_protect(tag, hq=False),
        keep={v.name for v in videos},
    )


def cmd_publish_hq(args: argparse.Namespace) -> int:
    refused = _prune_refused(args, "release assets")
    if refused is not None:
        return refused
    defaults, videos = load_manifest()
    filtered = _filter_videos(videos, args.only)
    if isinstance(filtered, int):
        return filtered
    # Entries flagged hq_from_raw live on the raws gdrive remote, not on the
    # release. Skip them here; pull-hq rclones them from source_remote.
    to_publish = [v for v in filtered if not v.hq_from_raw]
    skipped = [v.name for v in filtered if v.hq_from_raw]
    for name in skipped:
        print(f"  ~ {name}: hq_from_raw — served from source_remote, not the release")
    tag = defaults.get("release_tag_hq", _auto_release_tag("videos-hq"))
    return _publish_tier(
        to_publish, HQ_DIR,
        tag=tag,
        release_title="Video assets (HQ)",
        release_notes="Visually-lossless venue masters. Run scripts/videos.py publish-hq to update.",
        force=args.force, dry_run=args.dry_run, prune=args.prune,
        protected=_shared_protect(tag, hq=True),
        keep={v.name for v in videos if not v.hq_from_raw},
    )


def cmd_pull(args: argparse.Namespace) -> int:
    refused = _prune_refused(args, "local files")
    if refused is not None:
        return refused
    defaults, videos = load_manifest()
    filtered = _filter_videos(videos, args.only)
    if isinstance(filtered, int):
        if not args.include_shared:
            return filtered
        filtered = []  # --only may name inherited clips; shared pass below
    tag = defaults.get("release_tag", _auto_release_tag("videos"))
    if filtered:
        rc = _pull_tier(
            filtered, WEB_DIR,
            tag=tag,
            force=args.force, dry_run=args.dry_run, prune=args.prune,
            protected=_shared_names(),
            keep={v.name for v in videos},
        )
        if rc != 0:
            return rc
    if not args.include_shared:
        return 0
    shared_defaults, extra = _shared_deck_videos(args.only)
    if not extra:
        print("No inherited deck clips to pull from shared.")
        return 0
    shared_tag = shared_defaults.get("release_tag")
    if not shared_tag:
        print("error: shared registry sets no release_tag", file=sys.stderr)
        return 2
    print(f"Pulling {len(extra)} inherited clip(s) from shared release {shared_tag!r}...")
    return _pull_tier(
        extra, WEB_DIR,
        tag=shared_tag,
        force=args.force, dry_run=args.dry_run, prune=False,
        repo=shared_defaults.get("repo"),
    )


def cmd_pull_hq(args: argparse.Namespace) -> int:
    refused = _prune_refused(args, "local files")
    if refused is not None:
        return refused
    defaults, videos = load_manifest()
    filtered = _filter_videos(videos, args.only)
    if isinstance(filtered, int):
        if not args.include_shared:
            return filtered
        filtered = []  # --only may name inherited clips; shared pass below
    _ensure_hq_symlink()

    # hq_from_raw entries come from source_remote via rclone; the rest come
    # from the parallel GH Release.
    from_raw = [v for v in filtered if v.hq_from_raw]
    from_release = [v for v in filtered if not v.hq_from_raw]

    if from_release:
        rc = _pull_tier(
            from_release, HQ_DIR,
            tag=defaults.get("release_tag_hq", _auto_release_tag("videos-hq")),
            force=args.force, dry_run=args.dry_run,
            # Defer prune to after the rclone pass so hq_from_raw files aren't
            # flagged as orphans by the release-tier pull.
            prune=False,
        )
        if rc != 0:
            return rc

    rc = _rclone_from_raw(from_raw, defaults.get("source_remote"), args.dry_run)
    if rc != 0:
        return rc

    if args.include_shared:
        shared_defaults, extra = _shared_deck_videos(args.only)
        s_from_raw = [v for v in extra if v.hq_from_raw]
        s_from_release = [v for v in extra if not v.hq_from_raw]
        if s_from_release:
            s_tag = shared_defaults.get("release_tag_hq")
            if not s_tag:
                print("error: shared registry sets no release_tag_hq", file=sys.stderr)
                return 2
            print(f"Pulling {len(s_from_release)} inherited HQ master(s) from shared release {s_tag!r}...")
            rc = _pull_tier(
                s_from_release, HQ_DIR,
                tag=s_tag,
                force=args.force, dry_run=args.dry_run, prune=False,
                repo=shared_defaults.get("repo"),
            )
            if rc != 0:
                return rc
        rc = _rclone_from_raw(s_from_raw, shared_defaults.get("source_remote"), args.dry_run)
        if rc != 0:
            return rc

    if args.prune:
        wanted = {v.name for v in videos}   # the whole manifest, never the --only subset
        protected_names = _shared_names()
        for existing in HQ_DIR.iterdir():
            if not existing.is_file():
                continue
            if existing.name in wanted:
                continue
            if existing.name.endswith(".partial.mp4") or existing.name.endswith(".partial.mov"):
                continue
            if existing.name in protected_names:
                print(f"  ~ {existing.name}: protected (in shared registry), skipping prune")
                continue
            print(f"  - {existing.name}: pruning local (not in manifest)")
            if not args.dry_run:
                existing.unlink()

    return 0


# ---------------------------------------------------------------------------
# check — sanity: orphans, missing, slide refs
# ---------------------------------------------------------------------------

# `src` may stand anywhere in the tag; a bound `:src` / `v-bind:src` is an
# expression, not a file name, and is left alone.
VIDEO_REF_RE = re.compile(r'<VideoPlayer\b[^>]*?(?<![:\w-])src="([^"]+)"', re.S)

# Directories whose .md files are never slides (deps, build output).
SKIP_SCAN_DIRS = {"node_modules", "dist", "dist-portable", ".git"}


def _deck_markdown(root: Path):
    """Yield slide .md files under root, skipping deps/build directories."""
    for md in root.rglob("*.md"):
        if any(part in SKIP_SCAN_DIRS for part in md.relative_to(root).parts):
            continue
        yield md


def _slide_references() -> dict[str, list[str]]:
    """Walk slides and return {filename: [slide_files_that_reference_it]}."""
    refs: dict[str, list[str]] = {}
    for md in _deck_markdown(SLIDES_DIR):
        try:
            text = md.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for m in VIDEO_REF_RE.finditer(text):
            refs.setdefault(m.group(1), []).append(md.name)
    return refs


def _report(args: argparse.Namespace) -> dict:
    """The machine-readable result a command fills in; `--json` prints it."""
    return vars(args).setdefault("report", {})


def cmd_check(args: argparse.Namespace) -> int:
    report = _report(args)
    defaults, videos = load_manifest()
    _, shared_videos = load_shared_manifest()
    manifest_names = {v.name for v in videos}
    shared_names = {v.name for v in shared_videos}
    raw_files = {p.name for p in RAW_DIR.glob("*") if p.is_file() and not p.name.startswith(".")}
    web_files = {p.name for p in WEB_DIR.glob("*") if p.is_file() and not p.name.startswith(".")}
    hq_files = {p.name for p in HQ_DIR.glob("*") if p.is_file() and not p.name.startswith(".")}
    refs = _slide_references()

    infos: list[str] = []
    found: list[dict] = []

    def problem(kind: str, name: str, detail: str = "") -> None:
        print(f"  {kind + ':':<18}{name}{detail}")
        found.append({"kind": kind, "name": name, "detail": detail.strip()})

    # Unknown encoding profiles (would otherwise only surface at encode time).
    for v in videos:
        if v.profile not in PROFILE_NAMES:
            problem("BAD PROFILE", v.name, f" -> {v.profile!r}")

    # Manifest entries with no local copy in ANY tier. Since the post-Yaga
    # cleanup (2026-07-18) empty local dirs are the steady state: a clip that
    # lives on the talk's release is fetchable on demand and only worth an
    # info line. It's an error only when the release doesn't have it either —
    # then there is genuinely nothing to serve, bundle, or re-pull.
    missing_local = sorted(manifest_names - raw_files - web_files - hq_files)
    release_sizes: dict[str, int] | None = None
    if missing_local and shutil.which("gh"):
        release_sizes = _remote_asset_sizes(defaults["release_tag"])
    for name in missing_local:
        if release_sizes and name in release_sizes:
            infos.append(
                f"not local, on release ({human_size(release_sizes[name])}) — videos:pull on demand: {name}"
            )
        else:
            problem("MISSING LOCAL", name, "  (no local copy, not on the release — videos:sync + encode + publish)")
    for name in sorted((manifest_names - raw_files) & (web_files | hq_files)):
        infos.append(f"raw not synced (encoded copy present): {name}")

    # Encoded web copies of talk-owned clips exceeding the size budget.
    max_mb = int(defaults.get("max_size_mb", 200))
    for name in sorted(manifest_names & web_files):
        size = (WEB_DIR / name).stat().st_size
        if size > max_mb * 1024 * 1024:
            problem("OVER BUDGET", name, f"  ({human_size(size)} > max_size_mb={max_mb})")

    # Local files not declared by the talk OR the shared registry.
    # Shared-overlap files in any tier are valid (inherited copies pulled
    # for offline use, or talk overrides); they're only flagged if absent
    # from both manifests.
    bank_names = bank_manifest_names(RAW_DIR, TALK)   # sibling talks' raws in a shared bank
    for name in sorted(raw_files - manifest_names - shared_names - bank_names):
        problem("ORPHAN RAW", name)

    for name in sorted(web_files - manifest_names - shared_names):
        problem("ORPHAN WEB", name)

    for name in sorted(hq_files - manifest_names - shared_names):
        problem("ORPHAN HQ", name)

    # Slide references not satisfied by the talk manifest OR the shared registry.
    for name in sorted(set(refs) - manifest_names - shared_names):
        where = ", ".join(sorted(set(refs[name])))
        problem("UNKNOWN REF", name, f"  (in {where})")

    # Manifest entries referenced nowhere.
    for v in videos:
        if v.name not in refs:
            problem("UNUSED MANIFEST", v.name)

    # Informational: deck refs satisfied ONLY by the shared registry
    # (i.e., not also in the talk manifest). Clips that appear in both are
    # talk-owned with a shared-registry duplicate, not inherited.
    inherited = sorted((set(refs) & shared_names) - manifest_names)
    duplicated = sorted(manifest_names & shared_names)

    # Inherited clips with no local copy play fine online (release fallback)
    # but silently drop out of offline/portable/venue builds.
    inherited_not_local = [n for n in inherited if n not in web_files and n not in hq_files]
    if inherited_not_local:
        infos.append(
            f"{len(inherited_not_local)} inherited clip(s) have no local copy — offline/"
            "portable builds will lack them; fix with videos:pull/pull-hq --include-shared:"
        )
        infos.extend(f"  - {n}" for n in inherited_not_local)

    # A `dust` transition colours its grains from a frame strip; without one
    # the clip quietly fades instead (it still plays).
    dust = _dust_references()
    no_strip: list[str] = []
    if dust:
        index = _read_frames_index(_frames_dir())
        no_strip = sorted(n for n in dust if n not in index)
        if no_strip:
            infos.append(
                f"{len(no_strip)} clip(s) use the dust transition without a frame strip — "
                "they will fade instead; fix with `slidev-videos frames`:"
            )
            infos.extend(f"  - {n}" for n in no_strip)

    problems = len(found)
    report.update({
        "problems": found,
        "talk_owned": sorted(manifest_names),
        "inherited": inherited,
        "also_in_shared": duplicated,
        "referenced": sorted(refs),
        "inherited_not_local": inherited_not_local,
        "dust_without_strip": no_strip,
        "info": infos,
    })
    if problems == 0:
        owned = len(manifest_names)
        print(
            f"OK: {owned} talk-owned, {len(inherited)} inherited from shared, "
            f"{len(refs)} referenced, all consistent."
        )
        if inherited:
            print("  inherited from shared:")
            for name in inherited:
                print(f"    - {name}")
        if duplicated:
            print("  also in shared registry (talk currently owns):")
            for name in duplicated:
                print(f"    - {name}")
    if infos:
        print("  info:")
        for line in infos:
            print(f"    {line}")
    if problems == 0:
        return 0
    print(f"\n{problems} issue(s) found.")
    return 1


def cmd_shared_check(_: argparse.Namespace) -> int:
    """Sanity-check /videos/shared.toml. Run from the monorepo root.

    Validates that all shared entries have valid profiles, that the shared
    release tag is reachable, and surfaces deck refs across all talks that
    are satisfied by the shared registry.
    """
    root = TALK

    shared_path = _config.shared_registry_path()
    if not shared_path.exists():
        print(f"error: {shared_path} not found", file=sys.stderr)
        return 2

    with shared_path.open("rb") as f:
        data = tomllib.load(f)
    defaults = {**_load_global_defaults(), **data.get("defaults", {})}
    videos = _videos_from_data(data)
    shared_names = {v.name for v in videos}

    problems = 0

    # Profile sanity.
    for v in videos:
        if v.profile not in PROFILE_NAMES:
            print(f"  BAD PROFILE:      {v.name} -> {v.profile!r}")
            problems += 1

    # Cross-talk reference scan: are these clips actually used?
    used_in_talks: dict[str, list[str]] = {}
    for talk_dir in sorted((root / "talks").glob("*")):
        if not talk_dir.is_dir():
            continue
        for md in _deck_markdown(talk_dir):
            try:
                text = md.read_text(encoding="utf-8", errors="ignore")
            except OSError:
                continue
            for m in VIDEO_REF_RE.finditer(text):
                if m.group(1) in shared_names:
                    used_in_talks.setdefault(m.group(1), []).append(talk_dir.name)

    unused = sorted(shared_names - set(used_in_talks))
    for name in unused:
        print(f"  UNUSED SHARED:    {name}  (not referenced by any talk)")
        # Not an error — a shared registry is allowed to hold spare clips.

    # Release reachability (best-effort; gh may be unavailable).
    tag = defaults.get("release_tag")
    if tag and shutil.which("gh"):
        sizes = _remote_asset_sizes(tag)
        if sizes is None:
            print(f"  RELEASE MISSING:  {tag}  (cannot reach via gh)")
            problems += 1
        else:
            missing_assets = sorted(shared_names - set(sizes))
            for name in missing_assets:
                print(f"  MISSING ASSET:    {name}  (declared in shared.toml, not on release {tag})")
                problems += 1

    print()
    print(f"Shared registry: {len(videos)} clip(s), release_tag = {tag!r}")
    if used_in_talks:
        print(f"Referenced by talks ({sum(len(v) for v in used_in_talks.values())} ref(s)):")
        for name, talks_list in sorted(used_in_talks.items()):
            print(f"  {name}: {', '.join(sorted(set(talks_list)))}")
    if problems == 0:
        return 0
    print(f"\n{problems} issue(s) found.")
    return 1


# ---------------------------------------------------------------------------
# clean — verified-safe deletion of local video tiers
# ---------------------------------------------------------------------------
#
# Local raws/masters/web encodes are pure cache: raws live on the gdrive
# remote, encodes on the GH releases. clean deletes a local file ONLY when a
# size-matched remote copy is verified, and prints how to get each one back.
# Design: docs/superpowers/specs/2026-07-17-videos-clean-design.md


@dataclass(frozen=True)
class LocalFile:
    """What the planner needs to know about one on-disk file."""
    size: int
    inode: tuple[int, int]  # (st_dev, st_ino) — hard-link identity
    nlink: int


@dataclass
class CleanCandidate:
    tier: str      # raw | hq | web
    name: str
    file: LocalFile
    delete: bool
    reason: str    # recovery hint (delete) or skip reason


def plan_clean(
    tier_files: dict[str, dict[str, LocalFile]],
    talk_by_name: dict[str, VideoEntry],
    shared_by_name: dict[str, VideoEntry],
    inventories: dict[str, dict[str, int] | None],
    include_shared: bool,
) -> list[CleanCandidate]:
    """Pure deletability judgement — no filesystem or network access.

    `inventories` keys: raw_remote, hq_release, web_release,
    shared_raw_remote, shared_hq_release, shared_web_release. A None value
    means "could not be listed"; verification failure is never treated as
    absence, so every file depending on that inventory is kept.
    """
    def judge(inv_key: str, name: str, size: int, recover: str) -> tuple[bool, str]:
        inv = inventories.get(inv_key)
        if inv is None:
            return False, f"skip: {inv_key} unavailable"
        if name not in inv:
            return False, f"skip: not on {inv_key}"
        if inv[name] != size:
            return False, f"skip: size differs on {inv_key} ({human_size(inv[name])} there)"
        return True, recover

    out: list[CleanCandidate] = []
    for tier in sorted(tier_files):
        for name, f in sorted(tier_files[tier].items()):
            talk = talk_by_name.get(name)
            shared = shared_by_name.get(name) if talk is None else None
            if tier == "raw":
                if talk:
                    ok, why = judge("raw_remote", name, f.size, "recover: pnpm videos:sync")
                elif shared:
                    # Raws of shared clips aren't in this talk's manifest;
                    # treat as unmanaged rather than guessing ownership.
                    ok, why = False, "skip: shared clip raw — unmanaged here"
                else:
                    ok, why = False, "skip: unmanaged (not in any manifest)"
            elif tier == "hq":
                if talk and talk.hq_from_raw:
                    # The HQ file is a hard link of the raw; the raw on the
                    # source remote is the recovery path.
                    ok, why = judge("raw_remote", name, f.size,
                                    "recover: pnpm videos:pull-hq (rclone from source_remote)")
                elif talk:
                    ok, why = judge("hq_release", name, f.size, "recover: pnpm videos:pull-hq")
                elif shared and not include_shared:
                    ok, why = False, "skip: shared clip (opt in with --include-shared)"
                elif shared and shared.hq_from_raw:
                    ok, why = judge("shared_raw_remote", name, f.size,
                                    "recover: pnpm videos:pull-hq -- --include-shared")
                elif shared:
                    ok, why = judge("shared_hq_release", name, f.size,
                                    "recover: pnpm videos:pull-hq -- --include-shared")
                else:
                    ok, why = False, "skip: unmanaged (not in any manifest)"
            else:  # web
                if talk:
                    ok, why = judge("web_release", name, f.size, "recover: pnpm videos:pull")
                elif shared and not include_shared:
                    ok, why = False, "skip: shared clip (opt in with --include-shared)"
                elif shared:
                    ok, why = judge("shared_web_release", name, f.size,
                                    "recover: pnpm videos:pull -- --include-shared")
                else:
                    ok, why = False, "skip: unmanaged (not in any manifest)"
            out.append(CleanCandidate(tier=tier, name=name, file=f, delete=ok, reason=why))
    return out


def reclaimed_bytes(cands: list[CleanCandidate]) -> int:
    """Bytes actually freed by the planned deletions.

    hq_from_raw files hard-link their raw: removing one of two links frees
    nothing. An inode's size counts once, and only when every remaining
    local link is planned for deletion.
    """
    planned: dict[tuple[int, int], int] = {}
    size_of: dict[tuple[int, int], int] = {}
    nlink_of: dict[tuple[int, int], int] = {}
    for c in cands:
        if not c.delete:
            continue
        planned[c.file.inode] = planned.get(c.file.inode, 0) + 1
        size_of[c.file.inode] = c.file.size
        nlink_of[c.file.inode] = c.file.nlink
    return sum(size_of[i] for i, n in planned.items() if n >= nlink_of[i])


def _local_files(d: Path) -> dict[str, LocalFile]:
    out: dict[str, LocalFile] = {}
    if not d.is_dir():
        return out
    for p in d.iterdir():
        if not p.is_file() or p.name.startswith("."):
            continue
        st = p.stat()
        out[p.name] = LocalFile(size=st.st_size, inode=(st.st_dev, st.st_ino), nlink=st.st_nlink)
    return out


def _rclone_inventory(remote: str | None) -> dict[str, int] | None:
    """{name: size} listing of an rclone remote dir, or None when unlistable."""
    if not remote or not shutil.which("rclone"):
        return None
    out = subprocess.run(
        ["rclone", "lsf", "--format", "sp", remote.rstrip("/")],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        return None
    inv: dict[str, int] = {}
    for line in out.stdout.splitlines():
        size, _, name = line.partition(";")
        try:
            inv[name.strip()] = int(size)
        except ValueError:
            continue
    return inv


def cmd_clean(args: argparse.Namespace) -> int:
    defaults, videos = load_manifest()
    shared_defaults, shared_videos = load_shared_manifest()
    talk_by_name = {v.name: v for v in videos}
    shared_by_name = {v.name: v for v in shared_videos}

    tiers = {t for t, on in (("raw", args.raw), ("hq", args.hq), ("web", args.web)) if on}
    if not tiers:
        tiers = {"raw", "hq"}  # web is opt-in (spec: default raw + hq)

    tier_dirs = {"raw": RAW_DIR, "hq": HQ_DIR, "web": WEB_DIR}
    tier_files = {t: _local_files(tier_dirs[t]) for t in sorted(tiers)}
    if not any(tier_files.values()):
        print(f"Nothing local to clean in {', '.join(sorted(tiers))}.")
        return 0

    # One listing per remote/tag; every file is judged against the in-memory
    # inventory. gh/rclone being unavailable makes tiers non-deletable, not
    # invisible.
    inventories: dict[str, dict[str, int] | None] = {}
    if "raw" in tiers or "hq" in tiers:
        inventories["raw_remote"] = _rclone_inventory(defaults.get("source_remote"))
        shared_remote = shared_defaults.get("source_remote")
        inventories["shared_raw_remote"] = (
            inventories["raw_remote"]
            if shared_remote == defaults.get("source_remote")
            else _rclone_inventory(shared_remote)
        )
    has_gh = bool(shutil.which("gh"))
    if "hq" in tiers:
        inventories["hq_release"] = (
            _remote_asset_sizes(defaults.get("release_tag_hq", _auto_release_tag("videos-hq")))
            if has_gh else None
        )
        s_tag_hq = shared_defaults.get("release_tag_hq")
        inventories["shared_hq_release"] = _remote_asset_sizes(s_tag_hq) if (s_tag_hq and has_gh) else None
    if "web" in tiers:
        inventories["web_release"] = _remote_asset_sizes(defaults["release_tag"]) if has_gh else None
        s_tag = shared_defaults.get("release_tag")
        inventories["shared_web_release"] = _remote_asset_sizes(s_tag) if (s_tag and has_gh) else None

    plan = plan_clean(tier_files, talk_by_name, shared_by_name, inventories, args.include_shared)
    deletable = [c for c in plan if c.delete]
    for c in plan:
        mark = "DELETE" if c.delete else "keep  "
        print(f"  {mark}  [{c.tier:3s}] {c.name}  ({human_size(c.file.size)})  {c.reason}")
    total = reclaimed_bytes(plan)
    print()
    print(f"{len(deletable)} deletable — {human_size(total)} reclaimable "
          f"(hard links counted once); {len(plan) - len(deletable)} kept.")

    if not args.yes:
        if deletable:
            print("Dry run — nothing deleted. Re-run with --yes to delete.")
        return 0

    failures = 0
    freed_names = 0
    for c in deletable:
        path = tier_dirs[c.tier] / c.name
        try:
            st = path.stat()
        except FileNotFoundError:
            continue  # vanished since planning — already what we wanted
        if st.st_size != c.file.size:
            print(f"  ! {c.name} [{c.tier}]: changed since planning — kept", file=sys.stderr)
            failures += 1
            continue
        try:
            path.unlink()
            freed_names += 1
        except OSError as e:
            print(f"  ! {c.name} [{c.tier}]: delete failed: {e}", file=sys.stderr)
            failures += 1
    print(f"Deleted {freed_names} file(s), ~{human_size(total)} freed.")
    print("Recovery: pnpm videos:sync (raws); pnpm videos:pull / videos:pull-hq "
          "[-- --include-shared] (encodes).")
    return 1 if failures else 0


# ---------------------------------------------------------------------------
# The player's fallback chain
# ---------------------------------------------------------------------------
#
# VideoPlayer tries, for one clip: the local HQ copy (only when `hq` is on for
# that clip, by its tag or the headmatter's `videos.hq`), the local web copy,
# the talk's release, the shared release. Local copies come first in dev and
# in a VITE_VIDEOS_LOCAL_FIRST=1 build (the venue bundle); a deployed build
# tries the releases first. resolve_chain() is that order, limited to copies
# that exist, so preflight, frames and venue look at the file the deck plays.

CHAIN_MODES = ("local-first", "remote-first")

HQ_HEADMATTER_RE = re.compile(r"^videos:[ \t]*\n(?:[ \t]+.*\n|[ \t]*\n)*?[ \t]+hq:[ \t]*true\b", re.M)
TAG_HQ_RE = re.compile(r'(?<=\s)(:|v-bind:)?hq(?:="([^"]*)")?(?=[\s/>])')


def _tag_hq(tag: str) -> bool | None:
    """A tag's own `hq`: None when it has none (the headmatter decides)."""
    m = TAG_HQ_RE.search(tag)
    if not m:
        return None
    if m.group(1):   # :hq="..." is an expression
        return {"true": True, "false": False}.get((m.group(2) or "").strip())
    # Vue casts a present Boolean attribute to true, and keeps any other
    # static value as a (truthy) string: hq, hq="", hq="false" all mean on.
    return True


def hq_refs_in(text: str) -> dict[str, bool]:
    """{clip: hq} for one deck file, resolved as VideoPlayer resolves `hq`."""
    deck_wide = bool(HQ_HEADMATTER_RE.search(text))
    out: dict[str, bool] = {}
    for tag in VIDEO_TAG_RE.findall(text):
        src = TAG_SRC_RE.search(tag)
        if not src:
            continue
        own = _tag_hq(tag)
        out[src.group(1)] = out.get(src.group(1), False) or (deck_wide if own is None else own)
    return out


def _hq_references() -> dict[str, bool]:
    refs: dict[str, bool] = {}
    for md in _deck_markdown(SLIDES_DIR):
        try:
            text = md.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for name, hq in hq_refs_in(text).items():
            refs[name] = refs.get(name, False) or hq
    return refs


def _release_assets(defaults: dict, shared_defaults: dict) -> tuple[dict | None, dict | None]:
    """(talk, shared) release listings, None where gh or the release is missing."""
    if not shutil.which("gh"):
        return None, None
    shared_tag = shared_defaults.get("release_tag")
    if shared_tag == defaults["release_tag"]:
        talk = _remote_assets(defaults["release_tag"])
        return talk, talk
    if not shared_tag:
        return _remote_assets(defaults["release_tag"]), None
    # Two gh calls of about half a second each: list both releases at once.
    with ThreadPoolExecutor(max_workers=2) as pool:
        talk = pool.submit(_remote_assets, defaults["release_tag"])
        shared = pool.submit(_remote_assets, shared_tag, shared_defaults.get("repo"))
        return talk.result(), shared.result()


def resolve_chain(name: str, mode: str, *, hq: bool = False,
                  talk_assets: dict | None = None, shared_assets: dict | None = None) -> list[tuple[str, str]]:
    """[(tier, local path or URL)] VideoPlayer would try for `name`, in its
    order for `mode` (local-first | remote-first), keeping copies that exist."""
    paths = ([("local-hq", HQ_DIR / name)] if hq else []) + [("local-web", WEB_DIR / name)]
    local = [(tier, str(path)) for tier, path in paths if path.is_file()]
    remote = [(tier, assets[name]["url"])
              for tier, assets in (("talk-release", talk_assets), ("shared-release", shared_assets))
              if assets and name in assets and assets[name].get("url")]
    chain = local + remote if mode == "local-first" else remote + local
    return [c for i, c in enumerate(chain) if i == 0 or c[1] != chain[i - 1][1]]


# ---------------------------------------------------------------------------
# preflight — venue playback lint for everything the deck references
# ---------------------------------------------------------------------------
#
# The Yaga talk (2026-07-18) froze twice on clips that individually looked
# fine: HQ-tier HEVC at venue-native resolution (a 148 Mbps raw hard-link,
# a 2880x1600 master). preflight resolves what VideoPlayer will ACTUALLY
# serve for each deck reference (resolve_chain), ffprobes it (https URLs
# included) and flags anything that history says can freeze a venue machine
# or ambush the audio level. Clips are probed in parallel, and each probe and
# loudness reading is cached in ~/.cache/slidev-videos/probe.json under the
# file's path or URL plus its size and mtime (local) or asset version
# (release), so a re-run only reads what changed.

BROWSER_SAFE_VIDEO = frozenset({"h264", "vp8", "vp9", "av1"})
PREFLIGHT_MAX_MBPS = 10.0
PREFLIGHT_JOBS = 6
PROBE_CACHE_VERSION = 1


def _probe_media(src: str) -> dict | None:
    out = subprocess.run(
        [_ffprobe(), "-v", "error",
         "-show_entries", "stream=codec_type,codec_name,width,height:format=bit_rate,duration",
         "-of", "json", src],
        capture_output=True, text=True,
    )
    if out.returncode != 0:
        return None
    try:
        return json.loads(out.stdout)
    except ValueError:
        return None


def _probe_cache_path() -> Path:
    return _tools_mod.cache_dir() / "probe.json"


def _load_probe_cache() -> dict:
    try:
        data = json.loads(_probe_cache_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(data, dict) or data.get("version") != PROBE_CACHE_VERSION:
        return {}
    entries = data.get("entries")
    return entries if isinstance(entries, dict) else {}


def _save_probe_cache(new: dict) -> None:
    """Merge `new` into the cache file; older versions of the same file go."""
    if not new:
        return
    entries = _load_probe_cache()   # re-read: another run may have written since
    srcs = {e["src"] for e in new.values()}
    entries = {k: e for k, e in entries.items() if e.get("src") not in srcs}
    entries.update(new)
    path = _probe_cache_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(f".probe.{os.getpid()}.json")
        tmp.write_text(json.dumps({"version": PROBE_CACHE_VERSION, "entries": entries}) + "\n",
                       encoding="utf-8")
        os.replace(tmp, path)
    except OSError:
        pass


def _probe_key(tier: str, src: str, assets: tuple[dict | None, dict | None]) -> str | None:
    """Cache key for one copy: path + size + mtime, or URL + asset version."""
    if tier.startswith("local"):
        try:
            st = Path(src).stat()
        except OSError:
            return None
        return f"{src}|{st.st_size}|{st.st_mtime_ns}"
    listing = assets[0] if tier == "talk-release" else assets[1]
    for a in (listing or {}).values():
        if a.get("url") == src:
            return f"{src}|{a.get('size')}|{a.get('version', '')}"
    return None


def _preflight_one(src: str, key: str | None, cache: dict, measure: bool) -> dict:
    """Probe (and measure) one served copy, from the cache where it can.

    Returns {probe, loudness, cached, new}; `new` is the (key, entry) to
    cache. A failed probe or loudness reading is never cached.
    """
    hit = (cache.get(key) or {}) if key else {}
    probe = hit.get("probe")
    if probe is not None and (not measure or "loudness" in hit):
        return {"probe": probe, "loudness": hit.get("loudness"), "cached": True, "new": None}
    if probe is None:
        probe = _probe_media(src)
        if probe is None:
            return {"probe": None, "loudness": None, "cached": False, "new": None}
        entry = {"probe": probe}
    else:
        entry = dict(hit)   # the probe is cached, the loudness is not yet
    entry["src"] = src
    if measure:
        if not any(st.get("codec_type") == "audio" for st in probe.get("streams", [])):
            entry["loudness"] = None
        else:
            measured = _measure_loudness(src)
            if measured is not None:
                entry["loudness"] = measured
    return {"probe": probe, "loudness": entry.get("loudness"), "cached": False,
            "new": (key, entry) if key else None}


def cmd_preflight(args: argparse.Namespace) -> int:
    report = _report(args)
    defaults, _ = load_manifest()
    shared_defaults, _shared = load_shared_manifest()
    refs = sorted(_slide_references())
    if getattr(args, "only", None):
        wanted = set(args.only)
        refs = [r for r in refs if r in wanted]
    mode = getattr(args, "mode", None) or "local-first"
    report.update({"mode": mode, "clips": [], "total": len(refs)})
    if not refs:
        print("No VideoPlayer references in the deck.")
        report.update({"flagged": 0, "unreadable": 0, "not_served": 0})
        return 0

    started = time.monotonic()
    assets = _release_assets(defaults, shared_defaults)
    hq_by_name = _hq_references()
    web_cap = int(defaults.get("web_long_edge_px", 1920))
    max_mbps = args.max_mbps or float(defaults.get("preflight_max_mbps", PREFLIGHT_MAX_MBPS))
    measure = not args.no_loudness
    jobs = max(1, int(getattr(args, "jobs", None) or PREFLIGHT_JOBS))
    tools = _tools()
    https_ok = bool(tools.chosen and tools.chosen.https)
    cache = _load_probe_cache()

    served: dict[str, list[tuple[str, str]]] = {
        name: resolve_chain(name, mode, hq=hq_by_name.get(name, False),
                            talk_assets=assets[0], shared_assets=assets[1])
        for name in refs
    }
    results: dict[str, dict] = {}
    with ThreadPoolExecutor(max_workers=min(jobs, len(refs))) as pool:
        futures = {
            pool.submit(_preflight_one, chain[0][1],
                        _probe_key(chain[0][0], chain[0][1], assets), cache, measure): name
            for name, chain in served.items() if chain
        }
        for fut in as_completed(futures):
            results[futures[fut]] = fut.result()
    _save_probe_cache(dict(r["new"] for r in results.values() if r["new"]))

    flagged = unreadable = not_served = from_cache = 0
    for name in refs:
        chain = served[name]
        clip = {"name": name, "hq": hq_by_name.get(name, False), "chain": [list(c) for c in chain],
                "tier": None, "src": None, "flagged": True, "problems": [], "notes": [], "cached": False}
        report["clips"].append(clip)
        if not chain:
            print(f"  FLAG  {name}: NOT SERVED — no local copy, no release asset (deck shows an error box)")
            clip["problems"].append("not served: no local copy, no release asset")
            flagged += 1
            not_served += 1
            continue
        tier, url = chain[0]
        res = results[name]
        clip.update(tier=tier, src=url, cached=res["cached"])
        from_cache += res["cached"]
        info = res["probe"]
        if info is None:
            hint = ("" if https_ok or not url.startswith("https://")
                    else " (this ffprobe crashes on HTTPS; see `slidev-videos doctor`)")
            print(f"  FLAG  {name} [{tier}]: ffprobe can't read it{hint}")
            clip["problems"].append(f"ffprobe can't read it{hint}")
            flagged += 1
            unreadable += 1
            continue
        vstreams = [s for s in info.get("streams", []) if s.get("codec_type") == "video"]
        astreams = [s for s in info.get("streams", []) if s.get("codec_type") == "audio"]
        vcodec = vstreams[0].get("codec_name", "?") if vstreams else "?"
        width = int(vstreams[0].get("width") or 0) if vstreams else 0
        height = int(vstreams[0].get("height") or 0) if vstreams else 0
        long_edge = max(width, height)
        acodec = astreams[0].get("codec_name") if astreams else None
        try:
            mbps = int(info.get("format", {}).get("bit_rate", 0)) / 1e6
        except (TypeError, ValueError):
            mbps = 0.0

        problems = clip["problems"]
        if vcodec not in BROWSER_SAFE_VIDEO:
            problems.append(f"video codec {vcodec} — not browser-safe (HEVC froze the Yaga venue)")
        if long_edge > web_cap:
            problems.append(f"long edge {long_edge}px > web cap {web_cap}px")
        if mbps > max_mbps:
            problems.append(f"{mbps:.1f} Mbps > {max_mbps:g} Mbps ceiling")
        if acodec and acodec not in BROWSER_SAFE_AUDIO:
            problems.append(f"audio codec {acodec} — Chrome plays it SILENT")
        lufs_txt = "no audio" if not acodec else "-"
        lufs_value = None
        measured = res["loudness"]
        if acodec and measure and measured is not None:
            try:
                lufs = float(measured["input_i"])
            except (KeyError, TypeError, ValueError):
                lufs = None
            if lufs is not None and not lufs > -70.0:
                # -inf: the track is digital silence. Re-encoding cannot
                # normalize it; the clip wants the silent-loop profile.
                lufs_txt = "silent track"
                clip["notes"].append("silent audio track — profile silent-loop drops it")
            elif lufs is not None:
                lufs_value = round(lufs, 1)
                lufs_txt = f"{lufs:.1f} LUFS"
                if abs(lufs - LOUDNORM_I) > LOUDNESS_TOLERANCE_LU:
                    problems.append(
                        f"loudness {lufs:.1f} LUFS off target {LOUDNORM_I:g} "
                        f"(±{LOUDNESS_TOLERANCE_LU:g} LU) — re-encode to normalize"
                    )
        clip.update(video={"codec": vcodec, "width": width, "height": height},
                    mbps=round(mbps, 2), audio=acodec, lufs=lufs_value,
                    silent_track=lufs_txt == "silent track", flagged=bool(problems))

        desc = f"{vcodec} {width}x{height}, {mbps:.1f} Mbps, audio={acodec or 'none'}, {lufs_txt}"
        if problems:
            flagged += 1
            print(f"  FLAG  {name} [{tier}]  {desc}")
            for p in problems:
                print(f"          - {p}")
        else:
            print(f"  ok    {name} [{tier}]  {desc}")
        for note in clip["notes"]:
            print(f"          ~ {note}")

    elapsed = time.monotonic() - started
    report.update({"flagged": flagged, "unreadable": unreadable, "not_served": not_served,
                   "from_cache": from_cache, "seconds": round(elapsed, 2), "ffprobe": tools.ffprobe})
    print()
    if flagged:
        print(f"{flagged} of {len(refs)} clip(s) flagged — fix or consciously accept before the venue.")
        return 1
    print(f"All {len(refs)} deck clip(s) look venue-safe.")
    return 0


# ---------------------------------------------------------------------------
# frames — strips of small frames for the player's `dust` transition
# ---------------------------------------------------------------------------
#
# The `dust` transition draws a clip's picture as particles, so the page needs
# the picture's pixels. GitHub serves release assets without CORS headers: a
# deployed deck can play a clip but not read it. `frames` writes, per
# deck-referenced clip, one JPEG holding a grid of small tiles — the first
# frame, then one every few seconds — into <public>/video-frames/, with an
# index.json the player reads. They are small, and they are committed with
# the deck. Entering uses tile 0; leaving uses the tile at the moment the
# presenter moved on (a same-origin clip — dev, venue build — is read live
# instead, to the frame).

FRAMES_DIRNAME = "video-frames"
FRAMES_INDEX = "index.json"
FRAMES_TILE_W = 320
FRAMES_INTERVAL_S = 4.0
FRAMES_MAX_TILES = 64
FRAMES_COLS = 8
FRAMES_VERSION = 1

DUST_HEADMATTER_RE = re.compile(r"^videos:[ \t]*\n(?:[ \t]+.*\n|[ \t]*\n)*?[ \t]+transition:[ \t]*[\"']?dust\b", re.M)
DUST_TAG_RE = re.compile(r'<VideoPlayer\b[^>]*?(?<![:\w-])transition="dust"[^>]*>', re.S)
VIDEO_TAG_RE = re.compile(r'<VideoPlayer\b[^>]*>', re.S)
TAG_SRC_RE = re.compile(r'(?<![:\w-])src="([^"]+)"')
TAG_TRANSITION_RE = re.compile(r'(?<![:\w-])transition="([^"]+)"')


def dust_refs_in(text: str) -> set[str]:
    """Clips that arrive as dust in one deck file: every clip when the
    headmatter says `videos.transition: dust` (bar those that opt out with
    their own `transition=`), else the clips tagged `transition="dust"`."""
    deck_wide = bool(DUST_HEADMATTER_RE.search(text))
    out: set[str] = set()
    for tag in VIDEO_TAG_RE.findall(text):
        src = TAG_SRC_RE.search(tag)
        if not src:
            continue
        own = TAG_TRANSITION_RE.search(tag)
        if (own.group(1) == "dust") if own else deck_wide:
            out.add(src.group(1))
    return out


def _dust_references() -> set[str]:
    refs: set[str] = set()
    for md in _deck_markdown(SLIDES_DIR):
        try:
            refs |= dust_refs_in(md.read_text(encoding="utf-8", errors="ignore"))
        except OSError:
            continue
    return refs


def _frames_dir() -> Path:
    return WEB_DIR.parent / FRAMES_DIRNAME


def _read_frames_index(d: Path) -> dict:
    try:
        data = json.loads((d / FRAMES_INDEX).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    clips = data.get("clips") if isinstance(data, dict) else None
    return clips if isinstance(clips, dict) else {}


def frames_plan(duration: float, interval: float = FRAMES_INTERVAL_S,
                max_tiles: int = FRAMES_MAX_TILES, cols: int = FRAMES_COLS) -> dict:
    """How a clip of `duration` seconds is cut into tiles.

    One tile every `interval` seconds starting with the first frame; a clip
    too long for `max_tiles` at that pace gets a wider interval instead of a
    bigger strip. The count is kept to tiles that certainly exist (the last
    one starts before the clip ends), so the player never lands on padding.
    """
    duration = max(0.0, float(duration))
    interval = max(0.1, float(interval))
    max_tiles = max(1, int(max_tiles))
    if duration / interval + 1 > max_tiles:
        # max_tiles tiles at 0, i, 2i, …: the last one starts one interval before the end
        interval = duration / max_tiles if max_tiles > 1 else duration + 1
    interval = round(interval, 3)
    count = max(1, min(max_tiles, int(max(0.0, duration - 0.05) // interval) + 1))
    cols = max(1, min(int(cols), count))
    rows = -(-count // cols)
    return {"interval": interval, "count": count, "cols": cols, "rows": rows}


def frames_tile_size(width: int, height: int, tile_w: int = FRAMES_TILE_W) -> tuple[int, int]:
    """Tile size for a width x height picture: `tile_w` wide, even height."""
    if width <= 0 or height <= 0:
        return tile_w, tile_w * 9 // 16
    h = max(2, round(tile_w * height / width))
    return tile_w, h + (h % 2)


def _frames_source(name: str, talk_assets, shared_assets) -> tuple[str, str] | None:
    """(tier, path or URL) to cut the strip from.

    Strips matter where a clip is cross-origin, in a deployed deck, which
    plays the web tier: resolve_chain() without HQ gives the local web copy,
    then the talk's release, then the shared release. A local HQ copy (not
    trimmed like the web tier) is the last resort.
    """
    chain = resolve_chain(name, "local-first", hq=False, talk_assets=talk_assets, shared_assets=shared_assets)
    if chain:
        return chain[0]
    hq = HQ_DIR / name
    return ("local-hq", str(hq)) if hq.is_file() else None


# Set when frames is interrupted: downloads in worker threads stop at their
# next chunk, so the scratch directory can go.
_STOP = threading.Event()


class _Terminated(Exception):
    """SIGTERM, raised in the main thread so `finally` blocks run."""


@contextlib.contextmanager
def _sigterm_raises():
    """Turn SIGTERM into _Terminated while the block runs.

    `timeout` and process supervisors stop a command with SIGTERM, whose
    default action skips every `finally`, leaving half-downloaded clips.
    """
    if threading.current_thread() is not threading.main_thread():
        yield
        return

    def handler(signum, frame):
        raise _Terminated(signum)
    previous = signal.signal(signal.SIGTERM, handler)
    try:
        yield
    finally:
        signal.signal(signal.SIGTERM, previous)


def _download(url: str, dest: Path) -> bool:
    """Fetch url to dest (streamed). False on any failure or on _STOP; dest is removed then."""
    import urllib.request
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "slidev-videos"})
        with urllib.request.urlopen(req, timeout=60) as r, dest.open("wb") as f:
            while chunk := r.read(1 << 20):
                if _STOP.is_set():
                    raise OSError("interrupted")
                f.write(chunk)
        return dest.stat().st_size > 0
    except (OSError, ValueError):
        dest.unlink(missing_ok=True)
        return False


def _frames_one(name: str, src: str, out_dir: Path, args: argparse.Namespace,
                scratch: Path | None = None) -> tuple[str, dict | None, str]:
    """Cut one strip. Returns (name, index entry or None, message).

    A release asset is read over HTTPS where ffmpeg can. A URL that ffprobe
    fails on (a static Linux build crashes resolving a host name) is
    downloaded into `scratch`, a temporary directory outside the deck, cut,
    and removed.
    """
    fetched: Path | None = None
    info = _probe_media(src)
    if info is None and src.startswith(("http://", "https://")):
        fetched = (scratch or Path(tempfile.gettempdir())) / f"{name}.src"
        if not _download(src, fetched):
            return name, None, "ffprobe can't read the URL and the download failed"
        src = str(fetched)
        info = _probe_media(src)
    try:
        return _frames_cut(name, src, info, out_dir, args, via_download=fetched is not None)
    finally:
        if fetched is not None:
            fetched.unlink(missing_ok=True)


def _frames_cut(name: str, src: str, info: dict | None, out_dir: Path,
                args: argparse.Namespace, via_download: bool = False) -> tuple[str, dict | None, str]:
    if info is None:
        return name, None, "ffprobe can't read it"
    vstreams = [s for s in info.get("streams", []) if s.get("codec_type") == "video"]
    if not vstreams:
        return name, None, "no video stream"
    width = int(vstreams[0].get("width") or 0)
    height = int(vstreams[0].get("height") or 0)
    try:
        duration = float(info.get("format", {}).get("duration") or 0)
    except (TypeError, ValueError):
        duration = 0.0
    plan = frames_plan(duration, args.interval, args.max_tiles, FRAMES_COLS)
    tw, th = frames_tile_size(width, height, args.tile_width)
    out = out_dir / f"{name}.jpg"
    tmp = out_dir / f".{name}.tmp.jpg"
    # select: the first frame, then every frame at least `interval` after the
    # last one kept — tile k is the picture at k * interval, tile 0 the opening frame.
    vf = (
        f"select='isnan(prev_selected_t)+gte(t-prev_selected_t\\,{plan['interval']})',"
        f"scale={tw}:{th}:flags=bicubic,setsar=1,"
        f"tile={plan['cols']}x{plan['rows']}:color=black"
    )
    cmd = [
        _ffmpeg(), "-hide_banner", "-loglevel", "error", "-y",
        "-i", src, "-an", "-sn", "-vf", vf, "-fps_mode", "vfr",
        "-frames:v", "1", "-q:v", str(args.quality), "-f", "image2", "-update", "1", str(tmp),
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0 or not tmp.is_file() or tmp.stat().st_size == 0:
        tmp.unlink(missing_ok=True)
        tail = (res.stderr or "").strip().splitlines()[-1:] or ["ffmpeg failed"]
        return name, None, tail[0]
    tmp.replace(out)
    entry = {
        "file": out.name,
        "tile": [tw, th],
        "cols": plan["cols"],
        "count": plan["count"],
        "interval": plan["interval"],
        "size": [width, height],
        "duration": round(duration, 3),
    }
    return name, entry, human_size(out.stat().st_size) + (" (downloaded to cut)" if via_download else "")


def _frames_current(entry: dict | None, out_dir: Path, args: argparse.Namespace) -> bool:
    """An existing strip made with the same settings needs no second cut."""
    if not entry or not (out_dir / str(entry.get("file", ""))).is_file():
        return False
    plan = frames_plan(float(entry.get("duration") or 0), args.interval, args.max_tiles, FRAMES_COLS)
    return (
        entry.get("tile", [0])[0] == args.tile_width
        and entry.get("interval") == plan["interval"]
        and entry.get("count") == plan["count"]
    )


def _sweep_frames_leftovers(out_dir: Path) -> int:
    """Remove what an interrupted run of an older CLI left in the strip folder.

    Downloads used to land in out_dir as .<name>.src; nothing writes them
    there now. A .<name>.tmp.jpg lives only while ffmpeg writes it, so one an
    hour old is a leftover.
    """
    if not out_dir.is_dir():
        return 0
    swept = 0
    now = time.time()
    for p in [*out_dir.glob(".*.src"), *out_dir.glob(".*.tmp.jpg")]:
        try:
            if p.suffix == ".src" or now - p.stat().st_mtime > 3600:
                p.unlink()
                swept += 1
        except OSError:
            continue
    return swept


def cmd_frames(args: argparse.Namespace) -> int:
    """Write frame strips for the clips the deck references."""
    report = _report(args)
    clips: list[dict] = []
    report.update({"clips": clips, "cut": 0, "failed": 0, "up_to_date": 0})
    all_refs = sorted(_slide_references())
    dust = _dust_references()
    refs = all_refs if args.all else [r for r in all_refs if r in dust]
    if getattr(args, "only", None):
        wanted = set(args.only)
        refs = [r for r in all_refs if r in wanted]
        for missing in sorted(wanted - set(refs)):
            print(f"  skip  {missing}: not referenced by the deck")
            clips.append({"name": missing, "status": "skip", "message": "not referenced by the deck"})
    out_dir = _frames_dir()
    report["dir"] = str(out_dir)
    index = _read_frames_index(out_dir)
    if not args.dry_run:
        swept = _sweep_frames_leftovers(out_dir)
        if swept:
            print(f"  removed {swept} leftover download(s) of an interrupted run from {out_dir.relative_to(TALK)}/")

    if args.prune:
        keep = set(all_refs)
        dropped = sorted(set(index) - keep)
        for name in dropped:
            f = out_dir / str(index[name].get("file", ""))
            print(f"  {'would drop' if args.dry_run else 'drop'}  {name}")
            clips.append({"name": name, "status": "would-drop" if args.dry_run else "drop"})
            if not args.dry_run:
                f.unlink(missing_ok=True)
                del index[name]
        # saved here: the run may find nothing left to cut and return early
        if dropped and not args.dry_run:
            _write_frames_index(out_dir, index)

    if not refs:
        print("No clips to cut: the deck has no `dust` clips "
              "(set `videos.transition: dust`, tag a clip `transition=\"dust\"`, or pass --all).")
        return 0
    if not _tools().ffmpeg:
        print("error: frames needs ffmpeg and ffprobe (on PATH, or see `slidev-videos doctor`)", file=sys.stderr)
        return 2

    todo = [n for n in refs if args.force or not _frames_current(index.get(n), out_dir, args)]
    for name in refs:
        if name not in todo:
            print(f"  ok    {name}  (up to date)")
            clips.append({"name": name, "status": "ok", "file": index[name].get("file")})
            report["up_to_date"] += 1
    if not todo:
        print(f"All {len(refs)} strip(s) up to date in {out_dir.relative_to(TALK)}/.")
        return 0

    # Release lookups only when some clip has no local web copy.
    talk_assets = shared_assets = None
    if any(not (WEB_DIR / n).is_file() for n in todo):
        defaults, _ = load_manifest()
        shared_defaults, _shared = load_shared_manifest()
        talk_assets, shared_assets = _release_assets(defaults, shared_defaults)

    jobs: list[tuple[str, str, str]] = []
    failed = 0
    for name in todo:
        src = _frames_source(name, talk_assets, shared_assets)
        if src is None:
            print(f"  FAIL  {name}: no local copy and no release asset to cut from")
            clips.append({"name": name, "status": "fail", "message": "no local copy and no release asset"})
            failed += 1
            continue
        jobs.append((name, *src))
    report["failed"] = failed
    if args.dry_run:
        for name, tier, src in jobs:
            print(f"  would cut  {name}  [{tier}]")
            clips.append({"name": name, "status": "would-cut", "tier": tier, "src": src})
        return 1 if failed else 0

    out_dir.mkdir(parents=True, exist_ok=True)
    workers = max(1, min(int(args.jobs), len(jobs) or 1))
    _STOP.clear()
    try:
        with _sigterm_raises(), tempfile.TemporaryDirectory(prefix="slidev-videos-frames-") as scratch, \
                ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(_frames_one, name, src, out_dir, args, Path(scratch)): (name, tier, src)
                       for name, tier, src in jobs}
            try:
                for fut in as_completed(futures):
                    name, tier, src = futures[fut]
                    try:
                        _, entry, msg = fut.result()
                    except Exception as exc:  # one clip must not sink the batch
                        entry, msg = None, str(exc)
                    if entry is None:
                        print(f"  FAIL  {name} [{tier}]: {msg}")
                        clips.append({"name": name, "status": "fail", "tier": tier, "src": src, "message": msg})
                        failed += 1
                        continue
                    index[name] = entry
                    clips.append({"name": name, "status": "cut", "tier": tier, "src": src, "message": msg,
                                  "file": entry["file"], "count": entry["count"], "interval": entry["interval"]})
                    report["cut"] += 1
                    print(f"  cut   {name} [{tier}]  {entry['count']} tile(s) every {entry['interval']:g} s, {msg}")
            except BaseException:
                # Stop downloads at their next chunk and drop queued clips;
                # the pool then waits for running cuts before the scratch
                # directory is removed.
                _STOP.set()
                for fut in futures:
                    fut.cancel()
                raise
    except (_Terminated, KeyboardInterrupt) as e:
        _write_frames_index(out_dir, index)
        print(f"\ninterrupted: {report['cut']} strip(s) cut and indexed, downloads removed.", file=sys.stderr)
        if isinstance(e, KeyboardInterrupt):
            raise
        return 128 + signal.SIGTERM
    finally:
        _STOP.clear()
    _write_frames_index(out_dir, index)
    report["failed"] = failed

    total = sum((out_dir / e["file"]).stat().st_size for e in index.values() if (out_dir / e["file"]).is_file())
    print(f"\n{len(index)} strip(s) in {out_dir.relative_to(TALK)}/ ({human_size(total)}) — commit them with the deck.")
    if failed:
        print(f"{failed} clip(s) failed; they will fade instead of arriving as dust.")
        return 1
    return 0


def _write_frames_index(out_dir: Path, clips: dict) -> None:
    payload = {"version": FRAMES_VERSION, "clips": {k: clips[k] for k in sorted(clips)}}
    (out_dir / FRAMES_INDEX).write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


# ---------------------------------------------------------------------------
# contact-sheet — one picture of a clip, to judge candidate footage
# ---------------------------------------------------------------------------
#
# Choosing between candidate clips meant opening each one, or a hand-written
# frames-to-montage script. contact-sheet tiles a frame every --every seconds
# (widened for long clips, as for strips) into one PNG, from a local file or
# an https URL; a URL the ffmpeg in use cannot read is downloaded into a
# temporary directory first. Needs no project.

SHEET_EVERY_S = 10.0
SHEET_COLS = 6
SHEET_TILE_W = 320
SHEET_PAD = 4


def _sheet_out(src: str) -> Path:
    from urllib.parse import urlparse
    stem = Path(urlparse(src).path).stem if src.startswith(("http://", "https://")) else Path(src).stem
    return Path.cwd() / f"{stem or 'clip'}.sheet.png"


def _clock(t: float) -> str:
    m, sec = divmod(int(round(t)), 60)
    return f"{m // 60}:{m % 60:02d}:{sec:02d}" if m >= 60 else f"{m}:{sec:02d}"


def cmd_contact_sheet(args: argparse.Namespace) -> int:
    src = args.source
    is_url = src.startswith(("http://", "https://"))
    if not is_url and not Path(src).is_file():
        print(f"error: {src}: no such file", file=sys.stderr)
        return 2
    if not _tools().ffmpeg:
        print("error: contact-sheet needs ffmpeg and ffprobe (see `slidev-videos doctor`)", file=sys.stderr)
        return 2
    out = Path(args.out) if args.out else _sheet_out(src)
    with _sigterm_raises(), tempfile.TemporaryDirectory(prefix="slidev-videos-sheet-") as scratch:
        info = _probe_media(src)
        if info is None and is_url:
            fetched = Path(scratch) / "clip.src"
            print(f"  downloading {src} (ffprobe can't read the URL)")
            if not _download(src, fetched):
                print("error: the download failed", file=sys.stderr)
                return 1
            src = str(fetched)
            info = _probe_media(src)
        vstreams = [st for st in (info or {}).get("streams", []) if st.get("codec_type") == "video"]
        if not vstreams:
            print(f"error: ffprobe can't read a video stream in {args.source}", file=sys.stderr)
            return 1
        width, height = int(vstreams[0].get("width") or 0), int(vstreams[0].get("height") or 0)
        try:
            duration = float(info.get("format", {}).get("duration") or 0)
        except (TypeError, ValueError):
            duration = 0.0
        plan = frames_plan(duration, args.every, args.max_tiles, args.cols)
        tw, th = frames_tile_size(width, height, args.tile_width)
        vf = (
            f"select='isnan(prev_selected_t)+gte(t-prev_selected_t\\,{plan['interval']})',"
            f"scale={tw}:{th}:flags=bicubic,setsar=1,"
            f"tile={plan['cols']}x{plan['rows']}:padding={SHEET_PAD}:margin={SHEET_PAD}:color=0x111111"
        )
        out.parent.mkdir(parents=True, exist_ok=True)
        res = subprocess.run(
            [_ffmpeg(), "-hide_banner", "-loglevel", "error", "-y", "-i", src, "-an", "-sn",
             "-vf", vf, "-fps_mode", "vfr", "-frames:v", "1", "-update", "1", str(out)],
            capture_output=True, text=True,
        )
    if res.returncode != 0 or not out.is_file():
        tail = (res.stderr or "").strip().splitlines()[-1:] or ["ffmpeg failed"]
        print(f"error: {tail[0]}", file=sys.stderr)
        return 1
    print(f"{out}  ({plan['count']} frames, one every {plan['interval']:g} s of {_clock(duration)}, "
          f"{plan['cols']} per row, {width}x{height} source)")
    for row in range(plan["rows"]):
        first = row * plan["cols"]
        last = min(first + plan["cols"], plan["count"]) - 1
        print(f"  row {row + 1}: {_clock(first * plan['interval'])} – {_clock(last * plan['interval'])}")
    return 0


# ---------------------------------------------------------------------------
# venue — one-command offline bundle: pull → preflight → build → zip
# ---------------------------------------------------------------------------

VENUE_BUILD_ENV = {"VITE_VIDEOS_LOCAL_FIRST": "1"}
VENUE_BUILD_ENV_TEXT = " ".join(f"{k}={v}" for k, v in VENUE_BUILD_ENV.items())


def cmd_venue(args: argparse.Namespace) -> int:
    """Self-contained venue bundle for this deck.

    Localizes the web tier (talk + inherited shared clips), preflights what
    will actually play, runs `pnpm build:portable`, and zips dist-portable
    with a RUN_ME note. HQ masters are NOT pulled — since 2026-07-18 the
    venue plays the 1080p H.264 web tier; a populated videos/hq/ still gets
    bundled via the public/videos-hq symlink for talks that opted in.

    The build runs with VITE_VIDEOS_LOCAL_FIRST=1, so the bundle's player
    tries its own copies before GitHub whatever the talk's build:portable
    script sets; without it a production build streams over venue Wi-Fi.
    """
    if not args.skip_pull:
        print("=== venue: pull web tier (incl. inherited shared clips) ===")
        rc = cmd_pull(argparse.Namespace(
            only=None, force=False, dry_run=args.dry_run, prune=False, include_shared=True,
        ))
        if rc != 0:
            return rc

    print("\n=== venue: preflight (metadata only; run videos:preflight for loudness) ===")
    pf = cmd_preflight(argparse.Namespace(only=None, no_loudness=True, max_mbps=None, mode="local-first"))
    if pf != 0:
        print("WARNING: preflight flagged clips above. Bundle continues — fix or accept consciously.")

    if args.dry_run:
        print(f"\n(dry run) would run: {VENUE_BUILD_ENV_TEXT} pnpm build:portable, then zip dist-portable/ "
              f"-> {TALK.name}-venue.zip")
        return 0

    print(f"\n=== venue: {VENUE_BUILD_ENV_TEXT} pnpm build:portable ===")
    rc = subprocess.call(["pnpm", "build:portable"], cwd=TALK, env={**os.environ, **VENUE_BUILD_ENV})
    if rc != 0:
        return rc

    dist = TALK / "dist-portable"
    if not dist.is_dir():
        print("error: dist-portable/ missing after build", file=sys.stderr)
        return 2
    (dist / "RUN_ME.txt").write_text(
        "Offline venue bundle. Browsers refuse ES-module apps on file://,\n"
        "so serve it over local HTTP:\n\n"
        "    python3 -m http.server 8000\n"
        "    then open http://localhost:8000\n\n"
        f"Built by `slidev-videos venue` for {TALK.name}.\n",
        encoding="utf-8",
    )
    bundle = TALK / f"{TALK.name}-venue.zip"
    print(f"\n=== venue: zipping -> {bundle.name} ===")
    # ZIP_STORED: the payload is already-compressed video; deflate would
    # burn minutes for ~0% gain.
    with zipfile.ZipFile(bundle, "w", zipfile.ZIP_STORED) as zf:
        for path in sorted(dist.rglob("*")):
            if path.is_file():
                zf.write(path, Path(f"{TALK.name}-venue") / path.relative_to(dist))
    print(f"Done: {bundle.name} ({human_size(bundle.stat().st_size)})")
    print("Copy to the venue machine (or gdrive as backup), unzip, see RUN_ME.txt.")
    return 0


# ---------------------------------------------------------------------------
# doctor — what this machine and project will run with
# ---------------------------------------------------------------------------

def cmd_doctor(args: argparse.Namespace) -> int:
    from . import doctor
    defaults: dict = {}
    if _PROJECT is not None:
        try:
            defaults, _ = load_manifest()
        except (OSError, tomllib.TOMLDecodeError):
            defaults = dict(_PROJECT.defaults)
    return doctor.run(_report(args), _PROJECT, defaults, _tools(), nvenc_available, cli_version())


# ---------------------------------------------------------------------------
# encode-hq — ffmpeg raw -> videos/hq/ (visually-lossless venue masters)
# ---------------------------------------------------------------------------

def _ensure_hq_symlink() -> None:
    """Make public/videos-hq a symlink to videos/hq (idempotent).

    If the path already exists as a symlink to the correct target, do nothing.
    If it exists as a different symlink, replace it.
    If it exists as a real file or directory, raise — user must remove it.
    """
    HQ_DIR.mkdir(parents=True, exist_ok=True)
    target = HQ_DIR.resolve()
    if HQ_LINK_DIR.is_symlink():
        if HQ_LINK_DIR.resolve() == target:
            return
        HQ_LINK_DIR.unlink()
    elif HQ_LINK_DIR.exists():
        raise RuntimeError(
            f"{HQ_LINK_DIR} exists and is not a symlink; remove it manually."
        )
    HQ_LINK_DIR.parent.mkdir(parents=True, exist_ok=True)
    HQ_LINK_DIR.symlink_to(target, target_is_directory=True)


def _encode_one_hq(entry: VideoEntry, force: bool, default_long_edge: int) -> tuple[VideoEntry, str, int, int]:
    """HQ counterpart of _encode_one. Writes to videos/hq/<name>.

    Profile selection (driven by the existing per-video `profile` field):
      - hq_from_raw → hard-link raw straight into videos/hq/ (no re-encode)
      - remux       → stream-copy (already web-friendly, no scale needed)
      - silent-loop → hq-visually-lossless + -an (strip audio)
      - everything else → hq-visually-lossless

    Returns (entry, status, raw_size, hq_size). status in {skipped, ok, missing, failed}.
    """
    raw = RAW_DIR / entry.name
    hq = HQ_DIR / entry.name
    if not raw.exists():
        return entry, "missing", 0, 0
    raw_size = raw.stat().st_size

    if entry.hq_from_raw:
        # Freshness for a hard link is exact: same inode == same bytes. The
        # mtime test used below would wrongly report "up to date" when a
        # re-pulled raw carries the old modtime (see cmd_sync's --checksum
        # note) — leaving last week's cut linked as the venue master.
        # HQ_DIR and RAW_DIR are siblings under videos/, so os.link is the
        # real path here; the copy2 fallback only fires cross-device, where it
        # re-copies each run rather than risk serving a stale master.
        if hq.exists() and not force and hq.samefile(raw):
            return entry, "skipped", raw_size, hq.stat().st_size
        if hq.exists() or hq.is_symlink():
            hq.unlink()
        try:
            import os
            os.link(raw, hq)
        except OSError:
            shutil.copy2(raw, hq)
        return entry, "ok", raw_size, raw_size

    if hq.exists() and not force and hq.stat().st_mtime >= raw.stat().st_mtime:
        return entry, "skipped", raw_size, hq.stat().st_size

    encoder = select_encoder(entry.encoder)
    if entry.profile == "remux":
        ff_args = _profile_args("remux", default_long_edge, encoder)
    else:
        long_edge = entry.long_edge_px or default_long_edge
        ff_args = _profile_args("hq-visually-lossless", long_edge, encoder, cq_override=entry.hq_crf)
        if entry.profile == "silent-loop":
            ff_args = ff_args + ["-an"]
    if entry.profile != "silent-loop":
        # Appended last so it overrides the profile's `-c:a copy` (ffmpeg takes
        # the final occurrence of an option).
        ff_args = ff_args + _hq_audio_args(raw)

    tmp = hq.with_name(f"{hq.stem}.partial{hq.suffix}")
    cmd = [
        _ffmpeg(), "-y", "-hide_banner", "-nostdin", "-loglevel", "error",
        "-i", str(raw),
        *ff_args,
        str(tmp),
    ]
    result = subprocess.run(cmd, capture_output=True)
    if result.returncode != 0:
        tmp.unlink(missing_ok=True)
        stderr_text = result.stderr.decode("utf-8", errors="replace")
        codec_failure = (
            "-c:a" in ff_args
            and "copy" in ff_args
            and ("codec" in stderr_text.lower() or "audio" in stderr_text.lower())
        )
        if not codec_failure:
            sys.stderr.write(stderr_text)
            print(f"  ! ffmpeg HQ failed for {entry.name}", file=sys.stderr)
            return entry, "failed", raw_size, 0
        # Audio-codec mismatch with -c:a copy. Retry once with AAC.
        retry_args = []
        i = 0
        while i < len(ff_args):
            if ff_args[i] == "-c:a" and i + 1 < len(ff_args) and ff_args[i + 1] == "copy":
                retry_args.extend(["-c:a", "aac", "-b:a", "256k", "-ac", "2"])
                i += 2
            else:
                retry_args.append(ff_args[i])
                i += 1
        cmd_retry = [
            _ffmpeg(), "-y", "-hide_banner", "-nostdin", "-loglevel", "error",
            "-i", str(raw),
            *retry_args,
            str(tmp),
        ]
        retry_result = subprocess.run(cmd_retry, capture_output=True)
        if retry_result.returncode != 0:
            tmp.unlink(missing_ok=True)
            sys.stderr.write(retry_result.stderr.decode("utf-8", errors="replace"))
            print(f"  ! ffmpeg HQ failed for {entry.name} (AAC retry also failed)", file=sys.stderr)
            return entry, "failed", raw_size, 0
    tmp.replace(hq)
    return entry, "ok", raw_size, hq.stat().st_size


def cmd_encode_hq(args: argparse.Namespace) -> int:
    defaults, videos = load_manifest()
    if args.only:
        wanted = set(args.only)
        videos = [v for v in videos if v.name in wanted]
        if not videos:
            print(f"error: no manifest entries match {args.only}", file=sys.stderr)
            return 2
    if not _tools().ffmpeg:
        print("error: ffmpeg not installed. brew install ffmpeg", file=sys.stderr)
        return 2
    HQ_DIR.mkdir(parents=True, exist_ok=True)
    _ensure_hq_symlink()
    default_long_edge = int(defaults.get("long_edge_px", 1920))
    # No over_budget warning: HQ files are local-only and expected to be large.
    print(f"HQ-encoding {len(videos)} video(s). raw -> {HQ_DIR.relative_to(TALK)} (long edge: {default_long_edge}px)")
    return _run_encode_batch(videos, _encode_one_hq, args.force, default_long_edge, label="hq")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def cmd_build(args: argparse.Namespace) -> int:
    """One-shot pipeline: (sync) -> encode (web) -> encode-hq (masters) -> check.

    Render generated animations first with the talk's own render script (e.g.
    `python3 scripts/orbital_animation.py`); `build` then encodes + checks.
    """
    steps = []
    if args.sync:
        steps.append(("sync", cmd_sync))
    steps.append(("encode", cmd_encode))
    if not args.web_only:
        steps.append(("encode-hq", cmd_encode_hq))
    steps.append(("check", cmd_check))
    for name, fn in steps:
        print(f"\n=== videos:build -> {name} ===")
        rc = fn(args)
        if rc != 0:
            print(f"videos:build stopped at {name} (exit {rc})", file=sys.stderr)
            return rc
    print("\nvideos:build complete.")
    return 0


# Commands that answer `--json` with one object on stdout (text goes to stderr).
JSON_COMMANDS = ("check", "preflight", "frames", "doctor")
# Commands that run without a videos.toml.
PROJECTLESS = ("doctor", "contact-sheet")


class _Parser(argparse.ArgumentParser):
    """argparse whose usage errors are also a JSON object under --json."""
    json_errors = False

    def error(self, message):
        if _Parser.json_errors:
            self.print_usage(sys.stderr)
            print(f"{self.prog}: error: {message}", file=sys.stderr)
            print(json.dumps({"ok": False, "exit": 2, "error": message}))
            sys.exit(2)
        super().error(message)


def cli_version() -> str:
    from importlib.metadata import PackageNotFoundError, version
    try:
        return version("slidev-videos")
    except PackageNotFoundError:
        return "unknown"


class _Version(argparse.Action):
    """`--version`: the installed version and where it runs from, unwrapped."""

    def __init__(self, option_strings, dest=argparse.SUPPRESS, default=argparse.SUPPRESS,
                 help="print the version and install path, then exit"):
        super().__init__(option_strings=option_strings, dest=dest, default=default, nargs=0, help=help)

    def __call__(self, parser, namespace, values, option_string=None):
        print(f"slidev-videos {cli_version()} ({Path(__file__).resolve().parent})")
        parser.exit()


def _leading_command(argv: list[str]) -> tuple[int, str | None]:
    """Index and name of the first non-option token (--project's value skipped)."""
    i = 0
    while i < len(argv):
        if argv[i] == "--project":
            i += 2
        elif argv[i].startswith("-"):
            i += 1
        else:
            return i, argv[i]
    return len(argv), None


def _usage_failure(message: str, as_json: bool) -> int:
    print(message, file=sys.stderr)
    if as_json:
        print(json.dumps({"ok": False, "exit": 2, "error": message}))
    return 2


def main(argv: list[str] | None = None) -> int:
    # pnpm >=7 forwards the `--` delimiter verbatim, so the documented
    # `pnpm videos:pull -- --include-shared` arrives as
    # ['pull', '--', '--include-shared'] and argparse rejects the rest.
    # No subcommand takes a positional that starts with "-", so every bare
    # `--` is dropped, wherever it lands (`--project X pull -- --prune`).
    args_list = [a for a in (sys.argv[1:] if argv is None else argv) if a != "--"]
    # `discover` is a self-contained archive search (CDS/NASA/ESO/Commons);
    # it needs no project, so it bypasses videos.toml discovery entirely.
    at, first = _leading_command(args_list)
    if first == "discover":
        from . import discover
        rest = args_list[at + 1:]
        if "--json" in args_list[:at] and "--json" not in rest:
            rest.append("--json")
        return discover.main(rest)

    _Parser.json_errors = "--json" in args_list
    # --project and --json are accepted before or after the subcommand.
    common = _Parser(add_help=False)
    common.add_argument("--project", default=argparse.SUPPRESS,
                        help="project directory (default: walk up from cwd for videos.toml)")
    common.add_argument("--json", action="store_true", default=argparse.SUPPRESS,
                        help=f"one JSON object on stdout, the text on stderr ({', '.join(JSON_COMMANDS)})")
    parser = _Parser(prog="slidev-videos", description=__doc__, parents=[common])
    parser.add_argument("--version", action=_Version)
    sub = parser.add_subparsers(dest="cmd", required=True)
    add = functools.partial(sub.add_parser, parents=[common])
    add("discover", help="search open archives (CDS/NASA/ESO/Hubble/Webb/NOIRLab/Commons) for clips; prints [[videos]] snippets")

    p_sync = add("sync", help="rclone manifest-listed raw files from Drive")
    p_sync.add_argument("--dry-run", action="store_true")
    p_sync.add_argument("--all", action="store_true", help="mirror the whole remote folder, not just manifest-listed raws")
    p_sync.add_argument("--quick", action="store_true", help="compare by size+modtime instead of MD5 (faster, but misses same-size re-exports)")
    p_sync.set_defaults(func=cmd_sync)

    p_fetch = add("fetch", help="yt-dlp a URL into raw/ + append a manifest entry")
    p_fetch.add_argument("url")
    p_fetch.add_argument("--name", required=True, help="target file name (\".mp4\" appended if missing)")
    p_fetch.add_argument("--profile", default="remux")
    p_fetch.add_argument("--used-in", nargs="*", default=[], dest="used_in", metavar="LNN")
    p_fetch.add_argument("--force", action="store_true", help="re-download even if raw exists")
    p_fetch.set_defaults(func=cmd_fetch)

    p_enc = add("encode", help="ffmpeg raw -> web")
    p_enc.add_argument("--force", action="store_true", help="re-encode even if up to date")
    p_enc.add_argument("--only", nargs="+", metavar="NAME", help="limit to named file(s)")
    p_enc.set_defaults(func=cmd_encode)

    p_pub = add("publish", help="upload web files to GH Release")
    p_pub.add_argument("--dry-run", action="store_true")
    p_pub.add_argument("--only", nargs="+", metavar="NAME", help="limit to named file(s)")
    p_pub.add_argument("--force", action="store_true", help="re-upload even if remote size matches local")
    p_pub.add_argument("--prune", action="store_true", help="delete release assets not in manifest (needs --yes, or --dry-run)")
    p_pub.add_argument("--yes", action="store_true", help="confirm that --prune may delete")
    p_pub.set_defaults(func=cmd_publish)

    p_pull = add("pull", help="download web files from GH Release")
    p_pull.add_argument("--dry-run", action="store_true")
    p_pull.add_argument("--only", nargs="+", metavar="NAME", help="limit to named file(s)")
    p_pull.add_argument("--force", action="store_true", help="re-download even if local size matches")
    p_pull.add_argument("--prune", action="store_true", help="delete local files not in manifest (shared-registry names are protected; needs --yes, or --dry-run)")
    p_pull.add_argument("--yes", action="store_true", help="confirm that --prune may delete")
    p_pull.add_argument("--include-shared", action="store_true", help="also pull deck-referenced shared clips (offline/portable builds)")
    p_pull.set_defaults(func=cmd_pull)

    p_chk = add("check", help="sanity-check manifest vs raw/web/slides")
    p_chk.set_defaults(func=cmd_check)

    p_ehq = add("encode-hq", help="ffmpeg raw -> videos/hq/ (visually-lossless venue masters)")
    p_ehq.add_argument("--force", action="store_true", help="re-encode even if up to date")
    p_ehq.add_argument("--only", nargs="+", metavar="NAME", help="limit to named file(s)")
    p_ehq.set_defaults(func=cmd_encode_hq)

    p_phq = add("publish-hq", help="upload HQ files to the parallel GH Release")
    p_phq.add_argument("--dry-run", action="store_true")
    p_phq.add_argument("--only", nargs="+", metavar="NAME", help="limit to named file(s)")
    p_phq.add_argument("--force", action="store_true", help="re-upload even if remote size matches local")
    p_phq.add_argument("--prune", action="store_true", help="delete release assets not in manifest (needs --yes, or --dry-run)")
    p_phq.add_argument("--yes", action="store_true", help="confirm that --prune may delete")
    p_phq.set_defaults(func=cmd_publish_hq)

    p_pull_hq = add("pull-hq", help="download HQ files from the parallel GH Release")
    p_pull_hq.add_argument("--dry-run", action="store_true")
    p_pull_hq.add_argument("--only", nargs="+", metavar="NAME", help="limit to named file(s)")
    p_pull_hq.add_argument("--force", action="store_true", help="re-download even if local size matches")
    p_pull_hq.add_argument("--prune", action="store_true", help="delete local files not in manifest (shared-registry names are protected; needs --yes, or --dry-run)")
    p_pull_hq.add_argument("--yes", action="store_true", help="confirm that --prune may delete")
    p_pull_hq.add_argument("--include-shared", action="store_true", help="also pull deck-referenced shared HQ masters (offline/venue builds)")
    p_pull_hq.set_defaults(func=cmd_pull_hq)

    p_shared = add("shared-check", help="sanity-check the shared registry (run from the package repo)")
    p_shared.set_defaults(func=cmd_shared_check)

    p_frames = add("frames", help="frame strips for the `dust` transition -> public/video-frames/")
    p_frames.add_argument("--only", nargs="+", metavar="NAME", help="limit to named clip(s)")
    p_frames.add_argument("--all", action="store_true", help="every referenced clip, not only those using the dust transition")
    p_frames.add_argument("--force", action="store_true", help="cut again even if the strip is up to date")
    p_frames.add_argument("--prune", action="store_true", help="drop strips of clips the deck no longer references")
    p_frames.add_argument("--dry-run", action="store_true")
    p_frames.add_argument("--interval", type=float, default=FRAMES_INTERVAL_S, help=f"seconds between tiles (default {FRAMES_INTERVAL_S:g}; widened for long clips)")
    p_frames.add_argument("--max-tiles", type=int, default=FRAMES_MAX_TILES, dest="max_tiles", help=f"tiles per strip at most (default {FRAMES_MAX_TILES})")
    p_frames.add_argument("--tile-width", type=int, default=FRAMES_TILE_W, dest="tile_width", help=f"tile width in px (default {FRAMES_TILE_W})")
    p_frames.add_argument("--quality", type=int, default=5, help="JPEG quality, ffmpeg -q:v 2 (best) .. 31 (default 5)")
    p_frames.add_argument("--jobs", type=int, default=3, help="clips cut at once (default 3)")
    p_frames.set_defaults(func=cmd_frames)

    p_clean = add("clean", help="delete local video files that are verified recoverable (dry-run by default)")
    p_clean.add_argument("--yes", action="store_true", help="actually delete (default is a dry run)")
    p_clean.add_argument("--raw", action="store_true", help="restrict to the raw tier")
    p_clean.add_argument("--hq", action="store_true", help="restrict to the HQ tier")
    p_clean.add_argument("--web", action="store_true", help="include the web tier (opt-in)")
    p_clean.add_argument("--include-shared", action="store_true", help="also clean local copies of shared-registry clips")
    p_clean.set_defaults(func=cmd_clean)

    p_pf = add("preflight", help="venue lint: probe what each deck ref will actually serve")
    p_pf.add_argument("--only", nargs="+", metavar="NAME", help="limit to named clip(s)")
    p_pf.add_argument("--no-loudness", action="store_true", help="skip the R128 loudness measurement (much faster)")
    p_pf.add_argument("--max-mbps", type=float, default=None, help="bitrate ceiling to flag (default 10, or [defaults].preflight_max_mbps)")
    p_pf.add_argument("--mode", choices=CHAIN_MODES, default="local-first",
                      help="the player's order: local-first (dev, venue bundle; default) or remote-first (a deployed deck)")
    p_pf.add_argument("--jobs", type=int, default=PREFLIGHT_JOBS, help=f"clips probed at once (default {PREFLIGHT_JOBS})")
    p_pf.set_defaults(func=cmd_preflight)

    p_venue = add("venue", help="one-shot offline bundle: pull --include-shared -> preflight -> build:portable -> zip")
    p_venue.add_argument("--dry-run", action="store_true")
    p_venue.add_argument("--skip-pull", action="store_true", help="assume local web tier is already complete")
    p_venue.set_defaults(func=cmd_venue)

    p_doctor = add("doctor", help="CLI version and install, the ffmpeg in use, gh, rclone, the deck's addon versions")
    p_doctor.set_defaults(func=cmd_doctor)

    p_sheet = add("contact-sheet", help="one PNG of a clip's frames (file or https URL), to judge footage at a glance")
    p_sheet.add_argument("source", help="video file or https URL")
    p_sheet.add_argument("--every", type=float, default=SHEET_EVERY_S, help=f"seconds between frames (default {SHEET_EVERY_S:g}; widened for long clips)")
    p_sheet.add_argument("--out", default=None, help="PNG to write (default: <name>.sheet.png here)")
    p_sheet.add_argument("--max-tiles", type=int, default=FRAMES_MAX_TILES, dest="max_tiles", help=f"frames at most (default {FRAMES_MAX_TILES})")
    p_sheet.add_argument("--cols", type=int, default=SHEET_COLS, help=f"frames per row (default {SHEET_COLS})")
    p_sheet.add_argument("--tile-width", type=int, default=SHEET_TILE_W, dest="tile_width", help=f"frame width in px (default {SHEET_TILE_W})")
    p_sheet.set_defaults(func=cmd_contact_sheet)

    p_build = add("build", help="one-shot: (sync) -> encode -> encode-hq -> check")
    p_build.add_argument("--sync", action="store_true", help="rclone raws from Drive first")
    p_build.add_argument("--all", action="store_true", help="with --sync: mirror the whole remote folder")
    p_build.add_argument("--web-only", action="store_true", help="skip the HQ master encode")
    p_build.add_argument("--force", action="store_true", help="re-encode even if up to date")
    p_build.add_argument("--only", nargs="+", metavar="NAME", help="limit to named file(s)")
    p_build.add_argument("--dry-run", action="store_true", help="dry-run the sync step")
    p_build.add_argument("--quick", action="store_true", help="with --sync: compare by size+modtime instead of MD5")
    p_build.set_defaults(func=cmd_build)

    args = parser.parse_args(args_list)
    as_json = getattr(args, "json", False)
    if as_json and args.cmd not in JSON_COMMANDS:
        parser.error(f"--json is supported by {', '.join(JSON_COMMANDS)}, not {args.cmd}")
    try:
        project = _config.load_project(getattr(args, "project", None))
    except SystemExit as e:
        if args.cmd not in PROJECTLESS:
            return _usage_failure(str(e.code), as_json)
        project = None
    if project is not None:
        _init_paths(project)
    else:
        _forget_project()
    if not as_json:
        return args.func(args)

    error = None
    with contextlib.redirect_stdout(sys.stderr):
        try:
            rc = args.func(args)
        except SystemExit as e:
            if isinstance(e.code, int) or e.code is None:
                rc = e.code or 0
            else:
                rc, error = 1, str(e.code)
                print(error, file=sys.stderr)
    payload = {"command": args.cmd, "ok": rc == 0, "exit": rc, **_report(args)}
    if error:
        payload["error"] = error
    print(json.dumps(payload, indent=2, ensure_ascii=False))
    return rc


if __name__ == "__main__":
    sys.exit(main())
