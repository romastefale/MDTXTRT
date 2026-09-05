"""Migra botões de mensagem legados para RichMessageButton 10.3 verde."""
from __future__ import annotations

import html


MESSAGE_APP_BUTTON = object()


def _rich_app_button(base_module) -> str:
    url = str(base_module.public_web_app_url() or "").strip()
    if not url:
        return ""
    return (
        '\n\n<tg-button-row align="center">\n'
        '<tg-button type="web_app" style="success" url="'
        + html.escape(url, quote=True)
        + '">Abrir Mini App</tg-button>\n'
        '</tg-button-row>'
    )


def install(base_module) -> None:
    original_reply_text = base_module.reply_text

    def mini_app_markup():
        # Marcador interno: nunca é enviado como ReplyMarkup.
        return MESSAGE_APP_BUTTON

    async def reply_text(message, bot, text: str, **kwargs):
        markup = kwargs.pop("reply_markup", None)
        if markup is not MESSAGE_APP_BUTTON:
            if markup is not None:
                kwargs["reply_markup"] = markup
            return await original_reply_text(message, bot, text, **kwargs)

        # RichMessageButton web_app é válido somente em conversa privada com o bot.
        if message.chat.type != base_module.ChatType.PRIVATE:
            return await original_reply_text(message, bot, text, **kwargs)

        button = _rich_app_button(base_module)
        if not button:
            return await original_reply_text(message, bot, text, **kwargs)

        # parse_mode pertence a sendMessage; o texto HTML suportado é aceito
        # diretamente pelo Rich Markdown do sendRichMessage.
        kwargs.pop("parse_mode", None)
        return await base_module.send_rich_message(
            bot,
            message.chat.id,
            str(text or "") + button,
            **base_module._message_context(message),
        )

    base_module.mini_app_markup = mini_app_markup
    base_module.reply_text = reply_text
