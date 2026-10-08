#!/usr/bin/env python3
"""Cut a toolkit release: scripts/release.py X.Y.Z [--stage A.B.C] [--dry-run] [--push]

Run from a clean `main` after the owner has merged what goes in. In order:

1. checks: on main, no tracked changes, the tag is free, main is not behind
   origin/main (as of the last fetch), CHANGELOG.md has entries under
   `## Unreleased` and no section for the new version yet, every version
   CHANGELOG.md has a section for is tagged, the new version is above the
   last tag and not below the files' version (a merged branch may have set
   it already);
2. tests: `python3 -m pytest tests -q` (against this tree's src/) and
   `pnpm test:all`;
3. one commit `chore: vX.Y.Z` that sets the version in pyproject.toml,
   package.json, src/slidev_videos/__init__.py and the install lines of
   README.md and packages/stage/README.md, and moves CHANGELOG's Unreleased
   entries under the new version. packages/stage/package.json has its own
   version and changes only with --stage;
4. an annotated tag vX.Y.Z, and the release notes (this version's CHANGELOG
   section) written into the git dir for `gh release create`.

Nothing leaves the machine unless --push: the push and `gh release create`
commands are printed for the owner to run. It never merges anything.
--dry-run runs the checks, prints the plan and the diff, and changes nothing.

Exit codes: 0 done (or a clean dry run), 1 a test or command failed,
2 refused (a check failed) or bad usage.
"""
from __future__ import annotations

import argparse
import datetime
import difflib
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEMVER = re.compile(r"^\d+\.\d+\.\d+$")

# file -> pattern whose group 2 is the version; each must match exactly once
VERSION_SITES = {
    "pyproject.toml": re.compile(r'^(version\s*=\s*")(\d+\.\d+\.\d+)(")', re.M),
    "package.json": re.compile(r'^(\s*"version":\s*")(\d+\.\d+\.\d+)(")', re.M),
    "src/slidev_videos/__init__.py": re.compile(r'^(__version__\s*=\s*")(\d+\.\d+\.\d+)(")', re.M),
}
STAGE_PACKAGE = "packages/stage/package.json"
# `pip install "slidev-videos @ git+...slidev-videos@vX.Y.Z"` and
# `pnpm add -D github:...slidev-videos#vX.Y.Z[&path:/packages/stage]`
INSTALL_LINE = re.compile(r"(slidev-videos[@#]v)(\d+\.\d+\.\d+)")
INSTALL_DOCS = ("README.md", "packages/stage/README.md")

UNRELEASED = re.compile(r"^## Unreleased[ \t]*\n", re.M)
NEXT_HEADING = re.compile(r"^## ", re.M)
RELEASE_HEADING = re.compile(r"^## v(\d+\.\d+\.\d+)\b", re.M)
COMMENT = re.compile(r"<!--.*?-->\n?", re.S)


def vtuple(v: str) -> tuple[int, ...]:
    return tuple(int(x) for x in v.split("."))


def read_version(text: str, pattern: re.Pattern) -> str:
    found = pattern.findall(text)
    if len(found) != 1:
        raise ValueError(f"expected one version line, found {len(found)}")
    return found[0][1]


def set_version(text: str, pattern: re.Pattern, version: str) -> str:
    read_version(text, pattern)
    return pattern.sub(lambda m: m.group(1) + version + m.group(3), text, count=1)


def set_install_lines(text: str, version: str) -> str:
    return INSTALL_LINE.sub(lambda m: m.group(1) + version, text)


def _unreleased_span(changelog: str) -> tuple[int, int, int]:
    """(heading start, body start, body end) of `## Unreleased`."""
    m = UNRELEASED.search(changelog)
    if not m:
        raise ValueError("CHANGELOG.md has no '## Unreleased' heading")
    nxt = NEXT_HEADING.search(changelog, m.end())
    return m.start(), m.end(), nxt.start() if nxt else len(changelog)


def unreleased_body(changelog: str) -> str:
    """The entries under `## Unreleased`, without HTML comments; '' if none."""
    _, start, end = _unreleased_span(changelog)
    return COMMENT.sub("", changelog[start:end]).strip()


def move_unreleased(changelog: str, version: str, date: str, stage: str | None = None) -> str:
    """Unreleased's entries become `## vX.Y.Z — date (stage S)`; an empty Unreleased stays on top."""
    body = unreleased_body(changelog)
    if not body:
        raise ValueError("nothing under '## Unreleased' in CHANGELOG.md")
    head, _, end = _unreleased_span(changelog)
    rest = changelog[end:]
    heading = f"## v{version} — {date}" + (f" (stage {stage})" if stage else "")
    return (changelog[:head] + f"## Unreleased\n\n{heading}\n\n{body}\n"
            + (f"\n{rest}" if rest else ""))


def released(changelog: str) -> list[str]:
    """The versions CHANGELOG.md has a `## vX.Y.Z` section for, in file order."""
    return RELEASE_HEADING.findall(changelog)


def release_notes(changelog: str, version: str) -> str:
    """The body of the `## vX.Y.Z` section, for the GitHub release."""
    m = re.search(rf"^## v{re.escape(version)}\b.*\n", changelog, re.M)
    if not m:
        raise ValueError(f"CHANGELOG.md has no '## v{version}' section")
    nxt = NEXT_HEADING.search(changelog, m.end())
    return changelog[m.end():nxt.start() if nxt else len(changelog)].strip() + "\n"


def plan_edits(root: Path, version: str, stage: str | None, date: str) -> dict[str, tuple[str, str]]:
    """{path: (old, new)} for every file the release commit changes."""
    stage_after = stage or read_version((root / STAGE_PACKAGE).read_text(encoding="utf-8"), VERSION_SITES["package.json"])
    steps = [(rel, lambda t, p=pat: set_version(t, p, version)) for rel, pat in VERSION_SITES.items()]
    if stage:
        steps.append((STAGE_PACKAGE, lambda t: set_version(t, VERSION_SITES["package.json"], stage)))
    steps += [(rel, lambda t: set_install_lines(t, version)) for rel in INSTALL_DOCS]
    steps.append(("CHANGELOG.md", lambda t: move_unreleased(t, version, date, stage_after)))
    edits = {}
    for rel, fn in steps:
        old = (root / rel).read_text(encoding="utf-8")
        new = fn(old)
        if new != old:
            edits[rel] = (old, new)
    return edits


def git(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(ROOT), *args], capture_output=True, text=True, check=check)


def current_versions() -> dict[str, str]:
    cur = {rel: read_version((ROOT / rel).read_text(encoding="utf-8"), pat) for rel, pat in VERSION_SITES.items()}
    cur[STAGE_PACKAGE] = read_version((ROOT / STAGE_PACKAGE).read_text(encoding="utf-8"), VERSION_SITES["package.json"])
    return cur


def checks(version: str, stage: str | None, cur: dict[str, str]) -> list[tuple[bool, str]]:
    """[(ok, line)]; lines starting 'note:' never fail."""
    out: list[tuple[bool, str]] = []
    now, now_stage = cur["pyproject.toml"], cur[STAGE_PACKAGE]

    branch = git("symbolic-ref", "--quiet", "--short", "HEAD", check=False).stdout.strip()
    out.append((branch == "main", f"on main (HEAD is {branch or 'detached'})"))
    dirty = [l[3:] for l in git("status", "--porcelain", "--untracked-files=no").stdout.splitlines()]
    out.append((not dirty, "no tracked changes" + (f" ({len(dirty)} changed: {', '.join(dirty[:4])})" if dirty else "")))
    taken = git("rev-parse", "-q", "--verify", f"refs/tags/v{version}", check=False).returncode == 0
    out.append((not taken, f"tag v{version} is free"))
    if git("rev-parse", "-q", "--verify", "refs/remotes/origin/main", check=False).returncode == 0:
        behind = int(git("rev-list", "--count", "HEAD..origin/main").stdout.strip())
        out.append((behind == 0, f"not behind origin/main as of the last fetch ({behind} behind)"))
    tags = [l[1:] for l in git("tag", "-l", "v[0-9]*").stdout.split() if SEMVER.match(l[1:])]
    last_tag = max(tags, key=vtuple, default=None)
    try:
        changelog = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
        out.append((bool(unreleased_body(changelog)), "CHANGELOG.md has entries under Unreleased"))
        logged = released(changelog)
        out.append((version not in logged, f"CHANGELOG.md has no v{version} section yet"))
        # A version written up but not tagged (v0.5.0 is tagged by hand, on
        # PR #2's merge): releasing past it would leave it untagged for good.
        untagged = [f"v{v}" for v in logged if v not in tags]
        out.append((not untagged, "every version in CHANGELOG.md is tagged"
                    + (f" (no tag: {', '.join(untagged)}; tag it or `git fetch --tags`)" if untagged else "")))
    except (OSError, ValueError) as e:
        out.append((False, f"CHANGELOG.md: {e}"))
    # A merged branch may have set the version in the files already.
    out.append((vtuple(version) >= vtuple(now) and (not last_tag or vtuple(version) > vtuple(last_tag)),
                f"{version} is above the last tag (v{last_tag}) and not below the files ({now})"))
    behind_files = [f"{rel} {v}" for rel, v in cur.items() if rel in VERSION_SITES and v != now]
    if behind_files:
        out.append((True, f"note: out of step with pyproject.toml, set now: {', '.join(behind_files)}"))
    if stage:
        out.append((vtuple(stage) >= vtuple(now_stage), f"stage {stage} is not below the current {now_stage}"))
    else:
        last = git("describe", "--tags", "--abbrev=0", "--match", "v[0-9]*", check=False).stdout.strip()
        if last and git("diff", "--quiet", last, "HEAD", "--", "packages/stage", check=False).returncode:
            out.append((True, f"note: packages/stage changed since {last}; without --stage it stays {now_stage}"))
    pnpm = shutil.which("pnpm") or ""
    # On WSL a Windows pnpm shim under /mnt/c can come first on PATH.
    out.append((bool(pnpm) and not pnpm.startswith("/mnt/"), f"pnpm is a Linux build ({pnpm or 'not on PATH'})"))
    # A child, as the test step runs it: under `python3 -I` this process does
    # not see the user site, where pytest often lives.
    has_pytest = subprocess.run([sys.executable, "-c", "import pytest"], cwd=ROOT, capture_output=True).returncode == 0
    out.append((has_pytest, f"pytest importable by {sys.executable}"
                + ("" if has_pytest else " (run release.py with a Python that has pytest)")))
    return out


def run(cmd: list[str], state: str, **kw) -> None:
    print(f"$ {shlex.join(cmd)}", flush=True)
    r = subprocess.run(cmd, cwd=ROOT, **kw)
    if r.returncode:
        sys.exit(f"release: `{shlex.join(cmd)}` failed (exit {r.returncode}); {state}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="scripts/release.py", description=__doc__.split("\n\n")[0])
    ap.add_argument("version", help="the new version, X.Y.Z (the tag is vX.Y.Z)")
    ap.add_argument("--stage", metavar="X.Y.Z", help=f"also set {STAGE_PACKAGE} to this version")
    ap.add_argument("--dry-run", action="store_true", help="check, print the plan and the diff, change nothing")
    ap.add_argument("--push", action="store_true", help="after tagging, push main and the tag and create the GitHub release")
    a = ap.parse_args(argv)
    for v in filter(None, (a.version, a.stage)):
        if not SEMVER.match(v):
            ap.error(f"{v!r} is not X.Y.Z (no leading v)")

    tag = f"v{a.version}"
    date = datetime.date.today().isoformat()
    git_dir = Path(git("rev-parse", "--git-common-dir").stdout.strip())
    notes_file = (git_dir if git_dir.is_absolute() else ROOT / git_dir).resolve() / "release-notes" / f"{tag}.md"
    url = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["repository"]["url"]
    slug = re.sub(r"^.*github\.com[/:]|\.git$", "", url)
    commit_cmd = ["git", "commit", "-q", "-m", f"chore: {tag}", *(["-m", f"stage {a.stage}"] if a.stage else [])]
    tag_cmd = ["git", "tag", "-a", tag, "-m", f"slidev-videos {tag}"]
    push_cmd = ["git", "push", "--atomic", "origin", "main", f"refs/tags/{tag}"]
    gh_cmd = ["gh", "release", "create", tag, "--repo", slug, "--verify-tag", "--title", tag,
              "--notes-file", str(notes_file)]

    try:
        cur = current_versions()
        found = checks(a.version, a.stage, cur)
    except ValueError as e:
        print(f"release: refusing: a version line: {e}", file=sys.stderr)
        return 2
    try:
        edits = plan_edits(ROOT, a.version, a.stage, date)
    except ValueError as e:
        edits = {}
        if all(ok for ok, _ in found):  # else a failed check already names the cause
            found.append((False, str(e)))

    print(f"release {tag} from {cur['pyproject.toml']} in {ROOT}" + (" (dry run)" if a.dry_run else ""))
    print(f"  stage {cur[STAGE_PACKAGE]} -> {a.stage}" if a.stage else f"  stage stays {cur[STAGE_PACKAGE]} (no --stage)")
    print("checks")
    for ok, line in found:
        mark, line = ("note", line[6:]) if line.startswith("note: ") else ("ok  " if ok else "FAIL", line)
        print(f"  {mark}  {line}")
    later = "" if a.push else "   # printed, not run: no --push"
    print("steps")
    print("  1. PYTHONPATH=src python3 -m pytest tests -q")
    print("  2. pnpm test:all")
    print(f"  3. edit {', '.join(edits) or '(nothing)'}")
    print(f"     version {a.version}" + (f", stage {a.stage}" if a.stage else "") + f"; CHANGELOG Unreleased -> {tag} — {date}"
          + f" (stage {a.stage or cur[STAGE_PACKAGE]})")
    print(f"  4. git add -- {' '.join(edits)} && {shlex.join(commit_cmd)}")
    print(f"  5. {shlex.join(tag_cmd)}; release notes -> {notes_file}")
    print(f"  6. {shlex.join(push_cmd)}{later}")
    print(f"  7. {shlex.join(gh_cmd)}{later}")
    print(f"  then, in outreach_talks: pnpm talk bump-toolkit {tag}")

    failed = [line for ok, line in found if not ok]
    sys.stdout.flush()
    if failed:
        print(f"release: refusing, {len(failed)} check{'s' if len(failed) > 1 else ''} failed: {'; '.join(failed)}",
              file=sys.stderr)
        return 2

    if a.dry_run:
        print("\ndiff of the release commit")
        for rel, (old, new) in edits.items():
            sys.stdout.writelines(difflib.unified_diff(
                old.splitlines(keepends=True), new.splitlines(keepends=True), f"a/{rel}", f"b/{rel}"))
        print("\nnotes for the GitHub release")
        print(release_notes(edits["CHANGELOG.md"][1], a.version), end="")
        return 0

    untouched = "nothing was changed"
    run([sys.executable, "-m", "pytest", "tests", "-q"], untouched, env={**os.environ, "PYTHONPATH": str(ROOT / "src")})
    run([shutil.which("pnpm"), "test:all"], untouched)
    if git("status", "--porcelain", "--untracked-files=no").stdout.strip():
        print("release: the tests changed tracked files, see `git status`; nothing was committed", file=sys.stderr)
        return 1

    for rel, (_, new) in edits.items():
        (ROOT / rel).write_text(new, encoding="utf-8")
    edited = f"the release edits are in the tree, uncommitted (`git checkout -- {' '.join(edits)}` drops them)"
    run(["git", "add", "--", *edits], edited)
    run(commit_cmd, edited)
    run(tag_cmd, "the release commit is made but not tagged")
    notes_file.parent.mkdir(parents=True, exist_ok=True)
    notes_file.write_text(release_notes(edits["CHANGELOG.md"][1], a.version), encoding="utf-8")
    print(f"committed and tagged {tag} at {git('rev-parse', '--short', 'HEAD').stdout.strip()}")

    if not a.push:
        print("not pushed. To publish:")
        print(f"  {shlex.join(push_cmd)}")
        print(f"  {shlex.join(gh_cmd)}")
        return 0
    run(push_cmd, "committed and tagged locally, nothing pushed")
    run(gh_cmd, "main and the tag are pushed; create the release by hand")
    return 0


if __name__ == "__main__":
    sys.exit(main())
