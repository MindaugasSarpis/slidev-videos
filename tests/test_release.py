"""scripts/release.py: the text edits, and whole runs against a throwaway repo."""
import importlib.util
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "scripts" / "release.py"
_spec = importlib.util.spec_from_file_location("release", SCRIPT)
release = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(release)

CHANGELOG = """# Changelog

Intro.

## Unreleased

<!-- ahead of the merges -->

### stage

- a new thing

## v0.5.0 — 2026-09-29 (stage 0.2.0)

- an old thing
"""

FILES = {
    "pyproject.toml": '[project]\nname = "slidev-videos"\nversion = "0.5.0"\n',
    "package.json": '{\n  "name": "slidev-addon-videos",\n  "version": "0.5.0",\n'
                    '  "repository": { "type": "git", "url": "https://github.com/MindaugasSarpis/slidev-videos.git" },\n'
                    '  "devDependencies": { "@slidev/theme-default": "0.25.0" }\n}\n',
    "src/slidev_videos/__init__.py": '__version__ = "0.5.0"\n',
    "README.md": ('    pip install "slidev-videos @ git+https://github.com/MindaugasSarpis/slidev-videos@v0.5.0"\n'
                  "    pnpm add -D github:MindaugasSarpis/slidev-videos#v0.5.0\n"
                  "as before v0.4 (v0.3.3)\n"),
    "packages/stage/README.md": '    pnpm add -D "github:MindaugasSarpis/slidev-videos#v0.5.0&path:/packages/stage"\n',
    "packages/stage/package.json": '{\n  "name": "slidev-addon-stage",\n  "version": "0.2.0",\n'
                                   '  "dependencies": { "three": "^0.185.1" }\n}\n',
    "CHANGELOG.md": CHANGELOG,
    "tests/test_ok.py": "def test_ok():\n    pass\n",
}


# --- the edits -----------------------------------------------------------------

def test_move_unreleased_leaves_an_empty_unreleased_and_drops_comments():
    out = release.move_unreleased(CHANGELOG, "0.6.0", "2026-10-20", "0.3.0")
    assert out.startswith("# Changelog\n\nIntro.\n\n## Unreleased\n\n## v0.6.0 — 2026-10-20 (stage 0.3.0)\n\n### stage\n")
    assert "ahead of the merges" not in out
    assert out.index("- a new thing") < out.index("## v0.5.0")
    assert release.unreleased_body(out) == ""
    assert release.release_notes(out, "0.6.0") == "### stage\n\n- a new thing\n"


def test_move_unreleased_refuses_when_empty():
    empty = release.move_unreleased(CHANGELOG, "0.6.0", "2026-10-20")
    with pytest.raises(ValueError, match="nothing under"):
        release.move_unreleased(empty, "0.7.0", "2026-10-21")


def test_set_version_touches_only_the_version_line():
    text = FILES["package.json"]
    out = release.set_version(text, release.VERSION_SITES["package.json"], "0.6.0")
    assert '"version": "0.6.0"' in out and '"@slidev/theme-default": "0.25.0"' in out
    with pytest.raises(ValueError):
        release.set_version("no version here\n", release.VERSION_SITES["pyproject.toml"], "0.6.0")


def test_install_lines_change_and_nothing_else():
    out = release.set_install_lines(FILES["README.md"], "0.6.0")
    assert out.count("v0.6.0") == 2 and "(v0.3.3)" in out and "before v0.4 " in out


def test_released_lists_the_version_sections_only():
    out = release.move_unreleased(CHANGELOG, "0.6.0", "2026-10-20")
    assert release.released(out + "## v0.3.3 — 2026-09-09\n\nas in v0.3.2\n") == ["0.6.0", "0.5.0", "0.3.3"]


# --- whole runs ----------------------------------------------------------------

@pytest.fixture
def repo(tmp_path):
    """A throwaway repo with the release-relevant files, on main and tagged v0.5.0, a fake pnpm on PATH."""
    root = tmp_path / "sv"
    for rel, text in FILES.items():
        (root / rel).parent.mkdir(parents=True, exist_ok=True)
        (root / rel).write_text(text, encoding="utf-8")
    (root / "scripts").mkdir()
    shutil.copy(SCRIPT, root / "scripts" / "release.py")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (bin_dir / "pnpm").write_text("#!/bin/sh\necho fake pnpm \"$@\"\n")
    (bin_dir / "pnpm").chmod(0o755)
    env = {**os.environ, "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
           "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1",
           "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.invalid",
           "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.invalid"}
    git = lambda *a: subprocess.run(["git", "-C", str(root), *a], env=env, check=True,
                                    capture_output=True, text=True).stdout
    git("init", "-q", "-b", "main")
    git("add", "-A")
    git("commit", "-q", "-m", "init")
    git("tag", "-a", "v0.5.0", "-m", "v0.5.0")
    run = lambda *a: subprocess.run([sys.executable, str(root / "scripts" / "release.py"), *a],
                                    env=env, capture_output=True, text=True)
    return root, git, run


def test_refuses_off_main_and_changes_nothing(repo):
    root, git, run = repo
    git("switch", "-q", "-c", "feat/x")
    r = run("0.6.0", "--dry-run")
    assert r.returncode == 2
    assert "FAIL  on main (HEAD is feat/x)" in r.stdout and "refusing" in r.stderr
    assert git("status", "--porcelain") == ""


def test_refuses_a_version_not_above_the_last_tag(repo):
    root, git, run = repo
    r = run("0.5.0", "--dry-run")
    assert r.returncode == 2 and "FAIL  0.5.0 is above the last tag (v0.5.0)" in r.stdout
    assert run("0.4.9", "--dry-run").returncode == 2


def test_refuses_a_version_the_changelog_already_has(repo):
    # v0.5.0 written up in CHANGELOG.md but not tagged yet, v0.4.0 the last
    # tag: a second v0.5.0 section, with Unreleased's entries, would follow.
    root, git, run = repo
    git("tag", "-d", "v0.5.0")
    git("tag", "-a", "v0.4.0", "-m", "v0.4.0")
    r = run("0.5.0", "--dry-run")
    assert r.returncode == 2
    assert "FAIL  CHANGELOG.md has no v0.5.0 section yet" in r.stdout
    assert git("status", "--porcelain") == ""


def test_refuses_while_a_changelog_version_is_untagged(repo):
    root, git, run = repo
    git("tag", "-d", "v0.5.0")
    git("tag", "-a", "v0.4.0", "-m", "v0.4.0")
    r = run("0.6.0", "--dry-run")
    assert r.returncode == 2
    assert "FAIL  every version in CHANGELOG.md is tagged (no tag: v0.5.0" in r.stdout
    git("tag", "-a", "v0.5.0", "-m", "v0.5.0")
    r = run("0.6.0", "--dry-run")
    assert r.returncode == 0, r.stdout + r.stderr
    assert "ok    every version in CHANGELOG.md is tagged" in r.stdout


def test_accepts_a_version_a_branch_already_set(repo):
    root, git, run = repo
    for rel in ("pyproject.toml", "package.json", "src/slidev_videos/__init__.py"):
        (root / rel).write_text((root / rel).read_text().replace("0.5.0", "0.6.0"))
    git("commit", "-q", "-am", "feat: v0.6.0 by hand")
    r = run("0.6.0", "--dry-run")
    assert r.returncode == 0, r.stdout + r.stderr
    assert "+version" not in r.stdout and "slidev-videos#v0.6.0" in r.stdout and "+## v0.6.0 — " in r.stdout


def test_dry_run_on_main_prints_the_diff(repo):
    root, git, run = repo
    r = run("0.6.0", "--stage", "0.3.0", "--dry-run")
    assert r.returncode == 0, r.stdout + r.stderr
    for line in ('-version = "0.5.0"', '+version = "0.6.0"', '+__version__ = "0.6.0"',
                 '+  "version": "0.3.0",', "+## v0.6.0 — ", "slidev-videos#v0.6.0&path:/packages/stage"):
        assert line in r.stdout, line
    assert git("status", "--porcelain") == "" and git("tag").split() == ["v0.5.0"]


def test_release_commits_and_tags_without_pushing(repo):
    root, git, run = repo
    r = run("0.6.0")
    assert r.returncode == 0, r.stdout + r.stderr
    assert "not pushed" in r.stdout and "git push --atomic origin main refs/tags/v0.6.0" in r.stdout
    assert git("log", "-1", "--format=%s").strip() == "chore: v0.6.0"
    assert git("tag").split() == ["v0.5.0", "v0.6.0"]
    assert git("status", "--porcelain", "--untracked-files=no") == ""
    assert '"version": "0.2.0"' in (root / "packages/stage/package.json").read_text()   # no --stage
    assert "## v0.6.0 — " in (root / "CHANGELOG.md").read_text()
    notes = (root / ".git" / "release-notes" / "v0.6.0.md").read_text()
    assert notes == "### stage\n\n- a new thing\n"
    again = run("0.7.0", "--dry-run")
    assert again.returncode == 2 and "FAIL  CHANGELOG.md has entries under Unreleased" in again.stdout
