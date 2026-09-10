"""User-owned media BLOBs and native Telegram location requests.

BLOBs are immutable. Replacement or restoration creates a new BLOB version and
preserves the previous bytes. Public URLs are opt-in, random-token based and revocable.
"""
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


def _http_media_type(value: str) -> str:
    """Return only type/subtype for aiohttp's content_type parameter.

    The original MIME string remains persisted. Public response construction
    must not receive parameters such as ``; charset=...`` through content_type.
    """
    base = (value or "application/octet-stream").split(";", 1)[0].strip().lower()
    if "/" not in base or any(ch.isspace() for ch in base):
        return "application/octet-stream"
    return base


@dataclass(frozen=True, slots=True)
class MediaBlob:
    id: str
    user_id: int
    draft_id: str
    filename: str
    mime_type: str
    sha256: str
    data: bytes


class BlobIntegrityError(RuntimeError):
    pass


class AssetService:
    def __init__(self, repository: SQLiteRepository):
        self.repository = repository

    def initialize(self) -> None:
        with self.repository.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS media_blobs (
                    id TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
                    filename TEXT NOT NULL,
                    mime_type TEXT NOT NULL,
                    sha256 TEXT NOT NULL,
                    original_bytes BLOB NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_media_blobs_owner
                    ON media_blobs(user_id, draft_id, created_at);

                CREATE TABLE IF NOT EXISTS media_replacements (
                    new_media_id TEXT PRIMARY KEY REFERENCES media_blobs(id) ON DELETE CASCADE,
                    previous_media_id TEXT NOT NULL REFERENCES media_blobs(id),
                    user_id INTEGER NOT NULL,
                    draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
                    created_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_media_replacements_previous
                    ON media_replacements(user_id, draft_id, previous_media_id, created_at);

                CREATE TABLE IF NOT EXISTS public_blob_links (
                    token TEXT PRIMARY KEY,
                    media_id TEXT NOT NULL REFERENCES media_blobs(id) ON DELETE CASCADE,
                    user_id INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    revoked_at TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_public_blob_media
                    ON public_blob_links(user_id, media_id, revoked_at);

                CREATE TABLE IF NOT EXISTS location_requests (
                    id TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    draft_id TEXT NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
                    status TEXT NOT NULL,
                    latitude REAL,
                    longitude REAL,
                    name TEXT,
                    address TEXT,
                    created_at TEXT NOT NULL,
                    fulfilled_at TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_location_pending
                    ON location_requests(user_id, status, created_at DESC);
            """)

    def store_media(
        self,
        *,
        user_id: int,
        draft_id: str,
        filename: str,
        mime_type: str | None,
        data: bytes,
        replaces_media_id: str | None = None,
    ) -> dict[str, Any]:
        self.repository.get_draft(draft_id, user_id=user_id)
        if replaces_media_id:
            previous = self.get_media(user_id=user_id, media_id=replaces_media_id)
            if previous.draft_id != draft_id:
                raise ValueError("replacement_media_does_not_belong_to_draft")
        media_id = str(uuid4())
        digest = hashlib.sha256(data).hexdigest()
        clean_filename = (filename or "arquivo").strip()[:255] or "arquivo"
        clean_mime = (mime_type or "application/octet-stream").strip()[:160]
        now = _now()
        with self.repository.connect() as db:
            db.execute(
                """INSERT INTO media_blobs(
                    id,user_id,draft_id,filename,mime_type,sha256,original_bytes,created_at
                ) VALUES(?,?,?,?,?,?,?,?)""",
                (media_id, user_id, draft_id, clean_filename, clean_mime, digest, data, now),
            )
            if replaces_media_id:
                db.execute(
                    """INSERT INTO media_replacements(new_media_id,previous_media_id,user_id,draft_id,created_at)
                       VALUES(?,?,?,?,?)""",
                    (media_id, replaces_media_id, user_id, draft_id, now),
                )
        return {
            "id": media_id,
            "draft_id": draft_id,
            "filename": clean_filename,
            "mime_type": clean_mime,
            "sha256": digest,
            "size": len(data),
            "replaces_media_id": replaces_media_id,
        }

    def get_media(self, *, user_id: int, media_id: str) -> MediaBlob:
        with self.repository.connect() as db:
            row = db.execute(
                "SELECT * FROM media_blobs WHERE id=? AND user_id=?",
                (media_id, user_id),
            ).fetchone()
        if row is None:
            raise KeyError("media_not_found")
        data = bytes(row["original_bytes"])
        digest = hashlib.sha256(data).hexdigest()
        if not secrets.compare_digest(digest, str(row["sha256"])):
            raise BlobIntegrityError("media_sha256_mismatch")
        return MediaBlob(
            id=str(row["id"]), user_id=int(row["user_id"]), draft_id=str(row["draft_id"]),
            filename=str(row["filename"]), mime_type=str(row["mime_type"]),
            sha256=str(row["sha256"]), data=data,
        )

    def replacement_history(self, *, user_id: int, media_id: str) -> list[dict[str, Any]]:
        self.get_media(user_id=user_id, media_id=media_id)
        history: list[dict[str, Any]] = []
        current = media_id
        with self.repository.connect() as db:
            while True:
                row = db.execute(
                    """SELECT previous_media_id,created_at FROM media_replacements
                       WHERE new_media_id=? AND user_id=?""",
                    (current, user_id),
                ).fetchone()
                if row is None:
                    break
                previous = self.get_media(user_id=user_id, media_id=str(row["previous_media_id"]))
                history.append({
                    "id": previous.id, "filename": previous.filename, "mime_type": previous.mime_type,
                    "sha256": previous.sha256, "size": len(previous.data), "replaced_at": row["created_at"],
                })
                current = previous.id
        return history

    def restore_media_version(self, *, user_id: int, media_id: str, version_id: str) -> dict[str, Any]:
        current = self.get_media(user_id=user_id, media_id=media_id)
        candidates = {item["id"] for item in self.replacement_history(user_id=user_id, media_id=media_id)}
        if version_id not in candidates:
            raise ValueError("media_version_is_not_in_history")
        selected = self.get_media(user_id=user_id, media_id=version_id)
        if selected.draft_id != current.draft_id:
            raise ValueError("media_version_does_not_belong_to_draft")
        return self.store_media(
            user_id=user_id,
            draft_id=current.draft_id,
            filename=selected.filename,
            mime_type=selected.mime_type,
            data=selected.data,
            replaces_media_id=current.id,
        )

    def clone_draft_media(self, *, user_id: int, source_draft_id: str, target_draft_id: str) -> dict[str, str]:
        self.repository.get_draft(source_draft_id, user_id=user_id)
        self.repository.get_draft(target_draft_id, user_id=user_id)
        with self.repository.connect() as db:
            rows = db.execute(
                "SELECT id FROM media_blobs WHERE user_id=? AND draft_id=? ORDER BY created_at",
                (user_id, source_draft_id),
            ).fetchall()
        mapping: dict[str, str] = {}
        for row in rows:
            source = self.get_media(user_id=user_id, media_id=str(row["id"]))
            copied = self.store_media(
                user_id=user_id,
                draft_id=target_draft_id,
                filename=source.filename,
                mime_type=source.mime_type,
                data=source.data,
            )
            mapping[source.id] = str(copied["id"])
        return mapping

    def create_public_link(self, *, user_id: int, media_id: str, public_base_url: str) -> dict[str, str]:
        self.get_media(user_id=user_id, media_id=media_id)
        token = secrets.token_urlsafe(32)
        with self.repository.connect() as db:
            db.execute(
                "INSERT INTO public_blob_links(token,media_id,user_id,created_at,revoked_at) VALUES(?,?,?,?,NULL)",
                (token, media_id, user_id, _now()),
            )
        base = public_base_url.rstrip("/")
        return {"token": token, "url": f"{base}/public/media/{token}"}

    def revoke_public_links(self, *, user_id: int, media_id: str) -> None:
        self.get_media(user_id=user_id, media_id=media_id)
        with self.repository.connect() as db:
            db.execute(
                "UPDATE public_blob_links SET revoked_at=? WHERE user_id=? AND media_id=? AND revoked_at IS NULL",
                (_now(), user_id, media_id),
            )

    def get_public_media(self, token: str) -> MediaBlob:
        with self.repository.connect() as db:
            row = db.execute(
                """SELECT m.* FROM public_blob_links p
                   JOIN media_blobs m ON m.id=p.media_id
                   WHERE p.token=? AND p.revoked_at IS NULL""",
                (token,),
            ).fetchone()
        if row is None:
            raise KeyError("public_media_not_found")
        data = bytes(row["original_bytes"])
        digest = hashlib.sha256(data).hexdigest()
        if not secrets.compare_digest(digest, str(row["sha256"])):
            raise BlobIntegrityError("media_sha256_mismatch")
        # The database keeps the exact upload MIME string. The anonymous HTTP
        # response receives only a valid type/subtype; response policy then
        # decides whether that base type is safe to render inline.
        public_mime = _http_media_type(str(row["mime_type"]))
        return MediaBlob(
            id=str(row["id"]), user_id=int(row["user_id"]), draft_id=str(row["draft_id"]),
            filename=str(row["filename"]), mime_type=public_mime,
            sha256=str(row["sha256"]), data=data,
        )

    def create_location_request(self, *, user_id: int, draft_id: str) -> dict[str, Any]:
        self.repository.get_draft(draft_id, user_id=user_id)
        request_id = str(uuid4())
        now = _now()
        with self.repository.connect() as db:
            db.execute(
                "INSERT INTO location_requests(id,user_id,draft_id,status,created_at) VALUES(?,?,?,?,?)",
                (request_id, user_id, draft_id, "pending", now),
            )
        return {"id": request_id, "draft_id": draft_id, "status": "pending", "created_at": now}

    def fulfill_latest_location(
        self,
        *,
        user_id: int,
        latitude: float,
        longitude: float,
        name: str | None = None,
        address: str | None = None,
    ) -> dict[str, Any] | None:
        with self.repository.connect() as db:
            row = db.execute(
                """SELECT * FROM location_requests
                   WHERE user_id=? AND status='pending'
                   ORDER BY created_at DESC LIMIT 1""",
                (user_id,),
            ).fetchone()
            if row is None:
                return None
            fulfilled = _now()
            db.execute(
                """UPDATE location_requests SET status='fulfilled',latitude=?,longitude=?,name=?,address=?,fulfilled_at=?
                   WHERE id=? AND user_id=? AND status='pending'""",
                (float(latitude), float(longitude), name, address, fulfilled, row["id"], user_id),
            )
        return self.get_location_request(user_id=user_id, request_id=str(row["id"]))

    def get_location_request(self, *, user_id: int, request_id: str) -> dict[str, Any]:
        with self.repository.connect() as db:
            row = db.execute(
                "SELECT * FROM location_requests WHERE id=? AND user_id=?",
                (request_id, user_id),
            ).fetchone()
        if row is None:
            raise KeyError("location_request_not_found")
        return dict(row)
