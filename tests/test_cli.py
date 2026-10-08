"""The command line itself: --version, --project/--json anywhere, exit codes."""
import json
import types

import pytest

from slidev_videos import pipeline


def make_talk(root, deck='<VideoPlayer src="a.mp4" />\n'):
    (root / "videos").mkdir(parents=True)
    (root / "videos.toml").write_text('[defaults]\nrepo = "o/r"\nshared = false\n', encoding="utf-8")
    (root / "videos" / "manifest.toml").write_text(
        '[[videos]]\nname = "a.mp4"\nprofile = "standard"\n', encoding="utf-8")
    (root / "public" / "videos").mkdir(parents=True)
    (root / "public" / "videos" / "a.mp4").write_bytes(b"x")
    (root / "deck.md").write_text(deck, encoding="utf-8")
    return root


def test_version_prints_the_installed_version_and_path(capsys):
    with pytest.raises(SystemExit) as e:
        pipeline.main(["--version"])
    assert e.value.code == 0
    out = capsys.readouterr().out
    assert out.startswith(f"slidev-videos {pipeline.cli_version()} (")
    assert "slidev_videos" in out


@pytest.mark.parametrize("argv", [
    ["--project", "{root}", "check"],
    ["check", "--project", "{root}"],
])
def test_project_before_or_after_the_subcommand(tmp_path, capsys, argv):
    root = make_talk(tmp_path)
    assert pipeline.main([a.format(root=root) for a in argv]) == 0
    assert "OK: 1 talk-owned" in capsys.readouterr().out


@pytest.mark.parametrize("argv", [
    ["--json", "--project", "{root}", "check"],
    ["--project", "{root}", "check", "--json"],
])
def test_check_json_is_one_object_on_stdout(tmp_path, capsys, argv):
    root = make_talk(tmp_path, deck='<VideoPlayer src="a.mp4" />\n<VideoPlayer src="ghost.mp4" />\n')
    assert pipeline.main([a.format(root=root) for a in argv]) == 1
    cap = capsys.readouterr()
    data = json.loads(cap.out)
    assert data["command"] == "check" and data["exit"] == 1 and data["ok"] is False
    assert data["problems"] == [{"kind": "UNKNOWN REF", "name": "ghost.mp4", "detail": "(in deck.md)"}]
    assert "UNKNOWN REF:      ghost.mp4" in cap.err      # the text still goes somewhere


def test_json_on_a_command_without_it_is_a_usage_error(tmp_path, capsys):
    root = make_talk(tmp_path)
    with pytest.raises(SystemExit) as e:
        pipeline.main(["--project", str(root), "--json", "encode"])
    assert e.value.code == 2
    assert json.loads(capsys.readouterr().out) == {
        "ok": False, "exit": 2,
        "error": "--json is supported by check, preflight, frames, doctor, not encode"}


def test_a_usage_error_under_json_is_json(capsys):
    with pytest.raises(SystemExit) as e:
        pipeline.main(["--json", "preflight", "--no-such-flag"])
    assert e.value.code == 2
    assert json.loads(capsys.readouterr().out)["exit"] == 2


def test_no_project_is_exit_2(tmp_path, capsys, monkeypatch):
    monkeypatch.chdir(tmp_path)
    assert pipeline.main(["check"]) == 2
    assert "no videos.toml" in capsys.readouterr().err
    assert pipeline.main(["check", "--json"]) == 2
    assert json.loads(capsys.readouterr().out)["exit"] == 2


def test_leading_command_skips_global_options():
    assert pipeline._leading_command(["--project", "x", "--json", "discover", "lhc"]) == (3, "discover")
    assert pipeline._leading_command(["discover"]) == (0, "discover")
    assert pipeline._leading_command(["--json"]) == (1, None)


@pytest.mark.parametrize("tty", [True, False])
def test_rclone_progress_only_on_a_terminal(tmp_path, monkeypatch, tty):
    root = make_talk(tmp_path)
    (root / "videos.toml").write_text(
        '[defaults]\nrepo = "o/r"\nshared = false\nsource_remote = "gdrive:raws"\n', encoding="utf-8")
    calls = []
    monkeypatch.setattr(pipeline.subprocess, "call", lambda cmd, *a, **k: calls.append(cmd) or 0)
    monkeypatch.setattr(pipeline.shutil, "which", lambda name: f"/usr/bin/{name}")
    monkeypatch.setattr(pipeline.sys, "stdout", types.SimpleNamespace(isatty=lambda: tty, write=lambda s: None, flush=lambda: None))
    assert pipeline.main(["--project", str(root), "sync"]) == 0
    assert ("--progress" in calls[0]) is tty


# --- venue ---------------------------------------------------------------------

def test_venue_builds_local_first(tmp_path, monkeypatch, capsys):
    root = make_talk(tmp_path)
    builds = []

    def fake_call(cmd, *a, **k):
        builds.append((cmd, k.get("env", {})))
        (root / "dist-portable").mkdir(exist_ok=True)
        (root / "dist-portable" / "index.html").write_text("<html></html>")
        return 0
    monkeypatch.setattr(pipeline.subprocess, "call", fake_call)
    monkeypatch.setattr(pipeline, "_release_assets", lambda *a: (None, None))
    monkeypatch.setattr(pipeline, "_probe_media", lambda src: None)
    assert pipeline.main(["--project", str(root), "venue", "--skip-pull"]) == 0
    (cmd, env), = builds
    assert cmd == ["pnpm", "build:portable"]
    assert env["VITE_VIDEOS_LOCAL_FIRST"] == "1"
    assert "PATH" in env                      # the rest of the environment is kept
    assert (root / f"{root.name}-venue.zip").is_file()


def test_venue_dry_run_names_the_variable(tmp_path, monkeypatch, capsys):
    root = make_talk(tmp_path)
    monkeypatch.setattr(pipeline, "_release_assets", lambda *a: (None, None))
    monkeypatch.setattr(pipeline, "_probe_media", lambda src: None)
    assert pipeline.main(["--project", str(root), "venue", "--skip-pull", "--dry-run"]) == 0
    assert "VITE_VIDEOS_LOCAL_FIRST=1 pnpm build:portable" in capsys.readouterr().out
