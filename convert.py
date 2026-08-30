"""Markdown <-> Telegram HTML conversion."""

from __future__ import annotations

import html
import os
import re

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


def split_html_chunks(html_text: str, limit: int = 4096) -> list[str]:
    if len(html_text) <= limit:
        return [html_text]
    chunks: list[str] = []
    remaining = html_text
    while remaining:
        if len(remaining) <= limit:
            chunks.append(remaining)
            break
        window = remaining[:limit]
        cut = window.rfind("\n")
        if cut < limit // 2:
            cut = window.rfind(">")
            if cut >= limit // 2:
                cut += 1
            else:
                cut = limit
        last_lt = remaining.rfind("<", 0, cut)
        last_gt = remaining.rfind(">", 0, cut)
        if last_lt > last_gt and last_lt > 0:
            cut = last_lt
        if cut <= 0:
            cut = min(limit, len(remaining))
        chunks.append(remaining[:cut])
        remaining = remaining[cut:].lstrip("\n")
    return chunks


def _upper_keep_tags(s: str) -> str:
    return "".join(
        part if part.startswith("<") else part.upper()
        for part in re.split(r"(<[^>]+>)", s)
    )


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


def markdown_to_telegram_html(source: str) -> tuple[str, list[str]]:
    text = source.replace("\r\n", "\n").replace("\r", "\n")
    lines = text.split("\n")
    n = len(lines)
    parts: list[str] = []
    found_images: list[str] = []
    i = 0

    def inline_tg(s: str) -> str:
        code_spans: list[str] = []

        def save_code(m: re.Match) -> str:
            code_spans.append(html.escape(m.group(1)))
            return f"CODESPAN{len(code_spans)-1}XYZ"

        s = re.sub(r"`([^`]+)`", save_code, s)
        s = html.escape(s)

        def handle_img(m: re.Match) -> str:
            alt, url = m.group(1), m.group(2)
            found_images.append(url)
            display = alt if alt else "imagem"
            return f'<a href="{url}">{display}</a>'

        s = re.sub(r"!\[([^\]]*)\]\((https?://[^)]+)\)", handle_img, s)
        s = re.sub(
            r"!\[([^\]]*)\]\(tg://emoji\?id=(\d+)\)",
            r'<tg-emoji emoji-id="\2">\1</tg-emoji>',
            s,
        )
        s = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', s)
        s = re.sub(r"\|\|(.+?)\|\|", r"<tg-spoiler>\1</tg-spoiler>", s)
        s = re.sub(r"__(.+?)__", r"<u>\1</u>", s)
        s = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", s)
        s = re.sub(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)", r"<i>\1</i>", s)
        s = re.sub(r"(?<!_)_(?!_)(.+?)(?<!_)_(?!_)", r"<i>\1</i>", s)
        s = re.sub(r"~~(.+?)~~", r"<s>\1</s>", s)
        for idx, c in enumerate(code_spans):
            s = s.replace(f"CODESPAN{idx}XYZ", f"<code>{c}</code>")
        return s

    while i < n:
        line = lines[i]
        stripped = line.strip()
        if stripped.startswith("```"):
            lang = stripped[3:].strip()
            i += 1
            block: list[str] = []
            while i < n and not lines[i].strip().startswith("```"):
                block.append(html.escape(lines[i]))
                i += 1
            i += 1
            code = "\n".join(block)
            if lang:
                parts.append(
                    f'<pre><code class="language-{html.escape(lang)}">{code}</code></pre>'
                )
            else:
                parts.append(f"<pre>{code}</pre>")
            continue
        if stripped.startswith("**>") or (
            stripped.startswith(">") and stripped.endswith("||")
        ):
            quote: list[str] = []
            while i < n and (
                lines[i].strip().startswith("**>") or lines[i].strip().startswith(">")
            ):
                lq = lines[i].strip()
                if lq.startswith("**>"):
                    lq = lq[3:].lstrip(" ")
                elif lq.startswith(">"):
                    lq = lq[1:].lstrip(" ")
                quote.append(lq.rstrip("|").rstrip())
                i += 1
            parts.append(
                "<blockquote expandable>"
                + "\n".join(inline_tg(q) for q in quote)
                + "</blockquote>"
            )
            continue
        if stripped.startswith(">"):
            quote = []
            while (
                i < n
                and lines[i].strip().startswith(">")
                and not lines[i].strip().startswith("**>")
            ):
                quote.append(lines[i].strip()[1:].lstrip(" "))
                i += 1
            parts.append(
                "<blockquote>" + "\n".join(inline_tg(q) for q in quote) + "</blockquote>"
            )
            continue
        if re.match(r"^---+", stripped) or re.match(r"^\*\*\*+", stripped):
            parts.append("──────────────")
            i += 1
            continue
        if stripped.startswith("|") and stripped.endswith("|"):
            table_lines: list[str] = []
            while (
                i < n
                and lines[i].strip().startswith("|")
                and lines[i].strip().endswith("|")
            ):
                table_lines.append(lines[i].strip())
                i += 1
            if len(table_lines) >= 2 and re.match(r"^[|\s\-:]+$", table_lines[1]):
                headers = [c.strip() for c in table_lines[0].strip("|").split("|")]
                rows = [
                    [c.strip() for c in row.strip("|").split("|")]
                    for row in table_lines[2:]
                ]
                col_widths = [len(h) for h in headers]
                for row in rows:
                    for c_idx, cell in enumerate(row):
                        if c_idx < len(col_widths):
                            col_widths[c_idx] = max(col_widths[c_idx], len(cell))
                header_str = " | ".join(
                    h.ljust(col_widths[idx]) for idx, h in enumerate(headers)
                )
                sep_str = "-+-".join("-" * w for w in col_widths)
                row_strs = [
                    " | ".join(
                        cell.ljust(col_widths[c_idx]) for c_idx, cell in enumerate(row)
                    )
                    for row in rows
                ]
                parts.append(
                    f"<pre>{html.escape(chr(10).join([header_str, sep_str] + row_strs))}</pre>"
                )
            else:
                for tl in table_lines:
                    parts.append(inline_tg(tl))
            continue
        h_match = re.match(r"^(#{1,6})\s+(.*)$", stripped)
        if h_match:
            h_len = len(h_match.group(1))
            h_text = inline_tg(h_match.group(2))
            mapping = {
                1: f"<b>━━━ {_upper_keep_tags(h_text)} ━━━</b>",
                2: f"<b>▶ {h_text}</b>",
                3: f"<b>◆ {h_text}</b>",
                4: f"<b>• <u>{h_text}</u></b>",
                5: f"<b><i>» {h_text}</i></b>",
            }
            parts.append(mapping.get(h_len, f"<i>• {h_text}</i>"))
            i += 1
            continue
        task_match = re.match(r"^[-*+]\s+\[([ xX])\]\s+(.*)$", stripped)
        if task_match:
            mark = "☑" if task_match.group(1).lower() == "x" else "☐"
            parts.append(f"{mark} {inline_tg(task_match.group(2))}")
            i += 1
            continue
        ul_match = re.match(r"^[-*+]\s+(.*)$", stripped)
        if ul_match:
            parts.append(f"• {inline_tg(ul_match.group(1))}")
            i += 1
            continue
        ol_match = re.match(r"^(\d+)\.\s+(.*)$", stripped)
        if ol_match:
            parts.append(f"{ol_match.group(1)}. {inline_tg(ol_match.group(2))}")
            i += 1
            continue
        parts.append("" if not stripped else inline_tg(line))
        i += 1
    return "\n".join(parts), found_images
