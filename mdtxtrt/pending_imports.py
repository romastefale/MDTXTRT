"""Persistent staging for loss-aware and idempotent file imports."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import secrets
from typing import Any
from uuid import uuid4

from mdtxtrt.storage import SQLiteRepository


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(frozen=True, slots=True)
class PendingImport:
    id: str
    user_id: int
    source_key: str | None
    filename: str
    mime_type: str | None
    sha256: str
    data: bytes
    status: str
    draft_id: str | None
    created_at: str
    completed_at: str | None

    def public(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "filename": self.filename,
            "mime_type": self.mime_type,
            "sha256": self.sha256,
            "size": len(self.data),
            "status": self.status,
            "draft_id": self.draft_id,
            "created_at": self.created_at,
            "completed_at": self.completed_at,
        }


class PendingImportStore:
    def __init__(self, repository: SQLiteRepository):
        self.repository = repository

    def initialize(self) -> None:
        with self.repository.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS pending_imports (
                    id TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    source_key TEXT,
                    filename TEXT NOT NULL,
                    mime_type TEXT,
                    sha256 TEXT NOT NULL,
                    original_bytes BLOB NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('pending','completed')),
                    draft_id TEXT REFERENCES drafts(id) ON DELETE SET NULL,
                    created_at TEXT NOT NULL,
                    completed_at TEXT,
                    UNIQUE(user_id, source_key)
                );
                CREATE INDEX IF NOT EXISTS idx_pending_imports_owner
                    ON pending_imports(user_id, status, created_at DESC);
            """)

    def stage(
        self,
        *,
        user_id: int,
        filename: str,
        mime_type: str | None,
        data: bytes,
        source_key: str | None = None,
    ) -> PendingImport:
        digest = hashlib.sha256(data).hexdigest()
        clean_filename = (filename or "import.txt").strip()[:255] or "import.txt"
        clean_source = source_key.strip()[:512] if source_key else None
        with self.repository.connect() as db:
            if clean_source:
                existing = db.execute(
                    "SELECT * FROM pending_imports WHERE user_id=? AND source_key=?",
                    (user_id, clean_source),
                ).fetchone()
                if existing is not None:
                    if not secrets.compare_digest(str(existing["sha256"]), digest):
                        raise RuntimeError("pending_import_source_collision")
                    return self._from_row(existing)
            import_id = str(uuid4())
            db.execute(
                """INSERT INTO pending_imports(
                    id,user_id,source_key,filename,mime_type,sha256,original_bytes,status,draft_id,created_at,completed_at
                ) VALUES(?,?,?,?,?,?,?,'pending',NULL,?,NULL)""",
                (import_id, user_id, clean_source, clean_filename, mime_type, digest, data, _now()),
            )
        return self.get(user_id=user_id, pending_import_id=import_id)

    def _from_row(self, row) -> PendingImport:
        data = bytes(row["original_bytes"])
        digest = hashlib.sha256(data).hexdigest()
        if not secrets.compare_digest(digest, str(row["sha256"])):
            raise RuntimeError("pending_import_sha256_mismatch")
        return PendingImport(
            id=str(row["id"]),
            user_id=int(row["user_id"]),
            source_key=str(row["source_key"]) if row["source_key"] is not None else None,
            filename=str(row["filename"]),
            mime_type=str(row["mime_type"]) if row["mime_type"] is not None else None,
            sha256=str(row["sha256"]),
            data=data,
            status=str(row["status"]),
            draft_id=str(row["draft_id"]) if row["draft_id"] is not None else None,
            created_at=str(row["created_at"]),
            completed_at=str(row["completed_at"]) if row["completed_at"] is not None else None,
        )

    def get(self, *, user_id: int, pending_import_id: str) -> PendingImport:
        with self.repository.connect() as db:
            row = db.execute(
                "SELECT * FROM pending_imports WHERE id=? AND user_id=?",
                (pending_import_id, user_id),
            ).fetchone()
        if row is None:
            raise KeyError("pending_import_not_found")
        return self._from_row(row)

    def mark_completed(self, *, user_id: int, pending_import_id: str, draft_id: str) -> PendingImport:
        now = _now()
        with self.repository.connect() as db:
            current = db.execute(
                "SELECT status,draft_id FROM pending_imports WHERE id=? AND user_id=?",
                (pending_import_id, user_id),
            ).fetchone()
            if current is None:
                raise KeyError("pending_import_not_found")
            if current["status"] == "completed":
                return self.get(user_id=user_id, pending_import_id=pending_import_id)
            db.execute(
                "UPDATE pending_imports SET status='completed',draft_id=?,completed_at=? WHERE id=? AND user_id=? AND status='pending'",
                (draft_id, now, pending_import_id, user_id),
            )
        return self.get(user_id=user_id, pending_import_id=pending_import_id)
