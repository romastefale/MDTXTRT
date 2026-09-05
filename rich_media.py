"""Mídia Rich 10.3: upload local e reutilização de file_id no round-trip."""
from __future__ import annotations

import hashlib
import re
from urllib.parse import quote, unquote

from aiogram.types import (
    BufferedInputFile,
    InputMediaAnimation,
    InputMediaAudio,
    InputMediaDocument,
    InputMediaPhoto,
    InputMediaVideo,
    InputMediaVoiceNote,
    InputRichMessage,
    InputRichMessageMedia,
)

import canonical

_REMOTE_RE = re.compile(
    r"tg://(photo|video|document|audio)\?id=([A-Za-z0-9_-]{1,64})"
    r"(?:&amp;|&)file=([^&\s\"'>)]+)"
    r"(?:(?:&amp;|&)kind=(animation|voice))?",
    re.IGNORECASE,
)
_OFFICIAL_RE = re.compile(
    r"tg://(photo|video|document|audio)\?id=([A-Za-z0-9_-]{1,64})",
    re.IGNORECASE,
)


def remote_uri(kind: str, file_id: str) -> str:
    kind = str(kind or "").lower()
    if kind == "photo":
        scheme, marker = "photo", ""
    elif kind == "document":
        scheme, marker = "document", ""
    elif kind == "animation":
        scheme, marker = "video", "&kind=animation"
    elif kind in {"voice", "voice_note"}:
        scheme, marker = "audio", "&kind=voice"
    elif kind == "video":
        scheme, marker = "video", ""
    else:
        scheme, marker = "audio", ""
    short = "r_" + hashlib.sha256(f"{kind}:{file_id}".encode()).hexdigest()[:24]
    return f"tg://{scheme}?id={short}&file={quote(str(file_id), safe='')}{marker}"


def _input_media(kind: str, media):
    if kind == "photo":
        return InputMediaPhoto(media=media)
    if kind == "video":
        return InputMediaVideo(media=media)
    if kind == "animation":
        return InputMediaAnimation(media=media)
    if kind == "audio":
        return InputMediaAudio(media=media)
    if kind in {"voice", "voice_note"}:
        return InputMediaVoiceNote(media=media)
    return InputMediaDocument(media=media)


def _local_input_media(item: dict):
    data = item.get("data")
    if not data:
        raise ValueError("Mídia local vazia.")
    upload = BufferedInputFile(data, filename=item.get("name") or "media.bin")
    return _input_media(str(item.get("kind") or "document"), upload)


def install(base_module, runtime_module) -> None:
    canonical.LOCAL_MEDIA_RE = re.compile(
        r'!\[([^\]]*)\]\(mdtxtrt://(photo|video|animation|audio|voice|document)/([A-Za-z0-9_-]+)(?:\s+"([^"]*)")?\)'
    )

    original_kind = runtime_module._media_kind

    def media_kind(filename: str, mime: str, requested: str) -> str:
        requested = (requested or "auto").lower()
        if requested == "voice":
            return "voice"
        return original_kind(filename, mime, requested)

    runtime_module._media_kind = media_kind
    runtime_module._input_media = _local_input_media

    def build_rich_message(content: str) -> InputRichMessage:
        markdown, refs = canonical.CanonicalDocument.from_markdown(content).telegram_markdown()
        media: list[InputRichMessageMedia] = []
        media_ids: set[str] = set()

        for ref in refs:
            item = base_module.MEDIA.get(ref.media_id)
            if not item:
                raise ValueError(f"Mídia local {ref.media_id} indisponível.")
            media.append(
                InputRichMessageMedia(
                    id=ref.media_id,
                    media=_local_input_media(item),
                )
            )
            media_ids.add(ref.media_id)

        def restore_remote(match: re.Match) -> str:
            scheme, reference_id, encoded_file_id, marker = match.groups()
            file_id = unquote(encoded_file_id)
            if not file_id:
                raise ValueError("Referência de mídia Telegram sem file_id.")
            kind = marker or scheme.lower()
            if scheme.lower() == "document":
                kind = "document"
            elif scheme.lower() == "photo":
                kind = "photo"
            elif scheme.lower() == "audio" and not marker:
                kind = "audio"
            elif scheme.lower() == "video" and not marker:
                kind = "video"
            if reference_id in media_ids:
                raise ValueError("Identificador de mídia duplicado no documento.")
            media.append(
                InputRichMessageMedia(
                    id=reference_id,
                    media=_input_media(kind, file_id),
                )
            )
            media_ids.add(reference_id)
            return f"tg://{scheme.lower()}?id={reference_id}"

        markdown = _REMOTE_RE.sub(restore_remote, markdown)
        referenced = {match.group(2) for match in _OFFICIAL_RE.finditer(markdown)}
        missing = referenced - media_ids
        if missing:
            raise ValueError(
                "O documento contém referência tg:// de mídia sem arquivo associado."
            )
        return InputRichMessage(markdown=markdown, media=media or None)

    base_module.build_rich_message = build_rich_message
