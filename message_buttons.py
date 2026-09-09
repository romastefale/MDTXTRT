"""Mensagens do bot usam RichMessageButton 10.3 verde, sem fallback para teclado inline legado."""
from __future__ import annotations

import html


MESSAGE_APP_BUTTON = object()


def _rich_app_button(public_web_app_url) -> str:
    url = str(public_web_app_url() or "").strip()
    if not url:
        return ""
    return (
        '\n\n<tg-button-row align="center">\n'
        '<tg-button type="web_app" style="success" url="'
        + html.escape(url, quote=True)
        + '">MDTXTRT</tg-button>\n'
        '</tg-button-row>'
    )


def create_message_ui(
    *, original_reply_text, send_rich_message, public_web_app_url,
    message_context, private_chat_type,
):

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
        if message.chat.type != private_chat_type:
            return await original_reply_text(message, bot, text, **kwargs)

        button = _rich_app_button(public_web_app_url)
        if not button:
            return await original_reply_text(message, bot, text, **kwargs)

        # parse_mode pertence a sendMessage; o texto HTML suportado é aceito
        # diretamente pelo Rich Markdown do sendRichMessage.
        kwargs.pop("parse_mode", None)
        return await send_rich_message(
            bot,
            message.chat.id,
            str(text or "") + button,
            **message_context(message),
        )

    return mini_app_markup, reply_text
