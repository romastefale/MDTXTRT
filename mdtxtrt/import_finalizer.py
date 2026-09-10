"""Atomic unit-of-work for turning a staged import into a draft.

The pending import, initial draft revision and byte-for-byte import record are
committed together. This removes the previous crash window between draft
creation and marking the staged import as completed.
"""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import secrets
from uuid import uuid4

from mdtxtrt.domain import CanonicalDocument
from mdtxtrt.storage import SQLiteRepository


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class ImportFinalizer:
    def __init__(self, repository: SQLiteRepository):
        self.repository = repository

    def finalize(
        self,
        *,
        user_id: int,
        pending_import_id: str,
        claim_token: str,
        name: str,
        document: CanonicalDocument,
        filename: str,
        mime_type: str | None,
        encoding: str,
        original_bytes: bytes,
        reason: str,
    ) -> tuple[str, str]:
        draft_id = str(uuid4())
        branch_id = str(uuid4())
        revision_id = str(uuid4())
        import_id = str(uuid4())
        now = _now()
        clean_name = (name or "Novo rascunho").strip()[:160] or "Novo rascunho"
        digest = hashlib.sha256(original_bytes).hexdigest()

        with self.repository.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            pending = db.execute(
                """SELECT status,draft_id,sha256 FROM pending_imports
                   WHERE id=? AND user_id=?""",
                (pending_import_id, user_id),
            ).fetchone()
            if pending is None:
                raise KeyError("pending_import_not_found")
            if pending["status"] == "completed":
                existing = str(pending["draft_id"] or "")
                if not existing:
                    raise RuntimeError("completed_import_missing_draft")
                return existing, ""
            if not secrets.compare_digest(str(pending["sha256"]), digest):
                raise RuntimeError("pending_import_sha256_mismatch")
            claim = db.execute(
                """SELECT 1 FROM pending_import_claims
                   WHERE pending_import_id=? AND user_id=? AND claim_token=?""",
                (pending_import_id, user_id, claim_token),
            ).fetchone()
            if claim is None:
                raise RuntimeError("pending_import_claim_lost")

            db.execute(
                "INSERT INTO drafts(id,user_id,name,created_at,updated_at) VALUES(?,?,?,?,?)",
                (draft_id, user_id, clean_name, now, now),
            )
            db.execute(
                "INSERT INTO branches(id,draft_id,parent_branch_id,fork_revision_id,created_at) VALUES(?,?,?,?,?)",
                (branch_id, draft_id, None, None, now),
            )
            db.execute(
                """INSERT INTO revisions(
                    id,draft_id,branch_id,parent_revision_id,canonical_json,reason,created_at,draft_name,archived_at
                ) VALUES(?,?,?,?,?,?,?,?,NULL)""",
                (revision_id, draft_id, branch_id, None, document.to_json(), reason, now, clean_name),
            )
            db.execute(
                "UPDATE drafts SET active_revision_id=?,active_branch_id=? WHERE id=? AND user_id=?",
                (revision_id, branch_id, draft_id, user_id),
            )
            db.execute(
                """INSERT INTO imports(
                    id,user_id,draft_id,filename,mime_type,encoding,sha256,original_bytes,created_at
                ) VALUES(?,?,?,?,?,?,?,?,?)""",
                (import_id, user_id, draft_id, filename, mime_type, encoding, digest, original_bytes, now),
            )
            updated = db.execute(
                """UPDATE pending_imports SET status='completed',draft_id=?,completed_at=?
                   WHERE id=? AND user_id=? AND status='pending'""",
                (draft_id, now, pending_import_id, user_id),
            )
            if updated.rowcount != 1:
                raise RuntimeError("pending_import_completion_conflict")
            db.execute(
                "DELETE FROM pending_import_claims WHERE pending_import_id=? AND user_id=? AND claim_token=?",
                (pending_import_id, user_id, claim_token),
            )

        return draft_id, import_id
