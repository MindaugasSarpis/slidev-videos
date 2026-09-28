"""`frames`: the tile plan, which clips arrive as dust, and an end-to-end cut."""
import json
import shutil
import subprocess

import pytest

from slidev_videos import config, pipeline
from slidev_videos.pipeline import (
    VIDEO_REF_RE, dust_refs_in, frames_plan, frames_tile_size,
)

HAVE_FFMPEG = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))


# --- the plan ----------------------------------------------------------------

def test_plan_short_clip_keeps_the_interval():
    p = frames_plan(20.0, interval=4, max_tiles=64, cols=8)
    assert p == {"interval": 4.0, "count": 5, "cols": 5, "rows": 1}


def test_plan_counts_only_tiles_that_exist():
    # a tile starting exactly at the end of the clip has no frame to show
    assert frames_plan(12.0, interval=4)["count"] == 3
    assert frames_plan(12.2, interval=4)["count"] == 4


def test_plan_long_clip_widens_the_interval():
    p = frames_plan(3600.0, interval=4, max_tiles=64, cols=8)
    assert p["count"] == 64
    assert p["rows"] == 8
    assert p["interval"] == pytest.approx(3600 / 64, abs=1e-3)
    # the last tile still starts inside the clip
    assert (p["count"] - 1) * p["interval"] < 3600


def test_plan_zero_length_is_one_tile():
    assert frames_plan(0.0) == {"interval": 4.0, "count": 1, "cols": 1, "rows": 1}


def test_plan_rows_cover_the_count():
    for duration in (1, 31, 33, 127, 500):
        p = frames_plan(duration)
        assert p["cols"] * p["rows"] >= p["count"]
        assert p["cols"] * (p["rows"] - 1) < p["count"]


def test_tile_size_keeps_the_aspect_and_is_even():
    assert frames_tile_size(1920, 1080) == (320, 180)
    assert frames_tile_size(1080, 1920)[1] % 2 == 0
    w, h = frames_tile_size(2048, 858)       # 2.39:1
    assert (w, h) == (320, 134)
    assert frames_tile_size(0, 0) == (320, 180)


# --- which clips are dust -------------------------------------------------------

DECK_WIDE = """---
theme: default
videos:
  repo: Owner/repo
  transition: dust
---

<VideoPlayer src="a.mp4" />

---

<VideoPlayer muted src="b.mp4" />

---

<VideoPlayer src="c.mp4" transition="cut" />
"""

PER_CLIP = """---
videos:
  repo: Owner/repo
---

<VideoPlayer src="a.mp4" />

---

<VideoPlayer
  src="b.mp4"
  transition="dust"
/>
"""


def test_deck_wide_dust_covers_every_clip_but_the_opt_outs():
    assert dust_refs_in(DECK_WIDE) == {"a.mp4", "b.mp4"}


def test_per_clip_dust():
    assert dust_refs_in(PER_CLIP) == {"b.mp4"}


def test_a_slide_transition_is_not_a_video_transition():
    # Slidev's own `transition: fade` sits at the top level, not under videos:
    assert dust_refs_in("---\ntransition: dust\nvideos:\n  repo: o/r\n---\n<VideoPlayer src=\"a.mp4\" />\n") == set()


def test_refs_found_in_any_attribute_position():
    text = '<VideoPlayer muted loop src="a.mp4" />\n<VideoPlayer\n  :volume="0.5"\n  src="b.webm"\n/>'
    assert VIDEO_REF_RE.findall(text) == ["a.mp4", "b.webm"]


def test_bound_src_is_not_a_file_name():
    assert VIDEO_REF_RE.findall('<VideoPlayer :src="clip" />') == []
    assert VIDEO_REF_RE.findall('<VideoPlayer v-bind:src="clip" />') == []


# --- end to end -------------------------------------------------------------------

def make_project(tmp_path, deck):
    (tmp_path / "videos.toml").write_text('[defaults]\nrepo = "Owner/repo"\nshared = false\n', encoding="utf-8")
    (tmp_path / "videos").mkdir()
    (tmp_path / "videos" / "manifest.toml").write_text("[defaults]\n", encoding="utf-8")
    (tmp_path / "slides.md").write_text(deck, encoding="utf-8")
    (tmp_path / "public" / "videos").mkdir(parents=True)
    pipeline._init_paths(config.load_project(str(tmp_path)))


def make_clip(path, seconds=9):
    subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
         "-i", f"testsrc2=size=640x360:rate=25:duration={seconds}",
         "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", str(path)],
        check=True,
    )


def run(tmp_path, *argv):
    return pipeline.main(["--project", str(tmp_path), "frames", *argv])


def test_no_dust_clips_is_not_an_error(tmp_path, capsys):
    make_project(tmp_path, PER_CLIP.replace(' transition="dust"', "").replace('  transition="dust"\n', ""))
    assert run(tmp_path) == 0
    assert "no `dust` clips" in capsys.readouterr().out
    assert not (tmp_path / "public" / "video-frames").exists()


def test_missing_source_fails_that_clip(tmp_path, capsys, monkeypatch):
    make_project(tmp_path, DECK_WIDE)
    monkeypatch.setattr(pipeline.shutil, "which", lambda name: None if name == "gh" else f"/usr/bin/{name}")
    assert run(tmp_path) == 1
    out = capsys.readouterr().out
    assert "FAIL  a.mp4" in out and "FAIL  b.mp4" in out


@pytest.mark.skipif(not HAVE_FFMPEG, reason="needs ffmpeg")
def test_cuts_a_strip_and_indexes_it(tmp_path, capsys):
    make_project(tmp_path, PER_CLIP)
    make_clip(tmp_path / "public" / "videos" / "b.mp4", seconds=9)
    assert run(tmp_path) == 0
    out_dir = tmp_path / "public" / "video-frames"
    index = json.loads((out_dir / "index.json").read_text())
    assert index["version"] == 1
    assert list(index["clips"]) == ["b.mp4"]           # a.mp4 does not use dust
    e = index["clips"]["b.mp4"]
    assert e["file"] == "b.mp4.jpg"
    assert e["tile"] == [320, 180]
    assert e["size"] == [640, 360]
    assert (e["count"], e["cols"], e["interval"]) == (3, 3, 4.0)
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0",
         str(out_dir / "b.mp4.jpg")], capture_output=True, text=True, check=True,
    )
    assert probe.stdout.strip() == "960,180"          # 3 tiles in one row

    # a second run has nothing to do
    capsys.readouterr()
    assert run(tmp_path) == 0
    assert "up to date" in capsys.readouterr().out


@pytest.mark.skipif(not HAVE_FFMPEG, reason="needs ffmpeg")
def test_all_and_prune(tmp_path):
    make_project(tmp_path, PER_CLIP)
    for name in ("a.mp4", "b.mp4"):
        make_clip(tmp_path / "public" / "videos" / name, seconds=5)
    assert run(tmp_path, "--all") == 0
    out_dir = tmp_path / "public" / "video-frames"
    assert set(json.loads((out_dir / "index.json").read_text())["clips"]) == {"a.mp4", "b.mp4"}

    # the deck drops a.mp4: --prune takes its strip with it
    (tmp_path / "slides.md").write_text(PER_CLIP.replace('<VideoPlayer src="a.mp4" />', ""), encoding="utf-8")
    assert run(tmp_path, "--prune") == 0
    assert set(json.loads((out_dir / "index.json").read_text())["clips"]) == {"b.mp4"}
    assert not (out_dir / "a.mp4.jpg").exists()
    assert (out_dir / "b.mp4.jpg").exists()


@pytest.mark.skipif(not HAVE_FFMPEG, reason="needs ffmpeg")
def test_check_reports_dust_clips_without_a_strip(tmp_path, capsys):
    make_project(tmp_path, PER_CLIP)
    make_clip(tmp_path / "public" / "videos" / "b.mp4", seconds=5)
    pipeline.main(["--project", str(tmp_path), "check"])
    assert "use the dust transition without a frame strip" in capsys.readouterr().out
    assert run(tmp_path) == 0
    capsys.readouterr()
    pipeline.main(["--project", str(tmp_path), "check"])
    assert "without a frame strip" not in capsys.readouterr().out
