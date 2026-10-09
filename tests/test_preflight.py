"""preflight: the player's chain, silent tracks, the probe cache, --json."""
import json
import os
import threading
import time

import pytest

from slidev_videos import config, pipeline
from slidev_videos.pipeline import hq_refs_in, resolve_chain

H264 = {"streams": [{"codec_type": "video", "codec_name": "h264", "width": 1920, "height": 1080},
                    {"codec_type": "audio", "codec_name": "aac"}],
        "format": {"bit_rate": "4000000", "duration": "10"}}
HEVC_4K = {"streams": [{"codec_type": "video", "codec_name": "hevc", "width": 3840, "height": 2160}],
           "format": {"bit_rate": "40000000", "duration": "10"}}


def make_talk(root, deck):
    (root / "videos").mkdir(parents=True)
    (root / "videos.toml").write_text(
        '[defaults]\nrepo = "o/r"\nrelease_tag = "videos-t"\nshared = false\n', encoding="utf-8")
    (root / "videos" / "manifest.toml").write_text("", encoding="utf-8")
    (root / "public" / "videos").mkdir(parents=True)
    (root / "videos" / "hq").mkdir(parents=True)
    (root / "deck.md").write_text(deck, encoding="utf-8")
    pipeline._init_paths(config.load_project(str(root)))
    return root


def release(*names, version="1"):
    return {n: {"size": 10, "url": f"https://github.com/o/r/releases/download/videos-t/{n}",
                "version": version} for n in names}


@pytest.fixture
def probes(monkeypatch):
    """Record what ffprobe is asked to read; answer from `answers` by file name."""
    seen = []
    answers = {}

    def fake_probe(src):
        seen.append(src)
        return answers.get(os.path.basename(src), H264)
    monkeypatch.setattr(pipeline, "_probe_media", fake_probe)
    monkeypatch.setattr(pipeline, "_measure_loudness", lambda src, *a: {"input_i": "-16.2"})
    monkeypatch.setattr(pipeline, "_release_assets", lambda *a: (None, None))
    return seen, answers


def preflight_json(root, capsys, *argv):
    rc = pipeline.main(["--project", str(root), "preflight", "--json", *argv])
    return rc, json.loads(capsys.readouterr().out)


# --- the chain -----------------------------------------------------------------

def test_hq_comes_from_the_tag_or_the_headmatter():
    assert hq_refs_in('<VideoPlayer src="a.mp4" hq />') == {"a.mp4": True}
    assert hq_refs_in('<VideoPlayer src="a.mp4" />') == {"a.mp4": False}
    assert hq_refs_in('<VideoPlayer src="hq.mp4" />') == {"hq.mp4": False}
    deck = '---\nvideos:\n  repo: o/r\n  hq: true\n---\n<VideoPlayer src="a.mp4" />\n<VideoPlayer :hq="false" src="b.mp4" />\n'
    assert hq_refs_in(deck) == {"a.mp4": True, "b.mp4": False}
    # Vue keeps a static value as a truthy string
    assert hq_refs_in('<VideoPlayer src="a.mp4" hq="false" />') == {"a.mp4": True}


def test_chain_order_follows_the_mode(tmp_path):
    root = make_talk(tmp_path, "")
    for d in ("public/videos", "videos/hq"):
        (root / d / "a.mp4").write_bytes(b"x")
    talk, shared = release("a.mp4"), {"a.mp4": {"url": "https://shared/a.mp4"}}
    local_first = resolve_chain("a.mp4", "local-first", hq=True, talk_assets=talk, shared_assets=shared)
    assert [t for t, _ in local_first] == ["local-hq", "local-web", "talk-release", "shared-release"]
    remote_first = resolve_chain("a.mp4", "remote-first", hq=False, talk_assets=talk, shared_assets=shared)
    assert [t for t, _ in remote_first] == ["talk-release", "shared-release", "local-web"]


def test_one_release_serving_both_steps_is_listed_once(tmp_path):
    make_talk(tmp_path, "")
    talk = release("a.mp4")
    chain = resolve_chain("a.mp4", "remote-first", talk_assets=talk, shared_assets=talk)
    assert [t for t, _ in chain] == ["talk-release"]


def test_an_hq_master_the_deck_does_not_opt_into_is_not_probed(tmp_path, capsys, probes):
    seen, answers = probes
    root = make_talk(tmp_path, '<VideoPlayer src="b.mp4" />\n')
    (root / "public" / "videos" / "b.mp4").write_bytes(b"web")
    (root / "videos" / "hq" / "b.mp4").write_bytes(b"master")
    answers["b.mp4"] = H264
    rc, d = preflight_json(root, capsys, "--no-loudness")
    assert rc == 0
    assert seen == [str(root / "public" / "videos" / "b.mp4")]
    assert d["clips"][0]["tier"] == "local-web"


def test_an_hq_master_the_deck_opts_into_is_probed(tmp_path, capsys, probes):
    seen, answers = probes
    root = make_talk(tmp_path, '<VideoPlayer src="b.mp4" hq />\n')
    (root / "public" / "videos" / "b.mp4").write_bytes(b"web")
    (root / "videos" / "hq" / "b.mp4").write_bytes(b"master")
    answers["b.mp4"] = HEVC_4K
    rc, d = preflight_json(root, capsys, "--no-loudness")
    assert rc == 1
    assert d["clips"][0]["tier"] == "local-hq"
    assert any("hevc" in p for p in d["clips"][0]["problems"])


# --- loudness ------------------------------------------------------------------

def test_a_silent_track_is_a_note_not_a_loudness_miss(tmp_path, capsys, probes, monkeypatch):
    root = make_talk(tmp_path, '<VideoPlayer src="a.mp4" />\n')
    (root / "public" / "videos" / "a.mp4").write_bytes(b"x")
    monkeypatch.setattr(pipeline, "_measure_loudness", lambda src, *a: {"input_i": "-inf"})
    rc, d = preflight_json(root, capsys)
    assert rc == 0
    clip = d["clips"][0]
    assert clip["silent_track"] is True and clip["lufs"] is None
    assert clip["problems"] == []
    assert "silent-loop" in clip["notes"][0]


def test_an_off_target_level_is_still_flagged(tmp_path, capsys, probes, monkeypatch):
    root = make_talk(tmp_path, '<VideoPlayer src="a.mp4" />\n')
    (root / "public" / "videos" / "a.mp4").write_bytes(b"x")
    monkeypatch.setattr(pipeline, "_measure_loudness", lambda src, *a: {"input_i": "-23.0"})
    rc, d = preflight_json(root, capsys)
    assert rc == 1
    assert d["clips"][0]["lufs"] == -23.0
    assert "off target" in d["clips"][0]["problems"][0]


# --- cache, parallelism, counts --------------------------------------------------

def test_a_rerun_reads_the_cache_until_the_file_changes(tmp_path, capsys, probes, monkeypatch):
    monkeypatch.setenv("XDG_CACHE_HOME", str(tmp_path / "cache"))
    seen, _ = probes
    root = make_talk(tmp_path / "talk", '<VideoPlayer src="a.mp4" />\n')
    clip = root / "public" / "videos" / "a.mp4"
    clip.write_bytes(b"x")
    preflight_json(root, capsys)
    assert len(seen) == 1
    rc, d = preflight_json(root, capsys)
    assert len(seen) == 1 and d["from_cache"] == 1
    clip.write_bytes(b"re-encoded")
    preflight_json(root, capsys)
    assert len(seen) == 2


def test_a_replaced_release_asset_is_probed_again(tmp_path, capsys, probes, monkeypatch):
    monkeypatch.setenv("XDG_CACHE_HOME", str(tmp_path / "cache"))
    seen, _ = probes
    root = make_talk(tmp_path / "talk", '<VideoPlayer src="a.mp4" />\n')
    listing = {"v": release("a.mp4", version="1")}
    monkeypatch.setattr(pipeline, "_release_assets", lambda *a: (listing["v"], None))
    preflight_json(root, capsys, "--no-loudness")
    preflight_json(root, capsys, "--no-loudness")
    assert len(seen) == 1
    listing["v"] = release("a.mp4", version="2")
    preflight_json(root, capsys, "--no-loudness")
    assert len(seen) == 2


def test_loudness_is_measured_once_then_cached(tmp_path, capsys, probes, monkeypatch):
    monkeypatch.setenv("XDG_CACHE_HOME", str(tmp_path / "cache"))
    measured = []
    monkeypatch.setattr(pipeline, "_measure_loudness", lambda src, *a: measured.append(src) or {"input_i": "-16.0"})
    root = make_talk(tmp_path / "talk", '<VideoPlayer src="a.mp4" />\n')
    (root / "public" / "videos" / "a.mp4").write_bytes(b"x")
    preflight_json(root, capsys, "--no-loudness")       # probe cached, no loudness yet
    preflight_json(root, capsys)
    preflight_json(root, capsys)
    assert len(measured) == 1


def test_clips_are_probed_at_once_and_reported_in_deck_order(tmp_path, capsys, monkeypatch):
    root = make_talk(tmp_path, "".join(f'<VideoPlayer src="{n}.mp4" />\n' for n in "abcd"))
    for n in "abcd":
        (root / "public" / "videos" / f"{n}.mp4").write_bytes(b"x")
    running, peak, lock = [0], [0], threading.Lock()

    def slow_probe(src):
        with lock:
            running[0] += 1
            peak[0] = max(peak[0], running[0])
        time.sleep(0.3 if src.endswith("a.mp4") else 0.05)
        with lock:
            running[0] -= 1
        return H264
    monkeypatch.setattr(pipeline, "_probe_media", slow_probe)
    monkeypatch.setattr(pipeline, "_release_assets", lambda *a: (None, None))
    rc, d = preflight_json(root, capsys, "--no-loudness", "--jobs", "4")
    assert rc == 0
    assert peak[0] > 1
    assert [c["name"] for c in d["clips"]] == ["a.mp4", "b.mp4", "c.mp4", "d.mp4"]


def test_unreadable_and_unserved_are_counted(tmp_path, capsys, probes):
    _, answers = probes
    root = make_talk(tmp_path, '<VideoPlayer src="a.mp4" />\n<VideoPlayer src="gone.mp4" />\n')
    (root / "public" / "videos" / "a.mp4").write_bytes(b"x")
    answers["a.mp4"] = None
    rc, d = preflight_json(root, capsys, "--no-loudness")
    assert rc == 1
    assert (d["total"], d["flagged"], d["unreadable"], d["not_served"]) == (2, 2, 1, 1)
