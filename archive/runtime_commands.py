"""UI dos comandos sobre o núcleo de handlers composto."""
from __future__ import annotations

import dm_command_ui

from main import ChatType, HELP_TEXT, ParseMode, reply_text as base_reply_text
from runtime_commands_core import (
    CommandService as _CommandService,
    DeliveryService,
    _COMMAND_CONTEXT,
)


class CommandService(_CommandService):
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
                "Converte Markdown em rich text do Telegram e exporta mensagens em .md.\n\n"
                "• Mini App — redigir, pré-visualizar, enviar ao chat e publicar no Telegraph\n"
                "• Arquivo .md anexado ou encaminhado — vira mensagem formatada (tgrich)\n"
                "• /tgrich — a mesma conversão, respondendo a um arquivo compatível\n"
                "• /mdrich — responde a uma mensagem e exporta .md otimizado\n"
                "• /help — comandos e a diferença entre chat e Mini App"
            )
            await self.reply(
                message,
                bot,
                text,
                reply_markup=self.mini_app_markup(),
                parse_mode=ParseMode.HTML,
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
            HELP_TEXT,
            parse_mode=ParseMode.HTML,
        )
