# Automation report

*November 8, 2026 · covers the `glass-notes` and `Irridenta` repositories and the tools connected to this workspace*

## Summary

I found **15 repetitive tasks** worth automating. I built and tested the **5 with the highest impact**, all for Glass Notes:

| # | Prototype | Status | Saves (estimate) |
|---|---|---|---|
| 1 | End-to-end app test | ✅ 9/9 checks pass; confirmed it catches a real past bug | 30–45 min per release, and stops broken releases |
| 2 | One-command release + tag-based builds | ✅ 5 tests pass | 20–30 min per release |
| 3 | Scheduled, verified, rotating notes backups | ✅ 5 tests pass | 10 min/week, plus protection against data loss |
| 4 | Markdown export / import (Obsidian, Notion) | ✅ 6 tests pass; imported pages open correctly in the app | 3–5 min per page moved; hours for a one-off migration |
| 5 | AI weekly review of your notes | ✅ 5 tests pass (simulated AI reply) | 30–45 min/week |

Together these save roughly **2–4 hours a month** at a modest pace of work (2 releases and 4 weekly reviews a month). They also remove the two biggest risks I saw: losing your notes, and shipping a broken build.

Everything is in the new `automation/` folder, with step-by-step instructions in [`automation/README.md`](README.md). I didn't change, delete or push any existing files.

---

## What I looked at

| Asset | What's there | Notes |
|---|---|---|
| `irridenta/glass-notes` | Electron notes app (≈3,100 lines), GitHub build that publishes a Windows installer on every push | Built in this session; I know how it's built and released |
| `irridenta/Irridenta` | Eye-tracking mouse control in Python (OpenCV + dlib, Windows cursor control) | Also your GitHub profile repo; read only |
| Connected tools | Gmail, Google Calendar, Google Drive, Claude Docs | I did **not** open any email, event or file — only noted they're available |
| Claude Code plugin | research-superpowers (literature search, sources, manuscript drafting) | Already covers research workflows; nothing to add |

Things I noticed in `Irridenta`: the 96 MB face model and 6 compiled `__pycache__` files are committed to git; there's no `requirements.txt`; `build_and_run.sh` builds a Docker image, but there's no `Dockerfile`; and the eye calibration (center point, sensitivity) is set by hotkeys and lost every time the program closes.

---

## The 15 opportunities

Difficulty: **Easy** = under 2 hours, **Medium** = half a day to 2 days, **Hard** = several days or needs outside accounts. Time savings are estimates based on the frequencies noted.

| # | Task today | Automation | Technology | Difficulty | Time saved |
|---|---|---|---|---|---|
| 1 | **Testing the app by hand before a release** — open it, click through pages, export, check nothing broke | Scripted end-to-end test that drives the real app; runs on every push | Playwright + Electron, GitHub Actions | Medium | 30–45 min/release |
| 2 | **Releasing**: edit the version by hand, write notes, build. Today every push to `main` silently replaces the files in release v1.0.0 | `release.py patch` bumps the version, writes the changelog, tags; GitHub builds only on tags, only after tests pass | Python, git, GitHub Actions | Easy | 20–30 min/release |
| 3 | **Backing up notes** — copy `notes.json` by hand, or (more likely) never | Daily compressed backup, checked after writing, with a sensible history | Python, Windows Task Scheduler | Easy | 10 min/week + risk |
| 4 | **Moving notes in and out** — copy and paste page by page from Obsidian/Notion, or to share as text | Bulk Markdown export and import with folders → sub-pages | Python | Medium | 3–5 min/page |
| 5 | **Weekly review** — re-read the week's pages to find open to-dos and loose ends | Claude reads pages edited this week and writes a structured review you can add as a page | Python + Claude API | Easy | 30–45 min/week |
| 6 | **Daily journal** — open the app, pick the journal template every morning | A "daily note" setting that creates today's page on launch | App feature (JavaScript) | Easy | 1–2 min/day |
| 7 | **Meeting notes** — copy title, time and attendees from your calendar into the template | Create a pre-filled meeting page from a calendar event | Google Calendar API / connector | Medium | 3–5 min/meeting |
| 8 | **Saving emails to notes** — copy and paste email content | Label an email "To notes" → it becomes a Markdown page you import | Gmail API (or Apps Script) + `notes_markdown.py` | Medium | 2–3 min/email |
| 9 | **Sharing exports** — export a PDF, then upload/attach by hand | "Share to Google Drive" option that uploads the export and copies a link | Google Drive API | Medium | 2–3 min/share |
| 10 | **Regenerating app icons** — a one-off script made the PNG/ICO sizes | Commit it as `npm run icons` | Node + Playwright | Easy | 15 min/icon change |
| 11 | **Keeping Electron and libraries patched** — check for security updates by hand | Weekly update pull requests, checked by the tests from #1 | GitHub Dependabot | Easy | 30 min/month + security |
| 12 | **"Windows protected your PC" warning** for everyone who installs | Code-sign the installer in the build | Azure Trusted Signing (~$10/month) in GitHub Actions | Hard | Support time; user trust |
| 13 | **Irridenta setup and repo upkeep** — clone 96 MB+, install dlib/OpenCV by trial and error, cache files committed | `.gitignore`, `requirements.txt`, model downloaded on first run (or Git LFS), working Dockerfile | git, pip, Docker | Easy | 30–60 min per new machine |
| 14 | **Irridenta calibration** — press C and tune sensitivity with hotkeys every session; lost on exit | Save calibration to a profile file; 5-dot guided calibration on first run | Python (JSON) | Medium | 1–3 min per session + accuracy |
| 15 | **Irridenta distribution** — others must install Python, dlib and OpenCV | Packaged `.exe` built by GitHub Actions, like Glass Notes | PyInstaller + GitHub Actions | Medium–Hard | 30–60 min per person |

---

## Why these 5

I ranked by **time saved × how often it happens × what goes wrong without it**, then by whether I could build and *prove* it works here:

1. **App test (#1)**: guards every future change. While building the app I fixed bugs (a slash menu that ignored Enter, a broken code block) that only showed up by clicking through it. This test would have caught them automatically.
2. **Releases (#2)**: the current setup has a real flaw: every push to `main` replaces the files in the existing v1.0.0 release, so the download page can change without notice.
3. **Backups (#3)**: all your notes live in one file on one computer. The app keeps only one previous copy. This is the cheapest protection against the most painful failure.
4. **Markdown (#4)**: no lock-in. Notes can leave the app (Obsidian, GitHub, any editor) and come in from Notion or Obsidian.
5. **AI review (#5)**: the biggest weekly time saver, and the only one where AI clearly beats a script.

The Irridenta items (#14, #15) are valuable, but they need a webcam and a Windows desktop to test, so I left them as next steps rather than ship something untested.

---

## What I built and how I tested it

| Prototype | Files | How it was tested |
|---|---|---|
| App test | `automation/smoke-test.js` | Ran against the real app: **9/9 pass** (~20 s). Then I put the old slash-menu bug back in a throwaway copy: the test **failed on that step**, saved a screenshot and exited with an error code, as a build system needs. |
| Releases | `automation/release.py`, `automation/ci/build-windows-on-tag.yml` | 5 tests on a temporary git repo: version math, dry run changes nothing, bumps `package.json` and the lock file, sorts commits into Added/Fixed, newest changelog on top, refuses uncommitted changes. Workflow YAML validated; the changelog → release-notes step tested on its own. |
| Backups | `automation/notes_backup.py` | 5 tests: byte-identical restore, skips when nothing changed, refuses a corrupt file, 400-day history pruned to under 45 files with the newest always kept, never deletes files it didn't make. Also ran from the command line. |
| Markdown | `automation/notes_markdown.py`, `automation/notes_lib.py` | 6 tests: export folder tree, **round trip keeps every block type and to-do state**, common Markdown parsing, blocks `javascript:` links and `<script>`, preview leaves notes untouched, `--apply` backs up first. Imported pages were opened in the real app and look identical to the originals. |
| AI review | `automation/notes_digest.py` | 5 tests with a simulated Claude reply: correct model and safety fallback settings, only recent non-deleted pages sent, refusals handled, offline mode lists open to-dos only. **Not tested against the live API**: there's no API key in this session. |
| GitHub automation | `automation/ci/tests.yml` | YAML validated. It hasn't run on GitHub yet because I haven't pushed anything. |

**Totals:** 20 unit tests in ~2 seconds, plus the 9-step app test. Test data is made-up sample notes (the app's welcome pages), not your notes.

---

## How to start using them

Full commands are in [`automation/README.md`](README.md). In short:

1. **Commit the folder.** It's new and not pushed yet. Say "push the automation folder" and I'll do it.
2. **Turn on tests:** move `automation/ci/tests.yml` to `.github/workflows/`.
3. **Start backups:** `python automation/notes_backup.py schedule`, then paste the printed line into a Windows terminal once.
4. **Switch releases to tags:** replace `.github/workflows/build-windows.yml` with `automation/ci/build-windows-on-tag.yml`, then release with `python automation/release.py patch` and `git push --follow-tags`.
5. **Try the AI review:** `pip install anthropic`, set `ANTHROPIC_API_KEY`, run `python automation/notes_digest.py`.

---

## Roadmap

| When | Do | Effort | Why now |
|---|---|---|---|
| **Today** | Commit `automation/`, turn on tests (#1), schedule backups (#3) | 30 min | Protects your notes and the code immediately |
| **This week** | Tag-based releases (#2); Dependabot (#11) | 1 hour | Fixes the release-overwrite issue; tests from #1 make update PRs safe to merge |
| **Weeks 2–3** | Weekly AI review on a schedule (#5); Markdown export as a second, readable backup (#4); `npm run icons` (#10) | 2 hours | Weekly time savings start adding up |
| **Month 2** | Irridenta: `.gitignore`, `requirements.txt`, model download, Dockerfile (#13); save calibration (#14) | 1–2 days | Makes the project easy to set up and nicer to use daily |
| **Month 2–3** | App features: daily note (#6), calendar meeting notes (#7) | 2–3 days | Removes small daily frictions; #7 uses your connected calendar |
| **Later** | Gmail → notes (#8), share to Drive (#9), Irridenta `.exe` (#15), code signing (#12) | 1–2 weeks | Useful, but needs account setup, costs money, or depends on earlier steps |

---

## Caveats

- The **AI review** has not made a real API call. Expect small prompt tweaks after the first real run.
- The **GitHub workflow drafts** are validated but haven't run on GitHub.
- **Imports with `--apply`** must be done with Glass Notes closed. The app would otherwise overwrite the change on its next save. The tool asks you to confirm and makes a backup first.
- Time savings are estimates based on the frequencies listed above, not measurements.
