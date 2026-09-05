"""Entrega de Rich Messages longas sem cortar estruturas nem deslocar mídia."""
from __future__ import annotations

import re

from aiogram.types import InputRichMessage, ReplyParameters

RICH_CHAR_LIMIT = 32768
_MEDIA_REF_RE = re.compile(
    r"tg://(?:photo|video|audio|document)\?id=([A-Za-z0-9_-]+)",
    re.IGNORECASE,
)
_FENCE_RE = re.compile(r"^\s*(`{3,}|~{3,})")
_PAIRED_START_RE = re.compile(
    r"^\s*<(details|blockquote|aside|table|figure|ul|ol|footer|tg-button-row|tg-collage|tg-slideshow)\b",
    re.IGNORECASE,
)


def _structural_blocks(text: str) -> list[str]:
    lines = (text or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    blocks: list[str] = []
    ordinary: list[str] = []
    i = 0

    def flush() -> None:
        if ordinary:
            blocks.append("\n".join(ordinary))
            ordinary.clear()

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()
        if not stripped:
            flush()
            i += 1
            continue

        fence = _FENCE_RE.match(line)
        if fence:
            flush()
            marker = fence.group(1)
            block = [line]
            i += 1
            while i < len(lines):
                block.append(lines[i])
                if re.match(rf"^\s*{re.escape(marker[0])}{{{len(marker)},}}\s*$", lines[i]):
                    i += 1
                    break
                i += 1
            blocks.append("\n".join(block))
            continue

        if stripped.startswith("$$"):
            flush()
            block = [line]
            same_line_closed = len(stripped) > 4 and stripped.endswith("$$")
            i += 1
            if not same_line_closed:
                while i < len(lines):
                    block.append(lines[i])
                    if "$$" in lines[i]:
                        i += 1
                        break
                    i += 1
            blocks.append("\n".join(block))
            continue

        paired = _PAIRED_START_RE.match(line)
        if paired:
            flush()
            tag = paired.group(1)
            close = re.compile(rf"</{re.escape(tag)}>\s*$", re.IGNORECASE)
            block = [line]
            i += 1
            if not close.search(line):
                while i < len(lines):
                    block.append(lines[i])
                    if close.search(lines[i]):
                        i += 1
                        break
                    i += 1
            blocks.append("\n".join(block))
            continue

        ordinary.append(line)
        i += 1

    flush()
    return [block for block in blocks if block]


def split_structural_chunks(text: str, limit: int = RICH_CHAR_LIMIT) -> list[str]:
    if len(text or "") <= limit:
        return [text or ""]
    chunks: list[str] = []
    current = ""
    for block in _structural_blocks(text):
        if len(block) > limit:
            raise ValueError(
                f"Um bloco Rich excede o limite de {limit} caracteres e não pode ser dividido sem perda."
            )
        candidate = block if not current else current + "\n\n" + block
        if len(candidate) <= limit:
            current = candidate
            continue
        if current:
            chunks.append(current)
        current = block
    if current:
        chunks.append(current)
    return chunks or [""]


def media_for_chunk(chunk: str, media) -> list:
    ids = set(_MEDIA_REF_RE.findall(chunk or ""))
    if not ids:
        return []
    return [item for item in (media or []) if str(getattr(item, "id", "")) in ids]


def install(base_module) -> None:
    async def send_rich_message(
        bot,
        chat_id,
        content: str,
        reply_to_message_id=None,
        *,
        message_thread_id=None,
        direct_messages_topic_id=None,
        business_connection_id=None,
        ephemeral_message_parameters=None,
    ):
        rich = base_module.build_rich_message(content)
        chunks = split_structural_chunks(rich.markdown or "")
        media = rich.media or []
        for idx, chunk in enumerate(chunks):
            reply = None
            if idx == 0 and reply_to_message_id:
                reply = ReplyParameters(message_id=reply_to_message_id)
            chunk_media = media_for_chunk(chunk, media)
            await bot.send_rich_message(
                chat_id=chat_id,
                rich_message=InputRichMessage(
                    markdown=chunk,
                    media=chunk_media or None,
                    is_rtl=rich.is_rtl,
                ),
                reply_parameters=reply,
                message_thread_id=message_thread_id,
                direct_messages_topic_id=direct_messages_topic_id,
                business_connection_id=business_connection_id,
                ephemeral_message_parameters=ephemeral_message_parameters,
                request_timeout=60,
            )

    base_module.send_rich_message = send_rich_message
