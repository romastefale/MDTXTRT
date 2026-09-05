"""Modelo canônico MDTXTRT e projeções Telegram Rich 10.3 / Telegraph."""
from __future__ import annotations

from dataclasses import dataclass
import html
import re
from urllib.parse import urlparse

LOCAL_MEDIA_RE = re.compile(
    r'!\[([^\]]*)\]\(mdtxtrt://(photo|video|animation|audio|voice|document)/([A-Za-z0-9_-]+)(?:\s+"([^"]*)")?\)'
)
HTTP_MEDIA_RE = re.compile(
    r'^!\[([^\]]*)\]\((https?://[^\s)]+)(?:\s+"([^"]*)")?\)\s*$'
)
INLINE_LINK_RE = re.compile(r'\[([^\]]+)\]\(([^)]+)\)')
INLINE_IMAGE_RE = re.compile(r'!\[([^\]]*)\]\((https?://[^\s)]+)(?:\s+"([^"]*)")?\)')


@dataclass(frozen=True)
class LocalMediaRef:
    kind: str
    media_id: str
    caption: str = ""

    @property
    def telegram_scheme(self) -> str:
        if self.kind == "photo":
            return "photo"
        if self.kind in {"video", "animation"}:
            return "video"
        if self.kind == "document":
            return "document"
        return "audio"


@dataclass(frozen=True)
class TelegraphProjection:
    html: str
    degradations: tuple[str, ...]


@dataclass(frozen=True)
class CanonicalDocument:
    markdown: str

    @classmethod
    def from_markdown(cls, source: str) -> "CanonicalDocument":
        text = (source or "").replace("\r\n", "\n").replace("\r", "\n")
        if text.startswith("\ufeff"):
            text = text[1:]
        return cls(text)

    def telegram_markdown(self) -> tuple[str, tuple[LocalMediaRef, ...]]:
        refs: list[LocalMediaRef] = []

        def repl(match: re.Match) -> str:
            alt, kind, media_id, caption = match.groups()
            caption = caption or alt or ""
            ref = LocalMediaRef(kind=kind, media_id=media_id, caption=caption)
            refs.append(ref)
            title = f' "{caption.replace(chr(34), "")}"' if caption else ""
            return f"![](tg://{ref.telegram_scheme}?id={media_id}{title})"

        return LOCAL_MEDIA_RE.sub(repl, self.markdown), tuple(refs)

    def telegraph(self) -> TelegraphProjection:
        return markdown_to_telegraph(self.markdown)


def _unique(items: list[str]) -> tuple[str, ...]:
    seen = set()
    out = []
    for item in items:
        if item not in seen:
            seen.add(item)
            out.append(item)
    return tuple(out)


def _media_kind_from_url(url: str) -> str:
    path = urlparse(url).path.lower()
    if path.endswith((".jpg", ".jpeg", ".png", ".webp", ".avif")):
        return "image"
    if path.endswith((".mp4", ".webm", ".mov", ".m4v", ".gif")):
        return "video"
    if path.endswith((".mp3", ".m4a", ".aac", ".ogg", ".opus", ".flac", ".wav")):
        return "audio"
    return "document"


def _inline_telegraph(text: str, degradations: list[str]) -> str:
    # Preserve meaning while making every loss of Telegram-only semantics explicit.
    placeholders: dict[str, str] = {}

    def hold(value: str) -> str:
        key = f"\x00{len(placeholders)}\x00"
        placeholders[key] = value
        return key

    if re.search(r"\|\|.*?\|\||<tg-spoiler\b", text, re.I | re.S):
        degradations.append("Spoiler do Telegram é publicado revelado no Telegraph.")
    if re.search(r"==.+?==", text, re.S):
        degradations.append("Texto marcado do Telegram é publicado em destaque simples no Telegraph.")
    if re.search(r"<(?:sub|sup)>", text, re.I):
        degradations.append("Subscrito/sobrescrito é preservado como texto normal no Telegraph.")
    if re.search(r"<a\s+name=", text, re.I):
        degradations.append("Âncoras internas do Telegram não existem no Telegraph e são removidas.")
    if re.search(r"<tg-reference\b", text, re.I):
        degradations.append("Referências internas do Telegram são preservadas como texto no Telegraph.")

    def html_link(match: re.Match) -> str:
        url, label = match.groups()
        label = re.sub(r"<[^>]+>", "", label)
        if url.startswith("#"):
            degradations.append("Links internos/âncoras do Telegram viram texto no Telegraph.")
            return hold(html.escape(label))
        return hold(
            f'<a href="{html.escape(url, quote=True)}">{html.escape(label)}</a>'
        )

    text = re.sub(
        r'<a\s+href="([^"]+)"\s*>(.*?)</a>',
        html_link,
        text,
        flags=re.I | re.S,
    )
    text = re.sub(r'<a\s+name="[^"]+"\s*></a>', "", text, flags=re.I)
    text = re.sub(r'<tg-reference\s+name="[^"]+">(.*?)</tg-reference>', r"\1", text, flags=re.I | re.S)
    text = re.sub(r"<tg-spoiler>(.*?)</tg-spoiler>", r"\1", text, flags=re.I | re.S)
    text = text.replace("||", "")

    def link(match: re.Match) -> str:
        label, url = match.groups()
        if url.startswith("#"):
            degradations.append("Links internos/âncoras do Telegram viram texto no Telegraph.")
            return hold(html.escape(label))
        return hold(
            f'<a href="{html.escape(url, quote=True)}">{html.escape(label)}</a>'
        )

    # Protect constructs that must not be parsed again by Markdown regexes.
    text = INLINE_LINK_RE.sub(link, text)

    def formula(match: re.Match) -> str:
        degradations.append(
            "Fórmulas LaTeX são preservadas como código porque o Telegraph não possui bloco matemático nativo."
        )
        return hold(f"<code>{html.escape(match.group(1))}</code>")

    text = re.sub(r"(?<!\$)\$([^\n$]+)\$(?!\$)", formula, text)
    text = re.sub(
        r"`([^`\n]+)`",
        lambda m: hold(f"<code>{html.escape(m.group(1))}</code>"),
        text,
    )

    escaped = html.escape(text, quote=False)
    escaped = re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", escaped)
    escaped = re.sub(r"__(.+?)__", r"<strong>\1</strong>", escaped)  # Rich Markdown: __ is bold
    escaped = re.sub(r"(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)", r"<em>\1</em>", escaped)
    escaped = re.sub(r"(?<!_)_(?!_)(.+?)(?<!_)_(?!_)", r"<em>\1</em>", escaped)
    escaped = re.sub(r"~~(.+?)~~", r"<s>\1</s>", escaped)
    escaped = re.sub(r"==(.+?)==", r"<strong>\1</strong>", escaped)
    escaped = re.sub(r"&lt;u&gt;(.*?)&lt;/u&gt;", r"<u>\1</u>", escaped, flags=re.I | re.S)
    escaped = re.sub(
        r"&lt;(?:sub|sup)&gt;(.*?)&lt;/(?:sub|sup)&gt;",
        r"\1",
        escaped,
        flags=re.I | re.S,
    )

    for key, value in placeholders.items():
        escaped = escaped.replace(key, value)
    return escaped


def _collect_tag_block(lines: list[str], start: int, closing: str) -> tuple[str, int]:
    block: list[str] = []
    i = start
    closing_lower = closing.lower()
    while i < len(lines):
        block.append(lines[i])
        i += 1
        if closing_lower in lines[i - 1].lower():
            break
    return "\n".join(block), i


def markdown_to_telegraph(source: str) -> TelegraphProjection:
    text = CanonicalDocument.from_markdown(source).markdown
    degradations: list[str] = []

    if re.search(r"(?m)^#{1,2}\s|^#{5,6}\s", text):
        degradations.append(
            "Telegraph só possui h3/h4; H1-H2 e H5-H6 são mapeados deterministicamente para esses níveis."
        )
    if re.search(r"(?m)^\s*\|.*\|\s*$", text):
        degradations.append("Tabelas Rich/GFM são preservadas como bloco preformatado no Telegraph.")
    if "<details" in text.lower():
        degradations.append(
            "Blocos <details> não existem no Telegraph; resumo e corpo são publicados expandidos."
        )
    if re.search(r"<blockquote\s+expandable\b", text, re.I):
        degradations.append(
            "Citação expandível é publicada como citação normal no Telegraph."
        )
    if re.search(r"<footer\b", text, re.I):
        degradations.append("Rodapé Rich é preservado como parágrafo enfatizado no Telegraph.")
    if re.search(r"<tg-(?:map|button|collage|slideshow|reference)", text, re.I):
        degradations.append(
            "Estruturas exclusivas do Telegram Rich são convertidas para uma representação textual/compatível no Telegraph."
        )
    if LOCAL_MEDIA_RE.search(text):
        degradations.append(
            "Mídia de upload local é temporária e não pode ser persistida pelo Telegraph; apenas a legenda é mantida."
        )

    lines = text.split("\n")
    parts: list[str] = []
    para: list[str] = []
    i = 0

    def flush_para() -> None:
        if not para:
            return
        raw = " ".join(x.strip() for x in para if x.strip())
        para.clear()
        if raw:
            parts.append(f"<p>{_inline_telegraph(raw, degradations)}</p>")

    while i < len(lines):
        raw_line = lines[i]
        stripped = raw_line.strip()

        # Fenced code or math.
        if stripped.startswith("```"):
            flush_para()
            language = stripped[3:].strip().lower()
            i += 1
            body: list[str] = []
            while i < len(lines) and not lines[i].strip().startswith("```"):
                body.append(lines[i])
                i += 1
            if i < len(lines):
                i += 1
            if language == "math":
                degradations.append("Blocos matemáticos são publicados como preformatado no Telegraph.")
            parts.append(f"<pre>{html.escape(chr(10).join(body))}</pre>")
            continue

        if stripped == "$$" or stripped.startswith("$$"):
            flush_para()
            expr = stripped[2:]
            if stripped.endswith("$$") and len(stripped) > 4:
                expr = stripped[2:-2]
                i += 1
            else:
                i += 1
                body = [expr] if expr else []
                while i < len(lines) and "$$" not in lines[i]:
                    body.append(lines[i])
                    i += 1
                if i < len(lines):
                    tail = lines[i].split("$$", 1)[0]
                    if tail:
                        body.append(tail)
                    i += 1
                expr = "\n".join(body)
            degradations.append(
                "Fórmulas LaTeX são preservadas como código porque o Telegraph não possui bloco matemático nativo."
            )
            parts.append(f"<pre>{html.escape(expr.strip())}</pre>")
            continue

        # Temporary local upload.
        local = LOCAL_MEDIA_RE.fullmatch(stripped)
        if local:
            flush_para()
            caption = local.group(4) or local.group(1) or "Mídia do Telegram"
            parts.append(f"<p><em>{html.escape(caption)}</em></p>")
            i += 1
            continue

        # HTTP media as an independent Rich Markdown block.
        media = HTTP_MEDIA_RE.fullmatch(stripped)
        if media:
            flush_para()
            alt, url, caption = media.groups()
            caption = caption or alt or ""
            safe_url = html.escape(url, quote=True)
            kind = _media_kind_from_url(url)
            if kind == "image":
                node = f'<img src="{safe_url}">'
            elif kind == "video":
                node = f'<video src="{safe_url}"></video>'
            else:
                degradations.append(
                    "Áudio/documento Rich por URL vira link no Telegraph, que não oferece bloco equivalente confiável."
                )
                parts.append(
                    f'<p><a href="{safe_url}">{html.escape(caption or "Abrir mídia")}</a></p>'
                )
                i += 1
                continue
            if caption:
                parts.append(
                    f"<figure>{node}<figcaption>{html.escape(caption)}</figcaption></figure>"
                )
            else:
                parts.append(node)
            i += 1
            continue

        # Expandable Telegram quote becomes a normal Telegraph quotation, not literal tags.
        if re.match(r"<blockquote\s+expandable\b", stripped, re.I):
            flush_para()
            blob, i = _collect_tag_block(lines, i, "</blockquote>")
            body = re.sub(r"^<blockquote\s+expandable[^>]*>", "", blob.strip(), flags=re.I)
            body = re.sub(r"</blockquote>\s*$", "", body, flags=re.I).strip()
            parts.append(f"<blockquote>{_inline_telegraph(' '.join(body.splitlines()), degradations)}</blockquote>")
            continue

        # Pull quote is natively representable by Telegraph's <aside>; credit becomes emphasized text.
        if stripped.lower().startswith("<aside"):
            flush_para()
            blob, i = _collect_tag_block(lines, i, "</aside>")
            inner = re.sub(r"^<aside[^>]*>", "", blob.strip(), flags=re.I)
            inner = re.sub(r"</aside>\s*$", "", inner, flags=re.I).strip()
            credit_match = re.search(r"<cite>(.*?)</cite>", inner, flags=re.I | re.S)
            credit = credit_match.group(1).strip() if credit_match else ""
            body = re.sub(r"<cite>.*?</cite>", "", inner, flags=re.I | re.S).strip()
            rendered = _inline_telegraph(body, degradations)
            if credit:
                rendered += f" <em>— {_inline_telegraph(credit, degradations)}</em>"
            parts.append(f"<aside>{rendered}</aside>")
            continue

        # Telegram map becomes a normal link.
        map_match = re.search(
            r'<tg-map\s+[^>]*lat="([^"]+)"[^>]*long="([^"]+)"[^>]*/?>',
            stripped,
            re.I,
        )
        if map_match:
            flush_para()
            lat, lon = map_match.groups()
            url = f"https://maps.google.com/?q={lat},{lon}"
            parts.append(
                f'<p><a href="{html.escape(url, quote=True)}">Mapa: {html.escape(lat)}, {html.escape(lon)}</a></p>'
            )
            i += 1
            continue

        # Button rows: preserve destination; copy_text also preserves the copied value.
        if stripped.lower().startswith("<tg-button-row"):
            flush_para()
            blob, i = _collect_tag_block(lines, i, "</tg-button-row>")
            buttons = re.findall(r"<tg-button\s+([^>]*)>(.*?)</tg-button>", blob, re.I | re.S)
            rendered = []
            for attrs, label in buttons:
                url_match = re.search(r'url="([^"]+)"', attrs, re.I)
                copy_match = re.search(r'type="copy_text"', attrs, re.I)
                text_match = re.search(r'text="([^"]*)"', attrs, re.I)
                label = re.sub(r"<[^>]+>", "", label).strip() or "Botão"
                if url_match:
                    rendered.append(
                        f'<a href="{html.escape(url_match.group(1), quote=True)}">{html.escape(label)}</a>'
                    )
                elif copy_match:
                    copied = text_match.group(1) if text_match else ""
                    if copied:
                        rendered.append(
                            f"{html.escape(label)}: <code>{html.escape(copied)}</code>"
                        )
                    else:
                        rendered.append(html.escape(label))
                else:
                    rendered.append(html.escape(label))
            if rendered:
                parts.append("<p>" + " · ".join(rendered) + "</p>")
            continue

        # Details: publish expanded, preserve the summary once and recursively project its rich body.
        if stripped.lower().startswith("<details"):
            flush_para()
            blob, i = _collect_tag_block(lines, i, "</details>")
            summary = re.search(r"<summary>(.*?)</summary>", blob, re.I | re.S)
            if summary:
                parts.append(
                    f"<h4>{_inline_telegraph(summary.group(1), degradations)}</h4>"
                )
            body = re.sub(r"<summary>.*?</summary>", "", blob, flags=re.I | re.S)
            body = re.sub(r"</?details[^>]*>", "", body, flags=re.I).strip()
            if body:
                nested = markdown_to_telegraph(body)
                parts.append(nested.html)
                degradations.extend(nested.degradations)
            continue

        # Preserve GFM tables as preformatted source.
        if stripped.startswith("|") and stripped.endswith("|"):
            flush_para()
            table: list[str] = []
            while (
                i < len(lines)
                and lines[i].strip().startswith("|")
                and lines[i].strip().endswith("|")
            ):
                table.append(lines[i].rstrip())
                i += 1
            parts.append(f"<pre>{html.escape(chr(10).join(table))}</pre>")
            continue

        if re.match(r"^(---+|\*\*\*+)$", stripped):
            flush_para()
            parts.append("<hr>")
            i += 1
            continue

        heading = re.match(r"^(#{1,6})\s+(.*)$", stripped)
        if heading:
            flush_para()
            level = len(heading.group(1))
            tag = "h3" if level <= 2 else "h4"
            parts.append(
                f"<{tag}>{_inline_telegraph(heading.group(2), degradations)}</{tag}>"
            )
            i += 1
            continue

        if stripped.startswith(">"):
            flush_para()
            quote: list[str] = []
            while i < len(lines) and (
                lines[i].strip().startswith(">") or not lines[i].strip()
            ):
                current = lines[i].strip()
                if current.startswith(">"):
                    current = current[1:].lstrip()
                    quote.append(current)
                elif quote:
                    quote.append("")
                i += 1
            parts.append(
                f"<blockquote>{_inline_telegraph(' '.join(quote).strip(), degradations)}</blockquote>"
            )
            continue

        list_match = re.match(r"^([-*+]|\d+\.)\s+(.*)$", stripped)
        if list_match:
            flush_para()
            ordered = list_match.group(1)[0].isdigit()
            items: list[str] = []
            while i < len(lines):
                cur = lines[i].strip()
                task = re.match(r"^[-*+]\s+\[([ xX])\]\s+(.*)$", cur)
                ul = re.match(r"^[-*+]\s+(.*)$", cur)
                ol = re.match(r"^\d+\.\s+(.*)$", cur)
                if task and not ordered:
                    mark = "☑" if task.group(1).lower() == "x" else "☐"
                    items.append(
                        f"<li>{mark} {_inline_telegraph(task.group(2), degradations)}</li>"
                    )
                elif ul and not ordered:
                    items.append(
                        f"<li>{_inline_telegraph(ul.group(1), degradations)}</li>"
                    )
                elif ol and ordered:
                    items.append(
                        f"<li>{_inline_telegraph(ol.group(1), degradations)}</li>"
                    )
                else:
                    break
                i += 1
            tag = "ol" if ordered else "ul"
            parts.append(f"<{tag}>{''.join(items)}</{tag}>")
            continue

        # Footer is not a Telegraph node type; keep its visible meaning without leaking markup.
        footer_match = re.fullmatch(r"<footer>(.*?)</footer>", stripped, re.I | re.S)
        if footer_match:
            flush_para()
            parts.append(
                f"<p><em>{_inline_telegraph(footer_match.group(1), degradations)}</em></p>"
            )
            i += 1
            continue

        if not stripped:
            flush_para()
            i += 1
            continue

        # Collage/slideshow grouping is Telegram-only; individual media lines are projected above.
        cleaned = re.sub(
            r"</?(?:tg-collage|tg-slideshow)[^>]*>", "", stripped, flags=re.I
        ).strip()
        if cleaned:
            para.append(cleaned)
        i += 1

    flush_para()
    return TelegraphProjection(
        "".join(parts).strip() or "<p></p>",
        _unique(degradations),
    )
