"""Generated entries (`generated = true`): the stage's recorded plates, which have no raw.

`talk record --plates` writes them into the manifest. sync, encode and fetch
leave them alone and check accepts them unreferenced in the deck; publish,
pull and preflight carry them like any clip, so the release, the venue
bundle and the preflight see what the live fallback will play.
"""
import json
import types

import pytest

from slidev_videos import config, pipeline
from test_prune_only import FakeGh, fake, run  # noqa: F401  (fake is a fixture)

MANIFEST = '''[[videos]]
name = "a.mp4"
profile = "standard"

# >>> plates
[[videos]]
name      = "03-plate.mp4"
profile   = "remux"
used_in   = ["slide 3"]
generated = true
# <<< plates
'''
H264 = {"streams": [{"codec_type": "video", "codec_name": "h264", "width": 1920, "height": 1080}],
        "format": {"bit_rate": "2000000", "duration": "26"}}


def make_talk(root, local=("a.mp4", "03-plate.mp4"), raw=("a.mp4",), source_remote=False):
    (root / "videos" / "raw").mkdir(parents=True)
    (root / "public" / "videos").mkdir(parents=True)
    (root / "videos.toml").write_text(
        '[defaults]\nrepo = "o/r"\nrelease_tag = "videos-t"\nshared = false\n'
        + ('source_remote = "gdrive:raw"\n' if source_remote else ""), encoding="utf-8")
    (root / "videos" / "manifest.toml").write_text(MANIFEST, encoding="utf-8")
    for n in local:
        (root / "public" / "videos" / n).write_bytes(b"x" * 10)
    for n in raw:
        (root / "videos" / "raw" / n).write_bytes(b"r" * 20)
    (root / "deck.md").write_text('<VideoPlayer src="a.mp4" />\n', encoding="utf-8")
    pipeline._init_paths(config.load_project(str(root)))
    return root


def test_the_manifest_reads_generated(tmp_path):
    make_talk(tmp_path)
    _, videos = pipeline.load_manifest()
    assert [(v.name, v.generated) for v in videos] == [("a.mp4", False), ("03-plate.mp4", True)]


def test_encode_leaves_a_generated_entry_alone(tmp_path, monkeypatch, capsys):
    root = make_talk(tmp_path)
    seen = []
    monkeypatch.setattr(pipeline, "_tools", lambda: types.SimpleNamespace(ffmpeg="ffmpeg", ffprobe="ffprobe"))
    monkeypatch.setattr(pipeline, "_encode_one", lambda v, force, edge: (seen.append(v.name), (v, "skipped", 20, 10))[1])
    assert run(root, "encode") == 0
    assert seen == ["a.mp4"]
    assert "~ 03-plate.mp4: generated (recorded by the stage), nothing to encode" in capsys.readouterr().out
    assert run(root, "encode", "--only", "03-plate.mp4") == 0      # named alone: nothing to do, not an error
    assert seen == ["a.mp4"]
    assert run(root, "encode", "--only", "nothing.mp4") == 2


def test_sync_never_asks_the_remote_for_a_generated_raw(tmp_path, monkeypatch):
    root = make_talk(tmp_path, source_remote=True)
    calls = []
    monkeypatch.setattr(pipeline.shutil, "which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(pipeline.subprocess, "call", lambda cmd, *a, **k: (calls.append(cmd), 0)[1])
    assert run(root, "sync", "--dry-run") == 0
    (cmd,) = calls
    assert "/a.mp4" in cmd and "/03-plate.mp4" not in cmd


def test_fetch_refuses_a_generated_name(tmp_path, monkeypatch, capsys):
    root = make_talk(tmp_path)
    monkeypatch.setattr(pipeline.shutil, "which", lambda name: f"/usr/bin/{name}")
    assert run(root, "fetch", "https://example.org/x", "--name", "03-plate") == 2
    assert "generated" in capsys.readouterr().err
    assert (root / "videos" / "manifest.toml").read_text() == MANIFEST


def test_check_accepts_a_generated_entry_the_deck_never_references(tmp_path, capsys):
    root = make_talk(tmp_path)
    assert run(root, "check") == 0
    assert "UNUSED MANIFEST" not in capsys.readouterr().out


def test_check_names_the_recorder_for_a_plate_that_is_nowhere(tmp_path, monkeypatch, capsys):
    root = make_talk(tmp_path, local=("a.mp4",))
    monkeypatch.setattr(pipeline.shutil, "which", lambda name: None)      # no gh: no release to look at
    assert run(root, "check") == 1
    out = capsys.readouterr().out
    assert "MISSING LOCAL:    03-plate.mp4" in out and "talk record" in out and "videos:sync" not in out


def test_check_does_not_miss_a_raw_for_a_generated_entry(tmp_path, capsys):
    root = make_talk(tmp_path)
    assert run(root, "check") == 0
    assert "raw not synced" not in capsys.readouterr().out


def test_publish_only_carries_a_generated_plate(tmp_path, fake):
    root = make_talk(tmp_path)
    gh = fake({"a.mp4": 10})
    assert run(root, "publish", "--only", "03-plate.mp4") == 0
    (upload,) = gh.gh("upload")
    assert upload[-2:] == [str(root / "public" / "videos" / "03-plate.mp4"), "--clobber"]


def test_pull_downloads_a_generated_plate(tmp_path, fake):
    root = make_talk(tmp_path, local=("a.mp4",))
    gh = fake({"a.mp4": 10, "03-plate.mp4": 10})
    assert run(root, "pull") == 0
    (download,) = gh.gh("download")
    assert "03-plate.mp4" in download


def test_preflight_probes_the_plates_too(tmp_path, monkeypatch, capsys):
    root = make_talk(tmp_path)
    monkeypatch.setattr(pipeline, "_probe_media", lambda src: H264)
    monkeypatch.setattr(pipeline, "_release_assets", lambda *a: (None, None))
    assert pipeline.main(["--project", str(root), "preflight", "--json", "--no-loudness"]) == 0
    report = json.loads(capsys.readouterr().out)
    assert report["total"] == 2 and [c["name"] for c in report["clips"]] == ["03-plate.mp4", "a.mp4"]


def test_frames_has_nothing_to_cut_for_a_plate(tmp_path, capsys):
    root = make_talk(tmp_path)
    assert run(root, "frames", "--only", "03-plate.mp4") == 0
    assert "not referenced by the deck" in capsys.readouterr().out
