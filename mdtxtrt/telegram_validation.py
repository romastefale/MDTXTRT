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
    is_forum: bool | None = None

    @classmethod
    def from_dict(cls, value: dict[str, Any], *, default_chat_id: str | int) -> "TelegramDestinationContext":
        return cls(
            chat_id=value.get("chat_id", default_chat_id),
            chat_type=str(value.get("chat_type") or "unknown"),
            message_thread_id=_optional_positive_int(value.get("message_thread_id"), "message_thread_id"),
            direct_messages_topic_id=_optional_positive_int(value.get("direct_messages_topic_id"), "direct_messages_topic_id"),
            can_send_messages=value.get("can_send_messages") if isinstance(value.get("can_send_messages"), bool) else None,
            is_forum=value.get("is_forum") if isinstance(value.get("is_forum"), bool) else None,
        )

    def public(self) -> dict[str, Any]:
        return {
            "chat_id": str(self.chat_id), "chat_type": self.chat_type,
            "message_thread_id": self.message_thread_id,
            "direct_messages_topic_id": self.direct_messages_topic_id,
            "can_send_messages": self.can_send_messages,
            "is_forum": self.is_forum,
        }


def _optional_positive_int(value: Any, name: str) -> int | None:
    if value in {None, ""}:
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name}_must_be_integer") from exc
    if parsed <= 0:
        raise ValueError(f"{name}_must_be_positive")
    return parsed


def telegram_validation_text(code: str) -> str | None:
    if code.endswith("_must_be_integer"):
        return f"{code[:-len('_must_be_integer')]} deve ser um inteiro."
    if code.endswith("_must_be_positive"):
        return f"{code[:-len('_must_be_positive')]} deve ser um inteiro positivo."
    return None


def _walk(node: CanonicalNode):
    yield node
    for child in node.children:
        yield from _walk(child)


def _rich_block_count_node(node: CanonicalNode) -> int:
    if node.kind in {"map", "location", "venue"}:
        return 0
    if node.kind == "table":
        # Telegram counts the table block and each table row toward the
        # 500-block Rich Message limit. Cells themselves are not blocks.
        return 1 + sum(1 for child in node.children if child.kind == "table_row")
    if node.kind == "button_row":
        return 1
    if node.kind == "list":
        # Telegram counts the list block, every list item, and the nested block
        # generated inside each item toward the 500-block limit.
        items = [child for child in node.children if child.kind == "list_item"]
        return 1 + (2 * len(items))
    if node.kind == "blockquote":
        # The typed representation wraps one paragraph inside the quote.
        return 2
    if node.kind == "details":
        return 1 + sum(_rich_block_count_node(child) for child in node.children)
    if node.kind in _BLOCK_KINDS:
        return 1
    return 0


def rich_block_count(document: CanonicalDocument) -> int:
    return sum(_rich_block_count_node(block) for block in document.blocks)


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
        if destination.message_thread_id:
            if destination.chat_type == "supergroup" and destination.is_forum is False:
                blocking.append("message_thread_id exige um supergrupo com tópicos habilitados.")
            elif destination.chat_type == "private" and destination.is_forum is not True:
                blocking.append("message_thread_id em conversa privada exige forum topic mode habilitado.")
            elif destination.chat_type not in {"supergroup", "private"}:
                blocking.append("message_thread_id só é válido em supergrupos com tópicos ou chats privados em forum mode.")
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
            if destination and destination.direct_messages_topic_id and kind in {
                "switch_inline_query", "switch_inline_query_current_chat", "switch_inline_query_chosen_chat"
            }:
                blocking.append(f"Botão {node.id}: ação inline não é suportada em direct messages de canal.")
            if destination and destination.chat_type == "channel" and kind == "switch_inline_query_current_chat":
                blocking.append(f"Botão {node.id}: switch_inline_query_current_chat não é suportado em canais.")

    for block in document.blocks:
        for node in _walk(block):
            if node.kind in {"map", "location", "venue"}:
                lat, lon = node.attrs.get("lat"), node.attrs.get("long")
                try:
                    if not -90 <= float(lat) <= 90 or not -180 <= float(lon) <= 180:
                        raise ValueError
                except (TypeError, ValueError):
                    blocking.append(f"Mapa {node.id}: coordenadas devem ser numéricas e válidas.")
            elif node.kind in {"photo", "video", "animation", "audio", "voice_note", "document"}:
                if node.attrs.get("media_blob_id"):
                    continue
                src = str(node.attrs.get("src") or "").strip()
                if not src or not _valid_http_or_tg(src):
                    blocking.append(f"Mídia {node.id}: origem deve usar HTTP, HTTPS ou referência tg:// interna.")
            elif node.kind in {"collage", "slideshow"}:
                media = [child for child in node.children if child.kind in _LOCAL_VISUAL_MEDIA]
                if len(media) != len(node.children) or not 2 <= len(media) <= 10:
                    blocking.append(f"{node.kind.title()} {node.id}: exige de 2 a 10 fotos ou vídeos.")
            elif node.kind == "table":
                rows = [child for child in node.children if child.kind == "table_row"]
                if not rows:
                    blocking.append(f"Tabela {node.id}: exige ao menos uma linha.")
                    continue
                # Columns occupied by rowspans from previous rows. The value is
                # how many future rows (including the current one) remain occupied.
                active_spans: dict[int, int] = {}
                for row in rows:
                    cells = [c for c in row.children if c.kind in {"table_cell", "table_header"}]
                    if not cells or len(cells) != len(row.children):
                        blocking.append(f"Tabela {node.id}: cada linha deve conter somente células e não pode ser vazia.")
                        continue
                    occupied = {col for col, remaining in active_spans.items() if remaining > 0}
                    cursor = 0
                    new_spans: dict[int, int] = {}
                    row_width = (max(occupied) + 1) if occupied else 0
                    for cell in cells:
                        try:
                            colspan = int(cell.attrs.get("colspan") or 1)
                            rowspan = int(cell.attrs.get("rowspan") or 1)
                        except (TypeError, ValueError):
                            colspan = rowspan = 0
                        if colspan < 1 or rowspan < 1:
                            blocking.append(f"Tabela {node.id}: colspan/rowspan devem ser inteiros positivos.")
                            continue
                        # Place the cell at the first contiguous run not occupied
                        # by a rowspan carried from an earlier row.
                        while True:
                            while cursor in occupied:
                                cursor += 1
                            columns = range(cursor, cursor + colspan)
                            if not any(col in occupied for col in columns):
                                break
                            cursor += 1
                        end_col = cursor + colspan
                        row_width = max(row_width, end_col)
                        if rowspan > 1:
                            for col in range(cursor, end_col):
                                new_spans[col] = max(new_spans.get(col, 0), rowspan - 1)
                        cursor = end_col
                        align = str(cell.attrs.get("align") or "left")
                        valign = str(cell.attrs.get("valign") or "top")
                        if align not in {"left", "center", "right"}:
                            blocking.append(f"Tabela {node.id}: alinhamento horizontal inválido: {align}.")
                        if valign not in {"top", "middle", "bottom"}:
                            blocking.append(f"Tabela {node.id}: alinhamento vertical inválido: {valign}.")
                    if row_width > 20:
                        blocking.append(f"Tabela {node.id}: linha excede 20 colunas efetivas ({row_width}).")
                    next_spans = {col: remaining - 1 for col, remaining in active_spans.items() if remaining > 1}
                    for col, remaining in new_spans.items():
                        next_spans[col] = max(next_spans.get(col, 0), remaining)
                    active_spans = next_spans


    return blocking


_LOCAL_VISUAL_MEDIA = {"photo", "video"}
