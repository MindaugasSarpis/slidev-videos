"""Which ffmpeg and ffprobe the CLI runs.

A machine often carries more than one build. The static Linux builds
(johnvansickle.com, often dropped into ~/.local/bin) crash with SIGSEGV as
soon as they look up a host name, so every HTTPS input fails, and they have
no NVENC. A conda/micromamba ffmpeg reads release URLs fine. Rather than rely
on PATH order, resolve() looks in, in order:

    $SLIDEV_VIDEOS_FFMPEG_DIR
    videos.toml [defaults].ffmpeg_dir
    $CONDA_PREFIX/bin
    ~/micromamba/envs/*/bin (and miniforge3, mambaforge, miniconda3)
    every directory on PATH that holds an ffmpeg (`which -a`)

A directory counts only when it holds both ffmpeg and ffprobe. Each pair is
probed once, offline, and the verdict is cached in
~/.cache/slidev-videos/tools.json keyed by binary path, size and mtime. A
pair that crashes on the probe is rejected. The first pair that survives
wins, except that among the discovered ones (conda envs and PATH) a build
with NVENC is preferred. When every pair crashes the first one is still
returned: it encodes local files fine, and `frames` downloads what it cannot
read over HTTPS.

The choice of binary never changes how a binary is used: select_encoder()
still asks the chosen ffmpeg whether h264_nvenc really encodes, as before.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path

ENV_DIR = "SLIDEV_VIDEOS_FFMPEG_DIR"
CACHE_VERSION = 1
# Nothing listens on port 9 (discard), so a sound build fails at once with
# "Connection refused". The host must be a name: the static builds crash in
# the name lookup, and an IP address (https://127.0.0.1:9/x) skips it.
HTTPS_PROBE_URL = "https://localhost:9/x"
PROBE_TIMEOUT_S = 15
ENV_ROOTS = ("micromamba", "miniforge3", "mambaforge", "miniconda3")
# Sources the user names on purpose: the first sound one wins outright.
EXPLICIT = ("env", "videos.toml", "conda")


@dataclass
class Candidate:
    dir: str
    source: str             # env | videos.toml | conda | conda-envs | PATH
    ffmpeg: str
    ffprobe: str
    version: str = ""
    https: bool = False     # both binaries survive the offline HTTPS probe
    crashed: bool = False   # a binary died on a signal during the probe
    nvenc: bool = False     # h264_nvenc is compiled in (-encoders)
    note: str = ""


@dataclass
class Tools:
    ffmpeg: str | None
    ffprobe: str | None
    chosen: Candidate | None
    candidates: list[Candidate] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "ffmpeg": self.ffmpeg,
            "ffprobe": self.ffprobe,
            "chosen": asdict(self.chosen) if self.chosen else None,
            "candidates": [asdict(c) for c in self.candidates],
        }


def cache_dir() -> Path:
    base = os.environ.get("XDG_CACHE_HOME") or str(Path.home() / ".cache")
    return Path(base) / "slidev-videos"


def _candidate_dirs(ffmpeg_dir: str | None, project_root: Path | None) -> list[tuple[str, Path]]:
    dirs: list[tuple[str, Path]] = []
    env = os.environ.get(ENV_DIR)
    if env:
        dirs.append(("env", Path(env).expanduser()))
    if ffmpeg_dir:
        p = Path(str(ffmpeg_dir)).expanduser()
        if not p.is_absolute() and project_root is not None:
            p = project_root / p
        dirs.append(("videos.toml", p))
    conda = os.environ.get("CONDA_PREFIX")
    if conda:
        dirs.append(("conda", Path(conda) / "bin"))
    home = Path.home()
    for root in ENV_ROOTS:
        for env_bin in sorted((home / root / "envs").glob("*/bin")):
            dirs.append(("conda-envs", env_bin))
    for entry in os.environ.get("PATH", "").split(os.pathsep):
        if entry and (Path(entry) / "ffmpeg").is_file():
            dirs.append(("PATH", Path(entry)))
    return dirs


def _executable(p: Path) -> bool:
    return p.is_file() and os.access(p, os.X_OK)


def _stamp(p: Path) -> list[int]:
    st = p.stat()
    return [st.st_size, st.st_mtime_ns]


def _crashed(rc: int) -> bool:
    # A signal shows as a negative rc from subprocess, and as 128+N when a
    # shell wrapper sits in between (139 = SIGSEGV, 134 = SIGABRT). Other
    # codes above 128 are ordinary failures: ffmpeg 7+ exits with its error
    # code, e.g. 145 for -ECONNREFUSED.
    return rc < 0 or rc in (134, 139)


def _probe(c: Candidate) -> None:
    """Fill version/https/crashed/nvenc for a candidate by running it."""
    try:
        ver = subprocess.run([c.ffmpeg, "-hide_banner", "-version"],
                             capture_output=True, text=True, timeout=PROBE_TIMEOUT_S)
        first = (ver.stdout or "").splitlines()[:1]
        c.version = first[0].removeprefix("ffmpeg version ").split(" Copyright")[0].strip() if first else ""
        enc = subprocess.run([c.ffmpeg, "-hide_banner", "-encoders"],
                             capture_output=True, text=True, timeout=PROBE_TIMEOUT_S)
        c.nvenc = "h264_nvenc" in (enc.stdout or "")
        rcs = []
        for cmd in ([c.ffprobe, "-v", "error", HTTPS_PROBE_URL],
                    [c.ffmpeg, "-hide_banner", "-nostdin", "-v", "error",
                     "-i", HTTPS_PROBE_URL, "-f", "null", "-"]):
            rcs.append(subprocess.run(cmd, capture_output=True, timeout=PROBE_TIMEOUT_S).returncode)
    except subprocess.TimeoutExpired:
        c.note = "probe timed out"
        return
    except OSError as e:
        c.crashed, c.note = True, f"cannot run: {e}"
        return
    c.crashed = any(_crashed(rc) for rc in rcs)
    c.https = not c.crashed
    if c.crashed:
        c.note = f"crashes on HTTPS input (exit {', '.join(str(rc) for rc in rcs)})"


def _load_cache() -> dict:
    try:
        data = json.loads((cache_dir() / "tools.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    if not isinstance(data, dict) or data.get("version") != CACHE_VERSION:
        return {}
    entries = data.get("entries")
    return entries if isinstance(entries, dict) else {}


def _save_cache(entries: dict) -> None:
    d = cache_dir()
    try:
        d.mkdir(parents=True, exist_ok=True)
        tmp = d / f".tools.{os.getpid()}.json"
        tmp.write_text(json.dumps({"version": CACHE_VERSION, "entries": entries}, indent=2) + "\n",
                       encoding="utf-8")
        os.replace(tmp, d / "tools.json")
    except OSError:
        pass  # a cache that cannot be written only costs a re-probe


def candidates(ffmpeg_dir: str | None = None, project_root: Path | None = None,
               use_cache: bool = True) -> list[Candidate]:
    """Every distinct ffmpeg/ffprobe pair in search order, probed (cached)."""
    cache = _load_cache() if use_cache else {}
    dirty = False
    seen: set[str] = set()
    out: list[Candidate] = []
    for source, d in _candidate_dirs(ffmpeg_dir, project_root):
        ffmpeg, ffprobe = d / "ffmpeg", d / "ffprobe"
        if not (_executable(ffmpeg) and _executable(ffprobe)):
            if source in ("env", "videos.toml"):
                out.append(Candidate(dir=str(d), source=source, ffmpeg=str(ffmpeg), ffprobe=str(ffprobe),
                                     note="no ffmpeg and ffprobe here"))
            continue
        real = os.path.realpath(ffmpeg)
        if real in seen:
            continue
        seen.add(real)
        c = Candidate(dir=str(d), source=source, ffmpeg=str(ffmpeg), ffprobe=str(ffprobe))
        key = [*_stamp(Path(real)), *_stamp(Path(os.path.realpath(ffprobe)))]
        hit = cache.get(real)
        if isinstance(hit, dict) and hit.get("key") == key:
            for k in ("version", "https", "crashed", "nvenc", "note"):
                if k in hit:
                    setattr(c, k, hit[k])
        else:
            _probe(c)
            if c.note != "probe timed out":
                cache[real] = {"key": key, "version": c.version, "https": c.https,
                               "crashed": c.crashed, "nvenc": c.nvenc, "note": c.note}
                dirty = True
        out.append(c)
    if dirty and use_cache:
        _save_cache(cache)
    return out


def choose(cands: list[Candidate]) -> Candidate | None:
    usable = [c for c in cands if _executable(Path(c.ffmpeg)) and _executable(Path(c.ffprobe))]
    # Pairs that passed the probe first; then pairs whose probe timed out
    # (not seen to crash); then anything at all.
    for pool in ([c for c in usable if c.https], [c for c in usable if not c.crashed]):
        explicit = [c for c in pool if c.source in EXPLICIT]
        if explicit:
            return explicit[0]
        if pool:
            return next((c for c in pool if c.nvenc), pool[0])
    return usable[0] if usable else None


def resolve(ffmpeg_dir: str | None = None, project_root: Path | None = None,
            use_cache: bool = True) -> Tools:
    cands = candidates(ffmpeg_dir, project_root, use_cache)
    chosen = choose(cands)
    if chosen is not None and chosen.crashed:
        print(f"  ! every ffmpeg found crashes on HTTPS input; using {chosen.ffmpeg} "
              "(local files only; see `slidev-videos doctor`)", file=sys.stderr)
    return Tools(
        ffmpeg=chosen.ffmpeg if chosen else None,
        ffprobe=chosen.ffprobe if chosen else None,
        chosen=chosen,
        candidates=cands,
    )
