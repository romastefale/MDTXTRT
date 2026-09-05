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


def markdown_to_telegraph(source: str) -> TelegraphProjection:
    """Projeção explícita para o subconjunto suportado pelo Telegraph."""
    text = source or ""
    degradations: list[str] = []

    def local_media(match: re.Match) -> str:
        alt, kind, _mid, caption = match.groups()
        label = caption or alt or kind
        degradations.append("Mídia local do Telegram não pode ser publicada no Telegraph sem URL pública.")
        return f"[{label}]"

    text = LOCAL_MEDIA_RE.sub(local_media, text)

    def media_url(match: re.Match) -> str:
        alt, url, caption = match.groups()
        kind = _media_kind_from_url(url)
        if kind == "image":
            return f'![{alt}]({url}{f" \"{caption}\"" if caption else ""})'
        label = caption or alt or kind
        degradations.append(f"Mídia {kind} por URL vira link no Telegraph.")
        return f"[{label}]({url})"

    text = HTTP_MEDIA_RE.sub(media_url, text)
    text = re.sub(r"<tg-map\b[^>]*/>", lambda _m: degradations.append("Mapa Telegram não possui equivalente nativo no Telegraph.") or "[Mapa]", text, flags=re.IGNORECASE)
    text = re.sub(r"<tg-button-row\b[^>]*>|</tg-button-row>", "", text, flags=re.IGNORECASE)
    text = re.sub(r"<tg-button\b([^>]*)>(.*?)</tg-button>", lambda m: _telegraph_button(m, degradations), text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<tg-(?:collage|slideshow)\b[^>]*>|</tg-(?:collage|slideshow)>", "", text, flags=re.IGNORECASE)
    text = re.sub(r"<blockquote\s+expandable>", "<blockquote>", text, flags=re.IGNORECASE)
    text = re.sub(r"<details(?:\s+open)?><summary>(.*?)</summary>(.*?)</details>", lambda m: _telegraph_details(m), text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<a\s+name=\"([^\"]+)\"></a>", "", text, flags=re.IGNORECASE)
    text = re.sub(r"<tg-reference\s+name=\"([^\"]+)\">(.*?)</tg-reference>", r"\2", text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<footer>(.*?)</footer>", r"\1", text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<aside>(.*?)</aside>", r"<blockquote>\1</blockquote>", text, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r"<cite>(.*?)</cite>", r" — \1", text, flags=re.IGNORECASE | re.DOTALL)
    return TelegraphProjection(html=_markdown_to_telegraph_html(text), degradations=_unique(degradations))


def _telegraph_button(match: re.Match, degradations: list[str]) -> str:
    attrs, label = match.group(1), match.group(2)
    url = re.search(r'\burl="([^"]+)"', attrs, flags=re.IGNORECASE)
    if url and url.group(1).startswith(("https://", "http://")):
        degradations.append("Botão Rich vira link no Telegraph.")
        return f"[{label}]({url.group(1)})"
    degradations.append("Ação de botão Telegram não existe no Telegraph; apenas o rótulo foi mantido.")
    return label


def _telegraph_details(match: re.Match) -> str:
    return f"**{match.group(1)}**\n\n{match.group(2)}"


def _markdown_to_telegraph_html(source: str) -> str:
    import convert

    return convert.markdown_to_telegraph_html(source)
