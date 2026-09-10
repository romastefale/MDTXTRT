"""Per-user conversion preferences for explicit, reversible format decisions.

Preferences are advisory defaults only. They never mutate a document or publish
without the same explicit action required when no preference exists.
"""
from __future__ import annotations

from datetime import datetime, timezone
import json
from typing import Any

from aiohttp import web

from mdtxtrt.auth import validate_init_data
from mdtxtrt.config import Settings
from mdtxtrt.storage import SQLiteRepository

_ALLOWED_KEYS = {
    "telegram_representation",
    "table_to_text",
    "table_to_telegraph",
    "details_fallback",
    "button_fallback",
    "heading_fallback",
    "map_fallback",
    "media_text_fallback",
}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class PreferenceStore:
    def __init__(self, repository: SQLiteRepository):
        self.repository = repository

    def initialize(self) -> None:
        with self.repository.connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS user_conversion_preferences (
                    user_id INTEGER NOT NULL,
                    preference_key TEXT NOT NULL,
                    value_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY(user_id, preference_key)
                );
            """)

    def list(self, *, user_id: int) -> dict[str, Any]:
        with self.repository.connect() as db:
            rows = db.execute(
                "SELECT preference_key,value_json FROM user_conversion_preferences WHERE user_id=? ORDER BY preference_key",
                (user_id,),
            ).fetchall()
        return {str(row["preference_key"]): json.loads(str(row["value_json"])) for row in rows}

    def set(self, *, user_id: int, key: str, value: Any) -> None:
        clean_key = str(key).strip()
        if clean_key not in _ALLOWED_KEYS:
            raise ValueError("unsupported_conversion_preference")
        encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        if len(encoded.encode("utf-8")) > 4096:
            raise ValueError("conversion_preference_too_large")
        with self.repository.connect() as db:
            db.execute(
                """INSERT INTO user_conversion_preferences(user_id,preference_key,value_json,updated_at)
                   VALUES(?,?,?,?)
                   ON CONFLICT(user_id,preference_key) DO UPDATE SET
                     value_json=excluded.value_json,updated_at=excluded.updated_at""",
                (user_id, clean_key, encoded, _now()),
            )

    def clear(self, *, user_id: int, key: str) -> None:
        clean_key = str(key).strip()
        if clean_key not in _ALLOWED_KEYS:
            raise ValueError("unsupported_conversion_preference")
        with self.repository.connect() as db:
            db.execute(
                "DELETE FROM user_conversion_preferences WHERE user_id=? AND preference_key=?",
                (user_id, clean_key),
            )


def _identity(request: web.Request):
    settings: Settings = request.app["settings"]
    return validate_init_data(
        request.headers.get("X-Telegram-Init-Data", ""),
        bot_token=settings.telegram_token,
        ttl_seconds=settings.init_data_ttl_seconds,
    )


async def list_preferences(request: web.Request) -> web.Response:
    identity = _identity(request)
    store: PreferenceStore = request.app["preferences"]
    return web.json_response({"ok": True, "preferences": store.list(user_id=identity.user_id)})


async def set_preference(request: web.Request) -> web.Response:
    identity = _identity(request)
    payload = await request.json()
    store: PreferenceStore = request.app["preferences"]
    key = request.match_info["key"]
    store.set(user_id=identity.user_id, key=key, value=payload.get("value"))
    return web.json_response({"ok": True, "preferences": store.list(user_id=identity.user_id)})


async def clear_preference(request: web.Request) -> web.Response:
    identity = _identity(request)
    store: PreferenceStore = request.app["preferences"]
    store.clear(user_id=identity.user_id, key=request.match_info["key"])
    return web.json_response({"ok": True, "preferences": store.list(user_id=identity.user_id)})


def attach_preference_routes(app: web.Application, store: PreferenceStore) -> None:
    app["preferences"] = store
    app.router.add_get("/api/preferences/conversion", list_preferences)
    app.router.add_put("/api/preferences/conversion/{key}", set_preference)
    app.router.add_delete("/api/preferences/conversion/{key}", clear_preference)
