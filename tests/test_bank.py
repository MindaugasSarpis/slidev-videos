"""bank_manifest_names: a raw bank shared by sibling projects is not this project's orphans."""
from pathlib import Path

from slidev_videos import pipeline


def write(p: Path, text: str) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


def test_collects_sibling_manifests_in_a_monorepo_bank(tmp_path):
    write(tmp_path / "videos.toml", "[defaults]\n")
    for talk, clip in [("a", "x.mp4"), ("b", "y.mp4")]:
        write(tmp_path / "talks" / talk / "videos.toml", '[project]\nraw_dir = "../../videos/raw"\n')
        write(tmp_path / "talks" / talk / "videos" / "manifest.toml", f'[[videos]]\nname = "{clip}"\nprofile = "standard"\n')
    write(tmp_path / "node_modules" / "pkg" / "videos.toml", "[defaults]\n")   # deps are skipped
    write(tmp_path / "node_modules" / "pkg" / "videos" / "manifest.toml", '[[videos]]\nname = "dep.mp4"\nprofile = "standard"\n')
    (tmp_path / "videos" / "raw").mkdir(parents=True)
    names = pipeline.bank_manifest_names(tmp_path / "videos" / "raw", tmp_path / "talks" / "a")
    assert names == {"x.mp4", "y.mp4"}


def test_empty_when_bank_is_inside_the_project(tmp_path):
    write(tmp_path / "videos.toml", "[defaults]\n")
    (tmp_path / "videos" / "raw").mkdir(parents=True)
    assert pipeline.bank_manifest_names(tmp_path / "videos" / "raw", tmp_path) == set()
