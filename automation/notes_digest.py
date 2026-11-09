#!/usr/bin/env python3
"""Weekly review of your notes, written by Claude.

  python notes_digest.py                 # last 7 days → "Weekly review YYYY-MM-DD.md"
  python notes_digest.py --days 30
  python notes_digest.py --offline       # no AI: a plain list of what changed and open to-dos

Collects pages you edited recently, sends their text to Claude and gets back:
what you worked on, open to-dos worth doing next, loose ends, and suggested next steps.
The result is a Markdown file; add it to the app with
  python notes_markdown.py import "Weekly review ....md" --apply

Needs: pip install anthropic, plus ANTHROPIC_API_KEY (or `ant auth login`).
Privacy: only pages edited in the chosen period are sent, and only when not --offline.
"""
from __future__ import annotations

import argparse
import datetime as dt
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from notes_lib import default_notes_file, html_to_text, is_alive, load_db, page_path, page_to_markdown, title_of  # noqa: E402

MODEL = "claude-opus-5-5"
MAX_CHARS = 400_000  # ~100k tokens; keeps cost predictable

SYSTEM = """You write a short weekly review of someone's personal notes.
Be concrete and refer to pages by their exact title. Use this Markdown structure:

## What you worked on
2-5 bullets, one line each.

## Open to-dos worth doing next
Up to 7 unchecked to-dos from the notes, most important first, each as "- [ ] task (Page title)".

## Loose ends
Ideas, questions or decisions that were started but not finished. Skip the section if there are none.

## Suggested next steps
2-3 bullets.

Do not invent tasks that are not in the notes. Keep the whole review under 350 words."""


def recent_pages(db: dict, since_ms: int) -> list[dict]:
    pages = [p for p in db["pages"].values() if is_alive(db, p) and p.get("updatedAt", 0) >= since_ms]
    return sorted(pages, key=lambda p: p.get("updatedAt", 0), reverse=True)


def open_todos(pages: list[dict]) -> list[tuple[str, str]]:
    out = []
    for p in pages:
        for b in p.get("blocks", []):
            if b.get("type") == "todo" and not b.get("checked"):
                text = html_to_text(b.get("html", "")).strip()
                if text:
                    out.append((text, title_of(p)))
    return out


def build_notes_text(db: dict, pages: list[dict]) -> tuple[str, int]:
    parts, used, skipped = [], 0, 0
    for p in pages:
        path = " / ".join(title_of(x) for x in page_path(db, p))
        chunk = f'<page title="{title_of(p)}" path="{path}" edited="{dt.datetime.fromtimestamp(p["updatedAt"] / 1000):%Y-%m-%d}">\n' \
                f"{page_to_markdown(p, front_matter=False)}</page>\n"
        if used + len(chunk) > MAX_CHARS:
            skipped += 1
            continue
        parts.append(chunk)
        used += len(chunk)
    return "".join(parts), skipped


def offline_digest(pages: list[dict], days: int) -> str:
    lines = [f"## Pages edited in the last {days} days", ""]
    lines += [f"- {p.get('icon') or '📄'} {title_of(p)} — {dt.datetime.fromtimestamp(p['updatedAt'] / 1000):%a %b %d}" for p in pages]
    todos = open_todos(pages)
    lines += ["", f"## Open to-dos ({len(todos)})", ""]
    lines += [f"- [ ] {t} ({src})" for t, src in todos[:30]] or ["- None"]
    return "\n".join(lines) + "\n"


def ai_digest(notes_text: str, days: int, client=None) -> str:
    import anthropic  # imported here so --offline works without the package

    client = client or anthropic.Anthropic()
    try:
        response = client.beta.messages.create(
            model=MODEL,
            max_tokens=16000,
            system=SYSTEM,
            output_config={"effort": "medium"},
            # If a safety check declines the request, Anthropic re-runs it on a suitable model.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            messages=[{"role": "user", "content": f"Here are the notes I edited in the last {days} days:\n\n{notes_text}\n\nWrite my weekly review."}],
        )
    except anthropic.AuthenticationError:
        raise SystemExit("Claude API key missing or invalid. Set ANTHROPIC_API_KEY or run `ant auth login`, or use --offline.")
    except anthropic.RateLimitError:
        raise SystemExit("Rate limited by the Claude API. Try again in a minute.")
    except anthropic.APIConnectionError:
        raise SystemExit("Couldn't reach the Claude API. Check your internet connection, or use --offline.")
    if response.stop_reason == "refusal":
        raise SystemExit("Claude declined to write this review. Try --offline.")
    text = "".join(b.text for b in response.content if b.type == "text").strip()
    if response.stop_reason == "max_tokens":
        text += "\n\n_(Review was cut off.)_"
    return text + "\n"


def main(argv=None, client=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--notes", type=Path, default=default_notes_file())
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--offline", action="store_true", help="no AI; list changes and open to-dos")
    ap.add_argument("--out", type=Path, help="output file (default: Weekly review <date>.md in the current folder)")
    ap.add_argument("--now", help=argparse.SUPPRESS)  # for tests: ISO date treated as today
    a = ap.parse_args(argv)

    if not a.notes.exists():
        print(f"Can't find {a.notes}. Pass --notes.", file=sys.stderr)
        return 1
    db = load_db(a.notes)
    now = dt.datetime.fromisoformat(a.now) if a.now else dt.datetime.now()
    since = int((now - dt.timedelta(days=a.days)).timestamp() * 1000)
    pages = recent_pages(db, since)
    out = a.out or Path(f"Weekly review {now:%Y-%m-%d}.md")

    header = f"---\ntitle: \"Weekly review — {now:%b %d, %Y}\"\nicon: \"🗓️\"\ncover: dusk\n---\n\n"
    if not pages:
        body = f"No pages were edited in the last {a.days} days.\n"
    elif a.offline:
        body = offline_digest(pages, a.days)
    else:
        notes_text, skipped = build_notes_text(db, pages)
        body = ai_digest(notes_text, a.days, client=client)
        if skipped:
            body += f"\n_{skipped} long page(s) were left out to keep the request small._\n"
    out.write_text(header + body, encoding="utf-8")
    print(f"Wrote {out} ({len(pages)} pages reviewed{', offline' if a.offline else ''}).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
