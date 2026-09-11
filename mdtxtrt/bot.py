"""Telegram bot boundary for the rebuilt runtime.

The dispatcher owns handlers directly. It does not import or mutate legacy modules.
"""
from __future__ import annotations

import asyncio
import html
import logging
from io import BytesIO
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from aiogram import Bot, Dispatcher, F, Router
from aiogram.filters import Command
from aiogram.types import BotCommand, InputRichMessage, MenuButtonWebApp, Message, WebAppInfo

from mdtxtrt.assets import AssetService
from mdtxtrt.config import Settings
from mdtxtrt.services import (
    MAX_IMPORT_BYTES,
    SUPPORTED_IMPORT_SUFFIXES,
    EncodingChoiceRequired,
    ImportReviewRequired,
    ImportService,
)

log = logging.getLogger("mdtxtrt.bot")


def _with_query(url: str, **values: str) -> str:
    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query.update(values)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def _with_draft(url: str, draft_id: str) -> str:
    return _with_query(url, draft=draft_id)


def _with_pending_import(url: str, pending_import_id: str) -> str:
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, "/static/pending-import.html", urlencode({"pending_import": pending_import_id}), ""))


def _attr(value: str) -> str:
    return html.escape(value, quote=True)


class TelegramRuntime:
    def __init__(self, settings: Settings, imports: ImportService, assets: AssetService):
        self.settings = settings
        self.imports = imports
        self.assets = assets
        self.bot = Bot(settings.telegram_token)
        self.dispatcher = Dispatcher()
        self.router = Router(name="mdtxtrt-rebuild")
        self._polling_task: asyncio.Task | None = None
        self.bot_username: str | None = None
        self.telegram_ready = False
        self.polling_ready = False
        self.last_operational_error: str | None = None
        self._register_handlers()
        self.dispatcher.include_router(self.router)

    def _register_handlers(self) -> None:
        self.router.message.register(self.start, Command("start"))
        self.router.message.register(self.help, Command("help"))
        self.router.message.register(self.import_command, Command("import"))
        self.router.message.register(self.native_location, F.location | F.venue)
        self.router.message.register(self.document, F.document)

    async def start(self, message: Message) -> None:
        if not message.from_user:
            return
        if not self.settings.web_app_url:
            await message.answer("MDTXTRT está ativo, mas WEB_APP_URL não foi configurada.")
            return
        body = (
            '<h1>MDTXTRT</h1><p>Editor Rich para Telegram Bot API 10.3 e Telegraph.</p>'
            '<tg-button-row align="center">'
            f'<tg-button type="web_app" style="success" url="{_attr(self.settings.web_app_url)}">Abrir editor</tg-button>'
            '</tg-button-row>'
        )
        await message.answer_rich(InputRichMessage(html=body))

    async def help(self, message: Message) -> None:
        body = (
            "<h1>MDTXTRT</h1>"
            "<table bordered striped compact>"
            "<tr><th>Comando</th><th>Função</th></tr>"
            "<tr><td>/start</td><td>Abrir o editor</td></tr>"
            "<tr><td>/import</td><td>Importar arquivo .md ou .txt</td></tr>"
            "<tr><td>/help</td><td>Mostrar esta ajuda</td></tr>"
            "</table>"
        )
        await message.answer_rich(InputRichMessage(html=body))

    async def import_command(self, message: Message) -> None:
        await message.answer("Envie um arquivo .md ou .txt. Ele será criado como rascunho separado da sua conta após a revisão necessária.")

    async def _pending_import_link(self, message: Message, pending_id: str, filename: str, reason: str) -> None:
        if not self.settings.web_app_url:
            await message.answer(reason + " O original foi preservado como importação pendente, mas WEB_APP_URL não está configurada.")
            return
        url = _with_pending_import(self.settings.web_app_url, pending_id)
        body = (
            f"<p><strong>{html.escape(filename)}</strong></p>"
            f"<p>{html.escape(reason)} O original foi preservado e nenhum rascunho definitivo foi criado ainda.</p>"
            '<tg-button-row align="center">'
            f'<tg-button type="web_app" style="success" url="{_attr(url)}">Revisar importação</tg-button>'
            '</tg-button-row>'
        )
        await message.answer_rich(InputRichMessage(html=body))

    async def document(self, message: Message) -> None:
        if not message.from_user or not message.document:
            return
        filename = message.document.file_name or "import.txt"
        if Path(filename).suffix.lower() not in SUPPORTED_IMPORT_SUFFIXES:
            await message.answer("Formato não suportado. Use arquivo .md ou .txt.")
            return
        declared_size = message.document.file_size
        if declared_size is not None and declared_size > MAX_IMPORT_BYTES:
            await message.answer("Arquivo acima do limite (1 MB).")
            return
        buffer = BytesIO()
        await self.bot.download(message.document, destination=buffer)
        data = buffer.getvalue()
        if len(data) > MAX_IMPORT_BYTES:
            await message.answer("Arquivo acima do limite (1 MB).")
            return
        user_id = int(message.from_user.id)
        source_key = f"telegram:{message.chat.id}:{message.message_id}"
        pending = self.imports.stage_file(
            user_id=user_id,
            filename=filename,
            data=data,
            mime_type=message.document.mime_type,
            source_key=source_key,
        )
        try:
            review = self.imports.preview_pending(
                user_id=user_id,
                pending_import_id=pending.id,
            )
        except EncodingChoiceRequired as exc:
            await self._pending_import_link(
                message,
                exc.pending_import_id or pending.id,
                filename,
                "O arquivo não é UTF-8; escolha o encoding explicitamente antes de importar.",
            )
            return

        if review.get("status") == "completed" and review.get("draft_id"):
            draft = self.imports.complete_pending(user_id=user_id, pending_import_id=pending.id)
        elif review.get("requires_confirmation"):
            await self._pending_import_link(
                message,
                pending.id,
                filename,
                "Parte do Markdown não pode ser convertida visualmente sem manter conteúdo cru; revise o resultado antes de criar o rascunho.",
            )
            return
        else:
            try:
                draft = self.imports.complete_pending(
                    user_id=user_id,
                    pending_import_id=pending.id,
                )
            except ImportReviewRequired:
                await self._pending_import_link(
                    message,
                    pending.id,
                    filename,
                    "A conversão passou a exigir revisão antes da conclusão; revise o resultado.",
                )
                return

        if not self.settings.web_app_url:
            await message.answer(f"Rascunho importado: {draft['name']}")
            return
        url = _with_draft(self.settings.web_app_url, draft["id"])
        body = (
            f"<p>Rascunho importado: <strong>{html.escape(str(draft['name']))}</strong></p>"
            '<tg-button-row align="center">'
            f'<tg-button type="web_app" style="success" url="{_attr(url)}">Abrir importação</tg-button>'
            '</tg-button-row>'
        )
        await message.answer_rich(InputRichMessage(html=body))

    async def native_location(self, message: Message) -> None:
        if not message.from_user:
            return
        latitude: float
        longitude: float
        name: str | None = None
        address: str | None = None
        if message.venue:
            latitude = float(message.venue.location.latitude)
            longitude = float(message.venue.location.longitude)
            name = message.venue.title
            address = message.venue.address
        elif message.location:
            latitude = float(message.location.latitude)
            longitude = float(message.location.longitude)
        else:
            return
        request = self.assets.fulfill_latest_location(
            user_id=int(message.from_user.id),
            latitude=latitude,
            longitude=longitude,
            name=name,
            address=address,
        )
        if request is not None:
            await message.answer("Localização recebida para o rascunho. Volte ao editor para continuar.")

    async def prompt_location(self, user_id: int) -> None:
        await self.bot.send_message(
            chat_id=user_id,
            text=(
                "O MDTXTRT está aguardando uma Location ou Venue para o rascunho. "
                "Use o anexo de localização do Telegram e escolha o local desejado; não precisa ser sua localização atual."
            ),
        )

    async def on_startup(self) -> None:
        # Telegram availability must not prevent aiohttp from serving the editor.
        self._polling_task = asyncio.create_task(self._connect_and_poll(), name="mdtxtrt-telegram-supervisor")

    async def _connect_and_poll(self) -> None:
        delay = 1.0
        while True:
            try:
                me = await self.bot.get_me()
                self.bot_username = me.username
                await self.bot.delete_webhook(drop_pending_updates=False)
                await self.bot.set_my_commands(
                    [
                        BotCommand(command="start", description="Abrir MDTXTRT"),
                        BotCommand(command="import", description="Importar .md/.txt"),
                        BotCommand(command="help", description="Ajuda"),
                    ]
                )
                if self.settings.web_app_url:
                    await self.bot.set_chat_menu_button(
                        menu_button=MenuButtonWebApp(
                            text="MDTXTRT", web_app=WebAppInfo(url=self.settings.web_app_url)
                        )
                    )
                self.telegram_ready = True
                self.polling_ready = True
                self.last_operational_error = None
                delay = 1.0
                await self.dispatcher.start_polling(self.bot)
                self.polling_ready = False
                self.telegram_ready = False
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                self.telegram_ready = False
                self.polling_ready = False
                self.last_operational_error = type(exc).__name__
                log.warning(
                    "Telegram indisponível; nova tentativa em %.1fs (%s)",
                    delay,
                    type(exc).__name__,
                )
            await asyncio.sleep(delay)
            delay = min(delay * 2, 60.0)

    async def on_cleanup(self) -> None:
        try:
            if self._polling_task is not None:
                self._polling_task.cancel()
                await asyncio.gather(self._polling_task, return_exceptions=True)
        finally:
            await self.bot.session.close()
