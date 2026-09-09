"""Loss-aware imports and projections around the canonical document."""
from __future__ import annotations

import json
import re
from uuid import uuid4

from mdtxtrt.domain import CanonicalDocument, CanonicalNode

_HEADING = re.compile(r"^(#{1,6})[ \t]+(.*)$")
_FENCE = re.compile(r"^\s*(`{3,}|~{3,})(.*)$")


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
            blocks.append(CanonicalNode.create("paragraph", text="\n".join(paragraph)))
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
            blocks.append(CanonicalNode.create(
                "heading",
                text=heading.group(2),
                attrs={"level": len(heading.group(1))},
            ))
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
                blocks.append(CanonicalNode.create("raw_markdown", text="\n".join(raw_lines)))
            continue

        if line.startswith("> "):
            flush_paragraph()
            quote = [line[2:]]
            index += 1
            while index < len(lines) and lines[index].startswith("> "):
                quote.append(lines[index][2:])
                index += 1
            blocks.append(CanonicalNode.create("blockquote", text="\n".join(quote)))
            continue

        # Custom/Rich HTML stays explicit and loss-aware until a dedicated
        # canonical node exists. It is never silently flattened.
        if line.lstrip().startswith("<"):
            flush_paragraph()
            raw = [line]
            index += 1
            while index < len(lines) and lines[index].strip():
                raw.append(lines[index])
                index += 1
            blocks.append(CanonicalNode.create("raw_markdown", text="\n".join(raw)))
            continue

        paragraph.append(line)
        index += 1

    flush_paragraph()
    return CanonicalDocument(
        id=str(uuid4()),
        schema_version=CanonicalDocument.CURRENT_SCHEMA_VERSION,
        blocks=tuple(blocks),
        metadata={"import_format": "markdown"},
    )


def from_text(source: str) -> CanonicalDocument:
    text = (source or "").replace("\r\n", "\n").replace("\r", "\n")
    blocks = tuple(
        CanonicalNode.create("paragraph", text=part)
        for part in text.split("\n\n")
        if part
    )
    return CanonicalDocument(
        id=str(uuid4()),
        schema_version=CanonicalDocument.CURRENT_SCHEMA_VERSION,
        blocks=blocks,
        metadata={"import_format": "text"},
    )


def to_markdown(document: CanonicalDocument) -> str:
    rendered: list[str] = []
    for block in document.blocks:
        if block.kind == "paragraph":
            rendered.append(block.text or "")
        elif block.kind == "heading":
            level = min(6, max(1, int(block.attrs.get("level", 1))))
            rendered.append(f'{"#" * level} {block.text or ""}')
        elif block.kind == "blockquote":
            rendered.append("\n".join(f"> {line}" for line in (block.text or "").split("\n")))
        elif block.kind == "code_block":
            language = str(block.attrs.get("language", ""))
            rendered.append(f"```{language}\n{block.text or ''}\n```")
        elif block.kind == "raw_markdown":
            rendered.append(block.text or "")
        else:
            rendered.append("<!-- mdtxtrt:unprojected " + json.dumps(block.to_dict(), ensure_ascii=False, sort_keys=True) + " -->")
    return "\n\n".join(rendered)


def to_text(document: CanonicalDocument) -> str:
    out: list[str] = []
    for block in document.blocks:
        if block.kind in {"paragraph", "heading", "blockquote", "code_block", "raw_markdown"}:
            out.append(block.text or "")
        else:
            out.append(f"[{block.kind}]")
    return "\n\n".join(out)
