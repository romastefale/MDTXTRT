"""Resolve user pelo MTProto. Opcional."""

from __future__ import annotations

import logging
import os

log = logging.getLogger("user_info.mt")

API_ID = int(os.environ.get("TELEGRAM_API_ID") or "0")
API_HASH = (os.environ.get("TELEGRAM_API_HASH") or "").strip()
SESSION = (os.environ.get("TELEGRAM_SESSION") or "user_info").strip() or "user_info"

_client = None


def enabled() -> bool:
    return bool(API_ID and API_HASH)


async def start():
    global _client
    if not enabled():
        log.info("MTProto desligado (sem TELEGRAM_API_ID/HASH)")
        return None
    from telethon import TelegramClient

    _client = TelegramClient(SESSION, API_ID, API_HASH)
    await _client.start()
    me = await _client.get_me()
    log.info("MTProto ok: %s", getattr(me, "username", None) or me.id)
    return _client


async def stop():
    global _client
    if _client:
        await _client.disconnect()
        _client = None


async def resolve(username: str | None, user_id: int | None) -> dict:
    out = {"id": user_id, "username": username, "name": "", "bio": ""}
    if _client is None:
        return out
    target = user_id if user_id is not None else (username or None)
    if target is None:
        return out
    try:
        ent = await _client.get_entity(target)
    except Exception as exc:
        log.info("get_entity falhou (%s): %s", target, exc)
        return out
    out["id"] = getattr(ent, "id", user_id)
    out["username"] = getattr(ent, "username", None) or username
    first = getattr(ent, "first_name", None) or ""
    last = getattr(ent, "last_name", None) or ""
    title = getattr(ent, "title", None) or ""
    out["name"] = " ".join(p for p in [first, last] if p) or title
    try:
        full = await _client.get_entity(ent)
        about = getattr(getattr(full, "full_user", None), "about", None)
        if not about:
            from telethon.tl.functions.users import GetFullUserRequest
            from telethon.tl.functions.channels import GetFullChannelRequest

            if getattr(ent, "broadcast", False) or getattr(ent, "megagroup", False):
                full = await _client(GetFullChannelRequest(ent))
                about = getattr(getattr(full, "full_chat", None), "about", None)
            else:
                full = await _client(GetFullUserRequest(ent))
                about = getattr(getattr(full, "full_user", None), "about", None)
        out["bio"] = (about or "").strip()
    except Exception as exc:
        log.info("bio MTProto falhou: %s", exc)
    return out
