"""Projeção reversa de mídia Rich sem confundir referência local com Telegram file_id."""
from __future__ import annotations

import html

import rich_media

_MEDIA_TYPES = {"photo", "video", "animation", "audio", "document", "voice_note"}
_ORIGINAL_BLOCK = None
_RT = None


def _file_id(block: dict) -> str:
    kind = str(block.get("type") or "")
    source = block.get(kind)
    if kind == "photo":
        sizes = source or []
        if isinstance(sizes, list) and sizes:
            item = sizes[-1]
            return str(item.get("file_id") or "") if isinstance(item, dict) else ""
        return ""
    if isinstance(source, dict):
        return str(source.get("file_id") or "")
    return ""


def _caption(block: dict) -> tuple[str, str]:
    value = block.get("caption")
    if not value:
        return "", ""
    return _RT._caption(value)


def _element(block: dict) -> str:
    kind = str(block.get("type") or "")
    file_id = _file_id(block)
    if not file_id:
        raise ValueError(f"Bloco de mídia {kind} recebido sem file_id reutilizável.")
    src = html.escape(rich_media.remote_uri(kind, file_id), quote=True)
    spoiler = " tg-spoiler" if block.get("has_spoiler") and kind in {"photo", "video", "animation"} else ""
    if kind == "photo":
        return f'<img src="{src}"{spoiler}/>'
    if kind in {"video", "animation"}:
        return f'<video src="{src}"{spoiler}></video>'
    if kind in {"audio", "voice_note"}:
        return f'<audio src="{src}"></audio>'
    return f'<tg-document src="{src}"></tg-document>'


def _media_block(block: dict) -> str:
    element = _element(block)
    caption, credit = _caption(block)
    if not caption and not credit:
        return element
    cite = f"<cite>{credit}</cite>" if credit else ""
    return f"<figure>{element}<figcaption>{caption}{cite}</figcaption></figure>"


def _collection(block: dict) -> str:
    tag = "tg-collage" if block.get("type") == "collage" else "tg-slideshow"
    parts: list[str] = []
    for child in block.get("blocks") or []:
        child = _RT._plain(child)
        if isinstance(child, dict) and child.get("type") in _MEDIA_TYPES:
            caption, credit = _caption(child)
            if credit:
                raise ValueError(
                    "Mídia interna de collage/slideshow possui crédito que o Rich Markdown não representa sem perda."
                )
            if caption:
                uri = rich_media.remote_uri(str(child.get("type")), _file_id(child))
                safe_caption = str(caption).replace('"', "")
                parts.append(f'![]({uri} "{safe_caption}")')
            else:
                parts.append(_element(child))
        else:
            parts.append(_ORIGINAL_BLOCK(child))
    caption, credit = _caption(block)
    if caption or credit:
        cite = f"<cite>{credit}</cite>" if credit else ""
        parts.append(f"<figcaption>{caption}{cite}</figcaption>")
    return f"<{tag}>\n" + "\n".join(parts) + f"\n</{tag}>"


def install(roundtrip_module) -> None:
    global _ORIGINAL_BLOCK, _RT
    _RT = roundtrip_module
    if _ORIGINAL_BLOCK is None:
        _ORIGINAL_BLOCK = roundtrip_module._block

    def block(value) -> str:
        parsed = roundtrip_module._plain(value)
        if isinstance(parsed, dict):
            typ = str(parsed.get("type") or "")
            if typ in _MEDIA_TYPES:
                return _media_block(parsed)
            if typ in {"collage", "slideshow"}:
                return _collection(parsed)
        return _ORIGINAL_BLOCK(parsed)

    roundtrip_module._block = block
