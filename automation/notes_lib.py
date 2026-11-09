"""Shared helpers for Glass Notes automation scripts.

Reads and writes the app's notes.json and converts between note blocks and Markdown.
Standard library only.
"""
from __future__ import annotations

import html
import json
import os
import re
import secrets
import sys
import time
from html.parser import HTMLParser
from pathlib import Path

APP_FOLDER = "Glass Notes"


def default_data_dir() -> Path:
    """Where the desktop app keeps notes.json (Electron's userData folder)."""
    if sys.platform == "win32":
        base = Path(os.environ.get("APPDATA", Path.home() / "AppData" / "Roaming"))
    elif sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    else:
        base = Path(os.environ.get("XDG_CONFIG_HOME", Path.home() / ".config"))
    return base / APP_FOLDER


def default_notes_file() -> Path:
    return default_data_dir() / "notes.json"


def load_db(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        db = json.load(f)
    if not isinstance(db, dict) or not isinstance(db.get("pages"), dict):
        raise ValueError(f"{path} is not a Glass Notes file (no 'pages' object)")
    return db


def save_db_atomic(db: dict, path: Path) -> None:
    """Write via a temp file + rename, so a crash never leaves a half-written file."""
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False)
    os.replace(tmp, path)


def new_id() -> str:
    return format(int(time.time() * 1000), "x") + secrets.token_hex(4)


# ---------- page helpers ----------

def is_alive(db: dict, page: dict) -> bool:
    """False if the page or any parent is in the trash."""
    seen = set()
    while page:
        if page.get("trashed") or page["id"] in seen:
            return False
        seen.add(page["id"])
        parent = page.get("parentId")
        page = db["pages"].get(parent) if parent else None
    return True


def page_path(db: dict, page: dict) -> list[dict]:
    out, seen = [], set()
    while page and page["id"] not in seen:
        seen.add(page["id"])
        out.insert(0, page)
        parent = page.get("parentId")
        page = db["pages"].get(parent) if parent else None
    return out


def title_of(page: dict) -> str:
    return (page.get("title") or "").strip() or "Untitled"


# ---------- inline HTML -> Markdown ----------

_MD_WRAP = {"b": "**", "strong": "**", "i": "*", "em": "*", "s": "~~", "strike": "~~", "code": "`", "mark": "==", "u": "<u>"}


class _InlineToMd(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.stack: list[tuple[str, str | None]] = []

    def handle_starttag(self, tag, attrs):
        if tag == "br":
            self.out.append("  \n")
            return
        if tag == "a":
            self.stack.append(("a", dict(attrs).get("href", "")))
            self.out.append("[")
        elif tag in _MD_WRAP:
            self.stack.append((tag, None))
            self.out.append(_MD_WRAP[tag])

    def handle_endtag(self, tag):
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                _, href = self.stack.pop(i)
                if tag == "a":
                    self.out.append(f"]({href})")
                elif tag == "u":
                    self.out.append("</u>")
                else:
                    self.out.append(_MD_WRAP[tag])
                return

    def handle_data(self, data):
        self.out.append(data)


def html_to_md(fragment: str) -> str:
    p = _InlineToMd()
    p.feed(fragment or "")
    p.close()
    return "".join(p.out)


def html_to_text(fragment: str) -> str:
    fragment = re.sub(r"<br\s*/?>", "\n", fragment or "", flags=re.I)
    return html.unescape(re.sub(r"<[^>]+>", "", fragment))


def page_to_markdown(page: dict, *, front_matter: bool = True) -> str:
    lines: list[str] = []
    if front_matter:
        lines += ["---", f"title: {json.dumps(title_of(page), ensure_ascii=False)}"]
        if page.get("icon"):
            lines.append(f"icon: {json.dumps(page['icon'], ensure_ascii=False)}")
        if page.get("cover"):
            lines.append(f"cover: {page['cover']}")
        for key in ("createdAt", "updatedAt"):
            if page.get(key):
                lines.append(f"{key}: {time.strftime('%Y-%m-%dT%H:%M:%S', time.localtime(page[key] / 1000))}")
        lines += ["---", ""]
    lines.append(f"# {title_of(page)}")
    lines.append("")
    number = {}
    prev_type = None
    for b in page.get("blocks", []):
        t = b.get("type", "p")
        body = html_to_md(b.get("html", ""))
        pad = "  " * int(b.get("indent") or 0)
        list_like = t in ("bullet", "number", "todo")
        if prev_type is not None and not (list_like and prev_type in ("bullet", "number", "todo")):
            lines.append("")
        if t != "number":
            number = {}
        if t in ("h1", "h2", "h3"):
            lines.append("#" * (int(t[1]) + 1) + " " + body)  # page title is the only H1
        elif t == "bullet":
            lines.append(f"{pad}- {body}")
        elif t == "number":
            d = int(b.get("indent") or 0)
            number = {k: v for k, v in number.items() if k <= d}
            number[d] = number.get(d, 0) + 1
            lines.append(f"{pad}{number[d]}. {body}")
        elif t == "todo":
            lines.append(f"{pad}- [{'x' if b.get('checked') else ' '}] {body}")
        elif t == "quote":
            lines.append("> " + body.replace("\n", "\n> "))
        elif t == "callout":
            lines.append(f"> {b.get('emoji', '💡')} {body}")
        elif t == "code":
            lines += ["```", html_to_text(b.get("html", "")), "```"]
        elif t == "divider":
            lines.append("---")
        elif t == "image":
            src = b.get("src", "")
            cap = html_to_text(b.get("html", "")) or "image"
            lines.append(f"![{cap}]({src if not src.startswith('data:') else 'embedded-image'})")
        else:
            lines.append(body)
        prev_type = t
    return "\n".join(lines).rstrip() + "\n"


# ---------- Markdown -> blocks ----------

def _inline_md_to_html(text: str) -> str:
    s = html.escape(text, quote=False)
    s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
    s = re.sub(r"\*\*(.+?)\*\*|__(.+?)__", lambda m: f"<b>{m.group(1) or m.group(2)}</b>", s)
    s = re.sub(r"(?<![*\w])\*(?!\s)(.+?)(?<!\s)\*(?!\*)", r"<i>\1</i>", s)
    s = re.sub(r"~~(.+?)~~", r"<s>\1</s>", s)
    s = re.sub(r"==(.+?)==", r'<mark class="hl-violet">\1</mark>', s)

    def link(m):
        href = html.unescape(m.group(2))
        if not re.match(r"^(https?:|mailto:)", href, re.I):
            return m.group(1)
        return f'<a href="{html.escape(href)}" title="Ctrl+click to open">{m.group(1)}</a>'

    s = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", link, s)
    return s


def markdown_to_page(md: str, fallback_title: str = "Imported") -> dict:
    """Parse Markdown (Obsidian / Notion export / plain) into a page dict."""
    meta = {}
    text = md.replace("\r\n", "\n")
    if text.startswith("---\n"):
        end = text.find("\n---", 4)
        if end != -1:
            for line in text[4:end].splitlines():
                if ":" in line:
                    k, v = line.split(":", 1)
                    v = v.strip()
                    try:
                        v = json.loads(v)
                    except (ValueError, TypeError):
                        pass
                    meta[k.strip()] = v
            text = text[end + 4:].lstrip("\n")
    lines = text.split("\n")
    title = meta.get("title")
    blocks: list[dict] = []
    i = 0
    while i < len(lines):
        raw = lines[i]
        line = raw.rstrip()
        stripped = line.strip()
        i += 1
        if not stripped:
            continue
        if stripped.startswith("```"):
            code = []
            while i < len(lines) and not lines[i].strip().startswith("```"):
                code.append(lines[i])
                i += 1
            i += 1
            blocks.append(_b("code", html.escape("\n".join(code), quote=False)))
            continue
        m = re.match(r"^(#{1,6})\s+(.*)$", stripped)
        if m:
            level = len(m.group(1))
            if level == 1 and not blocks and (title is None or m.group(2).strip() == title):
                title = m.group(2).strip()  # the page title, not a heading
                continue
            # The exporter shifts headings down one level; shift back.
            h = "h" + str(min(3, max(1, level - 1 if level > 1 else 1)))
            blocks.append(_b(h, _inline_md_to_html(m.group(2))))
            continue
        if re.fullmatch(r"(-{3,}|\*{3,}|_{3,})", stripped):
            blocks.append(_b("divider", ""))
            continue
        expanded = raw.expandtabs(4)
        indent = min(3, (len(expanded) - len(expanded.lstrip(" "))) // 2)
        extra = {"indent": indent} if indent else {}
        m = re.match(r"^[-*+]\s+\[([ xX])\]\s*(.*)$", stripped)
        if m:
            blocks.append(_b("todo", _inline_md_to_html(m.group(2)), **({"checked": True} if m.group(1).lower() == "x" else {}), **extra))
            continue
        m = re.match(r"^[-*+•]\s+(.*)$", stripped)
        if m:
            blocks.append(_b("bullet", _inline_md_to_html(m.group(1)), **extra))
            continue
        m = re.match(r"^\d+[.)]\s+(.*)$", stripped)
        if m:
            blocks.append(_b("number", _inline_md_to_html(m.group(1)), **extra))
            continue
        if stripped.startswith(">"):
            quote = [stripped.lstrip(">").strip()]
            while i < len(lines) and lines[i].strip().startswith(">"):
                quote.append(lines[i].strip().lstrip(">").strip())
                i += 1
            body = " ".join(q for q in quote if q)
            em = re.match(r"^(\S)\s+(.*)$", body)
            if em and re.match(r"[\U0001F300-\U0001FAFF☀-➿]", em.group(1)):
                blocks.append(_b("callout", _inline_md_to_html(em.group(2)), emoji=em.group(1)))
            else:
                blocks.append(_b("quote", _inline_md_to_html(body)))
            continue
        img = re.match(r"^!\[([^\]]*)\]\(([^)]+)\)$", stripped)
        if img and img.group(2).startswith("data:image/"):
            blocks.append(_b("image", html.escape(img.group(1)), src=img.group(2)))
            continue
        para = [line.strip()]
        while i < len(lines) and lines[i].strip() and not re.match(r"^\s*([-*+•]\s|\d+[.)]\s|#{1,6}\s|>|```|(-{3,})$)", lines[i]):
            para.append(lines[i].strip())
            i += 1
        blocks.append(_b("p", "<br>".join(_inline_md_to_html(p.rstrip()) for p in para)))
    now = int(time.time() * 1000)
    return {
        "id": new_id(), "parentId": None, "children": [], "favorite": False, "trashed": False,
        "createdAt": now, "updatedAt": now, "font": "sans", "wide": False,
        "title": title or fallback_title, "icon": meta.get("icon", "") or "", "cover": meta.get("cover") or None,
        "blocks": blocks or [_b("p", "")],
    }


def _b(type_: str, html_: str, **extra) -> dict:
    return {"id": new_id(), "type": type_, "html": html_, **extra}
