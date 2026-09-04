"""Rascunhos persistentes integrais, isolados por Telegram user.id."""

from __future__ import annotations

import json
import os
import re
import sqlite3
import time
from contextlib import closing
from pathlib import Path

from aiohttp import web

MAX_DRAFT_BYTES = 1_048_576
MEDIA_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
LOCAL_MEDIA_ID_RE = re.compile(
    r"mdtxtrt://(?:media|photo|video|audio|voice|animation|document)/([A-Za-z0-9_-]+)",
    re.IGNORECASE,
)

_BASE = None
_ORIGINAL_API_MEDIA = None
_ORIGINAL_BUILD_RICH_MESSAGE = None
_ORIGINAL_SERVE_MEDIA = None


def durable_draft_content(content: str) -> str:
    """O estado durável preserva integralmente o documento, inclusive refs de mídia local."""
    return str(content or "")


def local_media_ids(content: str) -> list[str]:
    return list(dict.fromkeys(LOCAL_MEDIA_ID_RE.findall(str(content or ""))))


class DraftStore:
    def __init__(self, path: str, media_dir: str | None = None):
        self.path = path
        base = Path(path).parent
        self.media_dir = Path(media_dir) if media_dir else base / "mdtxtrt-media"

    def _connect(self) -> sqlite3.Connection:
        path = Path(self.path)
        path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(path, timeout=5)
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("PRAGMA synchronous=NORMAL")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS drafts (
                telegram_user_id INTEGER PRIMARY KEY,
                content TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                updated_at INTEGER NOT NULL
            )
            """
        )
        columns = {
            row[1]
            for row in connection.execute("PRAGMA table_info(drafts)").fetchall()
        }
        if "title" not in columns:
            connection.execute(
                "ALTER TABLE drafts ADD COLUMN title TEXT NOT NULL DEFAULT ''"
            )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS draft_media (
                media_id TEXT PRIMARY KEY,
                telegram_user_id INTEGER NOT NULL,
                name TEXT NOT NULL,
                mime TEXT NOT NULL,
                kind TEXT NOT NULL,
                relative_path TEXT NOT NULL,
                size INTEGER NOT NULL,
                created_at INTEGER NOT NULL
            )
            """
        )
        return connection

    def load(self, telegram_user_id: int) -> dict | None:
        with closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT content, title, updated_at FROM drafts WHERE telegram_user_id = ?",
                (int(telegram_user_id),),
            ).fetchone()
        if not row:
            return None
        return {"content": row[0], "title": row[1], "updated_at": int(row[2])}

    def save(self, telegram_user_id: int, content: str, title: str = "") -> dict:
        durable = durable_draft_content(content)
        if len(durable.encode("utf-8")) > MAX_DRAFT_BYTES:
            raise ValueError("Rascunho acima de 1 MB.")
        clean_title = str(title or "")[:512]
        updated_at = int(time.time())
        with closing(self._connect()) as connection:
            with connection:
                connection.execute(
                    """
                    INSERT INTO drafts (telegram_user_id, content, title, updated_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(telegram_user_id) DO UPDATE SET
                        content = excluded.content,
                        title = excluded.title,
                        updated_at = excluded.updated_at
                    """,
                    (int(telegram_user_id), durable, clean_title, updated_at),
                )
        return {"content": durable, "title": clean_title, "updated_at": updated_at}

    def save_media(self, telegram_user_id: int, media_id: str, item: dict) -> dict:
        media_id = str(media_id or "").strip()
        if not MEDIA_ID_RE.fullmatch(media_id):
            raise ValueError("Identificador de mídia inválido.")
        raw = item.get("data")
        if not isinstance(raw, (bytes, bytearray)) or not raw:
            raise ValueError("Mídia vazia.")
        raw = bytes(raw)
        user_id = int(telegram_user_id)
        name = str(item.get("name") or f"{media_id}.bin")[:512]
        mime = str(item.get("mime") or "application/octet-stream")[:255]
        kind = str(item.get("kind") or "document")[:32]

        with closing(self._connect()) as connection:
            existing = connection.execute(
                "SELECT 1 FROM draft_media WHERE media_id = ?", (media_id,)
            ).fetchone()
        if existing:
            raise ValueError("Identificador de mídia já existe; refaça o upload.")

        user_dir = self.media_dir / str(user_id)
        user_dir.mkdir(parents=True, exist_ok=True)
        target = user_dir / f"{media_id}.bin"
        temporary = user_dir / f".{media_id}.tmp"
        with open(temporary, "wb") as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, target)
        relative_path = f"{user_id}/{media_id}.bin"
        created_at = int(time.time())
        try:
            with closing(self._connect()) as connection:
                with connection:
                    connection.execute(
                        """
                        INSERT INTO draft_media
                            (media_id, telegram_user_id, name, mime, kind, relative_path, size, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            media_id,
                            user_id,
                            name,
                            mime,
                            kind,
                            relative_path,
                            len(raw),
                            created_at,
                        ),
                    )
        except Exception:
            try:
                target.unlink()
            except FileNotFoundError:
                pass
            raise
        return {
            "id": media_id,
            "telegram_user_id": user_id,
            "name": name,
            "mime": mime,
            "kind": kind,
            "size": len(raw),
            "created_at": created_at,
        }

    def load_media(self, media_id: str) -> dict | None:
        media_id = str(media_id or "").strip()
        if not MEDIA_ID_RE.fullmatch(media_id):
            return None
        with closing(self._connect()) as connection:
            row = connection.execute(
                """
                SELECT telegram_user_id, name, mime, kind, relative_path, size, created_at
                FROM draft_media WHERE media_id = ?
                """,
                (media_id,),
            ).fetchone()
        if not row:
            return None
        root = self.media_dir.resolve()
        target = (self.media_dir / row[4]).resolve()
        try:
            target.relative_to(root)
        except ValueError:
            return None
        try:
            raw = target.read_bytes()
        except FileNotFoundError:
            return None
        if len(raw) != int(row[5]):
            return None
        return {
            "data": raw,
            "name": row[1],
            "mime": row[2],
            "kind": row[3],
            "telegram_user_id": int(row[0]),
            "created_at": int(row[6]),
            "exp": time.time() + 3600,
        }


_DB_PATH = os.environ.get("DRAFT_DB_PATH", "/data/mdtxtrt-drafts.sqlite3")
_MEDIA_DIR = os.environ.get("DRAFT_MEDIA_DIR") or str(Path(_DB_PATH).parent / "mdtxtrt-media")
STORE = DraftStore(_DB_PATH, _MEDIA_DIR)


def install(base_module) -> None:
    global _BASE, _ORIGINAL_API_MEDIA, _ORIGINAL_BUILD_RICH_MESSAGE, _ORIGINAL_SERVE_MEDIA
    _BASE = base_module
    if _ORIGINAL_API_MEDIA is None and base_module.api_media is not api_media:
        _ORIGINAL_API_MEDIA = base_module.api_media
    if _ORIGINAL_BUILD_RICH_MESSAGE is None and base_module.build_rich_message is not build_rich_message:
        _ORIGINAL_BUILD_RICH_MESSAGE = base_module.build_rich_message
    if _ORIGINAL_SERVE_MEDIA is None and base_module.serve_media is not serve_media:
        _ORIGINAL_SERVE_MEDIA = base_module.serve_media
    base_module.api_media = api_media
    base_module.build_rich_message = build_rich_message
    base_module.serve_media = serve_media


def _validated_user(data: dict, request: web.Request):
    if _BASE is None:
        raise RuntimeError("drafts.install() não foi executado")
    raw = _BASE.init_data_from_request(data, request)
    user = _BASE.validate_init_data(raw)
    return raw, user


def _rehydrate_media(content: str) -> None:
    if _BASE is None:
        return
    now = time.time()
    for media_id in local_media_ids(content):
        current = _BASE.MEDIA.get(media_id)
        if current and current.get("exp", 0) >= now:
            continue
        persisted = STORE.load_media(media_id)
        if persisted:
            _BASE.MEDIA[media_id] = persisted


def build_rich_message(content: str):
    if _ORIGINAL_BUILD_RICH_MESSAGE is None:
        raise RuntimeError("build_rich_message persistente não instalado")
    _rehydrate_media(content)
    return _ORIGINAL_BUILD_RICH_MESSAGE(content)


async def api_media(request: web.Request):
    if _ORIGINAL_API_MEDIA is None:
        raise RuntimeError("api_media persistente não instalada")
    response = await _ORIGINAL_API_MEDIA(request)
    if response.status >= 400:
        return response
    try:
        payload = json.loads(response.text)
        media_id = str(payload.get("id") or "")
        post = await request.post()
        raw_init = str(post.get("init_data") or "").strip()
        user = _BASE.validate_init_data(raw_init)
        item = _BASE.MEDIA.get(media_id)
        if not user or not user.get("id") or not item:
            raise RuntimeError("upload validado sem estado de mídia correspondente")
        STORE.save_media(int(user["id"]), media_id, item)
    except Exception as exc:
        media_id = locals().get("media_id") or ""
        if media_id:
            _BASE.MEDIA.pop(media_id, None)
        _BASE.log.exception("persistência de mídia do rascunho")
        return web.json_response(
            {"ok": False, "error": f"Não foi possível persistir a mídia do rascunho: {exc}"},
            status=500,
        )
    return response


async def serve_media(request: web.Request):
    if _ORIGINAL_SERVE_MEDIA is None:
        raise RuntimeError("serve_media persistente não instalado")
    media_id = (request.match_info.get("mid") or "").strip()
    current = _BASE.MEDIA.get(media_id)
    if not current or current.get("exp", 0) < time.time():
        persisted = STORE.load_media(media_id)
        if persisted:
            _BASE.MEDIA[media_id] = persisted
    return await _ORIGINAL_SERVE_MEDIA(request)


async def api_draft_load(request: web.Request):
    try:
        data = await request.json()
    except Exception:
        data = {}
    raw, user = _validated_user(data, request)
    if not user or not user.get("id"):
        return _BASE.session_error(raw)
    draft = STORE.load(int(user["id"]))
    if not draft:
        return web.json_response({"ok": True, "content": "", "title": "", "updated_at": None})
    return web.json_response({"ok": True, **draft})


async def api_draft_save(request: web.Request):
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "JSON inválido"}, status=400)
    raw, user = _validated_user(data, request)
    if not user or not user.get("id"):
        return _BASE.session_error(raw)
    try:
        draft = STORE.save(
            int(user["id"]),
            data.get("content") or "",
            data.get("title") or "",
        )
    except ValueError as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=413)
    return web.json_response({"ok": True, **draft})
