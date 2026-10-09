"""Shared fixtures: private caches, and fake ffmpeg builds for tools.resolve()."""
import stat
from pathlib import Path

import pytest

from slidev_videos import tools


@pytest.fixture(autouse=True, scope="session")
def _private_cache(tmp_path_factory):
    """Keep the CLI's caches (tools.json, probe.json) out of the real ~/.cache."""
    mp = pytest.MonkeyPatch()
    mp.setenv("XDG_CACHE_HOME", str(tmp_path_factory.mktemp("cache")))
    yield
    mp.undo()


# A fake build is a shell script: a "static" one kills itself with SIGSEGV on
# the HTTPS probe, as the real static Linux builds do; a sound one fails the
# probe the ordinary way. Every run is logged, so the cache can be checked.
SCRIPT = """#!/bin/sh
echo "$(basename "$0") $*" >> "{log}"
case "$*" in
  *-version*) echo "ffmpeg version {version} Copyright (c) the FFmpeg developers"; exit 0 ;;
  *-encoders*) {encoders} exit 0 ;;
  *localhost:9*) {https} ;;
esac
exit 0
"""


def _fake_build(d: Path, log: Path, *, crash=False, nvenc=False, version="9.9", https_rc=1) -> Path:
    d.mkdir(parents=True, exist_ok=True)
    https = "kill -SEGV $$" if crash else f"exit {https_rc}"
    encoders = 'echo " V....D h264_nvenc   NVIDIA NVENC H.264 encoder";' if nvenc else ""
    for name in ("ffmpeg", "ffprobe"):
        p = d / name
        p.write_text(SCRIPT.format(log=log, version=version, encoders=encoders, https=https))
        p.chmod(p.stat().st_mode | stat.S_IXUSR)
    return d


@pytest.fixture
def fake_build():
    """fake_build(dir, log, crash=, nvenc=, version=, https_rc=) -> dir"""
    return _fake_build


@pytest.fixture
def machine(tmp_path, monkeypatch):
    """A HOME with no envs, an empty PATH and a private cache."""
    home = tmp_path / "home"
    home.mkdir()
    monkeypatch.setenv("HOME", str(home))
    monkeypatch.setenv("XDG_CACHE_HOME", str(tmp_path / "cache"))
    monkeypatch.setenv("PATH", "")
    monkeypatch.delenv("CONDA_PREFIX", raising=False)
    monkeypatch.delenv(tools.ENV_DIR, raising=False)
    return home
