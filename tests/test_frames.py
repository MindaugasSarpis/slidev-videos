"""`frames`: the tile plan, which clips arrive as dust, and an end-to-end cut."""
import json
import os
import shutil
import signal
import subprocess
import time

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
def test_a_url_ffprobe_cannot_read_is_downloaded_and_cut(tmp_path, capsys, monkeypatch):
    """Some ffmpeg builds crash on HTTPS; the clip is then fetched and cut locally."""
    make_project(tmp_path, PER_CLIP)
    clip = tmp_path / "elsewhere.mp4"
    make_clip(clip, seconds=5)
    url = "https://example.invalid/releases/download/tag/b.mp4"
    monkeypatch.setattr(pipeline, "_frames_source", lambda name, *_: ("talk-release", url))
    real_probe = pipeline._probe_media
    monkeypatch.setattr(pipeline, "_probe_media", lambda src: None if src.startswith("http") else real_probe(src))
    fetched = []

    def fake_download(u, dest):
        fetched.append(u)
        shutil.copyfile(clip, dest)
        return True
    monkeypatch.setattr(pipeline, "_download", fake_download)

    assert run(tmp_path) == 0
    assert fetched == [url]
    assert "downloaded to cut" in capsys.readouterr().out
    out_dir = tmp_path / "public" / "video-frames"
    assert json.loads((out_dir / "index.json").read_text())["clips"]["b.mp4"]["size"] == [640, 360]
    assert sorted(p.name for p in out_dir.iterdir()) == ["b.mp4.jpg", "index.json"]   # the download is gone


def test_a_failed_download_fails_that_clip(tmp_path, capsys, monkeypatch):
    make_project(tmp_path, PER_CLIP)
    monkeypatch.setattr(pipeline.shutil, "which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(pipeline, "_frames_source", lambda name, *_: ("talk-release", "https://example.invalid/b.mp4"))
    monkeypatch.setattr(pipeline, "_probe_media", lambda src: None)
    monkeypatch.setattr(pipeline, "_download", lambda u, dest: False)
    assert run(tmp_path) == 1
    assert "the download failed" in capsys.readouterr().out


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


# --- scratch downloads, interruption, leftovers ------------------------------

def test_a_download_lands_outside_the_deck_and_is_removed(tmp_path, monkeypatch):
    make_project(tmp_path, PER_CLIP)
    monkeypatch.setattr(pipeline, "_frames_source", lambda name, *_: ("talk-release", "https://example.invalid/b.mp4"))
    monkeypatch.setattr(pipeline, "_probe_media", lambda src: None)
    dests = []
    monkeypatch.setattr(pipeline, "_download", lambda u, dest: dests.append(dest) or False)
    assert run(tmp_path) == 1
    out_dir = tmp_path / "public" / "video-frames"
    assert dests and out_dir not in dests[0].parents and tmp_path not in dests[0].parents
    assert not dests[0].parent.exists()          # the scratch directory went with the run


def test_sigterm_mid_download_cleans_up_and_exits_143(tmp_path, monkeypatch):
    make_project(tmp_path, PER_CLIP)
    monkeypatch.setattr(pipeline, "_frames_source", lambda name, *_: ("talk-release", "https://example.invalid/b.mp4"))
    monkeypatch.setattr(pipeline, "_probe_media", lambda src: None)
    seen = {}

    def interrupted_download(url, dest):
        dest.write_bytes(b"half a clip")
        seen["dest"] = dest
        if signal.getsignal(signal.SIGTERM) in (signal.SIG_DFL, signal.SIG_IGN, None):
            pytest.fail("frames did not install a SIGTERM handler")   # never signal pytest itself
        os.kill(os.getpid(), signal.SIGTERM)
        for _ in range(300):                     # a real download checks _STOP between chunks
            if pipeline._STOP.is_set():
                seen["stopped"] = True
                return False
            time.sleep(0.01)
        return False
    monkeypatch.setattr(pipeline, "_download", interrupted_download)
    previous = signal.getsignal(signal.SIGTERM)
    assert run(tmp_path) == 143
    assert seen.get("stopped")
    assert not seen["dest"].parent.exists()      # scratch directory and the partial download are gone
    assert signal.getsignal(signal.SIGTERM) == previous
    out_dir = tmp_path / "public" / "video-frames"
    assert not [p for p in out_dir.iterdir() if p.name.startswith(".")]


def test_leftovers_of_an_old_interrupted_run_are_swept(tmp_path, monkeypatch):
    make_project(tmp_path, PER_CLIP)
    out_dir = tmp_path / "public" / "video-frames"
    out_dir.mkdir(parents=True)
    (out_dir / ".b.mp4.src").write_bytes(b"x" * 100)
    stale, fresh = out_dir / ".a.mp4.tmp.jpg", out_dir / ".c.mp4.tmp.jpg"
    stale.write_bytes(b"j")
    fresh.write_bytes(b"j")
    os.utime(stale, (time.time() - 7200, time.time() - 7200))
    monkeypatch.setattr(pipeline, "_frames_source", lambda name, *_: None)
    run(tmp_path)
    assert not (out_dir / ".b.mp4.src").exists() and not stale.exists()
    assert fresh.exists()                        # may belong to a run still going


def test_the_strip_is_cut_from_the_web_tier_before_a_local_hq_copy(tmp_path):
    make_project(tmp_path, PER_CLIP)
    (tmp_path / "videos" / "hq").mkdir(parents=True)
    (tmp_path / "videos" / "hq" / "b.mp4").write_bytes(b"untrimmed master")
    talk = {"b.mp4": {"url": "https://github.com/o/r/releases/download/t/b.mp4", "size": 1}}
    assert pipeline._frames_source("b.mp4", talk, None)[0] == "talk-release"
    assert pipeline._frames_source("b.mp4", None, None)[0] == "local-hq"     # last resort
    (tmp_path / "public" / "videos" / "b.mp4").write_bytes(b"web")
    assert pipeline._frames_source("b.mp4", talk, None)[0] == "local-web"


def test_frames_json_lists_each_clip(tmp_path, capsys, monkeypatch):
    make_project(tmp_path, PER_CLIP)
    monkeypatch.setattr(pipeline.shutil, "which", lambda name: None if name == "gh" else f"/usr/bin/{name}")
    assert pipeline.main(["--project", str(tmp_path), "frames", "--json", "--dry-run", "--all"]) == 1
    d = json.loads(capsys.readouterr().out)
    assert d["command"] == "frames" and d["failed"] == 2
    assert {c["name"]: c["status"] for c in d["clips"]} == {"a.mp4": "fail", "b.mp4": "fail"}


# --- contact-sheet -----------------------------------------------------------------

@pytest.mark.skipif(not HAVE_FFMPEG, reason="needs ffmpeg")
def test_contact_sheet_tiles_a_clip_without_a_project(tmp_path, capsys, monkeypatch):
    monkeypatch.chdir(tmp_path)                  # no videos.toml anywhere above
    clip = tmp_path / "clip.mp4"
    make_clip(clip, seconds=9)
    assert pipeline.main(["contact-sheet", str(clip), "--every", "2"]) == 0
    sheet = tmp_path / "clip.sheet.png"
    assert "5 frames, one every 2 s" in capsys.readouterr().out
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", str(sheet)],
        capture_output=True, text=True, check=True,
    )
    assert probe.stdout.strip() == "1624,188"    # 5 tiles of 320x180, 4 px padding and margin


def test_contact_sheet_of_a_missing_file_is_a_usage_error(tmp_path, capsys, monkeypatch):
    monkeypatch.chdir(tmp_path)
    assert pipeline.main(["contact-sheet", str(tmp_path / "nope.mp4")]) == 2
    assert "no such file" in capsys.readouterr().err
