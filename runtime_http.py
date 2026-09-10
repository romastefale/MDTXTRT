"""Serviços HTTP com dependências explícitas."""
from __future__ import annotations

import json
import re
import secrets
import time

from aiohttp import web
from aiogram.exceptions import TelegramAPIError
from aiogram.types import InlineQueryResultArticle, InputTextMessageContent
from telegraph.exceptions import TelegraphException

import drafts
import map_location
import runtime_v2

from runtime_foundation import AuthService, MediaState
from runtime_rich import PersistentMediaService
from main import ChatType


class RuntimeMediaUpload:
    def __init__(self, *, auth: AuthService, media: MediaState):
        self._auth = auth
        self._media = media

    async def upload(self, request: web.Request):
        self._media.purge()
        try:
            post = await request.post()
        except Exception:
            return web.json_response(
                {"ok": False, "error": "Envio inválido"}, status=400
            )
        raw_init = str(post.get("init_data") or "").strip()
        if not self._auth.validate(raw_init):
            return self._auth.error_response(raw_init)
        upload = post.get("file")
        if upload is None or not hasattr(upload, "file"):
            return web.json_response(
                {"ok": False, "error": "Falta o arquivo"}, status=400
            )
        raw = upload.file.read()
        if not raw:
            return web.json_response(
                {"ok": False, "error": "Arquivo vazio"}, status=400
            )
        if len(raw) > runtime_v2.MAX_MEDIA_BYTES:
            return web.json_response(
                {"ok": False, "error": "Mídia acima de 50 MB"}, status=413
            )
        filename = getattr(upload, "filename", None) or "media.bin"
        mime = (
            getattr(upload, "content_type", None) or "application/octet-stream"
        ).lower()
        kind = runtime_v2._media_kind(
            filename, mime, str(post.get("kind") or "auto")
        )
        if kind == "photo" and len(raw) > 10 * 1024 * 1024:
            return web.json_response(
                {"ok": False, "error": "Foto acima de 10 MB"}, status=413
            )
        media_id = self._media.new_code()
        self._media.items[media_id] = {
            "data": raw,
            "name": filename,
            "mime": mime,
            "kind": kind,
            "exp": time.time() + self._media.ttl_seconds,
        }
        return web.json_response({"ok": True, "id": media_id, "kind": kind})


class DraftHttpService:
    def __init__(
        self,
        *,
        auth: AuthService,
        media: MediaState,
        persistent_media: PersistentMediaService,
        upload: RuntimeMediaUpload,
        store,
        logger,
    ):
        self._auth = auth
        self._media = media
        self._persistent_media = persistent_media
        self._upload = upload
        self._store = store
        self._log = logger

    async def api_media(self, request: web.Request):
        response = await self._upload.upload(request)
        if response.status >= 400:
            return response

        media_id = ""
        try:
            payload = json.loads(response.text)
            media_id = str(payload.get("id") or "")
            post = await request.post()
            raw = self._auth.init_data(post, request)
            user = self._auth.validate(raw)
            item = self._media.items.get(media_id)
            if not user or not user.get("id") or not item:
                raise RuntimeError(
                    "upload validado sem estado de mídia correspondente"
                )
            user_id = int(user["id"])
            item["telegram_user_id"] = user_id
            for removed_id in self._store.gc_media(user_id):
                self._media.items.pop(removed_id, None)
            self._store.save_media(user_id, media_id, item)
            self._persistent_media.set_cookie(response, user_id)
        except ValueError as exc:
            if media_id:
                self._media.items.pop(media_id, None)
            return web.json_response({"ok": False, "error": str(exc)}, status=413)
        except Exception:
            if media_id:
                self._media.items.pop(media_id, None)
            self._log.exception("persistência de mídia do rascunho")
            return web.json_response(
                {
                    "ok": False,
                    "error": "Não foi possível persistir a mídia do rascunho.",
                },
                status=500,
            )
        return response

    async def api_stash(self, request: web.Request):
        owner_id = self._persistent_media.cookie_user(request)
        if owner_id is None:
            return web.json_response(
                {
                    "ok": False,
                    "error": "Sessão do Telegram inválida. Reabra o Mini App.",
                },
                status=401,
            )
        try:
            data = await request.json()
        except Exception:
            return web.json_response(
                {"ok": False, "error": "JSON inválido"}, status=400
            )
        content = (data.get("content") or "").strip()
        if not content:
            return web.json_response(
                {"ok": False, "error": "Documento vazio"}, status=400
            )
        if len(content.encode("utf-8")) > drafts.MAX_DRAFT_BYTES:
            return web.json_response(
                {"ok": False, "error": "Documento acima de 1 MB"}, status=413
            )
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
                    "error": (
                        "Bot ainda a arrancar. Toca outra vez dentro de instantes."
                    ),
                },
                status=503,
            )
        code = self._media.new_code()
        self._media.stash[code] = {
            "action": action,
            "title": (data.get("title") or "Sem título").strip() or "Sem título",
            "content": content,
            "telegram_user_id": int(owner_id),
            "exp": time.time() + self._media.ttl_seconds,
        }
        prefix = "m" if action == "mdrich" else "c"
        start_param = f"{prefix}{code}"
        url = f"https://t.me/{username}?start={start_param}"
        return web.json_response(
            {"ok": True, "start": start_param, "url": url, "bot": username}
        )

    async def load(self, request: web.Request):
        try:
            data = await request.json()
        except Exception:
            data = {}
        raw, user = self._auth.user(data, request)
        if not user or not user.get("id"):
            return self._auth.error_response(raw)
        user_id = int(user["id"])
        draft = self._store.load(user_id)
        payload = draft or {
            "content": "",
            "title": "",
            "updated_at": None,
            "updated_at_ms": None,
            "revision": 0,
        }
        response = web.json_response({"ok": True, **payload})
        self._persistent_media.set_cookie(response, user_id)
        return response

    async def save(self, request: web.Request):
        try:
            data = await request.json()
        except Exception:
            return web.json_response(
                {"ok": False, "error": "JSON inválido"}, status=400
            )
        raw, user = self._auth.user(data, request)
        if not user or not user.get("id"):
            return self._auth.error_response(raw)
        user_id = int(user["id"])
        try:
            base_revision = int(data.get("base_revision"))
        except (TypeError, ValueError):
            base_revision = -1
        try:
            draft = self._store.save(
                user_id,
                data.get("content") or "",
                data.get("title") or "",
                base_revision=base_revision,
            )
            for removed_id in self._store.gc_media(user_id):
                self._media.items.pop(removed_id, None)
        except drafts.DraftConflict as exc:
            response = web.json_response(
                {
                    "ok": False,
                    "error": "Rascunho desatualizado.",
                    "conflict": True,
                    "current": exc.current,
                },
                status=409,
            )
            self._persistent_media.set_cookie(response, user_id)
            return response
        except ValueError as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=413)
        response = web.json_response({"ok": True, **draft})
        self._persistent_media.set_cookie(response, user_id)
        return response


class PublishService:
    def __init__(self, *, auth: AuthService, logger):
        self._auth = auth
        self._log = logger

    async def publish(self, request: web.Request):
        try:
            data = await request.json()
        except Exception:
            return web.json_response(
                {"ok": False, "error": "JSON inválido"}, status=400
            )
        raw = self._auth.init_data(data, request)
        if raw and not self._auth.validate(raw):
            return self._auth.error_response(raw)
        content = str(data.get("content") or "")
        if not content.strip():
            return web.json_response(
                {"ok": False, "error": "Documento vazio"}, status=400
            )

        report = runtime_v2.telegraph_preflight(content)
        public = runtime_v2._public_preflight(report)
        if data.get("preflight_only") is True:
            return web.json_response({"ok": True, "published": False, **public})
        if not report["publishable"]:
            return web.json_response(
                {
                    "ok": False,
                    "error": "A projeção excede o limite técnico do Telegraph.",
                    **public,
                },
                status=413,
            )
        has_adaptations = bool(report["adaptations"])
        has_unsupported = bool(report["unsupported"])
        if has_adaptations or has_unsupported:
            supplied = str(data.get("preflight_fingerprint") or "")
            if (
                supplied != report["fingerprint"]
                or (has_adaptations and data.get("confirm_adaptations") is not True)
                or (has_unsupported and data.get("confirm_unsupported") is not True)
            ):
                return web.json_response(
                    {
                        "ok": False,
                        "error": (
                            "A publicação exige confirmação das adaptações/"
                            "incompatibilidades detectadas no preflight."
                        ),
                        **public,
                    },
                    status=409,
                )
        if not runtime_v2._publish_allowed(request):
            return web.json_response(
                {
                    "ok": False,
                    "error": (
                        "Muitas publicações em sequência; tente novamente em um minuto."
                    ),
                },
                status=429,
            )
        try:
            page = await runtime_v2.publish_page_async(
                data.get("title") or "Sem título",
                content,
                allow_adaptations=has_adaptations,
                allow_unsupported=has_unsupported,
                preflight_fingerprint=(
                    report["fingerprint"]
                    if (has_adaptations or has_unsupported)
                    else None
                ),
            )
            return web.json_response({"ok": True, **page})
        except runtime_v2.TelegraphPreflightRequired as exc:
            return web.json_response(
                {
                    "ok": False,
                    "error": str(exc),
                    **runtime_v2._public_preflight(exc.report),
                },
                status=409,
            )
        except TelegraphException as exc:
            return web.json_response({"ok": False, "error": str(exc)}, status=502)
        except Exception as exc:
            self._log.exception("api_publish")
            return web.json_response({"ok": False, "error": str(exc)}, status=500)

    async def share(self, request: web.Request):
        try:
            data = await request.json()
        except Exception:
            return web.json_response(
                {"ok": False, "error": "JSON inválido"}, status=400
            )
        raw, user = self._auth.user(data, request)
        if not user or not user.get("id"):
            return self._auth.error_response(raw)
        url = str(data.get("url") or "").strip()
        if not re.fullmatch(r"https://telegra\.ph/[^\s]+", url):
            return web.json_response(
                {"ok": False, "error": "URL do Telegraph inválida"}, status=400
            )
        title = (
            str(data.get("title") or "Publicação no Telegraph").strip()[:256]
            or "Publicação no Telegraph"
        )
        bot_runtime = request.app.get("bot")
        if not bot_runtime:
            return web.json_response(
                {"ok": False, "error": "Bot não inicializado."}, status=503
            )
        result = InlineQueryResultArticle(
            id="telegraph-share",
            title=title,
            description="Compartilhar publicação do Telegraph",
            input_message_content=InputTextMessageContent(
                message_text=f"Acabei de publicar este artigo no Telegraph\n{url}"
            ),
        )
        try:
            prepared = await bot_runtime.bot.save_prepared_inline_message(
                user_id=int(user["id"]),
                result=result,
                allow_user_chats=True,
                allow_bot_chats=True,
                allow_group_chats=True,
                allow_channel_chats=True,
            )
            return web.json_response(
                {"ok": True, "prepared_message_id": prepared.id}
            )
        except TelegramAPIError:
            self._log.exception("api_share_telegraph telegram")
            return web.json_response(
                {
                    "ok": False,
                    "error": (
                        "Não foi possível preparar o compartilhamento no Telegram."
                    ),
                },
                status=502,
            )
        except Exception as exc:
            self._log.exception("api_share_telegraph")
            return web.json_response({"ok": False, "error": str(exc)}, status=500)


class MapService:
    def __init__(
        self,
        *,
        auth: AuthService,
        builder: PersistentMediaService,
        logger,
    ):
        self._auth = auth
        self._builder = builder
        self._log = logger

    def _auth_user(self, request: web.Request, data: dict):
        raw, user = self._auth.user(data, request)
        if not user or not user.get("id"):
            return None, self._auth.error_response(raw)
        return user, None

    async def _send_rich(self, bot, chat_id: int, subtitle: str, body: str):
        return await bot.send_rich_message(
            chat_id=chat_id,
            rich_message=self._builder.build(
                map_location._frame(subtitle, body)
            ),
            request_timeout=60,
        )

    async def request(self, request: web.Request):
        try:
            data = await request.json()
        except Exception:
            return web.json_response(
                {"ok": False, "error": "JSON inválido"}, status=400
            )
        user, error = self._auth_user(request, data)
        if error:
            return error
        runtime = request.app.get("bot")
        if not runtime:
            return web.json_response(
                {"ok": False, "error": "Bot não inicializado."}, status=503
            )
        user_id = int(user["id"])
        chat_id = user_id
        try:
            sent = await self._send_rich(
                runtime.bot,
                chat_id,
                "Mapa",
                "Selecione uma localização no Telegram e envie nesta conversa.",
            )
        except Exception:
            self._log.exception("api_map_request")
            return web.json_response(
                {
                    "ok": False,
                    "error": (
                        "Não foi possível enviar o pedido de localização na DM."
                    ),
                },
                status=502,
            )
        map_location._purge()
        key = (user_id, chat_id)
        previous = map_location._BY_USER_CHAT.get(key)
        if previous:
            map_location._PENDING.pop(previous, None)
        request_id = secrets.token_urlsafe(12)
        map_location._PENDING[request_id] = {
            "user_id": user_id,
            "chat_id": chat_id,
            "request_message_id": sent.message_id,
            "status": "pending",
            "exp": time.time() + map_location._TTL,
        }
        map_location._BY_USER_CHAT[key] = request_id
        return web.json_response(
            {
                "ok": True,
                "request_id": request_id,
                "bot": request.app.get("bot_username") or "",
            }
        )

    async def status(self, request: web.Request):
        try:
            data = await request.json()
        except Exception:
            return web.json_response(
                {"ok": False, "error": "JSON inválido"}, status=400
            )
        user, error = self._auth_user(request, data)
        if error:
            return error
        item = map_location._request_for_user(
            data.get("request_id"), int(user["id"])
        )
        if not item:
            return web.json_response(
                {
                    "ok": False,
                    "error": "Solicitação de mapa ausente ou expirada.",
                },
                status=404,
            )
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

    async def send_location(self, request: web.Request):
        try:
            data = await request.json()
        except Exception:
            return web.json_response(
                {"ok": False, "error": "JSON inválido"}, status=400
            )
        user, error = self._auth_user(request, data)
        if error:
            return error
        runtime = request.app.get("bot")
        if not runtime:
            return web.json_response(
                {"ok": False, "error": "Bot não inicializado."}, status=503
            )
        item = map_location._request_for_user(
            data.get("request_id"), int(user["id"])
        )
        if not item or item.get("status") != "received":
            return web.json_response(
                {
                    "ok": False,
                    "error": (
                        "Nenhuma localização recebida para esta solicitação."
                    ),
                },
                status=409,
            )
        try:
            await runtime.bot.send_location(
                chat_id=item["chat_id"],
                latitude=item["latitude"],
                longitude=item["longitude"],
                request_timeout=60,
            )
        except Exception:
            self._log.exception("api_map_send_location")
            return web.json_response(
                {
                    "ok": False,
                    "error": "Não foi possível enviar a localização na DM.",
                },
                status=502,
            )
        return web.json_response({"ok": True})

    async def handle(self, message, bot):
        if message.chat.type != ChatType.PRIVATE or not message.from_user:
            return
        map_location._purge()
        user_id = int(message.from_user.id)
        chat_id = int(message.chat.id)
        item = None
        if message.reply_to_message:
            replied_id = message.reply_to_message.message_id
            for candidate in map_location._PENDING.values():
                if (
                    candidate.get("status") == "pending"
                    and candidate.get("user_id") == user_id
                    and candidate.get("chat_id") == chat_id
                    and candidate.get("request_message_id") == replied_id
                ):
                    item = candidate
                    break
        else:
            request_id = map_location._BY_USER_CHAT.get((user_id, chat_id))
            candidate = (
                map_location._PENDING.get(request_id) if request_id else None
            )
            if candidate and candidate.get("status") == "pending":
                item = candidate
        if not item:
            return
        venue = message.venue
        location = venue.location if venue else message.location
        if not location:
            return
        item["status"] = "received"
        item["name"] = (
            str(venue.title).strip() if venue and venue.title else None
        )
        item["latitude"] = float(location.latitude)
        item["longitude"] = float(location.longitude)
        item["exp"] = time.time() + map_location._TTL
        try:
            await self._send_rich(
                bot, chat_id, "Mapa", "Localização recebida."
            )
        except Exception:
            self._log.exception("map_location_confirmation")
