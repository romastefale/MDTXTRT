"""Handlers do bot compostos por referências explícitas."""
from __future__ import annotations

from contextvars import ContextVar
import html
import re
import time

from aiogram.exceptions import TelegramAPIError
from telegraph.exceptions import TelegraphException

from canonical import CanonicalDocument
import dm_command_ui
import runtime_v2

from runtime_foundation import MediaState
from runtime_rich import PersistentMediaService, RichSender, RoundtripService

from main import (
    BufferedInputFile,
    ChatType,
    TelegramAPIError as MainTelegramAPIError,
    _message_context,
    _payload_from_webapp,
    entities_to_markdown,
    filename_from_markdown,
    is_markdown_document,
    message_rich_payload,
    public_web_app_url,
    read_document_text,
    reply_document,
    reply_text as base_reply_text,
    telegram_error_text,
)

# main.TelegramAPIError e aiogram.exceptions.TelegramAPIError são o mesmo contrato.
TelegramAPIError = MainTelegramAPIError

_COMMAND_CONTEXT: ContextVar[tuple[str, str] | None] = ContextVar(
    "mdtxtrt_runtime_command_context", default=None
)
_MESSAGE_APP_BUTTON = object()


class DeliveryService:
    def __init__(
        self,
        *,
        sender: RichSender,
        persistent_media: PersistentMediaService,
    ):
        self._sender = sender
        self._persistent_media = persistent_media

    async def dispatch(self, bot, chat_id, title: str, content: str):
        body = content
        if title and title != "Sem título":
            body = f"**{title}**\n\n{content}"
        with self._persistent_media.owner(chat_id):
            await self._sender.send(bot, chat_id, body)

    async def deliver(self, bot, chat_id, action: str, title: str, content: str):
        if action == "mdrich":
            md_text = CanonicalDocument.from_markdown(content).markdown
            name = filename_from_markdown(md_text)
            if title and title != "Sem título":
                safe = re.sub(r'[\\/*?:"<>|]', "", title).strip()[:60]
                if safe:
                    name = safe
            filename = f"{name}.md"
            await bot.send_document(
                chat_id=chat_id,
                document=BufferedInputFile(
                    md_text.encode("utf-8"), filename=filename
                ),
                caption=filename,
            )
            return
        await self.dispatch(bot, chat_id, title, content)


class CommandService:
    def __init__(
        self,
        *,
        sender: RichSender,
        builder: PersistentMediaService,
        delivery: DeliveryService,
        roundtrip: RoundtripService,
        media: MediaState,
        logger,
    ):
        self._sender = sender
        self._builder = builder
        self._delivery = delivery
        self._roundtrip = roundtrip
        self._media = media
        self._log = logger

    def mini_app_markup(self):
        return _MESSAGE_APP_BUTTON

    def _app_button(self) -> str:
        url = str(public_web_app_url() or "").strip()
        if not url:
            return ""
        return (
            '\n\n<tg-button-row align="center">\n'
            '<tg-button type="web_app" style="success" url="'
            + html.escape(url, quote=True)
            + '">MDTXTRT</tg-button>\n'
            "</tg-button-row>"
        )

    async def _base_reply(self, message, bot, text: str, **kwargs):
        markup = kwargs.pop("reply_markup", None)
        if markup is not _MESSAGE_APP_BUTTON:
            if markup is not None:
                kwargs["reply_markup"] = markup
            return await base_reply_text(message, bot, text, **kwargs)
        if message.chat.type != ChatType.PRIVATE:
            return await base_reply_text(message, bot, text, **kwargs)
        button = self._app_button()
        if not button:
            return await base_reply_text(message, bot, text, **kwargs)
        kwargs.pop("parse_mode", None)
        return await self._sender.send(
            bot,
            message.chat.id,
            str(text or "") + button,
            **_message_context(message),
        )

    async def reply(self, message, bot, text: str, **kwargs):
        context = _COMMAND_CONTEXT.get()
        if context and message.chat.type == ChatType.PRIVATE:
            command, subtitle = context
            kwargs.pop("parse_mode", None)
            kwargs["reply_markup"] = self.mini_app_markup()
            text = dm_command_ui._frame(command, subtitle, str(text or ""))
        return await self._base_reply(message, bot, text, **kwargs)

    async def _start_payload(self, message, bot, command):
        arg = ((command.args or "").split()[0] if command.args else "").strip()
        if not arg:
            return False
        kind, code = arg[0], arg[1:]
        item = self._media.stash.get(code)
        if not item or item.get("exp", 0) < time.time():
            self._media.stash.pop(code, None)
            await self.reply(
                message,
                bot,
                "Este envio já foi usado ou expirou. Abre o Mini App e toca outra vez.",
                reply_markup=self.mini_app_markup(),
            )
            return True

        expected_owner = item.get("telegram_user_id")
        opener = getattr(getattr(message, "from_user", None), "id", None)
        if expected_owner is not None and int(opener or 0) != int(expected_owner):
            await self.reply(
                message,
                bot,
                "Este envio pertence a outro usuário.",
                reply_markup=self.mini_app_markup(),
            )
            return True

        action = (
            "mdrich"
            if kind == "m" or item.get("action") == "mdrich"
            else "chat"
        )
        owner = (
            int(expected_owner)
            if expected_owner is not None
            else int(opener or message.chat.id)
        )
        try:
            with self._builder.owner(owner):
                await self._delivery.deliver(
                    bot,
                    message.chat.id,
                    action,
                    item.get("title") or "Sem título",
                    item.get("content") or "",
                )
        except TelegramAPIError as exc:
            await self.reply(message, bot, telegram_error_text(exc))
            return True
        except ValueError as exc:
            await self.reply(
                message,
                bot,
                str(exc),
                reply_markup=self.mini_app_markup(),
            )
            return True

        self._media.stash.pop(code, None)
        return True

    async def start(self, message, bot, command):
        private = message.chat.type == ChatType.PRIVATE
        arg = ((command.args or "").split()[0] if command.args else "").strip()
        if private and not arg:
            return await self._base_reply(
                message,
                bot,
                dm_command_ui._frame(
                    "/start",
                    dm_command_ui._META["/start"],
                    dm_command_ui._START_BODY,
                    command_table=True,
                ),
                reply_markup=self.mini_app_markup(),
            )
        token = (
            _COMMAND_CONTEXT.set(("/start", dm_command_ui._META["/start"]))
            if private
            else None
        )
        try:
            if await self._start_payload(message, bot, command):
                return
            text = (
                "<b>MDTXTRT</b>\n\n"
                "Converte Markdown em rich text do Telegram e exporta mensagens "
                "em .md.\n\n"
                "• Mini App — redigir, pré-visualizar, enviar ao chat e publicar "
                "no Telegraph\n"
                "• Arquivo .md anexado ou encaminhado — vira mensagem formatada\n"
                "• /tgrich — converte Markdown para Rich Text\n"
                "• /mdrich — exporta a mensagem respondida em .md\n"
                "• /help — comandos e a diferença entre chat e Mini App"
            )
            await self.reply(
                message,
                bot,
                text,
                reply_markup=self.mini_app_markup(),
            )
        finally:
            if token is not None:
                _COMMAND_CONTEXT.reset(token)

    async def help(self, message, bot):
        if message.chat.type == ChatType.PRIVATE:
            return await self._base_reply(
                message,
                bot,
                dm_command_ui._frame(
                    "/help",
                    dm_command_ui._META["/help"],
                    dm_command_ui._HELP_BODY,
                    command_table=True,
                ),
                reply_markup=self.mini_app_markup(),
            )
        await base_reply_text(
            message,
            bot,
            "Use /tgrich para converter Markdown e /mdrich para exportar .md.",
        )

    @staticmethod
    def _command_arg_text(message) -> str:
        text = (message.text or message.caption or "").strip()
        if not text:
            return ""
        parts = text.split(None, 1)
        if parts and parts[0].startswith("/"):
            return parts[1] if len(parts) > 1 else ""
        return text

    async def source_for_tgrich(self, message, bot) -> str:
        if is_markdown_document(message.document):
            return await read_document_text(bot, message.document)
        target = message.reply_to_message
        if target:
            if is_markdown_document(target.document):
                return await read_document_text(bot, target.document)
            rich = message_rich_payload(target)
            if rich:
                markdown = self._roundtrip.convert(rich)
                if str(markdown).strip():
                    return markdown
            raw = target.text or target.caption
            if raw:
                return raw
            if target.document:
                return await read_document_text(bot, target.document)
        arg = self._command_arg_text(message)
        if arg:
            return arg
        raise ValueError(
            "Responda a um arquivo .md compatível, anexe um .md, "
            "ou envie /tgrich seguido do texto."
        )

    async def source_for_mdrich(self, message, bot) -> str:
        target = message.reply_to_message
        if not target:
            if is_markdown_document(message.document):
                source = await read_document_text(bot, message.document)
                return CanonicalDocument.from_markdown(source).markdown
            raise ValueError("Responda a uma mensagem com /mdrich.")
        rich = message_rich_payload(target)
        if rich:
            markdown = self._roundtrip.convert(rich)
            if str(markdown).strip():
                return CanonicalDocument.from_markdown(markdown).markdown
        if target.document:
            text = await read_document_text(bot, target.document)
            if is_markdown_document(target.document):
                return CanonicalDocument.from_markdown(text).markdown
            caption = target.caption or ""
            if caption:
                caption_md = entities_to_markdown(
                    caption, target.caption_entities or []
                )
                text = caption_md + "\n\n" + text
            return CanonicalDocument.from_markdown(text).markdown
        raw = target.text or target.caption or ""
        entities = target.entities or target.caption_entities or []
        if not raw:
            raise ValueError("A mensagem alvo não possui texto exportável.")
        return CanonicalDocument.from_markdown(
            entities_to_markdown(raw, entities)
        ).markdown

    async def tgrich(self, message, bot):
        token = (
            _COMMAND_CONTEXT.set(("/tgrich", dm_command_ui._META["/tgrich"]))
            if message.chat.type == ChatType.PRIVATE
            else None
        )
        try:
            source = await self.source_for_tgrich(message, bot)
            if not source.strip():
                await self.reply(message, bot, "Documento vazio.")
                return
            await self._sender.send(
                bot,
                message.chat.id,
                source,
                reply_to_message_id=message.message_id,
                **_message_context(message),
            )
        except TelegramAPIError as exc:
            await self.reply(message, bot, telegram_error_text(exc))
        except ValueError as exc:
            await self.reply(message, bot, str(exc))
        except Exception:
            self._log.exception("tgrich")
            await self.reply(
                message, bot, "Não foi possível converter o arquivo."
            )
        finally:
            if token is not None:
                _COMMAND_CONTEXT.reset(token)

    async def mdrich(self, message, bot):
        token = (
            _COMMAND_CONTEXT.set(("/mdrich", dm_command_ui._META["/mdrich"]))
            if message.chat.type == ChatType.PRIVATE
            else None
        )
        try:
            markdown = await self.source_for_mdrich(message, bot)
            if not markdown.strip():
                await self.reply(message, bot, "Nada para exportar.")
                return
            name = filename_from_markdown(markdown)
            await reply_document(
                message,
                bot,
                markdown.encode("utf-8"),
                f"{name}.md",
            )
        except ValueError as exc:
            await self.reply(message, bot, str(exc))
        except Exception:
            self._log.exception("mdrich")
            await self.reply(message, bot, "Não foi possível exportar o .md.")
        finally:
            if token is not None:
                _COMMAND_CONTEXT.reset(token)

    async def handle_document(self, message, bot):
        if not message.document:
            return
        caption = (message.caption or "").strip()
        command = (
            caption.split()[0].split("@")[0].lower()
            if caption.startswith("/")
            else ""
        )
        if command in {"/start", "/help"}:
            return
        if command == "/mdrich":
            await self.mdrich(message, bot)
            return
        if command == "/tgrich" or is_markdown_document(message.document):
            await self.tgrich(message, bot)

    async def handle_webapp_data(self, message, bot):
        try:
            payload = _payload_from_webapp(message.web_app_data.data)
            content = payload["content"]
            if not str(content).strip():
                await self.reply(message, bot, "Documento vazio.")
                return
            if payload["action"] in {"publish_telegraph", "telegraph"}:
                page = await runtime_v2.publish_page_async(
                    payload["title"], content, payload["path"]
                )
                await self.reply(message, bot, f"Publicado: {page['url']}")
                return
            await self._delivery.deliver(
                bot,
                message.chat.id,
                "mdrich" if payload["action"] == "mdrich" else "chat",
                payload["title"],
                content,
            )
        except TelegramAPIError as exc:
            await self.reply(message, bot, telegram_error_text(exc))
        except TelegraphException as exc:
            await self.reply(
                message, bot, f"Telegraph recusou o HTML: {exc}"
            )
        except Exception as exc:
            self._log.exception("web_app_data")
            await self.reply(message, bot, f"Erro no processamento: {exc}")
