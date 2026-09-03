"""Markdown para Telegraph HTML, rich Telegram, e volta a .md."""

from __future__ import annotations

import html
import os
import re
from enum import Enum

from aiogram.types import TelegramObject
from aiogram.utils.serialization import deserialize_telegram_object_to_python

MD_EXTS = {".md", ".markdown", ".mdown", ".txt"}
MD_MIMES = {"text/markdown", "text/x-markdown", "text/plain"}
MDV2_ESC = re.compile(r"\\([_*\[\]()~`>#+\-=|{}.!\\])")


def optimize_markdown(source: str) -> str:
    text = source.replace("\r\n", "\n").replace("\r", "\n")
    if text.startswith("\ufeff"):
        text = text[1:]
    if len(MDV2_ESC.findall(text)) >= 3:
        text = MDV2_ESC.sub(r"\1", text)
    text = "\n".join(line.rstrip() for line in text.split("\n"))
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return f"{text}\n" if text else ""


def is_markdown_document(doc) -> bool:
    if not doc:
        return False
    name = (doc.file_name or "").lower()
    ext = os.path.splitext(name)[1]
    if ext in MD_EXTS:
        return True
    mime = (doc.mime_type or "").lower()
    return mime in MD_MIMES


def filename_from_markdown(md: str, fallback: str = "documento") -> str:
    for line in md.splitlines():
        match = re.match(r"^#+\s+(.*)$", line.strip())
        if match:
            safe = re.sub(r'[\\/*?:"<>|]', "", match.group(1)).strip()[:60]
            if safe:
                return safe
    first = next((ln.strip() for ln in md.splitlines() if ln.strip()), fallback)
    safe = re.sub(r'[\\/*?:"<>|]', "", first)[:60]
    return safe or fallback


def _u16_to_index(text: str, offset: int) -> int:
    return len(text.encode("utf-16-le")[: offset * 2].decode("utf-16-le"))


def entities_to_markdown(text: str, entities) -> str:
    if not text:
        return ""
    if not entities:
        return text
    n = len(text)
    prefixes: list[list[str]] = [[] for _ in range(n + 1)]
    suffixes: list[list[str]] = [[] for _ in range(n + 1)]
    for ent in sorted(entities, key=lambda e: (e.offset, -e.length)):
        start = max(0, min(n, _u16_to_index(text, ent.offset)))
        end = max(0, min(n, _u16_to_index(text, ent.offset + ent.length)))
        etype = ent.type
        if etype == "bold":
            prefixes[start].append("**")
            suffixes[end].insert(0, "**")
        elif etype == "italic":
            prefixes[start].append("_")
            suffixes[end].insert(0, "_")
        elif etype == "underline":
            prefixes[start].append("__")
            suffixes[end].insert(0, "__")
        elif etype == "strikethrough":
            prefixes[start].append("~~")
            suffixes[end].insert(0, "~~")
        elif etype == "spoiler":
            prefixes[start].append("||")
            suffixes[end].insert(0, "||")
        elif etype == "code":
            prefixes[start].append("`")
            suffixes[end].insert(0, "`")
        elif etype == "pre":
            lang = getattr(ent, "language", None) or ""
            prefixes[start].append(f"```{lang}\n")
            suffixes[end].insert(0, "\n```")
        elif etype == "text_link":
            prefixes[start].append("[")
            suffixes[end].insert(0, f"]({getattr(ent, 'url', '') or ''})")
        elif etype == "text_mention":
            user = getattr(ent, "user", None)
            uid = getattr(user, "id", "") if user else ""
            prefixes[start].append("[")
            suffixes[end].insert(0, f"](tg://user?id={uid})")
        elif etype == "custom_emoji":
            eid = getattr(ent, "custom_emoji_id", "") or ""
            prefixes[start].append("![")
            suffixes[end].insert(0, f"](tg://emoji?id={eid})")
        elif etype in ("blockquote", "expandable_blockquote"):
            marker = "**> " if etype == "expandable_blockquote" else "> "
            prefixes[start].append(marker)
            inner = text[start:end]
            for i, ch in enumerate(inner):
                if ch == "\n" and start + i + 1 < end:
                    prefixes[start + i + 1].append(marker)
    out: list[str] = []
    for i in range(n + 1):
        out.extend(suffixes[i])
        out.extend(prefixes[i])
        if i < n:
            out.append(text[i])
    return "".join(out)


def markdown_to_telegraph_html(source: str) -> str:
    text = source.replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"\|\|(.*?)\|\|", r"\1", text)
    parts: list[str] = []
    i = 0
    lines = text.split("\n")
    n = len(lines)

    def flush_para(buf: list[str]) -> None:
        if not buf:
            return
        raw = " ".join(s.strip() for s in buf if s.strip())
        if raw:
            parts.append(f"<p>{inline(raw)}</p>")
        buf.clear()

    def inline(s: str) -> str:
        s = html.escape(s)
        s = re.sub(r"!\[([^\]]*)\]\(tg://emoji\?id=\d+\)", r"\1", s)
        s = re.sub(r"!\[([^\]]*)\]\(([^)]+)\)", r'<img src="\2" alt="\1">', s)
        s = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', s)
        s = re.sub(r"`([^`]+)`", r"<code>\1</code>", s)
        s = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", s)
        s = re.sub(r"__(.+?)__", r"<u>\1</u>", s)
        s = re.sub(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)", r"<em>\1</em>", s)
        s = re.sub(r"_(.+?)_", r"<em>\1</em>", s)
        s = re.sub(r"~~(.+?)~~", r"<s>\1</s>", s)
        return s

    para: list[str] = []
    while i < n:
        stripped = lines[i].strip()
        if stripped.startswith("```"):
            flush_para(para)
            i += 1
            block: list[str] = []
            while i < n and not lines[i].strip().startswith("```"):
                block.append(html.escape(lines[i]))
                i += 1
            i += 1
            parts.append(f"<pre>{chr(10).join(block)}</pre>")
            continue
        if re.match(r"^---+", stripped) or re.match(r"^\*\*\*+", stripped):
            flush_para(para)
            parts.append("<hr>")
            i += 1
            continue
        heading = re.match(r"^(#{1,6})\s+(.*)$", stripped)
        if heading:
            flush_para(para)
            level = min(len(heading.group(1)) + 2, 4)
            parts.append(f"<h{level}>{inline(heading.group(2))}</h{level}>")
            i += 1
            continue
        if stripped.startswith(">") or stripped.startswith("**>"):
            flush_para(para)
            quote: list[str] = []
            while i < n and (
                lines[i].strip().startswith(">") or lines[i].strip().startswith("**>")
            ):
                lq = lines[i].strip()
                if lq.startswith("**>"):
                    lq = lq[3:].lstrip(" ")
                elif lq.startswith(">"):
                    lq = lq[1:].lstrip(" ")
                quote.append(lq.rstrip("|").rstrip())
                i += 1
            parts.append(f"<blockquote>{inline(' '.join(quote))}</blockquote>")
            continue
        ul_match = re.match(r"^[-*+]\s+(.*)$", stripped)
        ol_match = re.match(r"^\d+\.\s+(.*)$", stripped)
        if ul_match or ol_match:
            flush_para(para)
            ordered = bool(ol_match)
            items: list[str] = []
            while i < n:
                raw = lines[i].strip()
                tm = re.match(r"^[-*+]\s+\[([ xX])\]\s+(.*)$", raw)
                um = re.match(r"^[-*+]\s+(.*)$", raw)
                om = re.match(r"^\d+\.\s+(.*)$", raw)
                if tm:
                    mark = "☑" if tm.group(1).lower() == "x" else "☐"
                    items.append(f"<li>{mark} {inline(tm.group(2))}</li>")
                    ordered = False
                elif um and not ordered:
                    items.append(f"<li>{inline(um.group(1))}</li>")
                elif om and ordered:
                    items.append(f"<li>{inline(om.group(1))}</li>")
                else:
                    break
                i += 1
            tag = "ol" if ordered else "ul"
            parts.append(f"<{tag}>{''.join(items)}</{tag}>")
            continue
        if not stripped:
            flush_para(para)
            i += 1
            continue
        para.append(stripped)
        i += 1
    flush_para(para)
    return "".join(parts).strip() or "<p></p>"


RICH_CHAR_LIMIT = 32768
_EXPANDABLE_LINE = re.compile(r"^\*\*>\s?(.*)$")
_LOCAL_IMG = re.compile(
    r"!\[([^\]]*)\]\(mdtxtrt://media/([A-Za-z0-9_-]+)\)"
)
_OTHER_IMG = re.compile(r"!\[([^\]]*)\]\((?!tg://photo\?id=)([^)]*)\)")


def markdown_for_rich_api(source: str) -> str:
    """Pré-passo só do dialecto que o GFM da API não cobre."""
    text = (source or "").replace("\r\n", "\n").replace("\r", "\n")
    lines = text.split("\n")
    out: list[str] = []
    i = 0
    n = len(lines)
    while i < n:
        stripped = lines[i].strip()
        expandable = bool(_EXPANDABLE_LINE.match(stripped)) or (
            stripped.startswith(">") and stripped.endswith("||")
        )
        if expandable:
            quote: list[str] = []
            while i < n:
                s = lines[i].strip()
                m_exp = _EXPANDABLE_LINE.match(s)
                if not (m_exp or s.startswith(">")):
                    break
                piece = m_exp.group(1) if m_exp else s[1:].lstrip(" ")
                if piece.endswith("||"):
                    piece = piece[:-2].rstrip()
                quote.append(piece)
                i += 1
            body = "\n".join(quote).strip()
            out.append(f"<details>\n{body}\n</details>" if body else "<details></details>")
            continue
        out.append(lines[i])
        i += 1
    return "\n".join(out)


def extract_rich_media(markdown: str) -> tuple[str, list[str]]:
    """Só fotos já enviadas ao bot. URLs http ficam no Markdown."""
    ids: list[str] = []

    def _repl(match: re.Match) -> str:
        alt, mid = match.group(1), match.group(2)
        if mid not in ids:
            ids.append(mid)
        if alt:
            safe_alt = alt.replace('"', "")
            return f'![](tg://photo?id={mid} "{safe_alt}")'
        return f"![](tg://photo?id={mid})"

    rewritten = _LOCAL_IMG.sub(_repl, markdown or "")

    def _link(match: re.Match) -> str:
        alt, url = match.group(1), (match.group(2) or "").strip()
        label = alt or "imagem"
        if url.startswith("https://") or url.startswith("http://"):
            return f"[{label}]({url})"
        return label

    rewritten = _OTHER_IMG.sub(_link, rewritten)
    return rewritten, ids


def split_markdown_chunks(text: str, limit: int = RICH_CHAR_LIMIT) -> list[str]:
    if len(text) <= limit:
        return [text]
    chunks: list[str] = []
    remaining = text
    while remaining:
        if len(remaining) <= limit:
            chunks.append(remaining)
            break
        window = remaining[:limit]
        cut = window.rfind("\n")
        if cut < limit // 2:
            cut = limit
        chunks.append(remaining[:cut])
        remaining = remaining[cut:].lstrip("\n")
    return chunks


def _to_plain(obj):
    if isinstance(obj, Enum):
        return obj.value
    if obj is None or isinstance(obj, (str, int, float, bool)):
        return obj
    if isinstance(obj, (list, tuple)):
        return [_to_plain(x) for x in obj]
    if isinstance(obj, dict):
        return {k: _to_plain(v) for k, v in obj.items()}
    if isinstance(obj, TelegramObject):
        return _to_plain(
            deserialize_telegram_object_to_python(
                obj, include_api_method_name=False
            )
        )
    raise TypeError(f"Objeto rich não suportado: {type(obj).__name__}")


def _button_md(button) -> str:
    button = _to_plain(button) if not isinstance(button, dict) else button
    label = rich_text_to_md(button.get("text") or "") or "botão"
    url = button.get("url")
    web_app = button.get("web_app") or {}
    login_url = button.get("login_url") or {}
    target = url or web_app.get("url") or login_url.get("url")
    return f"[{label}]({target})" if target else label


def rich_text_to_md(node) -> str:
    if node is None:
        return ""
    if isinstance(node, str):
        return node
    if isinstance(node, (int, float)):
        return str(node)
    if isinstance(node, (list, tuple)):
        return "".join(rich_text_to_md(x) for x in node)
    if not isinstance(node, dict):
        node = _to_plain(node)
        if not isinstance(node, dict):
            return str(node) if node is not None else ""
    typ = str(node.get("type") or "")
    if typ in {"concat", "rich_text"} or "texts" in node:
        return rich_text_to_md(node.get("texts") or node.get("text"))
    inner = node.get("text")
    if inner is None:
        inner = node.get("texts")
    inner_md = rich_text_to_md(inner) if inner is not None else ""
    if typ in {"plain", "text", "regular", ""}:
        return inner_md
    if typ == "bold":
        return f"**{inner_md}**"
    if typ == "italic":
        return f"*{inner_md}*"
    if typ in {"underline", "ins"}:
        return f"<u>{inner_md}</u>"
    if typ == "strikethrough":
        return f"~~{inner_md}~~"
    if typ == "spoiler":
        return f"||{inner_md}||"
    if typ == "code":
        return f"`{inner_md}`"
    if typ == "marked":
        return f"=={inner_md}=="
    if typ == "subscript":
        return f"<sub>{inner_md}</sub>"
    if typ == "superscript":
        return f"<sup>{inner_md}</sup>"
    if typ in {"url", "text_link"}:
        url = node.get("url") or node.get("href") or ""
        return f"[{inner_md}]({url})" if url else inner_md
    if typ in {"email_address", "email"}:
        email = node.get("email") or node.get("email_address") or inner_md
        return f"[{inner_md or email}](mailto:{email})"
    if typ == "phone_number":
        phone = node.get("phone_number") or inner_md
        return f"[{inner_md or phone}](tel:{phone})"
    if typ in {"text_mention", "mention"}:
        user = node.get("user") or {}
        uid = user.get("id") if isinstance(user, dict) else getattr(user, "id", "")
        uid = uid or node.get("user_id") or node.get("username") or ""
        return f"[{inner_md}](tg://user?id={uid})" if uid else inner_md
    if typ == "custom_emoji":
        eid = node.get("custom_emoji_id") or ""
        alt = inner_md or node.get("alternative_text") or ""
        return f"![{alt}](tg://emoji?id={eid})" if eid else alt
    if typ == "mathematical_expression":
        expression = node.get("expression") or ""
        return f"${expression}$" if expression else ""
    if typ == "button":
        return _button_md(node.get("button") or {})
    if typ == "anchor_link":
        name = node.get("anchor_name") or node.get("name") or ""
        return f"[{inner_md}](#{name})" if name else inner_md
    return inner_md


def _heading_md(text: str, level: int) -> str:
    level = max(1, min(int(level or 1), 6))
    return f"{'#' * level} {text}".rstrip()


def _list_item_md(item, index: int) -> str:
    if isinstance(item, str):
        body = item
    elif isinstance(item, dict):
        if item.get("blocks"):
            body = "\n".join(
                rich_block_to_md(b) for b in item["blocks"] if b is not None
            )
        else:
            body = rich_text_to_md(item.get("text") or item.get("content") or item)
        if item.get("has_checkbox"):
            mark = "x" if item.get("is_checked") else " "
            prefix = f"- [{mark}] "
            lines = (body or "").split("\n")
            return prefix + lines[0] + (("\n  " + "\n  ".join(lines[1:])) if len(lines) > 1 else "")
    else:
        body = rich_text_to_md(item)
    value = item.get("value") if isinstance(item, dict) else None
    prefix = f"{value}. " if value is not None else "- "
    lines = (body or "").split("\n")
    return prefix + lines[0] + (("\n  " + "\n  ".join(lines[1:])) if len(lines) > 1 else "")


def rich_block_to_md(block) -> str:
    if block is None:
        return ""
    if isinstance(block, str):
        return block
    if not isinstance(block, dict):
        block = _to_plain(block)
        if not isinstance(block, dict):
            return str(block) if block is not None else ""
    typ = str(block.get("type") or "")
    nested = block.get(typ) if typ and isinstance(block.get(typ), (dict, list)) else None

    def _text() -> str:
        if nested and isinstance(nested, dict):
            return rich_text_to_md(
                nested.get("text") or nested.get("elements") or nested
            )
        return rich_text_to_md(
            block.get("text")
            or block.get("elements")
            or block.get("content")
            or nested
        )

    if typ in {"paragraph", "footer"}:
        return _text()
    if typ in {"section_heading", "heading"}:
        level = (
            block.get("level")
            or block.get("size")
            or (nested.get("level") if isinstance(nested, dict) else None)
            or (nested.get("size") if isinstance(nested, dict) else None)
            or 1
        )
        return _heading_md(_text(), level)
    if typ in {"preformatted", "pre"}:
        lang = block.get("language") or (
            nested.get("language") if isinstance(nested, dict) else ""
        ) or ""
        body = _text()
        return f"```{lang}\n{body}\n```"
    if typ in {"divider", "horizontal_rule"}:
        return "---"
    if typ in {"block_quotation", "blockquote"}:
        inner_blocks = block.get("blocks")
        if inner_blocks:
            inner = "\n".join(rich_block_to_md(b) for b in inner_blocks)
        else:
            inner = _text()
        return "\n".join(f"> {ln}" if ln else ">" for ln in inner.split("\n"))
    if typ in {"expandable_block_quotation", "expandable_blockquote"}:
        inner_blocks = block.get("blocks")
        if inner_blocks:
            inner = "\n".join(rich_block_to_md(b) for b in inner_blocks)
        else:
            inner = _text()
        lines = inner.split("\n")
        if not lines:
            return ""
        first = f"**> {lines[0]}" if not lines[0].startswith("**>") else lines[0]
        rest = [f"> {ln}" if ln else ">" for ln in lines[1:]]
        return "\n".join([first] + rest)
    if typ == "details":
        summary = rich_text_to_md(block.get("summary") or "")
        inner = "\n".join(rich_block_to_md(b) for b in (block.get("blocks") or []))
        return f"<details>\n<summary>{summary}</summary>\n{inner}\n</details>"
    if typ == "buttons":
        return " | ".join(
            piece for piece in (_button_md(b) for b in block.get("buttons") or []) if piece
        )
    if typ == "list":
        src = nested if isinstance(nested, dict) else block
        items = src.get("items") or []
        out = []
        for idx, item in enumerate(items, 1):
            out.append(_list_item_md(item, idx))
        return "\n".join(out)
    if typ == "table":
        src = nested if isinstance(nested, dict) else block
        rows = src.get("cells") or src.get("rows") or []
        md_rows: list[list[str]] = []
        for row in rows:
            if isinstance(row, dict) and "cells" in row:
                cells = row["cells"]
            else:
                cells = row
            md_rows.append(
                [
                    rich_text_to_md(
                        c.get("text") if isinstance(c, dict) else c
                    ).replace("\n", " ").strip()
                    for c in (cells or [])
                ]
            )
        if not md_rows:
            return ""
        width = max(len(r) for r in md_rows)
        for row in md_rows:
            while len(row) < width:
                row.append("")
        header = md_rows[0]
        lines = [
            "| " + " | ".join(header) + " |",
            "| " + " | ".join("---" for _ in header) + " |",
        ]
        for row in md_rows[1:]:
            lines.append("| " + " | ".join(row) + " |")
        return "\n".join(lines)
    if typ in {"collage", "slideshow"}:
        inner = "\n\n".join(
            rich_block_to_md(b) for b in block.get("blocks") or []
        )
        caption = block.get("caption") or {}
        caption_md = rich_text_to_md(caption.get("text") or "")
        return "\n\n".join(piece for piece in (inner, caption_md) if piece)
    if typ == "map":
        location = block.get("location") or {}
        latitude = location.get("latitude")
        longitude = location.get("longitude")
        caption = block.get("caption") or {}
        label = rich_text_to_md(caption.get("text") or "") or "Mapa"
        if latitude is None or longitude is None:
            return label
        return f"[{label}](https://maps.google.com/?q={latitude},{longitude})"
    if typ in {"photo", "video", "animation", "audio", "document", "voice_note"}:
        caption = block.get("caption")
        if isinstance(caption, dict):
            cap = rich_text_to_md(caption.get("text") or caption)
        else:
            cap = rich_text_to_md(caption)
        url = ""
        media_obj = block.get(typ) or block.get("photo") or {}
        if isinstance(media_obj, list) and media_obj:
            last = media_obj[-1]
            url = (last.get("file_id") if isinstance(last, dict) else "") or ""
            if url:
                url = f"tg://{typ}?id={url}"
        elif isinstance(media_obj, dict):
            url = media_obj.get("file_id") or media_obj.get("url") or ""
        if url:
            return f"![{cap}]({url})"
        return cap
    if typ == "mathematical_expression":
        expr = block.get("expression") or _text()
        return f"$${expr}$$"
    if typ in {"pull_quotation", "pullquote"}:
        return f"<aside>{_text()}</aside>"
    if block.get("blocks"):
        return "\n\n".join(rich_block_to_md(b) for b in block["blocks"])
    return _text()


def rich_message_to_markdown(rich) -> str:
    if not rich:
        return ""
    if isinstance(rich, str):
        return rich
    if not isinstance(rich, dict):
        rich = _to_plain(rich)
        if isinstance(rich, str):
            return rich
        if not isinstance(rich, dict):
            return ""
    if rich.get("markdown"):
        return str(rich["markdown"])
    blocks = rich.get("blocks")
    if blocks:
        parts = [rich_block_to_md(b) for b in blocks]
        return "\n\n".join(p for p in parts if p)
    if rich.get("html"):
        return str(rich["html"])
    return rich_text_to_md(rich.get("text") or rich)
