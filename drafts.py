"""Rascunhos textuais persistentes, isolados por Telegram user.id."""

from __future__ import annotations

import os
import re
import sqlite3
import time
from contextlib import closing
from pathlib import Path

from aiohttp import web

MAX_DRAFT_BYTES = 1_048_576
LOCAL_MEDIA_RE = re.compile(
    r'!\[[^\]\r\n]*\]\(\s*mdtxtrt://(?:media|photo|video|audio|voice|animation|document)/'
    r'[A-Za-z0-9_-]+(?:\s+"[^"\r\n]*")?\s*\)',
    re.IGNORECASE,
)

_BASE = None


def durable_draft_content(content: str) -> str:
    """Remove somente referências a uploads locais efêmeros do texto persistido."""
    return LOCAL_MEDIA_RE.sub("", str(content or ""))


class DraftStore:
    def __init__(self, path: str):
        self.path = path

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
                updated_at INTEGER NOT NULL
            )
            """
        )
        return connection

    def load(self, telegram_user_id: int) -> dict | None:
        with closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT content, updated_at FROM drafts WHERE telegram_user_id = ?",
                (int(telegram_user_id),),
            ).fetchone()
        if not row:
            return None
        return {"content": row[0], "updated_at": int(row[1])}

    def save(self, telegram_user_id: int, content: str) -> dict:
        durable = durable_draft_content(content)
        if len(durable.encode("utf-8")) > MAX_DRAFT_BYTES:
            raise ValueError("Rascunho acima de 1 MB.")
        updated_at = int(time.time())
        with closing(self._connect()) as connection:
            with connection:
                connection.execute(
                    """
                    INSERT INTO drafts (telegram_user_id, content, updated_at)
                    VALUES (?, ?, ?)
                    ON CONFLICT(telegram_user_id) DO UPDATE SET
                        content = excluded.content,
                        updated_at = excluded.updated_at
                    """,
                    (int(telegram_user_id), durable, updated_at),
                )
        return {"content": durable, "updated_at": updated_at}


STORE = DraftStore(os.environ.get("DRAFT_DB_PATH", "/data/mdtxtrt-drafts.sqlite3"))


def install(base_module) -> None:
    global _BASE
    _BASE = base_module


def _validated_user(data: dict, request: web.Request):
    if _BASE is None:
        raise RuntimeError("drafts.install() não foi executado")
    raw = _BASE.init_data_from_request(data, request)
    user = _BASE.validate_init_data(raw)
    return raw, user


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
        return web.json_response({"ok": True, "content": "", "updated_at": None})
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
        draft = STORE.save(int(user["id"]), data.get("content") or "")
    except ValueError as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=413)
    return web.json_response({"ok": True, **draft})
