"""Loss-aware import/export projections around the canonical document.

Markdown is parsed into the canonical tree where the representation is
unambiguous. Unsupported or application-specific block syntax remains explicit
instead of being discarded or silently normalized.
"""
from __future__ import annotations

import json
import re
from urllib.parse import urlparse
from uuid import uuid4

from mdtxtrt.domain import CanonicalDocument, CanonicalNode

_HEADING = re.compile(r"^(#{1,6})[ \t]+(.*)$")
_FENCE = re.compile(r"^\s*(`{3,}|~{3,})(.*)$")
_THEMATIC = re.compile(r"^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$")
_UL = re.compile(r"^\s{0,3}[-+*]\s+(.*)$")
_OL = re.compile(r"^\s{0,3}(\d+)[.)]\s+(.*)$")
_TASK = re.compile(r"^\[([ xX])\]\s+(.*)$")
_TABLE_DIVIDER_CELL = re.compile(r"^:?-{3,}:?$")
_IMAGE_ONLY = re.compile(r"^!\[([^\]]*)\]\(([^\s)]+)(?:\s+[\"']([^\"']*)[\"'])?\)\s*$")

_INLINE = re.compile(
    r"(?P<code>`([^`\n]+)`)|"
    r"(?P<emoji>!\[([^\]]*)\]\(tg://emoji\?id=([^)]+)\))|"
    r"(?P<link>\[([^\]]+)\]\(([^)\s]+)\))|"
    r"(?P<bold>\*\*(.+?)\*\*|__(.+?)__)|"
    r"(?P<strike>~~(.+?)~~)|"
    r"(?P<mark>==(.+?)==)|"
    r"(?P<spoiler>\|\|(.+?)\|\|)|"
    r"(?P<math>(?<!\$)\$([^\n$]+)\$(?!\$))|"
    r"(?P<italic>(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)|(?<!_)_(?!_)(.+?)(?<!_)_(?!_))"
)


def _doc(blocks: list[CanonicalNode], import_format: str) -> CanonicalDocument:
    return CanonicalDocument(
        id=str(uuid4()),
        schema_version=CanonicalDocument.CURRENT_SCHEMA_VERSION,
        blocks=tuple(blocks),
        metadata={"import_format": import_format},
    )


def _text(value: str) -> CanonicalNode:
    return CanonicalNode.create("text", text=value)


def _inline_nodes(source: str) -> tuple[CanonicalNode, ...]:
    out: list[CanonicalNode] = []
    cursor = 0
    for match in _INLINE.finditer(source or ""):
        if match.start() > cursor:
            out.append(_text(source[cursor:match.start()]))
        token = match.group(0)
        group = match.lastgroup
        if group == "code":
            out.append(CanonicalNode.create("code", text=token[1:-1]))
        elif group == "emoji":
            m = re.fullmatch(r"!\[([^\]]*)\]\(tg://emoji\?id=([^)]+)\)", token)
            out.append(CanonicalNode.create("custom_emoji", attrs={"emoji_id": m.group(2)}, children=(_text(m.group(1)),)))
        elif group == "link":
            m = re.fullmatch(r"\[([^\]]+)\]\(([^)\s]+)\)", token)
            out.append(CanonicalNode.create("url", attrs={"url": m.group(2)}, children=_inline_nodes(m.group(1))))
        elif group == "bold":
            inner = token[2:-2]
            out.append(CanonicalNode.create("bold", children=_inline_nodes(inner)))
        elif group == "strike":
            out.append(CanonicalNode.create("strikethrough", children=_inline_nodes(token[2:-2])))
        elif group == "mark":
            out.append(CanonicalNode.create("marked", children=_inline_nodes(token[2:-2])))
        elif group == "spoiler":
            out.append(CanonicalNode.create("spoiler", children=_inline_nodes(token[2:-2])))
        elif group == "math":
            out.append(CanonicalNode.create("math_inline", text=token[1:-1]))
        elif group == "italic":
            out.append(CanonicalNode.create("italic", children=_inline_nodes(token[1:-1])))
        cursor = match.end()
    if cursor < len(source):
        out.append(_text(source[cursor:]))
    return tuple(out)


def _paragraph(lines: list[str]) -> CanonicalNode:
    return CanonicalNode.create("paragraph", children=_inline_nodes("\n".join(lines)))


def _split_table_row(line: str) -> list[str]:
    line = line.strip()
    if line.startswith("|"):
        line = line[1:]
    if line.endswith("|"):
        line = line[:-1]
    cells: list[str] = []
    current: list[str] = []
    escaped = False
    for ch in line:
        if escaped:
            current.append(ch)
            escaped = False
        elif ch == "\\":
            escaped = True
            current.append(ch)
        elif ch == "|":
            cells.append("".join(current).strip())
            current.clear()
        else:
            current.append(ch)
    cells.append("".join(current).strip())
    return cells


def _is_table_divider(line: str) -> bool:
    cells = _split_table_row(line)
    return bool(cells) and all(_TABLE_DIVIDER_CELL.fullmatch(cell.replace(" ", "")) for cell in cells)


def _table_alignment(cell: str) -> str | None:
    value = cell.strip().replace(" ", "")
    if value.startswith(":") and value.endswith(":"):
        return "center"
    if value.endswith(":"):
        return "right"
    if value.startswith(":"):
        return "left"
    return None


def _table(lines: list[str], start: int) -> tuple[CanonicalNode | None, int]:
    if start + 1 >= len(lines) or "|" not in lines[start] or not _is_table_divider(lines[start + 1]):
        return None, start
    headers = _split_table_row(lines[start])
    divider = _split_table_row(lines[start + 1])
    alignments = [_table_alignment(cell) for cell in divider]
    rows: list[CanonicalNode] = []
    head_cells = []
    for index, value in enumerate(headers):
        attrs = {"align": alignments[index]} if index < len(alignments) and alignments[index] else {}
        head_cells.append(CanonicalNode.create("table_header", attrs=attrs, children=_inline_nodes(value)))
    rows.append(CanonicalNode.create("table_row", children=tuple(head_cells)))
    cursor = start + 2
    while cursor < len(lines) and lines[cursor].strip() and "|" in lines[cursor]:
        cells = []
        for index, value in enumerate(_split_table_row(lines[cursor])):
            attrs = {"align": alignments[index]} if index < len(alignments) and alignments[index] else {}
            cells.append(CanonicalNode.create("table_cell", attrs=attrs, children=_inline_nodes(value)))
        rows.append(CanonicalNode.create("table_row", children=tuple(cells)))
        cursor += 1
    return CanonicalNode.create("table", attrs={"bordered": True}, children=tuple(rows)), cursor


def _list(lines: list[str], start: int) -> tuple[CanonicalNode | None, int]:
    first_ul = _UL.match(lines[start])
    first_ol = _OL.match(lines[start])
    if not first_ul and not first_ol:
        return None, start
    ordered = bool(first_ol)
    items: list[CanonicalNode] = []
    cursor = start
    first_number = int(first_ol.group(1)) if first_ol else 1
    while cursor < len(lines):
        match = _OL.match(lines[cursor]) if ordered else _UL.match(lines[cursor])
        if not match:
            break
        body = match.group(2) if ordered else match.group(1)
        task = _TASK.match(body)
        attrs: dict[str, object] = {}
        if task:
            attrs.update({"task": True, "checked": task.group(1).lower() == "x"})
            body = task.group(2)
        if ordered:
            attrs["value"] = int(match.group(1))
        items.append(CanonicalNode.create("list_item", attrs=attrs, children=_inline_nodes(body)))
        cursor += 1
    attrs: dict[str, object] = {"ordered": ordered}
    if ordered and first_number != 1:
        attrs["start"] = first_number
    return CanonicalNode.create("list", attrs=attrs, children=tuple(items)), cursor


def _media_kind(url: str) -> str:
    path = urlparse(url).path.lower()
    if path.endswith((".jpg", ".jpeg", ".png", ".webp", ".avif")):
        return "photo"
    if path.endswith(".gif"):
        return "animation"
    if path.endswith((".mp4", ".webm", ".mov", ".m4v")):
        return "video"
    if path.endswith((".mp3", ".m4a", ".aac", ".ogg", ".opus", ".flac", ".wav")):
        return "audio"
    return "document"


def from_markdown(source: str) -> CanonicalDocument:
    text = (source or "").replace("\r\n", "\n").replace("\r", "\n")
    if text.startswith("\ufeff"):
        text = text[1:]
    lines = text.split("\n")
    blocks: list[CanonicalNode] = []
    paragraph: list[str] = []
    index = 0

    def flush_paragraph() -> None:
        if paragraph:
            blocks.append(_paragraph(paragraph))
            paragraph.clear()

    while index < len(lines):
        line = lines[index]
        if not line.strip():
            flush_paragraph()
            index += 1
            continue

        heading = _HEADING.match(line)
        if heading:
            flush_paragraph()
            blocks.append(CanonicalNode.create("heading", attrs={"level": len(heading.group(1))}, children=_inline_nodes(heading.group(2))))
            index += 1
            continue

        fence = _FENCE.match(line)
        if fence:
            flush_paragraph()
            marker = fence.group(1)
            language = fence.group(2).strip()
            raw_lines = [line]
            body: list[str] = []
            index += 1
            closed = False
            while index < len(lines):
                current = lines[index]
                raw_lines.append(current)
                if re.match(rf"^\s*{re.escape(marker[0])}{{{len(marker)},}}\s*$", current):
                    closed = True
                    index += 1
                    break
                body.append(current)
                index += 1
            if closed:
                blocks.append(CanonicalNode.create("code_block", text="\n".join(body), attrs={"language": language}))
            else:
                blocks.append(CanonicalNode.create("raw_markdown", text="\n".join(raw_lines), attrs={"reason": "unclosed_fence"}))
            continue

        if _THEMATIC.match(line):
            flush_paragraph()
            blocks.append(CanonicalNode.create("divider"))
            index += 1
            continue

        table, next_index = _table(lines, index)
        if table is not None:
            flush_paragraph()
            blocks.append(table)
            index = next_index
            continue

        listing, next_index = _list(lines, index)
        if listing is not None:
            flush_paragraph()
            blocks.append(listing)
            index = next_index
            continue

        if line.startswith(">"):
            flush_paragraph()
            quote_lines: list[str] = []
            expandable = False
            while index < len(lines) and lines[index].startswith(">"):
                value = lines[index][1:]
                if value.startswith(" "):
                    value = value[1:]
                if value.startswith("||"):
                    expandable = True
                    value = value[2:].lstrip()
                quote_lines.append(value)
                index += 1
            blocks.append(CanonicalNode.create("expandable_blockquote" if expandable else "blockquote", children=_inline_nodes("\n".join(quote_lines))))
            continue

        image = _IMAGE_ONLY.match(line.strip())
        if image:
            flush_paragraph()
            alt, url, title = image.groups()
            if url.startswith(("http://", "https://")):
                blocks.append(CanonicalNode.create(_media_kind(url), attrs={"src": url, "caption": title or alt or ""}))
            else:
                blocks.append(CanonicalNode.create("raw_markdown", text=line, attrs={"reason": "non_http_media"}))
            index += 1
            continue

        if line.lstrip().startswith("<"):
            flush_paragraph()
            raw = [line]
            index += 1
            while index < len(lines) and lines[index].strip():
                raw.append(lines[index])
                index += 1
            blocks.append(CanonicalNode.create("raw_markdown", text="\n".join(raw), attrs={"reason": "custom_or_raw_html"}))
            continue

        paragraph.append(line)
        index += 1

    flush_paragraph()
    return _doc(blocks, "markdown")


def from_text(source: str) -> CanonicalDocument:
    """Import TXT literally; text that resembles Markdown remains text."""
    text = (source or "").replace("\r\n", "\n").replace("\r", "\n")
    blocks = [
        CanonicalNode.create("paragraph", children=(_text(part),))
        for part in text.split("\n\n")
        if part
    ]
    return _doc(blocks, "text")


def _inline_markdown(node: CanonicalNode) -> str:
    body = "".join(_inline_markdown(child) for child in node.children) if node.children else (node.text or "")
    wrappers = {
        "bold": ("**", "**"), "italic": ("*", "*"), "strikethrough": ("~~", "~~"),
        "marked": ("==", "=="), "spoiler": ("||", "||"), "code": ("`", "`"),
    }
    if node.kind in {"text", "plain"}:
        return node.text or ""
    if node.kind in wrappers:
        left, right = wrappers[node.kind]
        return left + body + right
    if node.kind == "underline":
        return f"<u>{body}</u>"
    if node.kind == "subscript":
        return f"<sub>{body}</sub>"
    if node.kind == "superscript":
        return f"<sup>{body}</sup>"
    if node.kind in {"url", "link"}:
        return f"[{body}]({node.attrs.get('url', '')})"
    if node.kind == "custom_emoji":
        return f"![{body}](tg://emoji?id={node.attrs.get('emoji_id', '')})"
    if node.kind in {"math_inline", "mathematical_expression"}:
        return f"${node.text or body}$"
    if node.kind == "text_mention":
        return f"[{body}](tg://user?id={node.attrs.get('user_id', '')})"
    if node.kind in {"anchor_link", "reference_link"}:
        return f"[{body}](#{node.attrs.get('name', '')})"
    return body or f"[{node.kind}]"


def _plain(node: CanonicalNode) -> str:
    return "".join(_plain(child) for child in node.children) if node.children else (node.text or "")


def to_markdown(document: CanonicalDocument) -> str:
    rendered: list[str] = []
    for block in document.blocks:
        body = "".join(_inline_markdown(child) for child in block.children) if block.children else (block.text or "")
        if block.kind == "paragraph":
            rendered.append(body)
        elif block.kind == "heading":
            level = min(6, max(1, int(block.attrs.get("level", 1))))
            rendered.append(f'{"#" * level} {body}')
        elif block.kind in {"blockquote", "expandable_blockquote"}:
            prefix = ">|| " if block.kind == "expandable_blockquote" else "> "
            rendered.append("\n".join(prefix + line for line in body.split("\n")))
        elif block.kind == "pullquote":
            rendered.append("\n".join("> " + line for line in body.split("\n")))
        elif block.kind == "code_block":
            rendered.append(f"```{block.attrs.get('language', '')}\n{block.text or ''}\n```")
        elif block.kind == "divider":
            rendered.append("---")
        elif block.kind == "list":
            lines = []
            for i, item in enumerate(block.children, start=int(block.attrs.get("start", 1))):
                content = "".join(_inline_markdown(child) for child in item.children)
                if item.attrs.get("task"):
                    lines.append(f"- [{'x' if item.attrs.get('checked') else ' '}] {content}")
                elif block.attrs.get("ordered"):
                    lines.append(f"{item.attrs.get('value', i)}. {content}")
                else:
                    lines.append(f"- {content}")
            rendered.append("\n".join(lines))
        elif block.kind == "table":
            rows = [[_plain(cell).replace("|", "\\|") for cell in row.children] for row in block.children]
            if rows:
                rendered.append("| " + " | ".join(rows[0]) + " |")
                rendered.append("| " + " | ".join("---" for _ in rows[0]) + " |")
                rendered.extend("| " + " | ".join(row) + " |" for row in rows[1:])
        elif block.kind in {"photo", "video", "animation", "audio", "voice_note", "document"}:
            caption = str(block.attrs.get("caption") or "")
            rendered.append(f"![{caption}]({block.attrs.get('src', '')})")
        elif block.kind == "raw_markdown":
            rendered.append(block.text or "")
        else:
            rendered.append("<!-- mdtxtrt:canonical " + json.dumps(block.to_dict(), ensure_ascii=False, sort_keys=True) + " -->")
    return "\n\n".join(rendered)


def to_text(document: CanonicalDocument) -> str:
    out: list[str] = []
    for block in document.blocks:
        if block.kind == "list":
            for index, item in enumerate(block.children, start=1):
                marker = f"{index}." if block.attrs.get("ordered") else "-"
                if item.attrs.get("task"):
                    marker = "[x]" if item.attrs.get("checked") else "[ ]"
                out.append(f"{marker} {_plain(item)}")
        elif block.kind == "table":
            out.extend(" | ".join(_plain(cell) for cell in row.children) for row in block.children)
        elif block.kind == "map":
            name = str(block.attrs.get("name") or "Localização")
            out.append(f"{name}: {block.attrs.get('lat', '')}, {block.attrs.get('long', '')}")
        elif block.kind in {"photo", "video", "animation", "audio", "voice_note", "document"}:
            caption = str(block.attrs.get("caption") or block.kind)
            src = str(block.attrs.get("src") or "")
            out.append(f"{caption}: {src}" if src else caption)
        else:
            value = _plain(block) or block.text or ""
            if value:
                out.append(value)
    return "\n\n".join(out)
