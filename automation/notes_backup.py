#!/usr/bin/env python3
"""Back up Glass Notes on a schedule and keep a sensible history.

  python notes_backup.py run              # make a backup now (skips if nothing changed)
  python notes_backup.py list             # show existing backups
  python notes_backup.py schedule         # print the command that runs it daily on Windows

Backups are compressed, checked after writing, and pruned to:
  every backup from the last 2 days, one per day for 14 days,
  one per week for 8 weeks and one per month for 12 months.
Standard library only. Never modifies notes.json.
"""
from __future__ import annotations

import argparse
import datetime as dt
import gzip
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from notes_lib import default_notes_file, load_db  # noqa: E402

PREFIX = "notes-"
SUFFIX = ".json.gz"
STAMP = "%Y%m%d-%H%M%S"


def default_dest() -> Path:
    return Path.home() / "Documents" / "Glass Notes Backups"


def backups(dest: Path) -> list[tuple[dt.datetime, Path]]:
    out = []
    for p in dest.glob(f"{PREFIX}*{SUFFIX}"):
        try:
            when = dt.datetime.strptime(p.name[len(PREFIX):-len(SUFFIX)], STAMP)
        except ValueError:
            continue  # not ours; never touch it
        out.append((when, p))
    return sorted(out)


def digest_of(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def run(source: Path, dest: Path, now: dt.datetime | None = None, force: bool = False) -> Path | None:
    now = now or dt.datetime.now()
    raw = source.read_bytes()
    db = json.loads(raw)  # refuse to back up a corrupt file
    if not isinstance(db, dict) or "pages" not in db:
        raise ValueError(f"{source} does not look like a Glass Notes file")
    dest.mkdir(parents=True, exist_ok=True)
    existing = backups(dest)
    if existing and not force:
        last = gzip.decompress(existing[-1][1].read_bytes())
        if digest_of(last) == digest_of(raw):
            print(f"No changes since {existing[-1][1].name} — skipped.")
            return None
    target = dest / f"{PREFIX}{now.strftime(STAMP)}{SUFFIX}"
    tmp = target.with_suffix(".tmp")
    tmp.write_bytes(gzip.compress(raw, compresslevel=9))
    # Verify the written copy before keeping it.
    if digest_of(gzip.decompress(tmp.read_bytes())) != digest_of(raw):
        tmp.unlink()
        raise IOError("Backup verification failed; nothing was kept")
    tmp.replace(target)
    pages = sum(1 for p in db["pages"].values() if not p.get("trashed"))
    print(f"Backed up {pages} pages → {target} ({target.stat().st_size / 1024:.0f} KB)")
    prune(dest, now)
    return target


def keep_set(items: list[tuple[dt.datetime, Path]], now: dt.datetime) -> set[Path]:
    keep: set[Path] = set()
    seen_day, seen_week, seen_month = set(), set(), set()
    for when, path in sorted(items, reverse=True):  # newest first
        age = now - when
        day, week, month = when.date(), when.isocalendar()[:2], (when.year, when.month)
        if age <= dt.timedelta(days=2):
            keep.add(path)
        if age <= dt.timedelta(days=14) and day not in seen_day:
            keep.add(path)
        if age <= dt.timedelta(weeks=8) and week not in seen_week:
            keep.add(path)
        if age <= dt.timedelta(days=366) and month not in seen_month:
            keep.add(path)
        seen_day.add(day); seen_week.add(week); seen_month.add(month)
    if items:
        keep.add(max(items)[1])  # never delete the newest backup
    return keep


def prune(dest: Path, now: dt.datetime) -> list[Path]:
    items = backups(dest)
    keep = keep_set(items, now)
    removed = []
    for _, path in items:
        if path not in keep:
            path.unlink()
            removed.append(path)
    if removed:
        print(f"Pruned {len(removed)} old backup(s).")
    return removed


def list_backups(dest: Path) -> None:
    items = backups(dest)
    if not items:
        print(f"No backups in {dest}")
        return
    for when, p in items:
        print(f"{when:%Y-%m-%d %H:%M:%S}  {p.stat().st_size / 1024:8.0f} KB  {p.name}")


def schedule_hint() -> None:
    script = Path(__file__).resolve()
    print("Windows (run once in a terminal):")
    print(f'  schtasks /Create /SC DAILY /ST 21:00 /TN "Glass Notes backup" /TR "pythonw \\"{script}\\" run" /F')
    print("\nmacOS / Linux (add with `crontab -e`):")
    print(f"  0 21 * * * python3 '{script}' run")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["run", "list", "schedule"])
    ap.add_argument("--source", type=Path, default=default_notes_file(), help="notes.json to back up")
    ap.add_argument("--dest", type=Path, default=default_dest(), help="folder for backups")
    ap.add_argument("--force", action="store_true", help="back up even if nothing changed")
    a = ap.parse_args(argv)
    if a.command == "list":
        list_backups(a.dest)
    elif a.command == "schedule":
        schedule_hint()
    else:
        if not a.source.exists():
            print(f"Can't find {a.source}. Pass --source.", file=sys.stderr)
            return 1
        load_db(a.source)
        run(a.source, a.dest, force=a.force)
    return 0


if __name__ == "__main__":
    sys.exit(main())
