"""Publication application services for Telegram Bot API 10.3 and Telegraph."""
from __future__ import annotations

import asyncio
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
from telegraph import Telegraph
from telegraph.utils import html_to_nodes, json_dumps

from mdtxtrt.assets import AssetService
from mdtxtrt.credentials import CredentialCipher
from mdtxtrt.domain import CanonicalDocument, CanonicalNode
from mdtxtrt.preferences import PreferenceStore
from mdtxtrt.projections import ProjectionReview, telegram_projection, telegraph_projection
from mdtxtrt.storage import SQLiteRepository
from mdtxtrt.telegram_representations import (
    RepresentationPlan,
    TelegramRepresentationSet,
    plan_telegram_representations,
)
from mdtxtrt.telegram_validation import rich_block_count, validate_telegram_document

TELEGRAPH_CONTENT_LIMIT_BYTES = 64 * 1024
_LOCAL_MEDIA_KINDS = {"photo", "video", "animation", "audio", "voice_note", "document"}
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


def _apply_telegram_validation(review: ProjectionReview, document: CanonicalDocument) -> None:
    review.blocking[:] = [
        message for message in review.blocking
        if not message.startswith("Documento excede 500 blocos/nós estruturais")
    ]
    review.metrics.pop("nodes", None)
    review.metrics["blocks"] = rich_block_count(document)
    for message in validate_telegram_document(document):
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

        projected_document = CanonicalDocument(
            id=document.id,
            schema_version=document.schema_version,
            blocks=tuple(transform(block) for block in document.blocks),
            metadata=document.metadata,
        )
        review = telegram_projection(projected_document)
        _apply_telegram_validation(review, projected_document)
        review.metrics["local_media_attachments"] = len(attachments)
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
    ) -> tuple[str, TelegramRepresentationSet]:
        revision_id, document, html_review, _attachments = self._prepare(
            user_id=user_id,
            draft_id=draft_id,
            document_override=document_override,
        )
        plans = plan_telegram_representations(
            document,
            html_review=html_review,
            preferred=self._preferred_representation(user_id),
        )
        return revision_id, plans

    def _select_plan(
        self,
        *,
        user_id: int,
        document: CanonicalDocument,
        html_review: ProjectionReview,
        representation: str | None,
    ) -> RepresentationPlan:
        plans = plan_telegram_representations(
            document,
            html_review=html_review,
            preferred=self._preferred_representation(user_id),
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
            if attachments:
                raise ValueError("blocks_representation_does_not_support_local_attachment_plan")
            return InputRichMessage(blocks=plan.blocks or [])
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
    ) -> dict[str, Any]:
        revision_id, document, html_review, attachments = self._prepare(
            user_id=user_id,
            draft_id=draft_id,
            document_override=document_override,
        )
        plan = self._select_plan(
            user_id=user_id,
            document=document,
            html_review=html_review,
            representation=representation,
        )
        _require_representation(plan, confirmed_fingerprint)
        target = _chat_id(destination_chat_id)
        message = await bot.send_rich_message(
            chat_id=target,
            rich_message=self._message(plan, attachments),
        )
        event = {
            "representation": plan.key,
            "fingerprint": plan.fingerprint,
            "telegram_message_id": int(message.message_id),
            "destination_chat_id": str(destination_chat_id),
            "local_media_attachments": len(attachments),
            **_override_payload(document_override),
        }
        return self.repository.create_publication(
            user_id=user_id,
            draft_id=draft_id,
            revision_id=revision_id,
            kind="telegram",
            title=(title or "Publicação Telegram").strip()[:256] or "Publicação Telegram",
            destination_chat_id=str(destination_chat_id),
            telegram_message_id=int(message.message_id),
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
    ) -> dict[str, Any]:
        publication = self.repository.get_publication(publication_id=publication_id, user_id=user_id)
        if publication["kind"] != "telegram":
            raise ValueError("publication_is_not_telegram")
        destination = publication.get("destination_chat_id")
        message_id = publication.get("telegram_message_id")
        if not destination or message_id is None:
            raise ValueError("telegram_publication_missing_target")
        revision_id, document, html_review, attachments = self._prepare(
            user_id=user_id,
            draft_id=publication["draft_id"],
            document_override=document_override,
        )
        plan = self._select_plan(
            user_id=user_id,
            document=document,
            html_review=html_review,
            representation=representation,
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
        )


class TelegraphPublicationService:
    def __init__(self, repository: SQLiteRepository, cipher: CredentialCipher):
        self.repository = repository
        self.cipher = cipher

    def _document(
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

    def preview(
        self,
        *,
        user_id: int,
        draft_id: str,
        document_override: dict[str, Any] | None = None,
    ) -> tuple[str, ProjectionReview]:
        revision_id, document = self._document(
            user_id=user_id,
            draft_id=draft_id,
            document_override=document_override,
        )
        review = telegraph_projection(document)

        def inspect_local_media(node: CanonicalNode) -> None:
            if node.kind in _LOCAL_MEDIA_KINDS and node.attrs.get("media_blob_id"):
                src = str(node.attrs.get("src") or "")
                if not src.startswith(("https://", "http://")):
                    review.blocking.append(
                        f"Mídia local {node.id} precisa de link público explícito antes da publicação no Telegraph."
                    )
            for child in node.children:
                inspect_local_media(child)

        for block in document.blocks:
            inspect_local_media(block)
        try:
            payload_bytes = len(json_dumps(html_to_nodes(review.content)).encode("utf-8"))
            review.metrics["content_bytes"] = payload_bytes
            review.metrics["content_limit_bytes"] = TELEGRAPH_CONTENT_LIMIT_BYTES
            if payload_bytes > TELEGRAPH_CONTENT_LIMIT_BYTES:
                review.blocking.append(
                    f"Conteúdo Telegraph serializado excede {TELEGRAPH_CONTENT_LIMIT_BYTES} bytes ({payload_bytes})."
                )
        except Exception as exc:
            review.blocking.append(f"HTML projetado não pôde ser convertido em nós Telegraph: {exc}")
        return revision_id, review

    async def _token(self, user_id: int) -> str:
        envelope = self.repository.get_telegraph_token_envelope(user_id=user_id)
        if envelope:
            return self.cipher.decrypt(envelope)
        short_hash = hashlib.sha256(f"mdtxtrt:{user_id}".encode("utf-8")).hexdigest()[:16]

        def create_account() -> str:
            client = Telegraph()
            account = client.create_account(short_name=f"mdtxtrt-{short_hash}")
            token = str(account.get("access_token") or "")
            if not token:
                raise RuntimeError("Telegraph did not return an access token")
            return token

        token = await asyncio.to_thread(create_account)
        self.repository.set_telegraph_token_envelope(
            user_id=user_id,
            token_envelope=self.cipher.encrypt(token),
        )
        return token

    async def publish(
        self,
        *,
        user_id: int,
        draft_id: str,
        title: str,
        confirmed_fingerprint: str | None = None,
        document_override: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        revision_id, review = self.preview(
            user_id=user_id,
            draft_id=draft_id,
            document_override=document_override,
        )
        _require_review(review, confirmed_fingerprint)
        token = await self._token(user_id)
        clean_title = (title or "Sem título").strip()[:256] or "Sem título"

        def create_page() -> dict[str, Any]:
            return Telegraph(access_token=token).create_page(
                title=clean_title,
                html_content=review.content,
                return_content=False,
            )

        page = await asyncio.to_thread(create_page)
        path = str(page.get("path") or "")
        url = str(page.get("url") or "")
        if not path or not url:
            raise RuntimeError("Telegraph did not return page path/url")
        return self.repository.create_publication(
            user_id=user_id,
            draft_id=draft_id,
            revision_id=revision_id,
            kind="telegraph",
            title=clean_title,
            telegraph_path=path,
            telegraph_url=url,
            event_payload={
                "fingerprint": review.fingerprint,
                "telegraph_path": path,
                "telegraph_url": url,
                **_override_payload(document_override),
            },
        )

    async def edit(
        self,
        *,
        user_id: int,
        publication_id: str,
        title: str,
        confirmed_fingerprint: str | None = None,
        document_override: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        publication = self.repository.get_publication(publication_id=publication_id, user_id=user_id)
        if publication["kind"] != "telegraph":
            raise ValueError("publication_is_not_telegraph")
        path = str(publication.get("telegraph_path") or "")
        if not path:
            raise ValueError("telegraph_publication_missing_path")
        revision_id, review = self.preview(
            user_id=user_id,
            draft_id=publication["draft_id"],
            document_override=document_override,
        )
        _require_review(review, confirmed_fingerprint)
        token = await self._token(user_id)
        clean_title = (title or publication["title"]).strip()[:256] or publication["title"]

        def edit_page() -> dict[str, Any]:
            return Telegraph(access_token=token).edit_page(
                path=path,
                title=clean_title,
                html_content=review.content,
                return_content=False,
            )

        page = await asyncio.to_thread(edit_page)
        url = str(page.get("url") or publication.get("telegraph_url") or "")
        new_path = str(page.get("path") or path)
        return self.repository.update_publication(
            publication_id=publication_id,
            user_id=user_id,
            revision_id=revision_id,
            title=clean_title,
            telegraph_path=new_path,
            telegraph_url=url,
            event_payload={
                "fingerprint": review.fingerprint,
                "telegraph_path": new_path,
                "telegraph_url": url,
                **_override_payload(document_override),
            },
        )
