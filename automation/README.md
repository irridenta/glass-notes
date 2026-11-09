# Glass Notes automation

Five tools that take repetitive work off your hands. All are tested (`20` unit tests + a `9`-step end-to-end app test).

| Tool | What it does | Needs |
|---|---|---|
| `smoke-test.js` | Opens the real app, uses it like a person, fails if anything core breaks | Node, `npm i --no-save playwright` |
| `release.py` | Bumps the version, writes the changelog, commits and tags a release | Python 3.9+, git |
| `notes_backup.py` | Compressed, verified, rotating backups of your notes | Python 3.9+ |
| `notes_markdown.py` | Export all notes to Markdown; import Markdown (Obsidian, Notion) as pages | Python 3.9+ |
| `notes_digest.py` | AI weekly review: what you worked on, open to-dos, loose ends | Python 3.9+, `pip install anthropic`, an API key |

Python tools use only the standard library (except the AI review). Nothing here changes `notes.json` unless you pass `--apply`, and even then a backup is made first.

---

## 1. App smoke test

```bash
npm i --no-save playwright          # once
node automation/smoke-test.js       # Windows/macOS
xvfb-run -a node automation/smoke-test.js   # Linux without a screen
```
Checks: app starts, new page + markdown shortcuts + list indenting, slash menu (quote, code), to-do + undo/redo, search, web-page and PDF export (fonts embedded, valid PDF), trash/restore, notes survive a restart, and no console errors. Uses a throwaway data folder, so your notes are never touched. Failure screenshots land in `automation/smoke-output/`.

**Run it on GitHub automatically:** move `automation/ci/tests.yml` to `.github/workflows/tests.yml` and push. Every push and pull request then runs the unit tests and the smoke test.

## 2. One-command releases

```bash
python automation/release.py patch --dry-run   # preview: 1.0.0 → 1.0.1 and the changelog
python automation/release.py patch             # do it: bump, CHANGELOG.md, commit, tag v1.0.1
git push --follow-tags
```
Write commit messages starting with *Add…* or *Fix…* and they're sorted into the right changelog section.

**Switch the GitHub build to releases-on-tag** (recommended once you use `release.py`): replace `.github/workflows/build-windows.yml` with `automation/ci/build-windows-on-tag.yml`. Then a release is built only when you push a tag, only if the smoke test passes, and the release notes come from `CHANGELOG.md`. Today, every push to `main` re-uploads the files to the same `v1.0.0` release.

## 3. Automatic backups

```bash
python automation/notes_backup.py run        # back up now (skips if nothing changed)
python automation/notes_backup.py list
python automation/notes_backup.py schedule   # prints the one-line command to run it daily
```
On Windows, paste the `schtasks` line it prints into a terminal once; it then runs every evening at 21:00.
Backups go to `Documents\Glass Notes Backups` as `notes-YYYYMMDD-HHMMSS.json.gz`. History kept: everything from the last 2 days, then one per day (14 days), per week (8 weeks), per month (12 months).
**Restore:** close the app, unzip a backup (7-Zip, or `python -c "import gzip,shutil;shutil.copyfileobj(gzip.open('FILE.json.gz'),open('notes.json','wb'))"`) and put it in `%APPDATA%\Glass Notes\`.

## 4. Markdown export / import

```bash
python automation/notes_markdown.py export "D:\Notes as Markdown"
python automation/notes_markdown.py import "C:\path\to\Obsidian vault"            # preview only
python automation/notes_markdown.py import "C:\path\to\Obsidian vault" --apply    # close the app first
```
Export keeps headings, lists (with nesting), to-dos (ticked or not), quotes, callouts, code, links, bold/italic/highlight, and the page tree as folders. Import understands the same, plus Notion's file names (it strips Notion's long ids). Folders become parent pages; everything lands under a new **📥 Imported <date>** page so it's easy to review or delete.

## 5. AI weekly review

```bash
pip install anthropic
set ANTHROPIC_API_KEY=sk-ant-...          # Windows (PowerShell: $env:ANTHROPIC_API_KEY="...")
python automation/notes_digest.py                     # last 7 days
python automation/notes_digest.py --days 30
python automation/notes_digest.py --offline           # no AI, no key needed
python automation/notes_markdown.py import "Weekly review 2026-11-08.md" --apply   # add it as a page
```
Uses Claude Opus 5.5 at medium effort. If a safety check declines the request, the API retries it on a suitable model automatically (`fallbacks: "default"`). Only pages edited in the chosen period are sent; requests are capped at about 100k tokens (at most about $0.50 per review; a typical week of notes is under $0.10). Schedule it weekly the same way as backups (e.g. `schtasks /SC WEEKLY /D SUN /ST 18:00 ...`).

---

## Tests

```bash
python -m unittest discover automation/tests -v     # 20 tests, ~2 s
xvfb-run -a node automation/smoke-test.js            # 9 checks, ~20 s
```
`tests/fixtures/notes.sample.json` is made-up sample data (the app's welcome pages), not real notes.
