#!/usr/bin/env python3
"""One-command releases for Glass Notes.

  python automation/release.py patch      # 1.0.0 → 1.0.1
  python automation/release.py minor      # 1.0.0 → 1.1.0
  python automation/release.py 2.0.0      # explicit version
  python automation/release.py minor --dry-run

What it does:
  1. Checks the working tree is clean and you're on main.
  2. Bumps "version" in package.json (and package-lock.json).
  3. Writes a changelog section from commit messages since the last tag (CHANGELOG.md).
  4. Commits "Release vX.Y.Z" and creates tag vX.Y.Z.
Then `git push --follow-tags` and GitHub builds the installer and publishes the release.
Standard library + git only.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEMVER = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")


def git(*args: str, cwd: Path = ROOT, check: bool = True) -> str:
    r = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True)
    if check and r.returncode != 0:
        raise SystemExit(f"git {' '.join(args)} failed:\n{r.stderr.strip()}")
    return r.stdout.strip()


def next_version(current: str, bump: str) -> str:
    if SEMVER.match(bump):
        return bump
    m = SEMVER.match(current)
    if not m:
        raise SystemExit(f"Current version {current!r} isn't X.Y.Z")
    major, minor, patch = map(int, m.groups())
    if bump == "major":
        return f"{major + 1}.0.0"
    if bump == "minor":
        return f"{major}.{minor + 1}.0"
    if bump == "patch":
        return f"{major}.{minor}.{patch + 1}"
    raise SystemExit("Use patch, minor, major or an explicit X.Y.Z")


def changes_since_last_tag(cwd: Path) -> list[str]:
    last = git("describe", "--tags", "--abbrev=0", cwd=cwd, check=False)
    rng = f"{last}..HEAD" if last else "HEAD"
    subjects = git("log", rng, "--no-merges", "--pretty=format:%s", cwd=cwd).splitlines()
    return [s for s in subjects if s and not s.startswith("Release v")]


def changelog_section(version: str, subjects: list[str], today: dt.date) -> str:
    groups = {"Added": [], "Fixed": [], "Changed": []}
    for s in subjects:
        low = s.lower()
        key = "Fixed" if re.match(r"(fix|bug|repair|correct)", low) else "Added" if re.match(r"(add|new|build|create|support)", low) else "Changed"
        groups[key].append(s)
    out = [f"## {version} — {today:%Y-%m-%d}", ""]
    for name, items in groups.items():
        if items:
            out += [f"### {name}", *[f"- {i}" for i in items], ""]
    if not subjects:
        out += ["- Maintenance release.", ""]
    return "\n".join(out)


def bump_json_version(path: Path, version: str) -> None:
    if not path.exists():
        return
    data = json.loads(path.read_text(encoding="utf-8"))
    data["version"] = version
    if path.name == "package-lock.json" and "" in data.get("packages", {}):
        data["packages"][""]["version"] = version
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def release(bump: str, root: Path = ROOT, dry_run: bool = False, today: dt.date | None = None) -> str:
    today = today or dt.date.today()
    if git("status", "--porcelain", cwd=root):
        raise SystemExit("You have uncommitted changes. Commit or stash them first.")
    branch = git("rev-parse", "--abbrev-ref", "HEAD", cwd=root)
    if branch != "main":
        raise SystemExit(f"Releases are made from main (you're on {branch}).")
    pkg = root / "package.json"
    current = json.loads(pkg.read_text(encoding="utf-8"))["version"]
    version = next_version(current, bump)
    tag = f"v{version}"
    if git("tag", "--list", tag, cwd=root):
        raise SystemExit(f"Tag {tag} already exists.")
    section = changelog_section(version, changes_since_last_tag(root), today)
    print(f"{current} → {version}\n\n{section}")
    if dry_run:
        print("(dry run — nothing changed)")
        return version
    bump_json_version(pkg, version)
    bump_json_version(root / "package-lock.json", version)
    log = root / "CHANGELOG.md"
    old = log.read_text(encoding="utf-8") if log.exists() else "# Changelog\n\n"
    head, _, rest = old.partition("\n\n")
    log.write_text(f"{head}\n\n{section}\n{rest}".rstrip() + "\n", encoding="utf-8")
    git("add", "package.json", "package-lock.json", "CHANGELOG.md", cwd=root)
    git("commit", "-m", f"Release {tag}", cwd=root)
    git("tag", "-a", tag, "-m", f"Glass Notes {version}", cwd=root)
    print(f"\nCommitted and tagged {tag}. Publish with:\n  git push --follow-tags")
    return version


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("bump", help="patch | minor | major | X.Y.Z")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)
    release(a.bump, dry_run=a.dry_run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
