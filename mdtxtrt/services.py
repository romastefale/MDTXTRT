"""Application services for user-owned documents and loss-aware imports."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from mdtxtrt.conversion import from_markdown, from_text, to_markdown, to_text
from mdtxtrt.domain import CanonicalDocument, CanonicalNode
from mdtxtrt.import_finalizer import ImportFinalizer
from mdtxtrt.pending_imports import PendingImport, PendingImportStore
from mdtxtrt.storage import SQLiteRepository


SUPPORTED_IMPORT_SUFFIXES = {".md", ".txt"}
MAX_IMPORT_BYTES = 1_000_000


@dataclass(frozen=True, slots=True)
class EncodingChoiceRequired(Exception):
    filename: str
    pending_import_id: str | None = None

    def __str__(self) -> str:
        return f"encoding choice required for {self.filename}"


@dataclass(frozen=True, slots=True)
class ImportReviewRequired(ValueError):
    pending_import_id: str
    review: dict[str, Any]

    def __str__(self) -> str:
        return "import_review_required"


def _automatic_empty_name() -> str:
    local = datetime.now(ZoneInfo("America/Sao_Paulo"))
    return local.strftime("Rascunho %d/%m/%Y %H:%M")


def _content_title(document: CanonicalDocument, fallback: str) -> str:
    for block in document.blocks:
        text = "".join(child.text or "" for child in block.children).strip() if block.children else (block.text or "").strip()
        if text:
            candidate = text[:40].strip()
            if len(text) > 40 and " " in candidate:
                candidate = candidate.rsplit(" ", 1)[0].strip() or candidate
            return candidate
        structural = {
            "table": "Tabela",
            "photo": "Foto",
            "video": "Vídeo",
            "animation": "Animação",
            "audio": "Áudio",
            "voice_note": "Mensagem de voz",
            "document": "Documento",
            "map": "Mapa", "location": "Localização", "venue": "Venue",
            "collage": "Collage",
            "slideshow": "Slideshow",
            "button_row": "Botões",
            "details": "Detalhes",
            "math_block": "Fórmula",
        }.get(block.kind)
        if structural:
            return structural
    return fallback


def _raw_markdown_nodes(nodes: tuple[CanonicalNode, ...]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []

    def walk(node: CanonicalNode) -> None:
        if node.kind == "raw_markdown":
            result.append(
                {
                    "node_id": node.id,
                    "reason": str(node.attrs.get("reason") or "unsupported_markdown"),
                    "text": node.text or "",
                }
            )
        for child in node.children:
            walk(child)

    for node in nodes:
        walk(node)
    return result


class DocumentService:
    def __init__(self, repository: SQLiteRepository):
        self.repository = repository

    def create(self, *, user_id: int, name: str = "Novo rascunho") -> dict[str, Any]:
        requested = (name or "").strip()
        automatic = not requested or requested == "Novo rascunho"
        resolved_name = _automatic_empty_name() if automatic else requested
        return self.repository.create_draft(user_id=user_id, name=resolved_name, document=CanonicalDocument.empty())

    def create_with_document(self, *, user_id: int, name: str, document: CanonicalDocument, reason: str) -> dict[str, Any]:
        resolved = (name or "").strip() or _content_title(document, _automatic_empty_name())
        return self.repository.create_draft(user_id=user_id, name=resolved, document=document, reason=reason)

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

    def delete(self, *, user_id: int, draft_id: str, confirmed: bool) -> None:
        if not confirmed:
            raise ValueError("draft_delete_confirmation_required")
        self.repository.get_draft(draft_id, user_id=user_id)
        with self.repository.connect() as db:
            cur = db.execute("DELETE FROM drafts WHERE id=? AND user_id=?", (draft_id, user_id))
            if cur.rowcount != 1:
                raise KeyError("draft_not_found")

    def undo(self, *, user_id: int, draft_id: str) -> dict[str, Any]:
        self.repository.undo(draft_id=draft_id, user_id=user_id)
        return self.get(user_id=user_id, draft_id=draft_id)

    def redo(self, *, user_id: int, draft_id: str, revision_id: str) -> dict[str, Any]:
        self.repository.redo(draft_id=draft_id, user_id=user_id, revision_id=revision_id)
        return self.get(user_id=user_id, draft_id=draft_id)

    def save_session(self, *, user_id: int, draft_id: str, payload: dict[str, Any]) -> None:
        self.repository.save_session(draft_id=draft_id, user_id=user_id, payload=payload)

    def list_imports(self, *, user_id: int, draft_id: str) -> list[dict[str, Any]]:
        self.repository.get_draft(draft_id, user_id=user_id)
        with self.repository.connect() as db:
            rows = db.execute(
                """SELECT id,filename,mime_type,encoding,sha256,length(original_bytes) AS size,created_at
                   FROM imports WHERE user_id=? AND draft_id=? ORDER BY created_at DESC""",
                (user_id, draft_id),
            ).fetchall()
        return [dict(row) for row in rows]


class ImportService:
    def __init__(
        self,
        repository: SQLiteRepository,
        documents: DocumentService,
        pending: PendingImportStore,
        finalizer: ImportFinalizer,
    ):
        self.repository = repository
        self.documents = documents
        self.pending = pending
        self.finalizer = finalizer

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
        if suffix not in SUPPORTED_IMPORT_SUFFIXES:
            raise ValueError("unsupported_import_format")
        if len(data) > MAX_IMPORT_BYTES:
            raise ValueError("import_file_too_large")
        return self.pending.stage(
            user_id=user_id,
            filename=filename,
            mime_type=mime_type,
            data=data,
            source_key=source_key,
        )

    def get_pending(self, *, user_id: int, pending_import_id: str) -> dict[str, Any]:
        return self.pending.get(user_id=user_id, pending_import_id=pending_import_id).public()

    def preview_pending(
        self,
        *,
        user_id: int,
        pending_import_id: str,
        encoding: str | None = None,
    ) -> dict[str, Any]:
        pending = self.pending.get(user_id=user_id, pending_import_id=pending_import_id)
        if pending.status == "completed" and pending.draft_id:
            return {
                "pending_import_id": pending.id,
                "status": "completed",
                "draft_id": pending.draft_id,
                "requires_confirmation": False,
            }
        try:
            text, used_encoding = self._decode(pending.filename, pending.data, encoding)
        except EncodingChoiceRequired as exc:
            raise EncodingChoiceRequired(exc.filename, pending.id) from exc

        suffix = Path(pending.filename).suffix.lower()
        document = from_markdown(text) if suffix == ".md" else from_text(text)
        residual = _raw_markdown_nodes(document.blocks)
        format_name = "markdown" if suffix == ".md" else "text"
        title = _content_title(document, pending.filename)
        return {
            "pending_import_id": pending.id,
            "status": "staged",
            "filename": pending.filename,
            "mime_type": pending.mime_type,
            "sha256": pending.sha256,
            "size": len(pending.data),
            "encoding": used_encoding,
            "format": format_name,
            "suggested_title": title,
            "original_text": text,
            "converted_document": document.to_dict(),
            "converted_markdown": to_markdown(document),
            "converted_text": to_text(document),
            "residual_raw_markdown": residual,
            "requires_confirmation": bool(residual),
            "lossless_visual_import": not residual,
        }

    def complete_pending(
        self,
        *,
        user_id: int,
        pending_import_id: str,
        encoding: str | None = None,
        confirm_partial: bool = False,
    ) -> dict[str, Any]:
        pending = self.pending.get(user_id=user_id, pending_import_id=pending_import_id)
        if pending.status == "completed" and pending.draft_id:
            draft = self.documents.get(user_id=user_id, draft_id=pending.draft_id)
            draft["pending_import_id"] = pending.id
            return draft

        review = self.preview_pending(
            user_id=user_id,
            pending_import_id=pending.id,
            encoding=encoding,
        )
        if review.get("requires_confirmation") and not confirm_partial:
            raise ImportReviewRequired(pending.id, review)

        claim_token = self.pending.claim_completion(user_id=user_id, pending_import_id=pending.id)
        if claim_token is None:
            completed = self.pending.get(user_id=user_id, pending_import_id=pending.id)
            if completed.draft_id:
                draft = self.documents.get(user_id=user_id, draft_id=completed.draft_id)
                draft["pending_import_id"] = completed.id
                return draft
            raise RuntimeError("pending_import_completed_without_draft")

        try:
            document = CanonicalDocument.from_dict(review["converted_document"])
            draft_id, import_id = self.finalizer.finalize(
                user_id=user_id,
                pending_import_id=pending.id,
                claim_token=claim_token,
                name=str(review["suggested_title"]),
                document=document,
                filename=pending.filename,
                mime_type=pending.mime_type,
                encoding=str(review["encoding"]),
                original_bytes=pending.data,
                reason=f"import:{review['format']}",
            )
            draft = self.documents.get(user_id=user_id, draft_id=draft_id)
            if import_id:
                draft["import_id"] = import_id
            draft["pending_import_id"] = pending.id
            draft["import_encoding"] = str(review["encoding"])
            draft["import_review"] = {
                "lossless_visual_import": bool(review["lossless_visual_import"]),
                "residual_raw_markdown": review["residual_raw_markdown"],
            }
            return draft
        except Exception:
            self.pending.release_claim(
                user_id=user_id,
                pending_import_id=pending.id,
                claim_token=claim_token,
            )
            raise

    def import_file(
        self,
        *,
        user_id: int,
        filename: str,
        data: bytes,
        mime_type: str | None = None,
        encoding: str | None = None,
        source_key: str | None = None,
        confirm_partial: bool = False,
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
            confirm_partial=confirm_partial,
        )
