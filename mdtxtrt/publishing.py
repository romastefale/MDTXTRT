"""Telegram Bot API 10.3 publication service."""
from __future__ import annotations

import hashlib
from typing import Any

from aiogram import Bot
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

from mdtxtrt.assets import AssetService
from mdtxtrt.domain import CanonicalDocument, CanonicalNode
from mdtxtrt.preferences import PreferenceStore
from mdtxtrt.projections import ProjectionReview, telegram_projection
from mdtxtrt.storage import SQLiteRepository
from mdtxtrt.telegram_representations import (
    RepresentationPlan,
    TelegramRepresentationSet,
    plan_telegram_representations,
)
from mdtxtrt.telegram_validation import (
    TelegramDestinationContext,
    rich_block_count,
    validate_telegram_document,
)

_LOCAL_MEDIA_KINDS = {"photo", "video", "animation", "audio", "voice_note", "document"}
_NATIVE_LOCATION_KINDS = {"map", "location", "venue"}
_MEDIA_SCHEME = {
    "photo": "photo",
    "video": "video",
    "animation": "video",
    "audio": "audio",
    "voice_note": "audio",
    "document": "document",
}
_MEDIA_PREFIX = {
    "photo": "p",
    "video": "v",
    "animation": "a",
    "audio": "u",
    "voice_note": "n",
    "document": "d",
}


class ProjectionConfirmationRequired(ValueError):
    def __init__(self, review: Any):
        super().__init__("projection_confirmation_required")
        self.review = review


class ProjectionRejected(ValueError):
    def __init__(self, review: Any):
        super().__init__("projection_not_publishable")
        self.review = review


def _require_review(review: ProjectionReview, confirmed_fingerprint: str | None) -> None:
    if not review.publishable:
        raise ProjectionRejected(review)
    if review.requires_confirmation and confirmed_fingerprint != review.fingerprint:
        raise ProjectionConfirmationRequired(review)


def _require_representation(plan: RepresentationPlan, confirmed_fingerprint: str | None) -> None:
    if not plan.available or plan.blocking:
        raise ProjectionRejected(plan)
    if plan.requires_confirmation and confirmed_fingerprint != plan.fingerprint:
        raise ProjectionConfirmationRequired(plan)


def _chat_id(value: str | int) -> str | int:
    if isinstance(value, int):
        return value
    stripped = str(value).strip()
    if stripped.lstrip("-").isdigit():
        return int(stripped)
    return stripped


def _attachment_id(kind: str, media_id: str) -> str:
    compact = "".join(ch for ch in media_id if ch.isalnum())
    return f"{_MEDIA_PREFIX[kind]}_{compact}"[:64]


def _input_media(kind: str, data: bytes, filename: str):
    upload = BufferedInputFile(data, filename=filename)
    if kind == "photo":
        return InputMediaPhoto(media=upload)
    if kind == "video":
        return InputMediaVideo(media=upload)
    if kind == "animation":
        return InputMediaAnimation(media=upload)
    if kind == "audio":
        return InputMediaAudio(media=upload)
    if kind == "voice_note":
        return InputMediaVoiceNote(media=upload)
    if kind == "document":
        return InputMediaDocument(media=upload)
    raise ValueError("unsupported_local_media_kind")


def _native_location_nodes(document: CanonicalDocument) -> list[CanonicalNode]:
    """Return top-level native Telegram Location/Venue operations in document order."""
    return [block for block in document.blocks if block.kind in _NATIVE_LOCATION_KINDS]


def _without_native_locations(document: CanonicalDocument) -> CanonicalDocument:
    """Keep native locations out of rich-message projection; they are Bot API operations."""
    return CanonicalDocument(
        id=document.id,
        schema_version=document.schema_version,
        blocks=tuple(block for block in document.blocks if block.kind not in _NATIVE_LOCATION_KINDS),
        metadata=document.metadata,
    )


def _native_location_payload(node: CanonicalNode) -> dict[str, Any]:
    attrs = dict(node.attrs)
    try:
        latitude = float(attrs["lat"])
        longitude = float(attrs["long"])
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("native_location_coordinates_required") from exc
    if not (-90 <= latitude <= 90 and -180 <= longitude <= 180):
        raise ValueError("native_location_coordinates_invalid")
    title = str(attrs.get("name") or attrs.get("title") or "").strip()
    address = str(attrs.get("address") or "").strip()
    kind = "venue" if node.kind == "venue" or (title and address) else "location"
    if kind == "venue" and (not title or not address):
        raise ValueError("native_venue_title_and_address_required")
    return {
        "kind": kind,
        "latitude": latitude,
        "longitude": longitude,
        "title": title,
        "address": address,
    }


async def _send_native_locations(
    bot: Bot,
    *,
    chat_id: str | int,
    nodes: list[CanonicalNode],
    destination: TelegramDestinationContext,
) -> list[int]:
    message_ids: list[int] = []
    for node in nodes:
        payload = _native_location_payload(node)
        common = {
            "chat_id": chat_id,
            "message_thread_id": destination.message_thread_id,
            "direct_messages_topic_id": destination.direct_messages_topic_id,
        }
        if payload["kind"] == "venue":
            message = await bot.send_venue(
                **common,
                latitude=payload["latitude"],
                longitude=payload["longitude"],
                title=payload["title"],
                address=payload["address"],
            )
        else:
            message = await bot.send_location(
                **common,
                latitude=payload["latitude"],
                longitude=payload["longitude"],
            )
        message_ids.append(int(message.message_id))
    return message_ids


def _apply_telegram_validation(
    review: ProjectionReview,
    document: CanonicalDocument,
    destination: TelegramDestinationContext | None = None,
) -> None:
    review.blocking[:] = [
        message for message in review.blocking
        if not message.startswith("Documento excede 500 blocos/nós estruturais")
    ]
    review.metrics.pop("nodes", None)
    review.metrics["blocks"] = rich_block_count(document)
    for message in validate_telegram_document(document, destination):
        if message not in review.blocking:
            review.blocking.append(message)


def _override_payload(document_override: dict[str, Any] | None) -> dict[str, Any]:
    if not document_override:
        return {"output_override": False}
    canonical = CanonicalDocument.from_dict(document_override)
    raw = canonical.to_json()
    return {
        "output_override": True,
        "output_document_sha256": hashlib.sha256(raw.encode("utf-8")).hexdigest(),
        "output_document": canonical.to_dict(),
    }


class TelegramPublicationService:
    def __init__(
        self,
        repository: SQLiteRepository,
        assets: AssetService,
        preferences: PreferenceStore | None = None,
    ):
        self.repository = repository
        self.assets = assets
        self.preferences = preferences

    def _source_document(
        self,
        *,
        user_id: int,
        draft_id: str,
        document_override: dict[str, Any] | None,
    ) -> tuple[str, CanonicalDocument]:
        revision_id, active = self.repository.get_active_document(draft_id=draft_id, user_id=user_id)
        if document_override is None:
            return revision_id, active
        override = CanonicalDocument.from_dict(document_override)
        if override.id != active.id:
            raise ValueError("output_override_document_id_mismatch")
        return revision_id, override

    def _prepare(
        self,
        *,
        user_id: int,
        draft_id: str,
        document_override: dict[str, Any] | None = None,
        destination: TelegramDestinationContext | None = None,
    ) -> tuple[str, CanonicalDocument, ProjectionReview, list[InputRichMessageMedia]]:
        revision_id, document = self._source_document(
            user_id=user_id,
            draft_id=draft_id,
            document_override=document_override,
        )
        attachments: dict[tuple[str, str], InputRichMessageMedia] = {}

        def transform(node: CanonicalNode) -> CanonicalNode:
            attrs = dict(node.attrs)
            if node.kind in _LOCAL_MEDIA_KINDS and attrs.get("media_blob_id"):
                media_id = str(attrs["media_blob_id"])
                blob = self.assets.get_media(user_id=user_id, media_id=media_id)
                if blob.draft_id != draft_id:
                    raise ValueError("media_does_not_belong_to_draft")
                key = (node.kind, media_id)
                identifier = _attachment_id(node.kind, media_id)
                attrs["src"] = f"tg://{_MEDIA_SCHEME[node.kind]}?id={identifier}"
                if key not in attachments:
                    attachments[key] = InputRichMessageMedia(
                        id=identifier,
                        media=_input_media(node.kind, blob.data, blob.filename),
                    )
            return CanonicalNode(
                id=node.id,
                kind=node.kind,
                text=node.text,
                attrs=attrs,
                children=tuple(transform(child) for child in node.children),
            )

        transformed = CanonicalDocument(
            id=document.id,
            schema_version=document.schema_version,
            blocks=tuple(transform(block) for block in document.blocks),
            metadata=document.metadata,
        )
        projected_document = _without_native_locations(transformed)
        review = telegram_projection(projected_document)
        _apply_telegram_validation(review, projected_document, destination)
        for native in _native_location_nodes(transformed):
            _native_location_payload(native)
        review.metrics["local_media_attachments"] = len(attachments)
        review.metrics["native_locations"] = len(_native_location_nodes(transformed))
        return revision_id, projected_document, review, list(attachments.values())

    def _preferred_representation(self, user_id: int) -> str | None:
        if self.preferences is None:
            return None
        value = self.preferences.list(user_id=user_id).get("telegram_representation")
        return str(value) if isinstance(value, str) else None

    def preview(
        self,
        *,
        user_id: int,
        draft_id: str,
        document_override: dict[str, Any] | None = None,
        destination: TelegramDestinationContext | None = None,
    ) -> tuple[str, TelegramRepresentationSet]:
        revision_id, document, html_review, _attachments = self._prepare(
            user_id=user_id,
            draft_id=draft_id,
            document_override=document_override,
            destination=destination,
        )
        plans = plan_telegram_representations(
            document,
            html_review=html_review,
            preferred=self._preferred_representation(user_id),
            fingerprint_context=destination.public() if destination else {},
        )
        return revision_id, plans

    def _select_plan(
        self,
        *,
        user_id: int,
        document: CanonicalDocument,
        html_review: ProjectionReview,
        representation: str | None,
        destination: TelegramDestinationContext | None = None,
    ) -> RepresentationPlan:
        plans = plan_telegram_representations(
            document,
            html_review=html_review,
            preferred=self._preferred_representation(user_id),
            fingerprint_context=destination.public() if destination else {},
        )
        key = str(representation or "auto").strip().lower()
        if key == "auto":
            key = plans.recommended
        if key not in plans.options:
            raise ValueError("unsupported_telegram_representation")
        return plans.options[key]

    @staticmethod
    def _message(plan: RepresentationPlan, attachments: list[InputRichMessageMedia]) -> InputRichMessage:
        if plan.key == "html":
            return InputRichMessage(html=plan.content or "", media=attachments or None)
        if plan.key == "markdown":
            return InputRichMessage(markdown=plan.content or "", media=attachments or None)
        if plan.key == "blocks":
            return InputRichMessage(blocks=plan.blocks or [], media=attachments or None)
        raise ValueError("unsupported_telegram_representation")

    async def publish(
        self,
        *,
        bot: Bot,
        user_id: int,
        draft_id: str,
        destination_chat_id: str | int,
        title: str,
        confirmed_fingerprint: str | None = None,
        representation: str | None = None,
        document_override: dict[str, Any] | None = None,
        destination: TelegramDestinationContext | None = None,
    ) -> dict[str, Any]:
        destination = destination or TelegramDestinationContext(destination_chat_id)
        if str(destination.chat_id) != str(destination_chat_id):
            raise ValueError("destination_context_chat_id_mismatch")
        source_revision_id, source_document = self._source_document(
            user_id=user_id,
            draft_id=draft_id,
            document_override=document_override,
        )
        native_nodes = _native_location_nodes(source_document)
        revision_id, document, html_review, attachments = self._prepare(
            user_id=user_id,
            draft_id=draft_id,
            document_override=document_override,
            destination=destination,
        )
        if source_revision_id != revision_id:
            raise RuntimeError("publication_revision_changed_during_prepare")
        plan = self._select_plan(
            user_id=user_id,
            document=document,
            html_review=html_review,
            representation=representation,
            destination=destination,
        )
        _require_representation(plan, confirmed_fingerprint)
        target = _chat_id(destination_chat_id)
        message_ids: list[int] = []
        has_rich_content = bool(document.blocks or attachments)
        if has_rich_content:
            message = await bot.send_rich_message(
                chat_id=target,
                rich_message=self._message(plan, attachments),
                message_thread_id=destination.message_thread_id,
                direct_messages_topic_id=destination.direct_messages_topic_id,
            )
            message_ids.append(int(message.message_id))
        native_message_ids = await _send_native_locations(
            bot,
            chat_id=target,
            nodes=native_nodes,
            destination=destination,
        )
        message_ids.extend(native_message_ids)
        if not message_ids:
            raise ValueError("telegram_publication_empty")
        primary_message_id = message_ids[0]
        event = {
            "representation": plan.key if has_rich_content else "native_location",
            "fingerprint": plan.fingerprint,
            "telegram_message_id": primary_message_id,
            "telegram_message_ids": message_ids,
            "native_location_message_ids": native_message_ids,
            "destination_chat_id": str(destination_chat_id),
            "local_media_attachments": len(attachments),
            "native_locations": len(native_nodes),
            "destination_context": destination.public(),
            **_override_payload(document_override),
        }
        return self.repository.create_publication(
            user_id=user_id,
            draft_id=draft_id,
            revision_id=revision_id,
            kind="telegram",
            title=(title or "Publicação Telegram").strip()[:256] or "Publicação Telegram",
            destination_chat_id=str(destination_chat_id),
            telegram_message_id=primary_message_id,
            event_payload=event,
        )

    async def edit(
        self,
        *,
        bot: Bot,
        user_id: int,
        publication_id: str,
        title: str,
        confirmed_fingerprint: str | None = None,
        representation: str | None = None,
        document_override: dict[str, Any] | None = None,
        destination_context: TelegramDestinationContext | None = None,
    ) -> dict[str, Any]:
        publication = self.repository.get_publication(publication_id=publication_id, user_id=user_id)
        if publication["kind"] != "telegram":
            raise ValueError("publication_is_not_telegram")
        previous_event = dict(publication.get("event_payload") or {})
        if previous_event.get("native_location_message_ids"):
            raise ValueError("native_location_publication_requires_republish")
        destination = publication.get("destination_chat_id")
        message_id = publication.get("telegram_message_id")
        if not destination or message_id is None:
            raise ValueError("telegram_publication_missing_target")
        destination_context = destination_context or TelegramDestinationContext(destination)
        if str(destination_context.chat_id) != str(destination):
            raise ValueError("destination_context_chat_id_mismatch")
        revision_id, document, html_review, attachments = self._prepare(
            user_id=user_id,
            draft_id=publication["draft_id"],
            document_override=document_override,
            destination=destination_context,
        )
        if _native_location_nodes(self._source_document(
            user_id=user_id,
            draft_id=publication["draft_id"],
            document_override=document_override,
        )[1]):
            raise ValueError("native_location_publication_requires_republish")
        plan = self._select_plan(
            user_id=user_id,
            document=document,
            html_review=html_review,
            representation=representation,
            destination=destination_context,
        )
        _require_representation(plan, confirmed_fingerprint)
        await bot.edit_message_text(
            chat_id=_chat_id(destination),
            message_id=int(message_id),
            rich_message=self._message(plan, attachments),
        )
        return self.repository.update_publication(
            publication_id=publication_id,
            user_id=user_id,
            revision_id=revision_id,
            title=(title or publication["title"]).strip()[:256] or publication["title"],
            event_payload={
                "representation": plan.key,
                "fingerprint": plan.fingerprint,
                "telegram_message_id": int(message_id),
                "destination_chat_id": str(destination),
                "local_media_attachments": len(attachments),
                "native_locations": 0,
                "destination_context": destination_context.public(),
                **_override_payload(document_override),
            },
        )

    async def republish(
        self,
        *,
        bot: Bot,
        user_id: int,
        publication_id: str,
        title: str | None = None,
        destination_chat_id: str | int | None = None,
        confirmed_fingerprint: str | None = None,
        representation: str | None = None,
        document_override: dict[str, Any] | None = None,
        destination: TelegramDestinationContext | None = None,
    ) -> dict[str, Any]:
        publication = self.repository.get_publication(publication_id=publication_id, user_id=user_id)
        if publication["kind"] != "telegram":
            raise ValueError("publication_is_not_telegram")
        target = destination_chat_id if destination_chat_id not in {None, ""} else publication.get("destination_chat_id")
        if target in {None, ""}:
            raise ValueError("telegram_publication_missing_target")
        return await self.publish(
            bot=bot,
            user_id=user_id,
            draft_id=str(publication["draft_id"]),
            destination_chat_id=target,
            title=(title or str(publication["title"])),
            confirmed_fingerprint=confirmed_fingerprint,
            representation=representation,
            document_override=document_override,
            destination=destination,
        )
