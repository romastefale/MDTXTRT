"""Composição do processo ativo sem monkey-patch ou service locator."""
from __future__ import annotations

import asyncio

from aiohttp import web

import drafts
import preview_security
import rich_buttons
import runtime_v2

from runtime_commands import CommandService, DeliveryService
from runtime_foundation import AuthService, MediaState
from runtime_http import DraftHttpService, MapService, PublishService, RuntimeMediaUpload
from runtime_rich import PersistentMediaService, RichMessageBuilder, RichSender, RoundtripService

from main import (
    Bot,
    BotRuntime,
    Command,
    Dispatcher,
    F,
    MEDIA,
    POLLING_OPTIONS,
    STASH,
    STASH_TTL,
    TOKEN,
    TelegramAPIError,
    _polling_finished,
    api_config,
    bot_commands,
    delete_webhook_with_retry,
    init_data_from_request,
    log,
    new_stash_code,
    public_web_app_url,
    purge_stash,
    session_error,
    telegram_error_text,
    validate_init_data,
)


class Runtime:
    def __init__(self):
        auth = AuthService(
            init_data=init_data_from_request,
            validate=validate_init_data,
            error_response=session_error,
        )
        media = MediaState(
            items=MEDIA,
            stash=STASH,
            ttl_seconds=STASH_TTL,
            purge=purge_stash,
            new_code=new_stash_code,
        )
        builder = RichMessageBuilder(media)
        persistent_media = PersistentMediaService(
            builder=builder,
            media=media,
            token=TOKEN,
            store=drafts.STORE,
            logger=log,
        )
        sender = RichSender(persistent_media.build)
        roundtrip = RoundtripService()
        publish = PublishService(auth=auth, logger=log)
        delivery = DeliveryService(
            sender=sender,
            persistent_media=persistent_media,
        )
        upload = RuntimeMediaUpload(auth=auth, media=media)
        drafts_http = DraftHttpService(
            auth=auth,
            media=media,
            persistent_media=persistent_media,
            upload=upload,
            store=drafts.STORE,
            logger=log,
        )
        commands = CommandService(
            sender=sender,
            builder=persistent_media,
            delivery=delivery,
            roundtrip=roundtrip,
            media=media,
            logger=log,
        )
        maps = MapService(
            auth=auth,
            builder=persistent_media,
            logger=log,
        )

        self.auth = auth
        self.media = media
        self.builder = persistent_media
        self.sender = sender
        self.roundtrip = roundtrip
        self.publish = publish
        self.delivery = delivery
        self.drafts = drafts_http
        self.commands = commands
        self.maps = maps

    def build_dispatcher(self) -> Dispatcher:
        dispatcher = Dispatcher()
        dispatcher.message.register(self.commands.start, Command("start"))
        dispatcher.message.register(self.commands.help, Command("help"))
        dispatcher.message.register(self.commands.tgrich, Command("tgrich"))
        dispatcher.message.register(self.commands.mdrich, Command("mdrich"))
        dispatcher.message.register(
            self.commands.handle_webapp_data, F.web_app_data
        )
        dispatcher.message.register(
            self.commands.handle_document, F.document
        )
        dispatcher.callback_query.register(rich_buttons.handle_callback)
        dispatcher.message.register(
            self.maps.handle, F.location | F.venue
        )
        return dispatcher

    async def serve_index(self, request: web.Request):
        response = await runtime_v2.serve_index(request)
        if response.status != 200:
            return response
        text = response.text
        text = preview_security.inject_preview_guard(text)
        text = rich_buttons.inject_ui(text)
        return web.Response(
            text=text,
            status=response.status,
            content_type="text/html",
            charset="utf-8",
            headers={
                key: value
                for key, value in response.headers.items()
                if key.lower() not in {"content-type", "content-length"}
            },
        )

    async def health(self, request: web.Request):
        payload = {
            "ok": True,
            "app": "mdtxtrt",
            "bot": bool(TOKEN),
            "web_app_url": public_web_app_url() or None,
            "telegraph_mode": "anonymous_per_publication",
            "document_model": "canonical",
            "telegram_rich": "10.3",
            "media_model": "typed",
            "telegraph_preflight": True,
        }
        return web.json_response(payload)

    async def api_send_chat(self, request: web.Request):
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
        raw = self.auth.init_data(data, request)
        user = self.auth.validate(raw)
        if not user or not user.get("id"):
            return self.auth.error_response(raw)
        bot_app = request.app.get("bot")
        if not bot_app:
            return web.json_response(
                {"ok": False, "error": "Bot não inicializado."}, status=503
            )
        try:
            await self.delivery.dispatch(
                bot=bot_app.bot,
                chat_id=user["id"],
                title=data.get("title") or "Sem título",
                content=content,
            )
            return web.json_response({"ok": True})
        except TelegramAPIError as exc:
            detail = telegram_error_text(exc)
            log.error("api_send_chat recusou: %s", detail)
            return web.json_response(
                {"ok": False, "error": detail}, status=502
            )
        except Exception as exc:
            log.exception("api_send_chat")
            return web.json_response(
                {"ok": False, "error": str(exc)}, status=500
            )

    async def on_startup(self, app: web.Application):
        app["bot_username"] = ""
        if not TOKEN:
            log.warning("TELEGRAM_TOKEN ausente. Mini App no ar; bot desligado.")
            return
        bot = Bot(TOKEN)
        dispatcher = self.build_dispatcher()
        try:
            me = await bot.get_me(request_timeout=60)
        except Exception:
            await bot.session.close()
            raise
        app["bot_username"] = me.username or ""
        try:
            await bot.set_my_commands(bot_commands())
            app_url = public_web_app_url()
            if app_url:
                from aiogram.types import MenuButtonWebApp, WebAppInfo
                await bot.set_chat_menu_button(
                    menu_button=MenuButtonWebApp(
                        text="Editor", web_app=WebAppInfo(url=app_url)
                    )
                )
        except Exception:
            log.exception("set_my_commands")
        await delete_webhook_with_retry(bot)

        polling_started = asyncio.Event()

        async def mark_polling_started(**_kwargs):
            polling_started.set()

        dispatcher.startup.register(mark_polling_started)
        polling_task = asyncio.create_task(
            dispatcher.start_polling(bot, **POLLING_OPTIONS),
            name="telegram-polling",
        )
        polling_task.add_done_callback(_polling_finished)
        await polling_started.wait()
        app["bot"] = BotRuntime(bot, dispatcher, polling_task)
        log.info("Bot em escuta @%s", app["bot_username"])

    async def on_cleanup(self, app: web.Application):
        runtime = app.get("bot")
        if not runtime:
            return
        try:
            if not runtime.polling_task.done():
                await runtime.dispatcher.stop_polling()
            await runtime.polling_task
        finally:
            await runtime.bot.session.close()

    def build_web_app(self) -> web.Application:
        app = web.Application(
            client_max_size=runtime_v2.MAX_MEDIA_BYTES + 131072
        )
        app.router.add_get("/", self.serve_index)
        app.router.add_get("/health", self.health)
        app.router.add_get("/api/config", api_config)
        app.router.add_get("/media/{mid}", self.builder.serve)
        app.router.add_post("/api/stash", self.drafts.api_stash)
        app.router.add_post("/api/media", self.drafts.api_media)
        app.router.add_post("/api/publish", self.publish.publish)
        app.router.add_post("/api/send-chat", self.api_send_chat)
        app.router.add_post("/api/share-telegraph", self.publish.share)
        app.router.add_post("/api/draft/load", self.drafts.load)
        app.router.add_post("/api/draft/save", self.drafts.save)
        app.router.add_post("/api/map/request", self.maps.request)
        app.router.add_post("/api/map/status", self.maps.status)
        app.router.add_post("/api/map/send-location", self.maps.send_location)
        app.on_startup.append(self.on_startup)
        app.on_cleanup.append(self.on_cleanup)
        return app


def build_web_app() -> web.Application:
    return Runtime().build_web_app()
