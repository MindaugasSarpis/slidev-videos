"""tools.resolve(): which ffmpeg/ffprobe pair the CLI runs.

Fake builds are shell scripts: a "static" one kills itself with SIGSEGV on
the HTTPS probe, as the real static Linux builds do; a sound one fails the
probe the ordinary way. Every run is logged so the cache can be checked.
"""
import os
import stat
from pathlib import Path

import pytest

from slidev_videos import config, pipeline, tools

SCRIPT = """#!/bin/sh
echo "$(basename "$0") $*" >> "{log}"
case "$*" in
  *-version*) echo "ffmpeg version {version} Copyright (c) the FFmpeg developers"; exit 0 ;;
  *-encoders*) {encoders} exit 0 ;;
  *localhost:9*) {https} ;;
esac
exit 0
"""


def fake_build(d: Path, log: Path, *, crash=False, nvenc=False, version="9.9", https_rc=1) -> Path:
    d.mkdir(parents=True, exist_ok=True)
    https = 'kill -SEGV $$' if crash else f"exit {https_rc}"
    encoders = 'echo " V....D h264_nvenc   NVIDIA NVENC H.264 encoder";' if nvenc else ""
    for name in ("ffmpeg", "ffprobe"):
        p = d / name
        p.write_text(SCRIPT.format(log=log, version=version, encoders=encoders, https=https))
        p.chmod(p.stat().st_mode | stat.S_IXUSR)
    return d


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


def runs(log: Path) -> list[str]:
    return log.read_text().splitlines() if log.exists() else []


def test_static_build_first_on_path_is_passed_over(machine, tmp_path, monkeypatch):
    log = tmp_path / "log"
    static = fake_build(tmp_path / "local-bin", log, crash=True, version="7.0.2-static")
    env = fake_build(machine / "micromamba" / "envs" / "talks" / "bin", log, nvenc=True, version="8.0.1")
    monkeypatch.setenv("PATH", str(static))
    t = tools.resolve()
    assert t.ffmpeg == str(env / "ffmpeg")
    assert t.chosen.https and t.chosen.nvenc
    bad = next(c for c in t.candidates if c.dir == str(static))
    assert bad.crashed and not bad.https


def test_an_ordinary_failure_code_is_not_a_crash(machine, tmp_path, monkeypatch):
    # ffmpeg 7+ exits with its error code: 145 is -ECONNREFUSED, not a signal
    good = fake_build(tmp_path / "bin", tmp_path / "log", https_rc=145)
    monkeypatch.setenv("PATH", str(good))
    t = tools.resolve()
    assert t.ffmpeg == str(good / "ffmpeg")
    assert t.chosen.https and not t.chosen.crashed


def test_a_shell_reported_segfault_is_a_crash(machine, tmp_path, monkeypatch):
    bad = fake_build(tmp_path / "bad", tmp_path / "log", https_rc=139)
    good = fake_build(tmp_path / "good", tmp_path / "log")
    monkeypatch.setenv("PATH", os.pathsep.join([str(bad), str(good)]))
    assert tools.resolve().ffmpeg == str(good / "ffmpeg")


def test_the_env_dir_wins_over_a_discovered_nvenc_build(machine, tmp_path, monkeypatch):
    log = tmp_path / "log"
    mine = fake_build(tmp_path / "mine", log)
    fake_build(machine / "micromamba" / "envs" / "talks" / "bin", log, nvenc=True)
    monkeypatch.setenv(tools.ENV_DIR, str(mine))
    t = tools.resolve()
    assert t.ffmpeg == str(mine / "ffmpeg")
    assert t.chosen.source == "env"


def test_a_crashing_env_dir_is_rejected(machine, tmp_path, monkeypatch):
    log = tmp_path / "log"
    mine = fake_build(tmp_path / "mine", log, crash=True)
    other = fake_build(tmp_path / "other", log)
    monkeypatch.setenv(tools.ENV_DIR, str(mine))
    monkeypatch.setenv("PATH", str(other))
    assert tools.resolve().ffmpeg == str(other / "ffmpeg")


def test_discovered_builds_prefer_nvenc(machine, tmp_path, monkeypatch):
    log = tmp_path / "log"
    plain = fake_build(tmp_path / "plain", log)
    gpu = fake_build(tmp_path / "gpu", log, nvenc=True)
    monkeypatch.setenv("PATH", os.pathsep.join([str(plain), str(gpu)]))
    assert tools.resolve().ffmpeg == str(gpu / "ffmpeg")


def test_when_every_build_crashes_the_first_is_still_used(machine, tmp_path, monkeypatch, capsys):
    static = fake_build(tmp_path / "static", tmp_path / "log", crash=True)
    monkeypatch.setenv("PATH", str(static))
    t = tools.resolve()
    assert t.ffmpeg == str(static / "ffmpeg")
    assert t.chosen.crashed
    assert "crashes on HTTPS" in capsys.readouterr().err


def test_a_directory_without_ffprobe_is_skipped(machine, tmp_path, monkeypatch):
    half = fake_build(tmp_path / "half", tmp_path / "log")
    (half / "ffprobe").unlink()
    monkeypatch.setenv("PATH", str(half))
    t = tools.resolve()
    assert t.ffmpeg is None and t.chosen is None


def test_the_verdict_is_cached_until_the_binary_changes(machine, tmp_path, monkeypatch):
    log = tmp_path / "log"
    b = fake_build(tmp_path / "bin", log)
    monkeypatch.setenv("PATH", str(b))
    tools.resolve()
    first = len(runs(log))
    assert first > 0
    assert (tmp_path / "cache" / "slidev-videos" / "tools.json").is_file()
    tools.resolve()
    assert len(runs(log)) == first          # cache hit: nothing ran
    st = (b / "ffmpeg").stat()
    os.utime(b / "ffmpeg", ns=(st.st_atime_ns, st.st_mtime_ns + 1_000_000_000))
    tools.resolve()
    assert len(runs(log)) > first           # new mtime: probed again


def test_videos_toml_ffmpeg_dir_feeds_the_pipeline(machine, tmp_path, monkeypatch):
    mine = fake_build(tmp_path / "mine", tmp_path / "log")
    fake_build(tmp_path / "other", tmp_path / "log", nvenc=True)
    monkeypatch.setenv("PATH", str(tmp_path / "other"))
    talk = tmp_path / "talk"
    (talk / "videos").mkdir(parents=True)
    (talk / "videos.toml").write_text(f'[defaults]\nffmpeg_dir = "{mine}"\n', encoding="utf-8")
    (talk / "videos" / "manifest.toml").write_text("", encoding="utf-8")
    pipeline._init_paths(config.load_project(str(talk)))
    assert pipeline._ffmpeg() == str(mine / "ffmpeg")
    assert pipeline._ffprobe() == str(mine / "ffprobe")
    assert pipeline._tools().chosen.source == "videos.toml"


def test_encoder_choice_still_asks_the_chosen_binary(machine, tmp_path, monkeypatch):
    # resolve() picks the binary; whether it encodes h264_nvenc is still the
    # runtime test encode on that binary, exactly as before
    log = tmp_path / "log"
    gpu = fake_build(tmp_path / "gpu", log, nvenc=True)
    monkeypatch.setenv("PATH", str(gpu))
    talk = tmp_path / "talk"
    (talk / "videos").mkdir(parents=True)
    (talk / "videos.toml").write_text("[defaults]\n", encoding="utf-8")
    (talk / "videos" / "manifest.toml").write_text("", encoding="utf-8")
    pipeline._init_paths(config.load_project(str(talk)))
    pipeline._encodes_with.cache_clear()
    assert pipeline.select_encoder(None) == "nvenc"     # the fake exits 0 on the test encode
    assert any("-c:v h264_nvenc" in line for line in runs(log))
