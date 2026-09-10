"""Publication application services for Telegram Bot API 10.3 and Telegraph."""
from __future__ import annotations

import asyncio
import hashlib
from typing import Any

from aiogram import Bot
from aiogram.types import InputRichMessage
from telegraph import Telegraph
from telegraph.utils import html_to_nodes, json_dumps

from mdtxtrt.credentials import CredentialCipher
from mdtxtrt.projections import ProjectionReview, telegram_projection, telegraph_projection
from mdtxtrt.storage import SQLiteRepository

TELEGRAPH_CONTENT_LIMIT_BYTES = 64 * 1024


class ProjectionConfirmationRequired(ValueError):
    def __init__(self, review: ProjectionReview):
        super().__init__("projection_confirmation_required")
        self.review = review


class ProjectionRejected(ValueError):
    def __init__(self, review: ProjectionReview):
        super().__init__("projection_not_publishable")
        self.review = review


def _require_review(review: ProjectionReview, confirmed_fingerprint: str | None) -> None:
    if not review.publishable:
        raise ProjectionRejected(review)
    if review.requires_confirmation and confirmed_fingerprint != review.fingerprint:
        raise ProjectionConfirmationRequired(review)


def _chat_id(value: str | int) -> str | int:
    if isinstance(value, int):
        return value
    stripped = str(value).strip()
    if stripped.lstrip("-").isdigit():
        return int(stripped)
    return stripped


class TelegramPublicationService:
    def __init__(self, repository: SQLiteRepository):
        self.repository = repository

    def preview(self, *, user_id: int, draft_id: str) -> tuple[str, ProjectionReview]:
        revision_id, document = self.repository.get_active_document(draft_id=draft_id, user_id=user_id)
        return revision_id, telegram_projection(document)

    async def publish(
        self, *, bot: Bot, user_id: int, draft_id: str, destination_chat_id: str | int,
        title: str, confirmed_fingerprint: str | None = None,
    ) -> dict[str, Any]:
        revision_id, review = self.preview(user_id=user_id, draft_id=draft_id)
        _require_review(review, confirmed_fingerprint)
        target = _chat_id(destination_chat_id)
        message = await bot.send_rich_message(
            chat_id=target,
            rich_message=InputRichMessage(html=review.content),
        )
        return self.repository.create_publication(
            user_id=user_id,
            draft_id=draft_id,
            revision_id=revision_id,
            kind="telegram",
            title=(title or "Publicação Telegram").strip()[:256] or "Publicação Telegram",
            destination_chat_id=str(destination_chat_id),
            telegram_message_id=int(message.message_id),
            event_payload={
                "representation": review.representation,
                "fingerprint": review.fingerprint,
                "telegram_message_id": int(message.message_id),
                "destination_chat_id": str(destination_chat_id),
            },
        )

    async def edit(
        self, *, bot: Bot, user_id: int, publication_id: str, title: str,
        confirmed_fingerprint: str | None = None,
    ) -> dict[str, Any]:
        publication = self.repository.get_publication(publication_id=publication_id, user_id=user_id)
        if publication["kind"] != "telegram":
            raise ValueError("publication_is_not_telegram")
        destination = publication.get("destination_chat_id")
        message_id = publication.get("telegram_message_id")
        if not destination or message_id is None:
            raise ValueError("telegram_publication_missing_target")
        revision_id, review = self.preview(user_id=user_id, draft_id=publication["draft_id"])
        _require_review(review, confirmed_fingerprint)
        await bot.edit_message_text(
            chat_id=_chat_id(destination),
            message_id=int(message_id),
            rich_message=InputRichMessage(html=review.content),
        )
        return self.repository.update_publication(
            publication_id=publication_id,
            user_id=user_id,
            revision_id=revision_id,
            title=(title or publication["title"]).strip()[:256] or publication["title"],
            event_payload={
                "representation": review.representation,
                "fingerprint": review.fingerprint,
                "telegram_message_id": int(message_id),
                "destination_chat_id": str(destination),
            },
        )


class TelegraphPublicationService:
    def __init__(self, repository: SQLiteRepository, cipher: CredentialCipher):
        self.repository = repository
        self.cipher = cipher

    def preview(self, *, user_id: int, draft_id: str) -> tuple[str, ProjectionReview]:
        revision_id, document = self.repository.get_active_document(draft_id=draft_id, user_id=user_id)
        review = telegraph_projection(document)
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
        self, *, user_id: int, draft_id: str, title: str,
        confirmed_fingerprint: str | None = None,
    ) -> dict[str, Any]:
        revision_id, review = self.preview(user_id=user_id, draft_id=draft_id)
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
            },
        )

    async def edit(
        self, *, user_id: int, publication_id: str, title: str,
        confirmed_fingerprint: str | None = None,
    ) -> dict[str, Any]:
        publication = self.repository.get_publication(publication_id=publication_id, user_id=user_id)
        if publication["kind"] != "telegraph":
            raise ValueError("publication_is_not_telegraph")
        path = str(publication.get("telegraph_path") or "")
        if not path:
            raise ValueError("telegraph_publication_missing_path")
        revision_id, review = self.preview(user_id=user_id, draft_id=publication["draft_id"])
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
            },
        )
