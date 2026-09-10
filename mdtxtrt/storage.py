"""SQLite persistence for user-owned drafts, immutable revisions and publications."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import sqlite3
from pathlib import Path
from typing import Any
from uuid import uuid4

from mdtxtrt.domain import CanonicalDocument


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class SQLiteRepository:
    def __init__(self, path: str):
        self.path = str(Path(path))

    def connect(self) -> sqlite3.Connection:
        db = sqlite3.connect(self.path)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys = ON")
        db.execute("PRAGMA journal_mode = WAL")
        return db

    def initialize(self) -> None:
        with self.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS drafts (
                    id TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    name TEXT NOT NULL,
                    active_revision_id TEXT,
                    active_branch_id TEXT,
                    archived_at TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_drafts_user_updated
                    ON drafts(user_id, archived_at, updated_at DESC);
                CREATE TABLE IF NOT EXISTS branches (
                    id TEXT PRIMARY KEY,
                    draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
                    parent_branch_id TEXT,
                    fork_revision_id TEXT,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS revisions (
                    id TEXT PRIMARY KEY,
                    draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
                    branch_id TEXT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
                    parent_revision_id TEXT,
                    canonical_json TEXT NOT NULL,
                    reason TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_revisions_parent
                    ON revisions(draft_id, parent_revision_id);
                CREATE TABLE IF NOT EXISTS editor_sessions (
                    draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
                    user_id INTEGER NOT NULL,
                    revision_id TEXT,
                    cursor_json TEXT,
                    selection_json TEXT,
                    scroll_top REAL NOT NULL DEFAULT 0,
                    active_block_id TEXT,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (draft_id, user_id)
                );
                CREATE TABLE IF NOT EXISTS imports (
                    id TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
                    filename TEXT NOT NULL,
                    mime_type TEXT,
                    encoding TEXT NOT NULL,
                    sha256 TEXT NOT NULL,
                    original_bytes BLOB NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_imports_user_draft
                    ON imports(user_id, draft_id, created_at DESC);
                CREATE TABLE IF NOT EXISTS telegraph_accounts (
                    user_id INTEGER PRIMARY KEY,
                    token_envelope TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS publications (
                    id TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
                    revision_id TEXT NOT NULL REFERENCES revisions(id),
                    kind TEXT NOT NULL CHECK(kind IN ('telegram','telegraph')),
                    title TEXT NOT NULL,
                    destination_chat_id TEXT,
                    telegram_message_id INTEGER,
                    telegraph_path TEXT,
                    telegraph_url TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_publications_user_updated
                    ON publications(user_id, updated_at DESC);
                CREATE TABLE IF NOT EXISTS publication_events (
                    id TEXT PRIMARY KEY,
                    publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
                    user_id INTEGER NOT NULL,
                    revision_id TEXT NOT NULL REFERENCES revisions(id),
                    action TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_publication_events_publication
                    ON publication_events(publication_id, created_at);
            """)

    def create_draft(self, *, user_id: int, name: str, document: CanonicalDocument, reason: str = "create") -> dict[str, Any]:
        draft_id, branch_id, revision_id = str(uuid4()), str(uuid4()), str(uuid4())
        now = _now()
        with self.connect() as db:
            db.execute(
                "INSERT INTO drafts(id,user_id,name,created_at,updated_at) VALUES(?,?,?,?,?)",
                (draft_id, user_id, name, now, now),
            )
            db.execute(
                "INSERT INTO branches(id,draft_id,parent_branch_id,fork_revision_id,created_at) VALUES(?,?,?,?,?)",
                (branch_id, draft_id, None, None, now),
            )
            db.execute(
                "INSERT INTO revisions(id,draft_id,branch_id,parent_revision_id,canonical_json,reason,created_at) VALUES(?,?,?,?,?,?,?)",
                (revision_id, draft_id, branch_id, None, document.to_json(), reason, now),
            )
            db.execute(
                "UPDATE drafts SET active_revision_id=?,active_branch_id=? WHERE id=?",
                (revision_id, branch_id, draft_id),
            )
        return self.get_draft(draft_id, user_id=user_id)

    def list_drafts(self, *, user_id: int, archived: bool = False) -> list[dict[str, Any]]:
        predicate = "archived_at IS NOT NULL" if archived else "archived_at IS NULL"
        with self.connect() as db:
            rows = db.execute(
                f"SELECT id,name,active_revision_id,active_branch_id,archived_at,created_at,updated_at FROM drafts WHERE user_id=? AND {predicate} ORDER BY updated_at DESC",
                (user_id,),
            ).fetchall()
            return [dict(row) for row in rows]

    def get_draft(self, draft_id: str, *, user_id: int) -> dict[str, Any]:
        with self.connect() as db:
            draft = db.execute("SELECT * FROM drafts WHERE id=? AND user_id=?", (draft_id, user_id)).fetchone()
            if draft is None:
                raise KeyError("draft_not_found")
            revision = db.execute("SELECT * FROM revisions WHERE id=?", (draft["active_revision_id"],)).fetchone()
            if revision is None:
                raise RuntimeError("draft_has_no_active_revision")
            return {
                "id": draft["id"],
                "name": draft["name"],
                "active_revision_id": revision["id"],
                "active_branch_id": revision["branch_id"],
                "document": json.loads(revision["canonical_json"]),
                "archived_at": draft["archived_at"],
                "created_at": draft["created_at"],
                "updated_at": draft["updated_at"],
            }

    def get_active_document(self, *, draft_id: str, user_id: int) -> tuple[str, CanonicalDocument]:
        draft = self.get_draft(draft_id, user_id=user_id)
        return str(draft["active_revision_id"]), CanonicalDocument.from_dict(draft["document"])

    def _active(self, db: sqlite3.Connection, draft_id: str, user_id: int) -> sqlite3.Row:
        row = db.execute(
            "SELECT r.* FROM drafts d JOIN revisions r ON r.id=d.active_revision_id WHERE d.id=? AND d.user_id=?",
            (draft_id, user_id),
        ).fetchone()
        if row is None:
            raise KeyError("draft_not_found")
        return row

    def commit_revision(self, *, draft_id: str, user_id: int, document: CanonicalDocument, reason: str) -> None:
        now = _now()
        with self.connect() as db:
            active = self._active(db, draft_id, user_id)
            existing_child = db.execute(
                "SELECT 1 FROM revisions WHERE draft_id=? AND parent_revision_id=? LIMIT 1",
                (draft_id, active["id"]),
            ).fetchone()
            branch_id = active["branch_id"]
            if existing_child is not None:
                branch_id = str(uuid4())
                db.execute(
                    "INSERT INTO branches(id,draft_id,parent_branch_id,fork_revision_id,created_at) VALUES(?,?,?,?,?)",
                    (branch_id, draft_id, active["branch_id"], active["id"], now),
                )
            revision_id = str(uuid4())
            db.execute(
                "INSERT INTO revisions(id,draft_id,branch_id,parent_revision_id,canonical_json,reason,created_at) VALUES(?,?,?,?,?,?,?)",
                (revision_id, draft_id, branch_id, active["id"], document.to_json(), reason, now),
            )
            db.execute(
                "UPDATE drafts SET active_revision_id=?,active_branch_id=?,updated_at=? WHERE id=? AND user_id=?",
                (revision_id, branch_id, now, draft_id, user_id),
            )

    def rename_draft(self, *, draft_id: str, user_id: int, name: str) -> None:
        name = name.strip()
        if not name:
            raise ValueError("draft_name_required")
        with self.connect() as db:
            cur = db.execute(
                "UPDATE drafts SET name=?,updated_at=? WHERE id=? AND user_id=?",
                (name[:160], _now(), draft_id, user_id),
            )
            if cur.rowcount != 1:
                raise KeyError("draft_not_found")

    def set_archived(self, *, draft_id: str, user_id: int, archived: bool) -> None:
        now = _now()
        with self.connect() as db:
            cur = db.execute(
                "UPDATE drafts SET archived_at=?,updated_at=? WHERE id=? AND user_id=?",
                (now if archived else None, now, draft_id, user_id),
            )
            if cur.rowcount != 1:
                raise KeyError("draft_not_found")

    def undo(self, *, draft_id: str, user_id: int) -> None:
        now = _now()
        with self.connect() as db:
            active = self._active(db, draft_id, user_id)
            if active["parent_revision_id"] is None:
                return
            parent = db.execute("SELECT * FROM revisions WHERE id=?", (active["parent_revision_id"],)).fetchone()
            if parent is None:
                raise RuntimeError("revision_parent_missing")
            db.execute(
                "UPDATE drafts SET active_revision_id=?,active_branch_id=?,updated_at=? WHERE id=? AND user_id=?",
                (parent["id"], parent["branch_id"], now, draft_id, user_id),
            )

    def redo_candidates(self, *, draft_id: str, user_id: int) -> list[dict[str, Any]]:
        with self.connect() as db:
            active = self._active(db, draft_id, user_id)
            rows = db.execute(
                "SELECT id,branch_id,reason,created_at FROM revisions WHERE draft_id=? AND parent_revision_id=? ORDER BY created_at",
                (draft_id, active["id"]),
            ).fetchall()
            return [dict(row) for row in rows]

    def redo(self, *, draft_id: str, user_id: int, revision_id: str) -> None:
        now = _now()
        with self.connect() as db:
            active = self._active(db, draft_id, user_id)
            target = db.execute(
                "SELECT * FROM revisions WHERE id=? AND draft_id=? AND parent_revision_id=?",
                (revision_id, draft_id, active["id"]),
            ).fetchone()
            if target is None:
                raise ValueError("revision_is_not_a_redo_candidate")
            db.execute(
                "UPDATE drafts SET active_revision_id=?,active_branch_id=?,updated_at=? WHERE id=? AND user_id=?",
                (target["id"], target["branch_id"], now, draft_id, user_id),
            )

    def save_session(self, *, draft_id: str, user_id: int, payload: dict[str, Any]) -> None:
        now = _now()
        with self.connect() as db:
            if db.execute("SELECT 1 FROM drafts WHERE id=? AND user_id=?", (draft_id, user_id)).fetchone() is None:
                raise KeyError("draft_not_found")
            db.execute(
                """
                INSERT INTO editor_sessions(draft_id,user_id,revision_id,cursor_json,selection_json,scroll_top,active_block_id,updated_at)
                VALUES(?,?,?,?,?,?,?,?)
                ON CONFLICT(draft_id,user_id) DO UPDATE SET
                  revision_id=excluded.revision_id,cursor_json=excluded.cursor_json,
                  selection_json=excluded.selection_json,scroll_top=excluded.scroll_top,
                  active_block_id=excluded.active_block_id,updated_at=excluded.updated_at
                """,
                (
                    draft_id, user_id, payload.get("revision_id"),
                    json.dumps(payload.get("cursor"), ensure_ascii=False) if payload.get("cursor") is not None else None,
                    json.dumps(payload.get("selection"), ensure_ascii=False) if payload.get("selection") is not None else None,
                    float(payload.get("scroll_top", 0)), payload.get("active_block_id"), now,
                ),
            )

    def get_session(self, *, draft_id: str, user_id: int) -> dict[str, Any] | None:
        with self.connect() as db:
            row = db.execute("SELECT * FROM editor_sessions WHERE draft_id=? AND user_id=?", (draft_id, user_id)).fetchone()
            if row is None:
                return None
            return {
                "revision_id": row["revision_id"],
                "cursor": json.loads(row["cursor_json"]) if row["cursor_json"] else None,
                "selection": json.loads(row["selection_json"]) if row["selection_json"] else None,
                "scroll_top": row["scroll_top"],
                "active_block_id": row["active_block_id"],
                "updated_at": row["updated_at"],
            }

    def store_import(self, *, user_id: int, draft_id: str, filename: str, mime_type: str | None, encoding: str, original_bytes: bytes) -> str:
        import_id = str(uuid4())
        with self.connect() as db:
            db.execute(
                "INSERT INTO imports(id,user_id,draft_id,filename,mime_type,encoding,sha256,original_bytes,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
                (import_id, user_id, draft_id, filename, mime_type, encoding, hashlib.sha256(original_bytes).hexdigest(), original_bytes, _now()),
            )
        return import_id

    def get_telegraph_token_envelope(self, *, user_id: int) -> str | None:
        with self.connect() as db:
            row = db.execute("SELECT token_envelope FROM telegraph_accounts WHERE user_id=?", (user_id,)).fetchone()
            return str(row["token_envelope"]) if row else None

    def set_telegraph_token_envelope(self, *, user_id: int, token_envelope: str) -> None:
        now = _now()
        with self.connect() as db:
            db.execute(
                """
                INSERT INTO telegraph_accounts(user_id,token_envelope,created_at,updated_at)
                VALUES(?,?,?,?)
                ON CONFLICT(user_id) DO UPDATE SET token_envelope=excluded.token_envelope,updated_at=excluded.updated_at
                """,
                (user_id, token_envelope, now, now),
            )

    def create_publication(
        self, *, user_id: int, draft_id: str, revision_id: str, kind: str, title: str,
        destination_chat_id: str | None = None, telegram_message_id: int | None = None,
        telegraph_path: str | None = None, telegraph_url: str | None = None,
        event_payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if kind not in {"telegram", "telegraph"}:
            raise ValueError("invalid_publication_kind")
        publication_id, now = str(uuid4()), _now()
        with self.connect() as db:
            owner = db.execute("SELECT active_revision_id FROM drafts WHERE id=? AND user_id=?", (draft_id, user_id)).fetchone()
            if owner is None:
                raise KeyError("draft_not_found")
            revision = db.execute("SELECT 1 FROM revisions WHERE id=? AND draft_id=?", (revision_id, draft_id)).fetchone()
            if revision is None:
                raise ValueError("revision_not_in_draft")
            db.execute(
                """INSERT INTO publications(
                    id,user_id,draft_id,revision_id,kind,title,destination_chat_id,telegram_message_id,
                    telegraph_path,telegraph_url,created_at,updated_at
                ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)""",
                (publication_id,user_id,draft_id,revision_id,kind,title,destination_chat_id,telegram_message_id,telegraph_path,telegraph_url,now,now),
            )
            self._append_publication_event(
                db, publication_id=publication_id, user_id=user_id, revision_id=revision_id,
                action="create", payload=event_payload or {}, created_at=now,
            )
        return self.get_publication(publication_id=publication_id, user_id=user_id)

    def _append_publication_event(self, db: sqlite3.Connection, *, publication_id: str, user_id: int, revision_id: str, action: str, payload: dict[str, Any], created_at: str | None = None) -> None:
        db.execute(
            "INSERT INTO publication_events(id,publication_id,user_id,revision_id,action,payload_json,created_at) VALUES(?,?,?,?,?,?,?)",
            (str(uuid4()), publication_id, user_id, revision_id, action, json.dumps(payload, ensure_ascii=False, separators=(",", ":")), created_at or _now()),
        )

    def update_publication(
        self, *, publication_id: str, user_id: int, revision_id: str, title: str,
        destination_chat_id: str | None = None, telegram_message_id: int | None = None,
        telegraph_path: str | None = None, telegraph_url: str | None = None,
        event_payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        now = _now()
        with self.connect() as db:
            current = db.execute("SELECT * FROM publications WHERE id=? AND user_id=?", (publication_id, user_id)).fetchone()
            if current is None:
                raise KeyError("publication_not_found")
            revision = db.execute("SELECT 1 FROM revisions WHERE id=? AND draft_id=?", (revision_id, current["draft_id"])).fetchone()
            if revision is None:
                raise ValueError("revision_not_in_publication_draft")
            db.execute(
                """UPDATE publications SET revision_id=?,title=?,destination_chat_id=?,telegram_message_id=?,
                    telegraph_path=?,telegraph_url=?,updated_at=? WHERE id=? AND user_id=?""",
                (
                    revision_id, title, destination_chat_id if destination_chat_id is not None else current["destination_chat_id"],
                    telegram_message_id if telegram_message_id is not None else current["telegram_message_id"],
                    telegraph_path if telegraph_path is not None else current["telegraph_path"],
                    telegraph_url if telegraph_url is not None else current["telegraph_url"],
                    now, publication_id, user_id,
                ),
            )
            self._append_publication_event(
                db, publication_id=publication_id, user_id=user_id, revision_id=revision_id,
                action="edit", payload=event_payload or {}, created_at=now,
            )
        return self.get_publication(publication_id=publication_id, user_id=user_id)

    def get_publication(self, *, publication_id: str, user_id: int) -> dict[str, Any]:
        with self.connect() as db:
            row = db.execute("SELECT * FROM publications WHERE id=? AND user_id=?", (publication_id, user_id)).fetchone()
            if row is None:
                raise KeyError("publication_not_found")
            result = dict(row)
            events = db.execute(
                "SELECT id,revision_id,action,payload_json,created_at FROM publication_events WHERE publication_id=? AND user_id=? ORDER BY created_at",
                (publication_id, user_id),
            ).fetchall()
            result["events"] = [
                {**dict(event), "payload": json.loads(event["payload_json"])} for event in events
            ]
            for event in result["events"]:
                event.pop("payload_json", None)
            return result

    def list_publications(self, *, user_id: int) -> list[dict[str, Any]]:
        with self.connect() as db:
            rows = db.execute(
                "SELECT * FROM publications WHERE user_id=? ORDER BY updated_at DESC",
                (user_id,),
            ).fetchall()
            return [dict(row) for row in rows]
