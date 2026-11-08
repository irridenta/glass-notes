# Glass Notes

A calm, dark-glass notes app for Windows. Pages, sub-pages, to-dos, headings, quotes, callouts, code, images — saved automatically on your computer. No account, works offline.

## Install
- **Glass-Notes-Setup-1.0.0.exe** — normal installer (Start menu + desktop shortcut).
- **Glass-Notes-Portable-1.0.0.exe** — runs without installing (e.g. from a USB stick).

The app isn't code-signed, so Windows SmartScreen may say "Windows protected your PC". Click **More info → Run anyway**.

## Sharing a note
Open a page → **Share** (top right):
- **Web page** — one `.html` file with fonts and images inside. Anyone can open it in a browser.
- **PDF document** — light, print-ready A4.

## Where notes live
`%APPDATA%\Glass Notes\notes.json` (Settings → "Show" opens the folder). A backup of the previous version is kept beside it as `notes.backup.json`.

## Shortcuts
| | |
|---|---|
| `Ctrl K` | Search pages and commands |
| `Ctrl N` | New page |
| `Ctrl \` | Show / hide sidebar |
| `Ctrl Shift E` | Share / export |
| `/` | Insert a block |
| `Ctrl B / I / U`, `Ctrl E`, `Ctrl Shift H` | Bold, italic, underline, inline code, highlight |
| `Tab` / `Shift Tab` | Indent / outdent list items |
| `Ctrl Shift ↑ / ↓` | Move block |
| `Ctrl D` | Duplicate block |
| `Ctrl Z` / `Ctrl Y` | Undo / redo |

Markdown at the start of a line: `#`, `##`, `###`, `-`, `1.`, `[]`, `>`, `!`, ```` ``` ````, `---`.

## Develop
```
npm install
npm start            # run the app
npm run dist:win     # build Windows installer + portable exe into dist/
```

## Download
Get the latest Windows build from the [Releases page](../../releases/latest). Every push to `main` rebuilds it automatically (see `.github/workflows/build-windows.yml`).
