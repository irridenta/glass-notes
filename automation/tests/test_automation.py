"""Tests for the automation scripts. Run:  python -m unittest discover automation/tests -v"""
from __future__ import annotations

import datetime as dt
import gzip
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import notes_backup  # noqa: E402
import notes_digest  # noqa: E402
import notes_lib  # noqa: E402
import notes_markdown  # noqa: E402
import release  # noqa: E402

FIXTURE = HERE / "fixtures" / "notes.sample.json"


def quiet(fn, *a, **k):
    with redirect_stdout(io.StringIO()):
        return fn(*a, **k)


class TempDirCase(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.notes = self.tmp / "notes.json"
        shutil.copy(FIXTURE, self.notes)

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)


class BackupTests(TempDirCase):
    def test_backup_is_compressed_and_identical(self):
        dest = self.tmp / "backups"
        out = quiet(notes_backup.run, self.notes, dest)
        self.assertTrue(out.name.endswith(".json.gz"))
        self.assertEqual(gzip.decompress(out.read_bytes()), self.notes.read_bytes())

    def test_skips_when_unchanged_and_runs_when_changed(self):
        dest = self.tmp / "backups"
        t0 = dt.datetime(2026, 11, 1, 9, 0, 0)
        quiet(notes_backup.run, self.notes, dest, now=t0)
        self.assertIsNone(quiet(notes_backup.run, self.notes, dest, now=t0 + dt.timedelta(hours=1)))
        db = json.loads(self.notes.read_text())
        next(iter(db["pages"].values()))["title"] = "Changed"
        self.notes.write_text(json.dumps(db))
        self.assertIsNotNone(quiet(notes_backup.run, self.notes, dest, now=t0 + dt.timedelta(hours=2)))
        self.assertEqual(len(notes_backup.backups(dest)), 2)

    def test_refuses_corrupt_source(self):
        self.notes.write_text("{not json")
        with self.assertRaises(ValueError):
            quiet(notes_backup.run, self.notes, self.tmp / "b")

    def test_rotation_policy(self):
        now = dt.datetime(2026, 11, 7, 21, 0)
        items = []
        # one backup every 6 hours for 400 days
        for h in range(0, 400 * 24, 6):
            when = now - dt.timedelta(hours=h)
            items.append((when, Path(f"{notes_backup.PREFIX}{when:%Y%m%d-%H%M%S}{notes_backup.SUFFIX}")))
        keep = notes_backup.keep_set(items, now)
        kept_times = sorted(w for w, p in items if p in keep)
        self.assertIn(now, kept_times)  # newest always kept
        recent = [w for w in kept_times if now - w <= dt.timedelta(days=2)]
        self.assertEqual(len(recent), 9)  # everything from the last 2 days
        self.assertTrue(all(now - w <= dt.timedelta(days=366) for w in kept_times))
        self.assertLess(len(keep), 45)  # bounded history

    def test_prune_ignores_foreign_files(self):
        dest = self.tmp / "b"
        dest.mkdir()
        (dest / "my-notes.txt").write_text("keep me")
        (dest / "notes-garbage.json.gz").write_text("not a stamp")
        quiet(notes_backup.prune, dest, dt.datetime.now())
        self.assertTrue((dest / "my-notes.txt").exists())
        self.assertTrue((dest / "notes-garbage.json.gz").exists())


class MarkdownTests(TempDirCase):
    def test_export_writes_tree(self):
        db = notes_lib.load_db(self.notes)
        files = notes_markdown.export(db, self.tmp / "md")
        names = {f.relative_to(self.tmp / "md").as_posix() for f in files}
        self.assertIn("Welcome to Glass Notes.md", names)
        self.assertIn("Welcome to Glass Notes/Keyboard shortcuts.md", names)
        text = (self.tmp / "md" / "Welcome to Glass Notes" / "A tidy week.md").read_text()
        self.assertIn("- [x] Try the **/** menu on an empty line", text)
        self.assertIn("==highlight==", text)
        self.assertIn("```\nconst plan", text)

    def test_locked_page_exports_placeholder_only(self):
        page = {"id": "x", "title": "Diary", "locked": {"v": 1}, "blocks": []}
        md = notes_lib.page_to_markdown(page)
        self.assertIn("# Diary", md)
        self.assertIn("password-protected", md)

    def test_round_trip_keeps_structure(self):
        db = notes_lib.load_db(self.notes)
        original = next(p for p in db["pages"].values() if p["title"] == "A tidy week")
        md = notes_lib.page_to_markdown(original)
        back = notes_lib.markdown_to_page(md)
        self.assertEqual(back["title"], "A tidy week")
        self.assertEqual(back["icon"], "🌿")
        self.assertEqual(back["cover"], "mint")
        strip = lambda bs: [(b["type"], bool(b.get("checked")), notes_lib.html_to_text(b["html"]).strip()) for b in bs]
        self.assertEqual(strip(back["blocks"]), strip(original["blocks"]))

    def test_parses_common_markdown(self):
        page = notes_lib.markdown_to_page(
            "# Trip plan\n\nIntro with **bold**, *italic* and [a link](https://example.com).\n\n"
            "## Packing\n- passport\n  - copies\n- [ ] book hotel\n- [x] flights\n1. first\n2. second\n\n"
            "> 💡 Remember adapters\n\n> Just a quote\n\n---\n```\ncode()\n```\n")
        types = [(b["type"], b.get("indent", 0)) for b in page["blocks"]]
        self.assertEqual(page["title"], "Trip plan")
        self.assertEqual(types, [("p", 0), ("h1", 0), ("bullet", 0), ("bullet", 1), ("todo", 0), ("todo", 0),
                                 ("number", 0), ("number", 0), ("callout", 0), ("quote", 0), ("divider", 0), ("code", 0)])
        self.assertIn('<a href="https://example.com"', page["blocks"][0]["html"])
        self.assertIn("<b>bold</b>", page["blocks"][0]["html"])
        self.assertTrue(page["blocks"][5].get("checked"))
        self.assertEqual(page["blocks"][8]["emoji"], "💡")

    def test_rejects_script_links(self):
        page = notes_lib.markdown_to_page("[click](javascript:alert(1)) <script>x</script>")
        html = page["blocks"][0]["html"]
        self.assertNotIn("javascript:", html)
        self.assertNotIn("<script>", html)

    def test_import_preview_does_not_touch_notes(self):
        vault = self.tmp / "vault"
        (vault / "Projects").mkdir(parents=True)
        (vault / "Inbox.md").write_text("- [ ] call bank\n")
        (vault / "Projects" / "Garden abc0123456789abc0123456789abcdef.md").write_text("Plant tomatoes\n")
        (vault / ".obsidian").mkdir()
        (vault / ".obsidian" / "skip.md").write_text("ignore")
        before = self.notes.read_bytes()
        quiet(notes_markdown.main, ["import", str(vault), "--notes", str(self.notes)])
        self.assertEqual(self.notes.read_bytes(), before)
        preview = json.loads((self.tmp / "notes.imported.json").read_text())
        titles = {p["title"] for p in preview["pages"].values()}
        self.assertTrue({"Inbox", "Projects", "Garden"} <= titles)
        self.assertNotIn("skip", titles)
        garden = next(p for p in preview["pages"].values() if p["title"] == "Garden")
        self.assertEqual(preview["pages"][garden["parentId"]]["title"], "Projects")

    def test_import_apply_backs_up_first(self):
        (self.tmp / "a.md").write_text("# Alpha\nhello")
        old_home = os.environ.get("HOME")
        os.environ["HOME"] = str(self.tmp)  # backups go to <HOME>/Documents/...
        try:
            quiet(notes_markdown.main, ["import", str(self.tmp / "a.md"), "--notes", str(self.notes), "--apply", "--yes"])
        finally:
            if old_home is not None:
                os.environ["HOME"] = old_home
        db = notes_lib.load_db(self.notes)
        self.assertTrue(any(p["title"] == "Alpha" for p in db["pages"].values()))
        backups = list((self.tmp / "Documents" / "Glass Notes Backups").glob("notes-*.json.gz"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(json.loads(gzip.decompress(backups[0].read_bytes())), json.loads(FIXTURE.read_text()))


class FakeClient:
    def __init__(self, stop_reason="end_turn", text="## What you worked on\n- Things"):
        self.calls = []
        self.beta = SimpleNamespace(messages=SimpleNamespace(create=self._create))
        self.stop_reason, self.text = stop_reason, text

    def _create(self, **kwargs):
        self.calls.append(kwargs)
        return SimpleNamespace(stop_reason=self.stop_reason, content=[SimpleNamespace(type="text", text=self.text)])


class DigestTests(TempDirCase):
    def now_after_fixture(self, days=1):
        newest = max(p["updatedAt"] for p in json.loads(FIXTURE.read_text())["pages"].values())
        return (dt.datetime.fromtimestamp(newest / 1000) + dt.timedelta(days=days)).isoformat()

    def test_offline_lists_pages_and_open_todos(self):
        out = self.tmp / "review.md"
        quiet(notes_digest.main, ["--notes", str(self.notes), "--offline", "--out", str(out), "--now", self.now_after_fixture()])
        text = out.read_text()
        self.assertIn("A tidy week", text)
        self.assertIn("- [ ] Give this page a new cover (A tidy week)", text)
        self.assertNotIn("Try the / menu", text)  # checked to-dos are not "open"
        self.assertTrue(text.startswith("---\ntitle:"))  # importable with notes_markdown

    def test_nothing_recent(self):
        out = self.tmp / "review.md"
        quiet(notes_digest.main, ["--notes", str(self.notes), "--offline", "--out", str(out), "--now", self.now_after_fixture(days=30)])
        self.assertIn("No pages were edited", out.read_text())

    def test_ai_request_shape(self):
        out = self.tmp / "review.md"
        client = FakeClient()
        quiet(notes_digest.main, ["--notes", str(self.notes), "--out", str(out), "--now", self.now_after_fixture()], client=client)
        call = client.calls[0]
        self.assertEqual(call["model"], "claude-opus-5-5")
        self.assertEqual(call["fallbacks"], "default")
        self.assertEqual(call["betas"], ["server-side-fallback-2026-07-01"])
        self.assertNotIn("thinking", call)
        user = call["messages"][0]["content"]
        self.assertIn('title="A tidy week"', user)
        self.assertIn("## What you worked on", out.read_text())

    def test_refusal_is_reported(self):
        client = FakeClient(stop_reason="refusal", text="")
        with self.assertRaises(SystemExit):
            quiet(notes_digest.main, ["--notes", str(self.notes), "--out", str(self.tmp / "r.md"), "--now", self.now_after_fixture()], client=client)

    def test_locked_pages_are_never_sent(self):
        db = json.loads(self.notes.read_text())
        for p in db["pages"].values():
            if p["title"] == "A tidy week":
                p["locked"] = {"v": 1, "data": "AAAA", "iv": "AAAA", "salt": "AAAA"}
                p["blocks"] = []
        self.notes.write_text(json.dumps(db))
        client = FakeClient()
        quiet(notes_digest.main, ["--notes", str(self.notes), "--out", str(self.tmp / "r.md"), "--now", self.now_after_fixture()], client=client)
        self.assertNotIn("A tidy week", client.calls[0]["messages"][0]["content"])

    def test_trashed_pages_are_excluded(self):
        db = json.loads(self.notes.read_text())
        for p in db["pages"].values():
            if p["title"] == "A tidy week":
                p["trashed"] = True
        self.notes.write_text(json.dumps(db))
        out = self.tmp / "review.md"
        quiet(notes_digest.main, ["--notes", str(self.notes), "--offline", "--out", str(out), "--now", self.now_after_fixture()])
        self.assertNotIn("A tidy week", out.read_text())


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.repo = Path(tempfile.mkdtemp())
        g = lambda *a: subprocess.run(["git", *a], cwd=self.repo, check=True, capture_output=True)
        self.git = g
        g("init", "-q", "-b", "main")
        g("config", "user.email", "t@example.com"); g("config", "user.name", "Test")
        (self.repo / "package.json").write_text(json.dumps({"name": "x", "version": "1.0.0"}, indent=2))
        (self.repo / "package-lock.json").write_text(json.dumps({"version": "1.0.0", "packages": {"": {"version": "1.0.0"}}}))
        g("add", "-A"); g("commit", "-qm", "Initial app")
        g("tag", "-a", "v1.0.0", "-m", "first")
        (self.repo / "a.txt").write_text("a"); g("add", "-A"); g("commit", "-qm", "Add export to PDF")
        (self.repo / "b.txt").write_text("b"); g("add", "-A"); g("commit", "-qm", "Fix slash menu not applying")

    def tearDown(self):
        shutil.rmtree(self.repo, ignore_errors=True)

    def test_next_version(self):
        self.assertEqual(release.next_version("1.2.3", "patch"), "1.2.4")
        self.assertEqual(release.next_version("1.2.3", "minor"), "1.3.0")
        self.assertEqual(release.next_version("1.2.3", "major"), "2.0.0")
        self.assertEqual(release.next_version("1.2.3", "4.0.0"), "4.0.0")

    def test_dry_run_changes_nothing(self):
        quiet(release.release, "minor", root=self.repo, dry_run=True)
        self.assertEqual(json.loads((self.repo / "package.json").read_text())["version"], "1.0.0")
        self.assertFalse((self.repo / "CHANGELOG.md").exists())

    def test_release_bumps_tags_and_writes_changelog(self):
        quiet(release.release, "minor", root=self.repo, today=dt.date(2026, 11, 8))
        self.assertEqual(json.loads((self.repo / "package.json").read_text())["version"], "1.1.0")
        lock = json.loads((self.repo / "package-lock.json").read_text())
        self.assertEqual((lock["version"], lock["packages"][""]["version"]), ("1.1.0", "1.1.0"))
        log = (self.repo / "CHANGELOG.md").read_text()
        self.assertIn("## 1.1.0 — 2026-11-08", log)
        self.assertIn("### Added\n- Add export to PDF", log)
        self.assertIn("### Fixed\n- Fix slash menu not applying", log)
        self.assertNotIn("Initial app", log)  # before the last tag
        tags = subprocess.run(["git", "tag"], cwd=self.repo, capture_output=True, text=True).stdout.split()
        self.assertIn("v1.1.0", tags)
        # A second release puts the newest section on top.
        (self.repo / "c.txt").write_text("c"); self.git("add", "-A"); self.git("commit", "-qm", "Fix typo")
        quiet(release.release, "patch", root=self.repo, today=dt.date(2026, 11, 9))
        log = (self.repo / "CHANGELOG.md").read_text()
        self.assertLess(log.index("## 1.1.1"), log.index("## 1.1.0"))

    def test_refuses_dirty_tree(self):
        (self.repo / "dirty.txt").write_text("x")
        with self.assertRaises(SystemExit):
            quiet(release.release, "patch", root=self.repo)


if __name__ == "__main__":
    unittest.main()
