"""The command line itself: --version, --project/--json anywhere, exit codes."""
import json
import shutil
import types
import zipfile

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
        "error": "--json is supported by check, preflight, frames, doctor, pptx, not encode"}


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

def fake_venue_build(root, builds=None, sidecar=True):
    """A build:portable stand-in: index.html, and the sidecar the venue plugin
    writes when the talk's slidev-addon-videos has it."""
    def fake_call(cmd, *a, **k):
        if builds is not None:
            builds.append((cmd, k.get("env", {})))
        dist = root / "dist-portable"
        dist.mkdir(exist_ok=True)
        (dist / "index.html").write_text("<html></html>")
        if sidecar:
            (dist / "venue-assets.js").write_text("window.__venueAssets = {}\n")
        return 0
    return fake_call


def test_venue_builds_local_first_for_file_urls(tmp_path, monkeypatch, capsys):
    """The bundle opens by double-clicking index.html: the build inlines the
    code and carries public/ in a sidecar (VIDEOS_VENUE_FILE, slidev-addon-videos'
    venue plugin), on the hash router (a path router finds no slide in a
    file:// path), and tries its own clips before GitHub."""
    root = make_talk(tmp_path)
    builds = []
    monkeypatch.setattr(pipeline.subprocess, "call", fake_venue_build(root, builds))
    monkeypatch.setattr(pipeline, "_release_assets", lambda *a: (None, None))
    monkeypatch.setattr(pipeline, "_probe_media", lambda src: None)
    assert pipeline.main(["--project", str(root), "venue", "--skip-pull"]) == 0
    (cmd, env), = builds
    assert cmd == ["pnpm", "build:portable", "--router-mode", "hash"]
    assert env["VITE_VIDEOS_LOCAL_FIRST"] == "1"
    assert env["VIDEOS_VENUE_FILE"] == "1"
    assert "PATH" in env                      # the rest of the environment is kept
    assert (root / f"{root.name}-venue.zip").is_file()


def test_venue_dry_run_names_the_variables(tmp_path, monkeypatch, capsys):
    root = make_talk(tmp_path)
    monkeypatch.setattr(pipeline, "_release_assets", lambda *a: (None, None))
    monkeypatch.setattr(pipeline, "_probe_media", lambda src: None)
    assert pipeline.main(["--project", str(root), "venue", "--skip-pull", "--dry-run"]) == 0
    assert "VITE_VIDEOS_LOCAL_FIRST=1 VIDEOS_VENUE_FILE=1 pnpm build:portable --router-mode hash" in capsys.readouterr().out


def venue_zip(tmp_path, monkeypatch, sidecar=True):
    root = make_talk(tmp_path)
    monkeypatch.setattr(pipeline.subprocess, "call", fake_venue_build(root, sidecar=sidecar))
    monkeypatch.setattr(pipeline, "_release_assets", lambda *a: (None, None))
    monkeypatch.setattr(pipeline, "_probe_media", lambda src: None)
    assert pipeline.main(["--project", str(root), "venue", "--skip-pull"]) == 0
    top = f"{root.name}-venue"
    zf = zipfile.ZipFile(root / f"{top}.zip")
    return top, zf, {n.removeprefix(f"{top}/"): n for n in zf.namelist()}


def test_venue_zip_opens_from_index_html_with_launchers_as_backups(tmp_path, monkeypatch):
    """index.html is the way in, on Windows and macOS alike: nothing to install,
    no launcher for SmartScreen or Gatekeeper to refuse. RUN_ME.bat (Windows
    PowerShell, no Python) and RUN_ME.command stay as backups."""
    top, zf, names = venue_zip(tmp_path, monkeypatch)
    with zf:
        assert set(names) == {"index.html", "venue-assets.js", "RUN_ME.txt", "RUN_ME.command", "RUN_ME.bat", "serve.ps1"}
        # Archive Utility and unzip take the mode from the entry's Unix attributes
        assert (zf.getinfo(names["RUN_ME.command"]).external_attr >> 16) & 0o777 == 0o755
        note = zf.read(names["RUN_ME.txt"]).decode("utf-8")
        command = zf.read(names["RUN_ME.command"]).decode("utf-8")
    first = note.index("index.html")
    assert first < note.index("RUN_ME.bat") and first < note.index("RUN_ME.command")
    assert "Extract All" in note                    # unzip first: inside the zip the clips are not beside it
    # macOS refuses a downloaded .command outright (Sequoia has no right-click Open): the two ways past
    assert "Open Anyway" in note and "xattr -dr com.apple.quarantine" in note
    assert "right-click it, then Open" not in note
    assert "live URL" in note
    assert command.startswith("#!/bin/bash\n") and "\r" not in command
    assert 'cd "$(dirname "$0")"' in command and "open " in command


def test_venue_bat_serves_with_windows_powershell_not_python(tmp_path, monkeypatch):
    top, zf, names = venue_zip(tmp_path, monkeypatch)
    with zf:
        bat = zf.read(names["RUN_ME.bat"]).decode("utf-8")
        ps1 = zf.read(names["serve.ps1"]).decode("utf-8")
    assert "\r\n" in bat and "\n" not in bat.replace("\r\n", "")   # cmd.exe wants CRLF
    assert "http.server" not in bat and "py -3" not in bat and "python --version" not in bat   # no Python asked for
    # a .ps1 from a downloaded zip carries the Mark of the Web: RemoteSigned refuses it unsigned
    assert 'powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"' in bat
    assert 'if not exist "%~dp0index.html"' in bat and "Extract All" in bat   # run from inside the zip
    assert "pause" in bat and "index.html" in bat
    # a socket on the loopback: no URL reservation (HttpListener's admin question), no firewall prompt
    assert "[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, $p)" in ps1
    assert "HttpListener" not in ps1
    assert "8000" in ps1 and "Start-Process $url" in ps1 and "[switch]$NoBrowser" in ps1
    assert "206 Partial Content" in ps1 and "416 Range Not Satisfiable" in ps1   # clips seek
    for ext, mime in ((".mp4", "video/mp4"), (".js", "text/javascript"), (".mjs", "text/javascript"),
                      (".json", "application/json"), (".wasm", "application/wasm"), (".webm", "video/webm")):
        assert f"'{ext}'='{mime}" in ps1, ext
    assert "StartsWith($root" in ps1                # nothing outside the folder


def test_venue_without_the_plugin_says_index_html_will_not_open(tmp_path, monkeypatch, capsys):
    """A talk pinned to a slidev-addon-videos without the venue plugin builds
    no sidecar: its index.html shows nothing from file://. The bundle is made
    all the same, and says to use the launchers."""
    top, zf, names = venue_zip(tmp_path, monkeypatch, sidecar=False)
    with zf:
        note = zf.read(names["RUN_ME.txt"]).decode("utf-8")
    out = capsys.readouterr().out
    assert "WARNING" in out and "0.8.5" in out
    assert "does not open" in note and "double-click index.html" not in note
    assert "Double-click the launcher" in note


@pytest.mark.skipif(not shutil.which("powershell.exe") or not shutil.which("wslpath"),
                    reason="Windows PowerShell is reachable only from WSL")
def test_serve_ps1_serves_ranges_on_windows(tmp_path):
    """serve.ps1 for real, under Windows PowerShell 5.1: the deck, a clip's
    byte ranges, nothing outside the folder."""
    import socket
    import subprocess
    import time
    (tmp_path / "index.html").write_text("<html>deck</html>")
    (tmp_path / "videos").mkdir()
    (tmp_path / "videos" / "a b.mp4").write_bytes(bytes(range(256)) * 4)
    (tmp_path / "serve.ps1").write_text(pipeline.VENUE_SERVE_PS1, encoding="utf-8", newline="\r\n")
    win = subprocess.run(["wslpath", "-w", str(tmp_path / "serve.ps1")], capture_output=True, text=True).stdout.strip()
    with socket.socket() as s:                  # a port Windows is unlikely to hold
        s.bind(("127.0.0.1", 0))
        port = 20000 + s.getsockname()[1] % 20000
    server = subprocess.Popen(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", win,
                               "-NoBrowser", "-Port", str(port)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try:
        u = f"http://127.0.0.1:{port}"
        probe = (f"Start-Sleep -Milliseconds 1500; "
                 f"curl.exe -s -o NUL -w '%{{http_code}} %{{content_type}}|' '{u}/'; "
                 f"curl.exe -s -D - -o NUL -H 'Range: bytes=10-19' '{u}/videos/a%20b.mp4' | Select-String 'HTTP/|Content-Range' | % {{ $_.Line.Trim() + '|' }}; "
                 f"curl.exe -s -o NUL -w '%{{http_code}}|' '{u}/videos/none.mp4'; "
                 f"curl.exe -s --path-as-is -o NUL -w '%{{http_code}}' '{u}/../serve.ps1'")
        out = subprocess.run(["powershell.exe", "-NoProfile", "-Command", probe], capture_output=True, text=True, timeout=60).stdout
        out = "".join(out.split("\n")).replace("\r", "")
        assert "200 text/html" in out
        assert "HTTP/1.1 206 Partial Content" in out and "Content-Range: bytes 10-19/1024" in out
        assert out.endswith("404|404"), out
    finally:
        server.kill()
        time.sleep(0.5)
