#!/usr/bin/env python3
"""Move notes between Glass Notes and plain Markdown files.

  python notes_markdown.py export OUT_DIR
      Every page becomes a .md file. Sub-pages go in folders named after their parent.
      Works with Obsidian, VS Code, GitHub, or any text editor.

  python notes_markdown.py import FOLDER_OR_FILES... [--apply]
      Turns .md files (e.g. an Obsidian vault or a Notion "Markdown & CSV" export)
      into pages, grouped under a new "Imported <date>" page.
      Without --apply it writes notes.imported.json next to your notes and changes nothing.
      With --apply it backs up notes.json first, then adds the pages. Close the app first.

Standard library only.
"""
from __future__ import annotations

import argparse
import datetime as dt
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from notes_lib import (  # noqa: E402
    default_notes_file, is_alive, load_db, markdown_to_page, new_id, page_to_markdown,
    save_db_atomic, title_of,
)

INVALID = re.compile(r'[\\/:*?"<>|\x00-\x1f]')


def safe_name(name: str) -> str:
    return INVALID.sub("", name).strip().rstrip(".")[:80] or "Untitled"


def export(db: dict, out_dir: Path) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []

    def write(page_id: str, folder: Path, used: set[str]):
        page = db["pages"].get(page_id)
        if not page or not is_alive(db, page):
            return
        base = safe_name(title_of(page))
        name, n = base, 2
        while name.lower() in used:
            name, n = f"{base} ({n})", n + 1
        used.add(name.lower())
        path = folder / f"{name}.md"
        path.write_text(page_to_markdown(page), encoding="utf-8")
        written.append(path)
        kids = [k for k in page.get("children", []) if k in db["pages"]]
        if kids:
            sub = folder / name
            sub.mkdir(exist_ok=True)
            child_used: set[str] = set()
            for k in kids:
                write(k, sub, child_used)

    root_used: set[str] = set()
    for pid in db.get("root", []):
        write(pid, out_dir, root_used)
    return written


def collect_markdown(inputs: list[Path]) -> list[Path]:
    files: list[Path] = []
    for p in inputs:
        if p.is_dir():
            files += sorted(x for x in p.rglob("*.md") if not any(part.startswith(".") for part in x.parts))
        elif p.suffix.lower() in (".md", ".markdown", ".txt"):
            files.append(p)
    return files


def import_files(db: dict, files: list[Path], base: Path | None = None) -> dict:
    """Add pages for the given files under a new parent page. Mirrors folder structure."""
    now = int(dt.datetime.now().timestamp() * 1000)
    holder = {
        "id": new_id(), "parentId": None, "children": [], "favorite": False, "trashed": False,
        "createdAt": now, "updatedAt": now, "font": "sans", "wide": False,
        "title": f"Imported {dt.date.today():%b %d, %Y}", "icon": "📥", "cover": None,
        "blocks": [{"id": new_id(), "type": "p", "html": f"{len(files)} pages imported from Markdown."}],
    }
    db["pages"][holder["id"]] = holder
    db.setdefault("root", []).append(holder["id"])
    folders: dict[Path, str] = {}

    def parent_for(rel_dir: Path) -> str:
        if rel_dir in (Path("."), Path("")):
            return holder["id"]
        if rel_dir in folders:
            return folders[rel_dir]
        parent = parent_for(rel_dir.parent)
        # Reuse a page with the same title as the folder (Obsidian/Notion style), else make one.
        for cid in db["pages"][parent]["children"]:
            if title_of(db["pages"][cid]).lower() == rel_dir.name.lower():
                folders[rel_dir] = cid
                return cid
        page = markdown_to_page("", fallback_title=rel_dir.name)
        page["icon"] = "📁"
        attach(page, parent)
        folders[rel_dir] = page["id"]
        return page["id"]

    def attach(page: dict, parent_id: str):
        page["parentId"] = parent_id
        db["pages"][page["id"]] = page
        db["pages"][parent_id]["children"].append(page["id"])

    for f in files:
        rel = f.relative_to(base) if base and f.is_relative_to(base) else Path(f.name)
        text = f.read_text(encoding="utf-8", errors="replace")
        title = re.sub(r"\s[0-9a-f]{32}$", "", f.stem)  # Notion appends an id to file names
        page = markdown_to_page(text, fallback_title=title)
        parent = parent_for(rel.parent)
        # A folder page and a same-named .md file are the same page: merge content.
        existing = next((db["pages"][c] for c in db["pages"][parent]["children"]
                         if title_of(db["pages"][c]).lower() == title_of(page).lower() and db["pages"][c].get("icon") == "📁"), None)
        if existing:
            existing.update({"blocks": page["blocks"], "icon": page["icon"] or "", "title": title_of(page)})
        else:
            attach(page, parent)
    return holder


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    ex = sub.add_parser("export")
    ex.add_argument("out_dir", type=Path)
    im = sub.add_parser("import")
    im.add_argument("inputs", type=Path, nargs="+")
    im.add_argument("--apply", action="store_true", help="write into notes.json (after a backup)")
    im.add_argument("--yes", action="store_true", help="don't ask to confirm the app is closed")
    for p in (ex, im):
        p.add_argument("--notes", type=Path, default=default_notes_file(), help="path to notes.json")
    a = ap.parse_args(argv)

    if not a.notes.exists():
        print(f"Can't find {a.notes}. Pass --notes.", file=sys.stderr)
        return 1
    db = load_db(a.notes)

    if a.cmd == "export":
        files = export(db, a.out_dir)
        print(f"Exported {len(files)} pages to {a.out_dir}")
        return 0

    files = collect_markdown(a.inputs)
    if not files:
        print("No .md files found.", file=sys.stderr)
        return 1
    base = a.inputs[0] if len(a.inputs) == 1 and a.inputs[0].is_dir() else None
    holder = import_files(db, files, base)
    if not a.apply:
        out = a.notes.with_name("notes.imported.json")
        save_db_atomic(db, out)
        print(f"Preview: {len(files)} pages under “{holder['title']}” → {out}\n"
              f"Nothing changed in your notes. Re-run with --apply to add them.")
        return 0
    if not a.yes and input("Is Glass Notes closed? It would overwrite these changes otherwise. [y/N] ").strip().lower() != "y":
        print("Cancelled.")
        return 1
    from notes_backup import default_dest, run as backup
    backup(a.notes, default_dest(), force=True)
    save_db_atomic(db, a.notes)
    print(f"Added {len(files)} pages under “{holder['title']}”.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
