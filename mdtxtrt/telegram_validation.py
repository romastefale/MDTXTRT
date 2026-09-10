"""Static validation for Telegram Bot API 10.3 Rich Message constraints."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any
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


@dataclass(frozen=True, slots=True)
class TelegramDestinationContext:
    """Destination facts used by both preflight and the final API call.

    Unknown is deliberately not treated as private: accepting a ``web_app`` button
    without knowing the chat type recreates the late-rejection bug this boundary is
    intended to prevent.
    """

    chat_id: str | int
    chat_type: str = "unknown"
    message_thread_id: int | None = None
    direct_messages_topic_id: int | None = None
    can_send_messages: bool | None = None

    @classmethod
    def from_dict(cls, value: dict[str, Any], *, default_chat_id: str | int) -> "TelegramDestinationContext":
        return cls(
            chat_id=value.get("chat_id", default_chat_id),
            chat_type=str(value.get("chat_type") or "unknown"),
            message_thread_id=_optional_positive_int(value.get("message_thread_id"), "message_thread_id"),
            direct_messages_topic_id=_optional_positive_int(value.get("direct_messages_topic_id"), "direct_messages_topic_id"),
            can_send_messages=value.get("can_send_messages") if isinstance(value.get("can_send_messages"), bool) else None,
        )

    def public(self) -> dict[str, Any]:
        return {
            "chat_id": str(self.chat_id), "chat_type": self.chat_type,
            "message_thread_id": self.message_thread_id,
            "direct_messages_topic_id": self.direct_messages_topic_id,
            "can_send_messages": self.can_send_messages,
        }


def _optional_positive_int(value: Any, name: str) -> int | None:
    if value in {None, ""}:
        return None
    parsed = int(value)
    if parsed <= 0:
        raise ValueError(f"{name}_must_be_positive")
    return parsed


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


def validate_telegram_document(
    document: CanonicalDocument,
    destination: TelegramDestinationContext | None = None,
) -> list[str]:
    """Return deterministic blocking messages for API constraints represented canonically."""
    blocking: list[str] = []
    block_count = rich_block_count(document)
    if block_count > 500:
        blocking.append(f"Documento excede 500 blocos Rich ({block_count}).")

    if destination:
        if destination.chat_type not in {"private", "group", "supergroup", "channel", "unknown"}:
            blocking.append(f"Tipo de chat Telegram inválido: {destination.chat_type}.")
        if destination.can_send_messages is False:
            blocking.append("O bot não possui permissão para enviar mensagens no destino.")
        if destination.message_thread_id and destination.chat_type != "supergroup":
            blocking.append("message_thread_id só é válido em supergrupos com tópicos.")
        if destination.direct_messages_topic_id and destination.chat_type != "channel":
            blocking.append("direct_messages_topic_id só é válido em mensagens diretas de canal.")
        if destination.message_thread_id and destination.direct_messages_topic_id:
            blocking.append("Tópico de fórum e tópico de mensagem direta não podem ser usados juntos.")

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
            if kind == "copy_text" and len(str(node.attrs.get("copy_text") or "")) > 256:
                blocking.append(f"Botão {node.id}: texto para cópia excede 256 caracteres.")
            if kind == "disabled" and any(node.attrs.get(key) for key in ("url", "data", "query", "copy_text")):
                blocking.append(f"Botão {node.id}: botão desabilitado não pode definir uma ação.")
            if kind == "web_app" and destination and destination.chat_type != "private":
                blocking.append(f"Botão {node.id}: web_app exige conversa privada com o bot.")

    for block in document.blocks:
        for node in _walk(block):
            if node.kind == "map":
                lat, lon = node.attrs.get("lat"), node.attrs.get("long")
                zoom = node.attrs.get("zoom", 13)
                try:
                    if not -90 <= float(lat) <= 90 or not -180 <= float(lon) <= 180:
                        raise ValueError
                    if not 0 <= int(zoom) <= 20:
                        blocking.append(f"Mapa {node.id}: zoom deve estar entre 0 e 20.")
                except (TypeError, ValueError):
                    blocking.append(f"Mapa {node.id}: coordenadas devem ser numéricas e válidas.")
            elif node.kind in {"collage", "slideshow"}:
                media = [child for child in node.children if child.kind in _LOCAL_VISUAL_MEDIA]
                if len(media) != len(node.children) or not 2 <= len(media) <= 10:
                    blocking.append(f"{node.kind.title()} {node.id}: exige de 2 a 10 fotos ou vídeos.")
            elif node.kind == "table":
                rows = [child for child in node.children if child.kind == "table_row"]
                widths = [len(row.children) for row in rows]
                if not rows or any(width == 0 for width in widths) or len(set(widths)) > 1:
                    blocking.append(f"Tabela {node.id}: linhas devem ter a mesma quantidade não nula de células.")

    return blocking


_LOCAL_VISUAL_MEDIA = {"photo", "video"}
