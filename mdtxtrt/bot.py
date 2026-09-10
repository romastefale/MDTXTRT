"""Telegram bot boundary for the rebuilt runtime.

The dispatcher owns handlers directly. It does not import or mutate legacy modules.
"""
from __future__ import annotations

import asyncio
import html
from io import BytesIO
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from aiogram import Bot, Dispatcher, F, Router
from aiogram.filters import Command
from aiogram.types import BotCommand, InputRichMessage, MenuButtonWebApp, Message, WebAppInfo

from mdtxtrt.assets import AssetService
from mdtxtrt.config import Settings
from mdtxtrt.services import EncodingChoiceRequired, ImportService


def _with_draft(url: str, draft_id: str) -> str:
    parts = urlsplit(url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query["draft"] = draft_id
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


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
        await message.answer("Envie um arquivo .md ou .txt. Ele será criado como rascunho separado da sua conta.")

    async def document(self, message: Message) -> None:
        if not message.from_user or not message.document:
            return
        filename = message.document.file_name or "import.txt"
        if Path(filename).suffix.lower() not in {".md", ".txt"}:
            await message.answer("Formato não suportado. Use arquivo .md ou .txt.")
            return
        buffer = BytesIO()
        await self.bot.download(message.document, destination=buffer)
        data = buffer.getvalue()
        try:
            draft = self.imports.import_file(
                user_id=int(message.from_user.id),
                filename=filename,
                data=data,
                mime_type=message.document.mime_type,
            )
        except EncodingChoiceRequired:
            await message.answer(
                "O arquivo não é UTF-8. Para não adivinhar o encoding, importe-o pelo Web App e escolha a codificação explicitamente."
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
                    text="MDTXTRT",
                    web_app=WebAppInfo(url=self.settings.web_app_url),
                )
            )
        self._polling_task = asyncio.create_task(
            self.dispatcher.start_polling(self.bot),
            name="mdtxtrt-telegram-polling",
        )

    async def on_cleanup(self) -> None:
        try:
            if self._polling_task is not None:
                if not self._polling_task.done():
                    await self.dispatcher.stop_polling()
                await self._polling_task
        finally:
            await self.bot.session.close()
