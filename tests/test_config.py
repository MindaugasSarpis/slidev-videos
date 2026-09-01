"""config.py: videos.toml discovery, [project] paths, [defaults] merge chain."""
import subprocess
from pathlib import Path

import pytest

from slidev_videos import config


def write(p: Path, text: str) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


def test_find_project_walks_up(tmp_path):
    write(tmp_path / "videos.toml", "[defaults]\n")
    deep = tmp_path / "a" / "b"
    deep.mkdir(parents=True)
    assert config.find_project(deep) == tmp_path


def test_find_project_missing_raises_systemexit(tmp_path):
    with pytest.raises(SystemExit) as e:
        config.find_project(tmp_path)
    assert "videos.toml" in str(e.value)


def test_project_paths_default_to_outreach_talk_layout(tmp_path):
    write(tmp_path / "videos.toml", "[defaults]\n")
    p = config.load_project(str(tmp_path))
    assert p.slides_dir == tmp_path
    assert p.public_dir == tmp_path / "public"
    assert p.raw_dir == tmp_path / "videos" / "raw"
    assert p.hq_dir == tmp_path / "videos" / "hq"
    assert p.manifest == tmp_path / "videos" / "manifest.toml"


def test_project_paths_overridable(tmp_path):
    write(tmp_path / "videos.toml", """
[project]
slides_dir = "lectures/content/slides"
public_dir = "lectures/content/public"
""")
    p = config.load_project(str(tmp_path))
    assert p.slides_dir == tmp_path / "lectures" / "content" / "slides"
    assert p.public_dir == tmp_path / "lectures" / "content" / "public"
    assert p.raw_dir == tmp_path / "videos" / "raw"  # untouched default


def test_defaults_merge_nearest_wins(tmp_path):
    write(tmp_path / "videos.toml", '[defaults]\nmax_size_mb = 100\nweb_long_edge_px = 1920\n')
    talk = tmp_path / "talks" / "T1"
    write(talk / "videos.toml", '[defaults]\nmax_size_mb = 300\n')
    p = config.load_project(str(talk))
    assert p.root == talk
    assert p.defaults["max_size_mb"] == 300          # nearest wins
    assert p.defaults["web_long_edge_px"] == 1920    # inherited from ancestor


def test_repo_from_git_remote(tmp_path):
    write(tmp_path / "videos.toml", "[defaults]\n")
    subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
    subprocess.run(["git", "-C", str(tmp_path), "remote", "add", "origin",
                    "https://github.com/SomeOwner/some-repo.git"], check=True)
    p = config.load_project(str(tmp_path))
    assert p.defaults["repo"] == "SomeOwner/some-repo"


def test_repo_explicit_beats_git(tmp_path):
    write(tmp_path / "videos.toml", '[defaults]\nrepo = "Explicit/repo"\n')
    p = config.load_project(str(tmp_path))
    assert p.defaults["repo"] == "Explicit/repo"


def test_shared_default_and_parse(tmp_path):
    write(tmp_path / "videos.toml", "[defaults]\n")
    p = config.load_project(str(tmp_path))
    assert p.defaults["shared"] == "MindaugasSarpis/slidev-videos@videos-shared"
    assert config.parse_shared(p.defaults["shared"]) == (
        "MindaugasSarpis/slidev-videos", "videos-shared")
    assert config.parse_shared(False) is None
    assert config.parse_shared("") is None


def test_shared_disable(tmp_path):
    write(tmp_path / "videos.toml", "[defaults]\nshared = false\n")
    p = config.load_project(str(tmp_path))
    assert config.parse_shared(p.defaults["shared"]) is None


def test_shared_registry_path_is_bundled_file():
    path = config.shared_registry_path()
    assert path.name == "shared.toml"
    assert path.is_file()
