"""Static validation for Telegram Bot API 10.3 Rich Message constraints."""
from __future__ import annotations

from urllib.parse import urlparse

from mdtxtrt.domain import CanonicalDocument, CanonicalNode

_BUTTON_TYPES = {
    "url",
    "callback_data",
    "web_app",
    "login_url",
    "switch_inline_query",
    "switch_inline_query_current_chat",
    "switch_inline_query_chosen_chat",
    "copy_text",
    "disabled",
}
_BUTTON_STYLES = {"", "danger", "success", "primary", "link"}
_BLOCK_KINDS = {
    "paragraph", "heading", "code_block", "footer", "divider", "math_block", "anchor",
    "list", "list_item", "blockquote", "expandable_blockquote", "pullquote", "collage",
    "slideshow", "table", "table_row", "details", "map", "animation", "audio", "photo",
    "video", "voice_note", "document", "button_row", "raw_markdown",
}
_EXCLUDED_FROM_BLOCK_COUNT = {"table_cell", "table_header", "button"}


def _walk(node: CanonicalNode):
    yield node
    for child in node.children:
        yield from _walk(child)


def rich_block_count(document: CanonicalDocument) -> int:
    count = 0
    for block in document.blocks:
        for node in _walk(block):
            if node.kind in _BLOCK_KINDS and node.kind not in _EXCLUDED_FROM_BLOCK_COUNT:
                count += 1
    return count


def _valid_http_or_tg(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https", "tg"} and bool(parsed.netloc or parsed.scheme == "tg")


def validate_telegram_document(document: CanonicalDocument) -> list[str]:
    """Return deterministic blocking messages for API constraints represented canonically."""
    blocking: list[str] = []
    block_count = rich_block_count(document)
    if block_count > 500:
        blocking.append(f"Documento excede 500 blocos Rich ({block_count}).")

    for block in document.blocks:
        for node in _walk(block):
            if node.kind == "button_row":
                buttons = [child for child in node.children if child.kind == "button"]
                if not 1 <= len(buttons) <= 8:
                    blocking.append(f"Linha de botões {node.id} deve conter de 1 a 8 botões.")
                align = str(node.attrs.get("align") or "")
                if align and align not in {"left", "center", "right"}:
                    blocking.append(f"Linha de botões {node.id} tem alinhamento inválido: {align}.")

            if node.kind != "button":
                continue
            kind = str(node.attrs.get("type") or "url")
            style = str(node.attrs.get("style") or "")
            if kind not in _BUTTON_TYPES:
                blocking.append(f"Botão {node.id} usa tipo não suportado pela Bot API 10.3: {kind}.")
                continue
            if style not in _BUTTON_STYLES:
                blocking.append(f"Botão {node.id} usa estilo inválido: {style}.")
            if style == "link" and kind != "callback_data":
                blocking.append(f"Botão {node.id}: estilo link só é permitido para callback_data.")
            if kind == "callback_data":
                size = len(str(node.attrs.get("data") or "").encode("utf-8"))
                if not 1 <= size <= 64:
                    blocking.append(f"Botão {node.id}: callback_data deve ter de 1 a 64 bytes ({size}).")
            if kind in {"url", "web_app", "login_url"}:
                value = str(node.attrs.get("url") or "")
                if not value:
                    blocking.append(f"Botão {node.id}: URL obrigatória para {kind}.")
                elif kind == "url" and not _valid_http_or_tg(value):
                    blocking.append(f"Botão {node.id}: URL deve usar HTTP, HTTPS ou tg://.")
                elif kind in {"web_app", "login_url"} and urlparse(value).scheme != "https":
                    blocking.append(f"Botão {node.id}: {kind} exige URL HTTPS.")
            if kind == "copy_text" and not str(node.attrs.get("copy_text") or ""):
                blocking.append(f"Botão {node.id}: texto para cópia é obrigatório.")

    return blocking
