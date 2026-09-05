"""Layout Rich nativo para mensagens de interface dos comandos em DM."""
from __future__ import annotations

from contextvars import ContextVar
import html


_COMMAND_CONTEXT: ContextVar[tuple[str, str] | None] = ContextVar(
    "mdtxtrt_dm_command_context", default=None
)


def _paragraphs(text: str) -> str:
    normalized = str(text or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not normalized:
        return ""
    blocks: list[str] = []
    for paragraph in normalized.split("\n\n"):
        lines = [html.escape(line.strip()) for line in paragraph.split("\n") if line.strip()]
        if lines:
            blocks.append("<p>" + "<br>".join(lines) + "</p>")
    return "\n".join(blocks)


def _frame(command: str, subtitle: str, body: str) -> str:
    parts = [
        "<h1>MDTXTRT</h1>",
        f"<h3>{html.escape(subtitle)}</h3>",
        html.escape(command),
    ]
    rendered_body = _paragraphs(body)
    if rendered_body:
        parts.append(rendered_body)
    return "\n\n".join(parts)


_START_BODY = (
    "Converte Markdown em Rich Text do Telegram e exporta mensagens em .md.\n\n"
    "Mini App: redija, pré-visualize, envie ao chat e publique no Telegraph.\n\n"
    "/tgrich — converte Markdown em Rich Text do Telegram.\n"
    "/mdrich — exporta uma mensagem em .md.\n"
    "/help — mostra a ajuda do bot."
)

_HELP_BODY = (
    "/start — abre o Mini App e resume as funções.\n"
    "/help — mostra esta ajuda.\n"
    "/tgrich — converte Markdown em Rich Text do Telegram. Responda a um arquivo compatível, anexe um .md ou escreva o texto após o comando.\n"
    "/mdrich — responda a uma mensagem para exportá-la em .md.\n\n"
    "Formatos: .md, .markdown e .txt.\n\n"
    "Use o Mini App para redigir, pré-visualizar, enviar ao chat e publicar no Telegraph."
)

_META = {
    "/start": "Início",
    "/help": "Comandos",
    "/tgrich": "Markdown → Rich Text",
    "/mdrich": "Telegram → Markdown",
}


def install(base_module) -> None:
    previous_reply_text = base_module.reply_text
    previous_start = base_module.start
    previous_tgrich = base_module.tgrich
    previous_mdrich = base_module.mdrich

    def is_private(message) -> bool:
        return message.chat.type == base_module.ChatType.PRIVATE

    async def send_frame(message, bot, command: str, subtitle: str, body: str):
        return await previous_reply_text(
            message,
            bot,
            _frame(command, subtitle, body),
            reply_markup=base_module.mini_app_markup(),
        )

    async def reply_text(message, bot, text: str, **kwargs):
        context = _COMMAND_CONTEXT.get()
        if not context or not is_private(message):
            return await previous_reply_text(message, bot, text, **kwargs)
        command, subtitle = context
        kwargs.pop("parse_mode", None)
        kwargs["reply_markup"] = base_module.mini_app_markup()
        return await previous_reply_text(
            message,
            bot,
            _frame(command, subtitle, str(text or "")),
            **kwargs,
        )

    async def start(message, bot, command):
        if not is_private(message):
            return await previous_start(message, bot, command)
        arg = ((command.args or "").split()[0] if command.args else "").strip()
        if not arg:
            return await send_frame(message, bot, "/start", _META["/start"], _START_BODY)
        token = _COMMAND_CONTEXT.set(("/start", _META["/start"]))
        try:
            return await previous_start(message, bot, command)
        finally:
            _COMMAND_CONTEXT.reset(token)

    async def help_cmd(message, bot):
        if not is_private(message):
            return await base_module._dm_command_ui_original_help(message, bot)
        return await send_frame(message, bot, "/help", _META["/help"], _HELP_BODY)

    async def tgrich(message, bot):
        if not is_private(message):
            return await previous_tgrich(message, bot)
        token = _COMMAND_CONTEXT.set(("/tgrich", _META["/tgrich"]))
        try:
            return await previous_tgrich(message, bot)
        finally:
            _COMMAND_CONTEXT.reset(token)

    async def mdrich(message, bot):
        if not is_private(message):
            return await previous_mdrich(message, bot)
        token = _COMMAND_CONTEXT.set(("/mdrich", _META["/mdrich"]))
        try:
            return await previous_mdrich(message, bot)
        finally:
            _COMMAND_CONTEXT.reset(token)

    base_module._dm_command_ui_original_help = base_module.help_cmd
    base_module.reply_text = reply_text
    base_module.start = start
    base_module.help_cmd = help_cmd
    base_module.tgrich = tgrich
    base_module.mdrich = mdrich
