"""`doctor`: the ffmpeg in use, gh, rclone, and the deck's addon versions."""
import json
import types

import pytest

from slidev_videos import doctor, pipeline


@pytest.fixture
def outside(monkeypatch):
    """gh logged in, rclone with one remote, git describing a branch."""
    def fake_run(cmd, timeout=20):
        if cmd[:3] == ["gh", "auth", "status"]:
            return types.SimpleNamespace(returncode=0, stdout="", stderr="  ✓ Logged in to github.com account someone (keyring)\n")
        if cmd[:2] == ["rclone", "listremotes"]:
            return types.SimpleNamespace(returncode=0, stdout="gdrive:\n", stderr="")
        if cmd[0] == "git":
            return types.SimpleNamespace(returncode=0, stdout="v0.5.0-1-gabc\n", stderr="")
        return None
    monkeypatch.setattr(doctor, "_run", fake_run)
    real_which = doctor.shutil.which
    monkeypatch.setattr(doctor.shutil, "which",
                        lambda name, *a, **k: f"/usr/bin/{name}" if name in ("gh", "rclone", "git") else real_which(name, *a, **k))


def doctor_json(capsys, *argv):
    rc = pipeline.main(["doctor", "--json", *argv])
    return rc, json.loads(capsys.readouterr().out)


def test_doctor_without_a_project(machine, tmp_path, monkeypatch, capsys, fake_build, outside):
    good = fake_build(tmp_path / "env-bin", tmp_path / "log", nvenc=True)
    monkeypatch.setenv("PATH", str(good))
    monkeypatch.chdir(tmp_path)
    pipeline._encodes_with.cache_clear()
    rc, d = doctor_json(capsys)
    assert rc == 0
    assert d["ffmpeg"]["ffmpeg"] == str(good / "ffmpeg")
    assert d["ffmpeg"]["chosen"]["https"] is True
    assert d["ffmpeg"]["nvenc_runtime"] is True
    assert d["gh"] == {"found": True, "path": "/usr/bin/gh", "logged_in": True, "account": "someone"}
    assert d["rclone"]["remotes"] == ["gdrive:"]
    assert d["project"] is None
    assert d["cli"]["version"] == pipeline.cli_version()
    assert d["problems"] == []


def test_doctor_names_a_crashing_ffmpeg_on_path(machine, tmp_path, monkeypatch, capsys, fake_build, outside):
    static = fake_build(tmp_path / "local-bin", tmp_path / "log", crash=True)
    fake_build(machine / "micromamba" / "envs" / "talks" / "bin", tmp_path / "log")
    monkeypatch.setenv("PATH", str(static))
    monkeypatch.chdir(tmp_path)
    rc, d = doctor_json(capsys)
    assert rc == 0
    assert d["ffmpeg"]["chosen"]["source"] == "conda-envs"
    assert any("crashes on HTTPS" in w and str(static / "ffmpeg") in w for w in d["warnings"])


def test_no_ffmpeg_is_a_problem(machine, tmp_path, monkeypatch, capsys, outside):
    monkeypatch.chdir(tmp_path)
    rc, d = doctor_json(capsys)
    assert rc == 1
    assert d["ffmpeg"]["chosen"] is None
    assert d["problems"]


def test_doctor_compares_the_decks_addon_with_the_cli(machine, tmp_path, monkeypatch, capsys, fake_build, outside):
    monkeypatch.setenv("PATH", str(fake_build(tmp_path / "bin", tmp_path / "log")))
    talk = tmp_path / "talk"
    (talk / "videos").mkdir(parents=True)
    (talk / "videos.toml").write_text('[defaults]\nrelease_tag = "videos-t"\nshared = false\n', encoding="utf-8")
    (talk / "videos" / "manifest.toml").write_text("", encoding="utf-8")
    (talk / "package.json").write_text(json.dumps({"devDependencies": {
        "slidev-addon-videos": "github:Owner/slidev-videos#v0.0.1",
        "slidev-addon-stage": "github:Owner/slidev-videos#v0.0.1&path:/packages/stage"}}), encoding="utf-8")
    nm = talk / "node_modules" / "slidev-addon-videos"
    nm.mkdir(parents=True)
    (nm / "package.json").write_text(json.dumps({"version": "0.0.1"}), encoding="utf-8")
    rc, d = doctor_json(capsys, "--project", str(talk))
    assert rc == 0
    a = d["project"]["addons"]
    assert a["slidev-addon-videos"] == {"spec": "github:Owner/slidev-videos#v0.0.1", "ref": "v0.0.1", "installed": "0.0.1"}
    assert a["slidev-addon-stage"]["ref"] == "v0.0.1" and a["slidev-addon-stage"]["installed"] is None
    assert d["project"]["release_tag"] == "videos-t"
    assert any("slidev-addon-videos is 0.0.1" in w for w in d["warnings"])


def test_an_explicit_project_without_videos_toml_is_an_error(tmp_path, capsys):
    assert pipeline.main(["doctor", "--project", str(tmp_path)]) == 2
    assert "no videos.toml" in capsys.readouterr().err
