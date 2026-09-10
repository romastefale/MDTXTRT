"""Application services for user-owned documents and loss-aware imports."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from mdtxtrt.conversion import from_markdown, from_text
from mdtxtrt.domain import CanonicalDocument
from mdtxtrt.pending_imports import PendingImport, PendingImportStore
from mdtxtrt.storage import SQLiteRepository


@dataclass(frozen=True, slots=True)
class EncodingChoiceRequired(Exception):
    filename: str
    pending_import_id: str | None = None

    def __str__(self) -> str:
        return f"encoding choice required for {self.filename}"


class DocumentService:
    def __init__(self, repository: SQLiteRepository):
        self.repository = repository

    def create(self, *, user_id: int, name: str = "Novo rascunho") -> dict[str, Any]:
        return self.repository.create_draft(user_id=user_id, name=name, document=CanonicalDocument.empty())

    def create_with_document(self, *, user_id: int, name: str, document: CanonicalDocument, reason: str) -> dict[str, Any]:
        return self.repository.create_draft(user_id=user_id, name=name, document=document, reason=reason)

    def list(self, *, user_id: int, archived: bool = False) -> list[dict[str, Any]]:
        return self.repository.list_drafts(user_id=user_id, archived=archived)

    def get(self, *, user_id: int, draft_id: str) -> dict[str, Any]:
        result = self.repository.get_draft(draft_id, user_id=user_id)
        result["session"] = self.repository.get_session(draft_id=draft_id, user_id=user_id)
        result["redo_candidates"] = self.repository.redo_candidates(draft_id=draft_id, user_id=user_id)
        return result

    def commit(self, *, user_id: int, draft_id: str, canonical: dict[str, Any], reason: str = "edit") -> dict[str, Any]:
        self.repository.commit_revision(
            draft_id=draft_id,
            user_id=user_id,
            document=CanonicalDocument.from_dict(canonical),
            reason=reason,
        )
        return self.get(user_id=user_id, draft_id=draft_id)

    def rename(self, *, user_id: int, draft_id: str, name: str) -> dict[str, Any]:
        self.repository.rename_draft(draft_id=draft_id, user_id=user_id, name=name)
        return self.get(user_id=user_id, draft_id=draft_id)

    def archive(self, *, user_id: int, draft_id: str, archived: bool) -> dict[str, Any]:
        self.repository.set_archived(draft_id=draft_id, user_id=user_id, archived=archived)
        return self.get(user_id=user_id, draft_id=draft_id)

    def undo(self, *, user_id: int, draft_id: str) -> dict[str, Any]:
        self.repository.undo(draft_id=draft_id, user_id=user_id)
        return self.get(user_id=user_id, draft_id=draft_id)

    def redo(self, *, user_id: int, draft_id: str, revision_id: str) -> dict[str, Any]:
        self.repository.redo(draft_id=draft_id, user_id=user_id, revision_id=revision_id)
        return self.get(user_id=user_id, draft_id=draft_id)

    def save_session(self, *, user_id: int, draft_id: str, payload: dict[str, Any]) -> None:
        self.repository.save_session(draft_id=draft_id, user_id=user_id, payload=payload)


class ImportService:
    def __init__(self, repository: SQLiteRepository, documents: DocumentService, pending: PendingImportStore):
        self.repository = repository
        self.documents = documents
        self.pending = pending

    @staticmethod
    def _decode(filename: str, data: bytes, encoding: str | None) -> tuple[str, str]:
        if encoding:
            try:
                return data.decode(encoding), encoding
            except LookupError as exc:
                raise ValueError("unknown_encoding") from exc
            except UnicodeDecodeError as exc:
                raise ValueError("invalid_encoding_for_file") from exc
        if data.startswith(b"\xef\xbb\xbf"):
            return data.decode("utf-8-sig"), "utf-8-sig"
        try:
            return data.decode("utf-8"), "utf-8"
        except UnicodeDecodeError as exc:
            raise EncodingChoiceRequired(filename) from exc

    def stage_file(
        self,
        *,
        user_id: int,
        filename: str,
        data: bytes,
        mime_type: str | None = None,
        source_key: str | None = None,
    ) -> PendingImport:
        suffix = Path(filename).suffix.lower()
        if suffix not in {".md", ".txt"}:
            raise ValueError("unsupported_import_format")
        return self.pending.stage(
            user_id=user_id,
            filename=filename,
            mime_type=mime_type,
            data=data,
            source_key=source_key,
        )

    def get_pending(self, *, user_id: int, pending_import_id: str) -> dict[str, Any]:
        return self.pending.get(user_id=user_id, pending_import_id=pending_import_id).public()

    def complete_pending(
        self,
        *,
        user_id: int,
        pending_import_id: str,
        encoding: str | None = None,
    ) -> dict[str, Any]:
        pending = self.pending.get(user_id=user_id, pending_import_id=pending_import_id)
        if pending.status == "completed" and pending.draft_id:
            draft = self.documents.get(user_id=user_id, draft_id=pending.draft_id)
            draft["pending_import_id"] = pending.id
            return draft
        try:
            text, used_encoding = self._decode(pending.filename, pending.data, encoding)
        except EncodingChoiceRequired as exc:
            raise EncodingChoiceRequired(exc.filename, pending.id) from exc
        suffix = Path(pending.filename).suffix.lower()
        document = from_markdown(text) if suffix == ".md" else from_text(text)
        format_name = "markdown" if suffix == ".md" else "text"
        visible = next(
            ("".join(child.text or "" for child in block.children).strip() for block in document.blocks if block.children),
            "",
        )
        title = visible[:40].strip() or pending.filename
        draft = self.documents.create_with_document(
            user_id=user_id,
            name=title,
            document=document,
            reason=f"import:{format_name}",
        )
        draft["import_id"] = self.repository.store_import(
            user_id=user_id,
            draft_id=draft["id"],
            filename=pending.filename,
            mime_type=pending.mime_type,
            encoding=used_encoding,
            original_bytes=pending.data,
        )
        completed = self.pending.mark_completed(
            user_id=user_id,
            pending_import_id=pending.id,
            draft_id=draft["id"],
        )
        draft["pending_import_id"] = completed.id
        draft["import_encoding"] = used_encoding
        return draft

    def import_file(
        self, *, user_id: int, filename: str, data: bytes,
        mime_type: str | None = None, encoding: str | None = None,
        source_key: str | None = None,
    ) -> dict[str, Any]:
        pending = self.stage_file(
            user_id=user_id,
            filename=filename,
            data=data,
            mime_type=mime_type,
            source_key=source_key,
        )
        return self.complete_pending(
            user_id=user_id,
            pending_import_id=pending.id,
            encoding=encoding,
        )
