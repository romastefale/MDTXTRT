"""Seleção de localização do bloco Mapa pela DM nativa do Telegram."""
from __future__ import annotations

import secrets
import time

from aiohttp import web

_BASE = None
_TTL = 10 * 60
_PENDING: dict[str, dict] = {}
_BY_USER_CHAT: dict[tuple[int, int], str] = {}


def _purge() -> None:
    now = time.time()
    for request_id, item in list(_PENDING.items()):
        if item.get("exp", 0) >= now:
            continue
        _PENDING.pop(request_id, None)
        key = (item.get("user_id"), item.get("chat_id"))
        if _BY_USER_CHAT.get(key) == request_id:
            _BY_USER_CHAT.pop(key, None)


def _request_for_user(request_id: str, user_id: int) -> dict | None:
    _purge()
    item = _PENDING.get(str(request_id or ""))
    if not item or item.get("user_id") != user_id:
        return None
    return item


def _auth(request: web.Request, data: dict):
    raw = _BASE.init_data_from_request(data, request)
    user = _BASE.validate_init_data(raw)
    if not user or not user.get("id"):
        return None, _BASE.session_error(raw)
    return user, None


def _frame(subtitle: str, body: str) -> str:
    return f"<h1>MDTXTRT</h1>\n\n<h3>{subtitle}</h3>\n\n<p>{body}</p>"


async def _send_rich(bot, chat_id: int, subtitle: str, body: str):
    return await bot.send_rich_message(
        chat_id=chat_id,
        rich_message=_BASE.build_rich_message(_frame(subtitle, body)),
        request_timeout=60,
    )


async def api_map_request(request: web.Request):
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "JSON inválido"}, status=400)
    user, error = _auth(request, data)
    if error:
        return error
    runtime = request.app.get("bot")
    if not runtime:
        return web.json_response({"ok": False, "error": "Bot não inicializado."}, status=503)
    user_id = int(user["id"])
    chat_id = user_id
    try:
        sent = await _send_rich(
            runtime.bot,
            chat_id,
            "Mapa",
            "Selecione uma localização no Telegram e envie nesta conversa.",
        )
    except Exception:
        _BASE.log.exception("api_map_request")
        return web.json_response(
            {"ok": False, "error": "Não foi possível enviar o pedido de localização na DM."},
            status=502,
        )
    _purge()
    key = (user_id, chat_id)
    previous = _BY_USER_CHAT.get(key)
    if previous:
        _PENDING.pop(previous, None)
    request_id = secrets.token_urlsafe(12)
    _PENDING[request_id] = {
        "user_id": user_id,
        "chat_id": chat_id,
        "request_message_id": sent.message_id,
        "status": "pending",
        "exp": time.time() + _TTL,
    }
    _BY_USER_CHAT[key] = request_id
    return web.json_response(
        {
            "ok": True,
            "request_id": request_id,
            "bot": request.app.get("bot_username") or "",
        }
    )


async def api_map_status(request: web.Request):
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "JSON inválido"}, status=400)
    user, error = _auth(request, data)
    if error:
        return error
    item = _request_for_user(data.get("request_id"), int(user["id"]))
    if not item:
        return web.json_response({"ok": False, "error": "Solicitação de mapa ausente ou expirada."}, status=404)
    if item.get("status") != "received":
        return web.json_response({"ok": True, "status": "pending"})
    return web.json_response(
        {
            "ok": True,
            "status": "received",
            "name": item.get("name") or None,
            "latitude": item["latitude"],
            "longitude": item["longitude"],
        }
    )


async def api_map_send_location(request: web.Request):
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"ok": False, "error": "JSON inválido"}, status=400)
    user, error = _auth(request, data)
    if error:
        return error
    runtime = request.app.get("bot")
    if not runtime:
        return web.json_response({"ok": False, "error": "Bot não inicializado."}, status=503)
    item = _request_for_user(data.get("request_id"), int(user["id"]))
    if not item or item.get("status") != "received":
        return web.json_response({"ok": False, "error": "Nenhuma localização recebida para esta solicitação."}, status=409)
    try:
        await runtime.bot.send_location(
            chat_id=item["chat_id"],
            latitude=item["latitude"],
            longitude=item["longitude"],
            request_timeout=60,
        )
    except Exception:
        _BASE.log.exception("api_map_send_location")
        return web.json_response({"ok": False, "error": "Não foi possível enviar a localização na DM."}, status=502)
    return web.json_response({"ok": True})


async def handle_location(message, bot) -> None:
    if message.chat.type != _BASE.ChatType.PRIVATE or not message.from_user:
        return
    _purge()
    user_id = int(message.from_user.id)
    chat_id = int(message.chat.id)
    item = None
    if message.reply_to_message:
        replied_id = message.reply_to_message.message_id
        for candidate in _PENDING.values():
            if (
                candidate.get("status") == "pending"
                and candidate.get("user_id") == user_id
                and candidate.get("chat_id") == chat_id
                and candidate.get("request_message_id") == replied_id
            ):
                item = candidate
                break
    else:
        request_id = _BY_USER_CHAT.get((user_id, chat_id))
        candidate = _PENDING.get(request_id) if request_id else None
        if candidate and candidate.get("status") == "pending":
            item = candidate
    if not item:
        return
    venue = message.venue
    location = venue.location if venue else message.location
    if not location:
        return
    item["status"] = "received"
    item["name"] = (str(venue.title).strip() if venue and venue.title else None)
    item["latitude"] = float(location.latitude)
    item["longitude"] = float(location.longitude)
    item["exp"] = time.time() + _TTL
    try:
        await _send_rich(bot, chat_id, "Mapa", "Localização recebida.")
    except Exception:
        _BASE.log.exception("map_location_confirmation")


def install(base_module) -> None:
    global _BASE
    _BASE = base_module
    previous_build_dispatcher = base_module.build_dispatcher

    def build_dispatcher():
        dispatcher = previous_build_dispatcher()
        dispatcher.message.register(handle_location, base_module.F.location | base_module.F.venue)
        return dispatcher

    base_module.build_dispatcher = build_dispatcher
