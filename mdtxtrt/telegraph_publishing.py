"""Telegraph publication adapter. Telegram Rich stays in publishing.py.

Limits follow the official Telegraph HTTP API (https://telegra.ph/api):
createAccount.short_name 1–32; createPage/editPage.title 1–256;
createPage/editPage.content up to 64 KB of Node JSON.
"""
from __future__ import annotations

import asyncio
import hashlib
from typing import Any

from telegraph import Telegraph
from telegraph.utils import html_to_nodes, json_dumps

from mdtxtrt.credentials import CredentialCipher
from mdtxtrt.domain import CanonicalDocument, CanonicalNode
from mdtxtrt.projections import ProjectionReview, telegraph_projection
from mdtxtrt.publishing import _LOCAL_MEDIA_KINDS, _override_payload, _require_review
from mdtxtrt.storage import SQLiteRepository

TELEGRAPH_CONTENT_LIMIT_BYTES = 64 * 1024
TELEGRAPH_SHORT_NAME_LIMIT = 32
TELEGRAPH_TITLE_LIMIT = 256


def _account_token(account: Any) -> str:
    token = str((account or {}).get("access_token") or "") if isinstance(account, dict) else str(getattr(account, "access_token", "") or "")
    if not token:
        raise RuntimeError("telegraph_missing_access_token")
    return token


def _page_locator(page: Any, *, fallback_url: str = "") -> tuple[str, str]:
    if isinstance(page, dict):
        path = str(page.get("path") or "")
        url = str(page.get("url") or fallback_url or "")
    else:
        path = str(getattr(page, "path", "") or "")
        url = str(getattr(page, "url", "") or fallback_url or "")
    if not path or not url:
        raise RuntimeError("telegraph_missing_page_locator")
    return path, url


def _clean_title(title: str, fallback: str) -> str:
    cleaned = (title or fallback).strip()[:TELEGRAPH_TITLE_LIMIT]
    return cleaned or fallback[:TELEGRAPH_TITLE_LIMIT] or "Sem título"


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
        short_name = f"mdtxtrt-{short_hash}"[:TELEGRAPH_SHORT_NAME_LIMIT]

        def create_account() -> str:
            # Official createAccount: https://telegra.ph/api#createAccount
            # python273/telegraph 2.2.0 returns the Account dict (access_token).
            return _account_token(Telegraph().create_account(short_name=short_name))

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
        clean_title = _clean_title(title, "Sem título")

        def create_page() -> dict[str, Any]:
            return Telegraph(access_token=token).create_page(
                title=clean_title,
                html_content=review.content,
                return_content=False,
            )

        page = await asyncio.to_thread(create_page)
        path, url = _page_locator(page)
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
        clean_title = _clean_title(title, str(publication["title"]))

        def edit_page() -> dict[str, Any]:
            return Telegraph(access_token=token).edit_page(
                path=path,
                title=clean_title,
                html_content=review.content,
                return_content=False,
            )

        page = await asyncio.to_thread(edit_page)
        new_path, url = _page_locator(page, fallback_url=str(publication.get("telegraph_url") or ""))
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
