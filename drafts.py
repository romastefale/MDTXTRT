"""Rascunhos persistentes integrais, com revisão e mídia vinculada ao Telegram user.id."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import sqlite3
import time
from contextlib import closing
from contextvars import ContextVar
from pathlib import Path

from aiohttp import web

MAX_DRAFT_BYTES = 1_048_576
MEDIA_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
LOCAL_MEDIA_ID_RE = re.compile(
    r"mdtxtrt://(?:media|photo|video|audio|voice|animation|document)/([A-Za-z0-9_-]+)",
    re.IGNORECASE,
)
MEDIA_SESSION_COOKIE = "mdtxtrt_media_session"

_BASE = None
_ORIGINAL_API_MEDIA = None
_ORIGINAL_BUILD_RICH_MESSAGE = None
_ORIGINAL_DISPATCH_USER_ARTIFACTS = None
_ORIGINAL_START = None
_MEDIA_OWNER: ContextVar[int | None] = ContextVar("mdtxtrt_media_owner", default=None)


class DraftConflict(RuntimeError):
    def __init__(self, current: dict):
        super().__init__("Rascunho desatualizado.")
        self.current = current


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
                updated_at INTEGER NOT NULL,
                updated_at_ms INTEGER NOT NULL DEFAULT 0,
                revision INTEGER NOT NULL DEFAULT 0
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
        if "updated_at_ms" not in columns:
            connection.execute(
                "ALTER TABLE drafts ADD COLUMN updated_at_ms INTEGER NOT NULL DEFAULT 0"
            )
        if "revision" not in columns:
            connection.execute(
                "ALTER TABLE drafts ADD COLUMN revision INTEGER NOT NULL DEFAULT 0"
            )
        connection.execute(
            "UPDATE drafts SET updated_at_ms = updated_at * 1000 WHERE updated_at_ms = 0"
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
        connection.commit()
        return connection

    @staticmethod
    def _draft_from_row(row) -> dict:
        if not row:
            return {
                "content": "",
                "title": "",
                "updated_at": None,
                "updated_at_ms": None,
                "revision": 0,
            }
        return {
            "content": row[0],
            "title": row[1],
            "updated_at": int(row[2]),
            "updated_at_ms": int(row[3]),
            "revision": int(row[4]),
        }

    def load(self, telegram_user_id: int) -> dict | None:
        with closing(self._connect()) as connection:
            row = connection.execute(
                """
                SELECT content, title, updated_at, updated_at_ms, revision
                FROM drafts WHERE telegram_user_id = ?
                """,
                (int(telegram_user_id),),
            ).fetchone()
        if not row:
            return None
        return self._draft_from_row(row)

    def save(
        self,
        telegram_user_id: int,
        content: str,
        title: str = "",
        *,
        base_revision: int | None = None,
    ) -> dict:
        durable = durable_draft_content(content)
        if len(durable.encode("utf-8")) > MAX_DRAFT_BYTES:
            raise ValueError("Rascunho acima de 1 MB.")
        clean_title = str(title or "")[:512]
        user_id = int(telegram_user_id)

        with closing(self._connect()) as connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                """
                SELECT content, title, updated_at, updated_at_ms, revision
                FROM drafts WHERE telegram_user_id = ?
                """,
                (user_id,),
            ).fetchone()
            current = self._draft_from_row(row)
            current_revision = int(current["revision"])
            if base_revision is not None and int(base_revision) != current_revision:
                connection.rollback()
                raise DraftConflict(current)

            revision = current_revision + 1
            updated_at_ms = int(time.time_ns() // 1_000_000)
            updated_at = updated_at_ms // 1000
            connection.execute(
                """
                INSERT INTO drafts
                    (telegram_user_id, content, title, updated_at, updated_at_ms, revision)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(telegram_user_id) DO UPDATE SET
                    content = excluded.content,
                    title = excluded.title,
                    updated_at = excluded.updated_at,
                    updated_at_ms = excluded.updated_at_ms,
                    revision = excluded.revision
                """,
                (
                    user_id,
                    durable,
                    clean_title,
                    updated_at,
                    updated_at_ms,
                    revision,
                ),
            )
            connection.commit()

        return {
            "content": durable,
            "title": clean_title,
            "updated_at": updated_at,
            "updated_at_ms": updated_at_ms,
            "revision": revision,
        }

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

    def media_owner(self, media_id: str) -> int | None:
        media_id = str(media_id or "").strip()
        if not MEDIA_ID_RE.fullmatch(media_id):
            return None
        with closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT telegram_user_id FROM draft_media WHERE media_id = ?",
                (media_id,),
            ).fetchone()
        return int(row[0]) if row else None

    def load_media(self, media_id: str, telegram_user_id: int) -> dict | None:
        media_id = str(media_id or "").strip()
        if not MEDIA_ID_RE.fullmatch(media_id):
            return None
        user_id = int(telegram_user_id)
        with closing(self._connect()) as connection:
            row = connection.execute(
                """
                SELECT telegram_user_id, name, mime, kind, relative_path, size, created_at
                FROM draft_media
                WHERE media_id = ? AND telegram_user_id = ?
                """,
                (media_id, user_id),
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
_MEDIA_DIR = os.environ.get("DRAFT_MEDIA_DIR") or str(
    Path(_DB_PATH).parent / "mdtxtrt-media"
)
STORE = DraftStore(_DB_PATH, _MEDIA_DIR)


def install(base_module) -> None:
    global _BASE, _ORIGINAL_API_MEDIA, _ORIGINAL_BUILD_RICH_MESSAGE
    global _ORIGINAL_DISPATCH_USER_ARTIFACTS, _ORIGINAL_START
    _BASE = base_module
    if _ORIGINAL_API_MEDIA is None and base_module.api_media is not api_media:
        _ORIGINAL_API_MEDIA = base_module.api_media
    if (
        _ORIGINAL_BUILD_RICH_MESSAGE is None
        and base_module.build_rich_message is not build_rich_message
    ):
        _ORIGINAL_BUILD_RICH_MESSAGE = base_module.build_rich_message
    if (
        _ORIGINAL_DISPATCH_USER_ARTIFACTS is None
        and base_module.dispatch_user_artifacts is not dispatch_user_artifacts
    ):
        _ORIGINAL_DISPATCH_USER_ARTIFACTS = base_module.dispatch_user_artifacts
    if _ORIGINAL_START is None and base_module.start is not start:
        _ORIGINAL_START = base_module.start

    base_module.api_media = api_media
    base_module.build_rich_message = build_rich_message
    base_module.serve_media = serve_media
    base_module.dispatch_user_artifacts = dispatch_user_artifacts
    base_module.api_stash = api_stash
    base_module.start = start


def _validated_user(data: dict, request: web.Request):
    if _BASE is None:
        raise RuntimeError("drafts.install() não foi executado")
    raw = _BASE.init_data_from_request(data, request)
    user = _BASE.validate_init_data(raw)
    return raw, user


def _cookie_secret() -> bytes:
    if _BASE is None:
        return b""
    return str(getattr(_BASE, "TOKEN", "") or "").encode("utf-8")


def _media_cookie_value(telegram_user_id: int) -> str:
    user_id = int(telegram_user_id)
    signature = hmac.new(
        _cookie_secret(),
        f"media:{user_id}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    return f"{user_id}.{signature}"


def _media_cookie_user(request: web.Request) -> int | None:
    raw = str(request.cookies.get(MEDIA_SESSION_COOKIE) or "")
    try:
        user_text, signature = raw.split(".", 1)
        user_id = int(user_text)
    except (ValueError, TypeError):
        return None
    expected = _media_cookie_value(user_id)
    if not expected or not hmac.compare_digest(expected, raw):
        return None
    return user_id


def _set_media_cookie(response: web.StreamResponse, telegram_user_id: int) -> None:
    if not _cookie_secret():
        return
    response.set_cookie(
        MEDIA_SESSION_COOKIE,
        _media_cookie_value(int(telegram_user_id)),
        max_age=48 * 3600,
        httponly=True,
        secure=True,
        samesite="Strict",
        path="/",
    )


def _rehydrate_media(content: str) -> None:
    if _BASE is None:
        return
    refs = local_media_ids(content)
    if not refs:
        return
    owner_id = _MEDIA_OWNER.get()
    if owner_id is None:
        raise ValueError("Mídia local sem usuário autenticado.")

    now = time.time()
    for media_id in refs:
        current = _BASE.MEDIA.get(media_id)
        if (
            current
            and current.get("exp", 0) >= now
            and int(current.get("telegram_user_id") or 0) == int(owner_id)
        ):
            continue
        persisted = STORE.load_media(media_id, int(owner_id))
        if not persisted:
            raise ValueError(
                f"Mídia local {media_id} indisponível para este usuário."
            )
        _BASE.MEDIA[media_id] = persisted


def build_rich_message(content: str):
    if _ORIGINAL_BUILD_RICH_MESSAGE is None:
        raise RuntimeError("build_rich_message persistente não instalado")
    _rehydrate_media(content)
    return _ORIGINAL_BUILD_RICH_MESSAGE(content)


async def dispatch_user_artifacts(bot, chat_id, title: str, content: str):
    if _ORIGINAL_DISPATCH_USER_ARTIFACTS is None:
        raise RuntimeError("dispatch_user_artifacts persistente não instalado")
    existing_owner = _MEDIA_OWNER.get()
    token = None
    if existing_owner is None:
        try:
            token = _MEDIA_OWNER.set(int(chat_id))
        except (TypeError, ValueError):
            token = None
    try:
        return await _ORIGINAL_DISPATCH_USER_ARTIFACTS(bot, chat_id, title, content)
    finally:
        if token is not None:
            _MEDIA_OWNER.reset(token)


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
        raw = _BASE.init_data_from_request(post, request)
        user = _BASE.validate_init_data(raw)
        item = _BASE.MEDIA.get(media_id)
        if not user or not user.get("id") or not item:
            raise RuntimeError("upload validado sem estado de mídia correspondente")
        user_id = int(user["id"])
        item["telegram_user_id"] = user_id
        STORE.save_media(user_id, media_id, item)
        _set_media_cookie(response, user_id)
    except Exception:
        media_id = locals().get("media_id") or ""
        if media_id:
            _BASE.MEDIA.pop(media_id, None)
        _BASE.log.exception("persistência de mídia do rascunho")
        return web.json_response(
            {"ok": False, "error": "Não foi possível persistir a mídia do rascunho."},
            status=500,
        )
    return response


async def serve_media(request: web.Request):
    if _BASE is None:
        raise RuntimeError("serve_media persistente não instalado")
    user_id = _media_cookie_user(request)
    if user_id is None:
        return web.Response(text="Mídia não autorizada", status=401)

    _BASE.purge_stash()
    media_id = (request.match_info.get("mid") or "").strip()
    current = _BASE.MEDIA.get(media_id)
    if not (
        current
        and current.get("exp", 0) >= time.time()
        and int(current.get("telegram_user_id") or 0) == user_id
    ):
        persisted = STORE.load_media(media_id, user_id)
        if not persisted:
            return web.Response(text="Mídia indisponível", status=404)
        _BASE.MEDIA[media_id] = persisted
        current = persisted

    return web.Response(
        body=current["data"],
        content_type=current.get("mime") or "application/octet-stream",
        headers={"Cache-Control": "private, max-age=60"},
    )


async def api_draft_load(request: web.Request):
    try:
        data = await request.json()
    except Exception:
        data = {}
    raw, user = _validated_user(data, request)
    if not user or not user.get("id"):
        return _BASE.session_error(raw)
    user_id = int(user["id"])
    draft = STORE.load(user_id)
    payload = (
        draft
        if draft
        else {
            "content": "",
            "title": "",
            "updated_at": None,
            "updated_at_ms": None,
            "revision": 0,
        }
    )
    response = web.json_response({"ok": True, **payload})
    _set_media_cookie(response, user_id)
    return response


async def api_draft_save(request: web.Request):
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "JSON inválido"}, status=400)
    raw, user = _validated_user(data, request)
    if not user or not user.get("id"):
        return _BASE.session_error(raw)

    user_id = int(user["id"])
    try:
        base_revision = int(data.get("base_revision"))
    except (TypeError, ValueError):
        base_revision = -1

    try:
        draft = STORE.save(
            user_id,
            data.get("content") or "",
            data.get("title") or "",
            base_revision=base_revision,
        )
    except DraftConflict as exc:
        response = web.json_response(
            {
                "ok": False,
                "error": "Rascunho desatualizado.",
                "conflict": True,
                "current": exc.current,
            },
            status=409,
        )
        _set_media_cookie(response, user_id)
        return response
    except ValueError as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=413)

    response = web.json_response({"ok": True, **draft})
    _set_media_cookie(response, user_id)
    return response


async def api_stash(request: web.Request):
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "JSON inválido"}, status=400)

    content = (data.get("content") or "").strip()
    if not content:
        return web.json_response({"ok": False, "error": "Documento vazio"}, status=400)
    if len(content.encode("utf-8")) > _BASE.MAX_DOC_BYTES:
        return web.json_response(
            {"ok": False, "error": "Documento acima de 1 MB"}, status=413
        )

    owner_id = None
    refs = local_media_ids(content)
    if refs:
        owners = [STORE.media_owner(media_id) for media_id in refs]
        if any(owner is None for owner in owners):
            return web.json_response(
                {
                    "ok": False,
                    "error": "O documento contém mídia local indisponível.",
                },
                status=409,
            )
        unique_owners = set(owners)
        if len(unique_owners) != 1:
            return web.json_response(
                {
                    "ok": False,
                    "error": "O documento mistura mídias de usuários diferentes.",
                },
                status=403,
            )
        owner_id = int(next(iter(unique_owners)))

    action = (data.get("action") or "chat").strip().lower()
    if action not in {"chat", "mdrich", "tgrich", "markdown"}:
        action = "chat"
    if action in {"tgrich", "markdown"}:
        action = "chat"

    username = request.app.get("bot_username") or ""
    if not username:
        return web.json_response(
            {
                "ok": False,
                "error": "Bot ainda a arrancar. Toca outra vez dentro de instantes.",
            },
            status=503,
        )

    code = _BASE.new_stash_code()
    _BASE.STASH[code] = {
        "action": action,
        "title": (data.get("title") or "Sem título").strip() or "Sem título",
        "content": content,
        "telegram_user_id": owner_id,
        "exp": time.time() + _BASE.STASH_TTL,
    }
    prefix = "m" if action == "mdrich" else "c"
    start_param = f"{prefix}{code}"
    url = f"https://t.me/{username}?start={start_param}"
    return web.json_response(
        {"ok": True, "start": start_param, "url": url, "bot": username}
    )


async def start(message, bot, command):
    if _ORIGINAL_START is None:
        raise RuntimeError("start persistente não instalado")

    arg = ((command.args or "").split()[0] if command.args else "").strip()
    if not arg:
        return await _ORIGINAL_START(message, bot, command)

    kind = arg[0]
    code = arg[1:]
    item = _BASE.STASH.get(code)
    if not item or item.get("exp", 0) < time.time():
        _BASE.STASH.pop(code, None)
        await _BASE.reply_text(
            message,
            bot,
            "Este envio já foi usado ou expirou. Abre o Mini App e toca outra vez.",
            reply_markup=_BASE.mini_app_markup(),
        )
        return

    expected_owner = item.get("telegram_user_id")
    opener = getattr(getattr(message, "from_user", None), "id", None)
    if expected_owner is not None and int(opener or 0) != int(expected_owner):
        await _BASE.reply_text(
            message,
            bot,
            "Este envio pertence a outro usuário.",
            reply_markup=_BASE.mini_app_markup(),
        )
        return

    action = (
        "mdrich"
        if kind == "m" or item.get("action") == "mdrich"
        else "chat"
    )
    token = _MEDIA_OWNER.set(
        int(expected_owner)
        if expected_owner is not None
        else int(opener or message.chat.id)
    )
    try:
        await _BASE.deliver_payload(
            bot,
            message.chat.id,
            action,
            item.get("title") or "Sem título",
            item.get("content") or "",
        )
    except _BASE.TelegramAPIError as exc:
        await _BASE.reply_text(message, bot, _BASE.telegram_error_text(exc))
        return
    except ValueError as exc:
        await _BASE.reply_text(
            message,
            bot,
            str(exc),
            reply_markup=_BASE.mini_app_markup(),
        )
        return
    finally:
        _MEDIA_OWNER.reset(token)

    _BASE.STASH.pop(code, None)
