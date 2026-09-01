"""Behaviour added by the config-layer patch: trim args, gh --repo, fetch parser."""
from pathlib import Path

import pytest

from slidev_videos import config, pipeline
from slidev_videos.pipeline import VideoEntry, _hms, _trim_args


def entry(**kw):
    return VideoEntry(name=kw.pop("name", "x.mp4"),
                      profile=kw.pop("profile", "standard"), used_in=[], **kw)


def test_hms():
    assert _hms("90") == 90.0
    assert _hms("1:30") == 90.0
    assert _hms("0:01:30") == 90.0


def test_trim_args_start_and_end():
    pre, out = _trim_args(entry(trim=("0:20", "1:50")))
    assert pre == ["-ss", "0:20"]
    assert out == ["-t", "90.000"]


def test_trim_args_open_end_and_none():
    assert _trim_args(entry(trim=("0:05", ""))) == (["-ss", "0:05"], [])
    assert _trim_args(entry()) == ([], [])


def test_trim_end_before_start_exits():
    with pytest.raises(SystemExit):
        _trim_args(entry(trim=("2:00", "1:00")))


def make_project(tmp_path, extra_defaults=""):
    (tmp_path / "videos.toml").write_text("[defaults]\n" + extra_defaults, encoding="utf-8")
    (tmp_path / "videos" ).mkdir(exist_ok=True)
    (tmp_path / "videos" / "manifest.toml").write_text("[defaults]\n", encoding="utf-8")
    return config.load_project(str(tmp_path))


def test_init_paths_binds_layout_and_repo(tmp_path):
    p = make_project(tmp_path, 'repo = "Owner/repo"\n')
    pipeline._init_paths(p)
    assert pipeline.TALK == tmp_path
    assert pipeline.WEB_DIR == tmp_path / "public" / "videos"
    assert pipeline.HQ_LINK_DIR == tmp_path / "public" / "videos-hq"
    assert pipeline.GH_REPO_ARGS == ["--repo", "Owner/repo"]


def test_load_manifest_inherits_project_defaults(tmp_path):
    p = make_project(tmp_path, 'max_size_mb = 123\n')
    pipeline._init_paths(p)
    defaults, videos = pipeline.load_manifest()
    assert defaults["max_size_mb"] == 123
    assert videos == []


def test_shared_manifest_reads_bundled_registry(tmp_path):
    p = make_project(tmp_path)   # default shared source
    pipeline._init_paths(p)
    shared_defaults, shared_videos = pipeline.load_shared_manifest()
    assert shared_defaults["release_tag"] == "videos-shared"
    assert shared_defaults["repo"] == "MindaugasSarpis/slidev-videos"
    assert shared_videos == []   # stub registry has no entries yet


def test_shared_disabled(tmp_path):
    p = make_project(tmp_path, "shared = false\n")
    pipeline._init_paths(p)
    assert pipeline.load_shared_manifest() == ({}, [])


def test_repo_threading_signatures():
    import inspect
    assert "repo" in inspect.signature(pipeline._remote_assets).parameters
    assert "repo" in inspect.signature(pipeline._remote_asset_sizes).parameters
    assert "repo" in inspect.signature(pipeline._pull_tier).parameters


def test_parser_has_fetch_and_project_and_build_quick(capsys):
    with pytest.raises(SystemExit):
        pipeline.main(["--help"])
    out = capsys.readouterr().out
    assert "fetch" in out and "--project" in out
    with pytest.raises(SystemExit):
        pipeline.main(["build", "--help"])
    assert "--quick" in capsys.readouterr().out
