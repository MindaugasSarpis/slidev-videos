"""`slidev-videos doctor`: what this machine, and the project if there is one,
will run with.

Reports the CLI's version and where it is installed from (an editable install
with its `git describe`), the ffmpeg/ffprobe pair tools.resolve() chose and
why, gh's login, rclone's remotes and, inside a project, the addon versions
the deck pins and has installed next to the CLI's own. Problems (exit 1) are
what stops the pipeline: no ffmpeg at all. Everything else is a warning.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
import tomllib
from pathlib import Path

ADDONS = ("slidev-addon-videos", "slidev-addon-stage")


def _run(cmd: list[str], timeout: float = 20) -> subprocess.CompletedProcess | None:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired):
        return None


def cli_install(version: str) -> dict:
    """Version, package directory, and the editable source with its git state."""
    from importlib.metadata import PackageNotFoundError, distribution
    pkg = Path(__file__).resolve().parent
    out: dict = {"version": version, "package_dir": str(pkg), "python": sys.executable,
                 "editable": False, "source": None, "source_version": None, "git": None}
    try:
        direct = distribution("slidev-videos").read_text("direct_url.json")
    except PackageNotFoundError:
        direct = None
    if direct:
        try:
            info = json.loads(direct)
        except ValueError:
            info = {}
        out["editable"] = bool(info.get("dir_info", {}).get("editable"))
        url = info.get("url", "")
        if url.startswith("file://"):
            out["source"] = url.removeprefix("file://")
    src = Path(out["source"]) if out["source"] else None
    if src and (src / "pyproject.toml").is_file():
        try:
            with (src / "pyproject.toml").open("rb") as f:
                out["source_version"] = tomllib.load(f).get("project", {}).get("version")
        except (OSError, tomllib.TOMLDecodeError):
            pass
    if out["editable"] and shutil.which("git"):
        d = _run(["git", "-C", str(pkg), "describe", "--tags", "--always", "--dirty"])
        b = _run(["git", "-C", str(pkg), "rev-parse", "--abbrev-ref", "HEAD"])
        if d and d.returncode == 0:
            out["git"] = {"describe": d.stdout.strip(),
                          "branch": b.stdout.strip() if b and b.returncode == 0 else None}
    return out


def gh_status() -> dict:
    if not shutil.which("gh"):
        return {"found": False, "logged_in": False, "account": None}
    r = _run(["gh", "auth", "status", "--hostname", "github.com"])
    text = ((r.stdout or "") + (r.stderr or "")) if r else ""
    m = re.search(r"Logged in to github\.com (?:account|as) (\S+)", text)
    return {"found": True, "path": shutil.which("gh"), "logged_in": bool(r and r.returncode == 0),
            "account": m.group(1) if m else None}


def rclone_status(source_remote: str | None, tools_dir: str | None) -> dict:
    path = shutil.which("rclone")
    out: dict = {"found": bool(path), "path": path, "remotes": [], "source_remote": source_remote,
                 "source_remote_configured": None, "elsewhere": None}
    if not path:
        if tools_dir and (Path(tools_dir) / "rclone").is_file():
            out["elsewhere"] = str(Path(tools_dir) / "rclone")
        return out
    r = _run(["rclone", "listremotes"])
    if r and r.returncode == 0:
        out["remotes"] = [line.strip() for line in r.stdout.splitlines() if line.strip()]
    if source_remote:
        name = source_remote.split(":", 1)[0] + ":"
        out["source_remote_configured"] = name in out["remotes"]
    return out


def _package_json_with_addons(start: Path) -> Path | None:
    for d in [start, *start.parents]:
        pj = d / "package.json"
        if not pj.is_file():
            continue
        try:
            data = json.loads(pj.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        deps = {**data.get("dependencies", {}), **data.get("devDependencies", {})}
        if any(a in deps for a in ADDONS):
            return pj
    return None


def addons(project_dir: Path) -> dict:
    """{addon: {spec, ref, installed}} from the deck's package.json and node_modules."""
    pj = _package_json_with_addons(project_dir)
    out: dict = {"package_json": str(pj) if pj else None}
    if pj is None:
        return out
    data = json.loads(pj.read_text(encoding="utf-8"))
    deps = {**data.get("dependencies", {}), **data.get("devDependencies", {})}
    for name in ADDONS:
        spec = deps.get(name)
        if spec is None:
            continue
        ref = spec.split("#", 1)[1].split("&", 1)[0] if "#" in spec else None
        installed = None
        try:
            installed = json.loads((pj.parent / "node_modules" / name / "package.json")
                                   .read_text(encoding="utf-8")).get("version")
        except (OSError, ValueError):
            pass
        out[name] = {"spec": spec, "ref": ref, "installed": installed}
    return out


def run(report: dict, project, defaults: dict, tools, nvenc_runtime, version: str) -> int:
    """Fill `report`, print the text, return 1 when something blocks the pipeline."""
    problems: list[str] = []
    warnings: list[str] = []

    cli = cli_install(version)
    if cli["editable"] and cli["source_version"] and cli["source_version"] != version:
        warnings.append(f"the editable install's metadata says {version}, its source {cli['source_version']}: "
                        f"re-run `pip install -e {cli['source']}` to refresh it")

    chosen = tools.chosen
    ff: dict = tools.as_dict()
    on_path = shutil.which("ffmpeg")
    ff["path_ffmpeg"] = on_path
    ff["nvenc_runtime"] = bool(chosen) and nvenc_runtime()
    if chosen is None:
        problems.append("no ffmpeg/ffprobe pair found (set SLIDEV_VIDEOS_FFMPEG_DIR or [defaults].ffmpeg_dir)")
    elif chosen.crashed:
        warnings.append(f"{chosen.ffmpeg} crashes on HTTPS input and is the only build found: "
                        "release URLs cannot be probed; frames downloads them instead")
    if chosen and on_path and Path(on_path).resolve() != Path(chosen.ffmpeg).resolve():
        bad = next((c for c in tools.candidates
                    if Path(c.ffmpeg).resolve() == Path(on_path).resolve() and c.crashed), None)
        if bad:
            warnings.append(f"`ffmpeg` on PATH is {on_path}, which crashes on HTTPS; the CLI uses "
                            f"{chosen.ffmpeg} — call that one in hand-written commands")

    gh = gh_status()
    if not gh["found"]:
        warnings.append("gh not found: publish, pull and the release lookups of check/preflight/frames need it")
    elif not gh["logged_in"]:
        warnings.append("gh is not logged in to github.com (gh auth login)")

    rc = rclone_status(defaults.get("source_remote"), chosen.dir if chosen else None)
    if not rc["found"]:
        hint = f" (there is one in {Path(rc['elsewhere']).parent}; put it on PATH)" if rc["elsewhere"] else ""
        warnings.append(f"rclone not on PATH: sync and hq_from_raw pulls need it{hint}")
    elif rc["source_remote_configured"] is False:
        warnings.append(f"rclone has no remote for source_remote {rc['source_remote']!r}")

    proj: dict | None = None
    if project is not None:
        proj = {"root": str(project.root), "manifest": str(project.manifest),
                "repo": defaults.get("repo"), "release_tag": defaults.get("release_tag"),
                "addons": addons(project.slides_dir)}
        videos_addon = proj["addons"].get("slidev-addon-videos")
        if videos_addon and videos_addon["installed"] and videos_addon["installed"] != version:
            warnings.append(f"the deck's slidev-addon-videos is {videos_addon['installed']}, the CLI {version}")
        elif videos_addon and not videos_addon["installed"]:
            warnings.append("slidev-addon-videos is declared but not installed (pnpm install)")

    report.update({"cli": cli, "ffmpeg": ff, "gh": gh, "rclone": rc, "project": proj,
                   "problems": problems, "warnings": warnings})

    # --- text --------------------------------------------------------------
    where = cli["source"] if cli["editable"] else cli["package_dir"]
    git = f", {cli['git']['describe']} on {cli['git']['branch']}" if cli["git"] else ""
    print(f"slidev-videos {version}  ({'editable from ' if cli['editable'] else ''}{where}{git})")
    if chosen:
        flags = [f"https {'yes' if chosen.https else 'NO'}",
                 f"nvenc {'yes' if ff['nvenc_runtime'] else ('built in, not working' if chosen.nvenc else 'no')}"]
        print(f"ffmpeg         {chosen.ffmpeg}  [{chosen.source}] {chosen.version}  ({', '.join(flags)})")
    else:
        print("ffmpeg         none found")
    for c in tools.candidates:
        if c is chosen:
            continue
        state = c.note or ("ok" if c.https else "not probed")
        print(f"  also         {c.ffmpeg}  [{c.source}] {c.version}  ({state})")
    if gh["found"]:
        who = f" as {gh['account']}" if gh["account"] else ""
        print(f"gh             {'logged in' + who if gh['logged_in'] else 'NOT logged in'}")
    else:
        print("gh             not found")
    if rc["found"]:
        print(f"rclone         remotes: {' '.join(rc['remotes']) or 'none'}")
    else:
        print("rclone         not on PATH")
    if proj:
        print(f"project        {proj['root']}  (release {proj['release_tag'] or 'auto'}, repo {proj['repo'] or '?'})")
        for name in ADDONS:
            a = proj["addons"].get(name)
            if a:
                print(f"  {name:<21}{a['installed'] or 'not installed'}  (pinned {a['ref'] or a['spec']})")
    for w in warnings:
        print(f"  ! {w}")
    for p in problems:
        print(f"  x {p}")
    return 1 if problems else 0
