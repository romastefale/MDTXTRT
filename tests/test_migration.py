import hashlib
import hmac
import json
import os
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from unittest.mock import patch

from aiogram.exceptions import TelegramNetworkError
from aiogram.methods import DeleteWebhook
from aiogram.types import (
    Chat,
    InputRichMessage,
    Message,
    RichBlockParagraph,
    RichBlockButtons,
    RichBlockList,
    RichBlockListItem,
    RichMessage,
    RichMessageButton,
    RichTextBold,
    RichTextButton,
    RichTextMathematicalExpression,
)

import main
from convert import markdown_for_rich_api, rich_message_to_markdown


class RecordingBot:
    def __init__(self):
        self.calls = []

    async def send_message(self, **kwargs):
        self.calls.append(("send_message", kwargs))

    async def send_rich_message(self, **kwargs):
        self.calls.append(("send_rich_message", kwargs))


def make_message(chat_type: str) -> Message:
    return Message(
        message_id=17,
        date=datetime.now(timezone.utc),
        chat=Chat(id=42, type=chat_type),
        text="teste",
    )


def signed_init_data(token: str, auth_date: int | None = None) -> str:
    fields = {
        "auth_date": str(auth_date or int(time.time())),
        "query_id": "AAE-regression",
        "signature": "third-party-signature-is-part-of-the-data-check-string",
        "user": json.dumps(
            {"id": 42, "first_name": "Teste"},
            separators=(",", ":"),
            ensure_ascii=False,
        ),
    }
    data_check_string = "\n".join(f"{key}={fields[key]}" for key in sorted(fields))
    secret_key = hmac.new(
        b"WebAppData", token.encode("utf-8"), hashlib.sha256
    ).digest()
    fields["hash"] = hmac.new(
        secret_key, data_check_string.encode("utf-8"), hashlib.sha256
    ).hexdigest()
    return urlencode(fields)


class MigrationTests(unittest.IsolatedAsyncioTestCase):
    def test_each_telegraph_publication_uses_a_fresh_anonymous_account(self):
        clients = []

        class FakeTelegraph:
            def __init__(self):
                self.account_calls = []
                self.page_calls = []
                clients.append(self)

            def create_account(self, **kwargs):
                self.account_calls.append(kwargs)
                return {"access_token": "discarded"}

            def create_page(self, **kwargs):
                self.page_calls.append(kwargs)
                return {"url": "https://telegra.ph/page", "path": "page"}

        with patch.object(main, "Telegraph", FakeTelegraph):
            main.publish_page("Primeira", "texto")
            main.publish_page("Segunda", "texto")

        self.assertEqual(len(clients), 2)
        self.assertIsNot(clients[0], clients[1])
        for client in clients:
            self.assertEqual(client.account_calls, [{"short_name": "MDTXTRT"}])
            self.assertNotIn("author_name", client.page_calls[0])

    def test_registered_bot_commands_use_aiogram_keyword_models(self):
        commands = main.bot_commands()
        self.assertEqual(
            [item.command for item in commands],
            ["start", "help", "tgrich", "mdrich"],
        )
        self.assertTrue(all(item.description for item in commands))

    def test_mini_app_markup_uses_aiogram_keyword_only_models(self):
        with patch.object(main, "WEB_APP_URL", "https://example.com"):
            markup = main.mini_app_markup()
        button = markup.inline_keyboard[0][0]
        self.assertEqual(button.text, "Abrir Mini App")
        self.assertEqual(button.web_app.url, "https://example.com")

    def test_webapp_signature_field_is_included_in_native_validation(self):
        token = "123456:ABCDEF_123456"
        raw = signed_init_data(token)
        with patch.object(main, "TOKEN", token):
            user = main.validate_init_data(raw)
        self.assertIsNotNone(user)
        self.assertEqual(user["id"], 42)

    def test_webapp_init_data_expiry_is_preserved(self):
        token = "123456:ABCDEF_123456"
        raw = signed_init_data(token, int(time.time()) - main.INIT_MAX_AGE - 5)
        with patch.object(main, "TOKEN", token):
            self.assertIsNone(main.validate_init_data(raw))

    def test_web_app_url_falls_back_to_railway_public_domain(self):
        with patch.object(main, "WEB_APP_URL", ""), patch.dict(
            os.environ,
            {"RAILWAY_PUBLIC_DOMAIN": "current.example"},
            clear=False,
        ):
            self.assertEqual(main.public_web_app_url(), "https://current.example")

    def test_polling_preserves_sequential_and_legacy_update_selection(self):
        self.assertIs(main.POLLING_OPTIONS["handle_as_tasks"], False)
        self.assertIsNone(main.POLLING_OPTIONS["allowed_updates"])
        self.assertIs(main.POLLING_OPTIONS["handle_signals"], False)
        self.assertIs(main.POLLING_OPTIONS["close_bot_session"], False)

    async def test_private_shortcut_does_not_force_a_reply(self):
        bot = RecordingBot()
        await main.reply_text(make_message("private"), bot, "ok")
        self.assertIsNone(bot.calls[0][1]["reply_parameters"])

    async def test_group_shortcut_keeps_the_old_reply_default(self):
        bot = RecordingBot()
        await main.reply_text(make_message("group"), bot, "ok")
        reply = bot.calls[0][1]["reply_parameters"]
        self.assertEqual(reply.message_id, 17)

    async def test_send_rich_message_uses_native_aiogram_model(self):
        bot = RecordingBot()
        await main.send_rich_message(bot, 42, "# título", reply_to_message_id=9)
        method, kwargs = bot.calls[0]
        self.assertEqual(method, "send_rich_message")
        self.assertIsInstance(kwargs["rich_message"], InputRichMessage)
        self.assertEqual(kwargs["rich_message"].markdown, "# título")
        self.assertEqual(kwargs["reply_parameters"].message_id, 9)
        self.assertEqual(kwargs["request_timeout"], 60)

    def test_incoming_native_rich_model_round_trips_to_markdown(self):
        rich = RichMessage(
            blocks=[RichBlockParagraph(text=RichTextBold(text="texto"))]
        )
        self.assertEqual(rich_message_to_markdown(rich), "**texto**")

    def test_bot_api_10_3_rich_buttons_are_not_silently_lost(self):
        button = RichMessageButton(text="Abrir", url="https://example.com")
        block = RichMessage(blocks=[RichBlockButtons(buttons=[button])])
        inline = RichMessage(
            blocks=[RichBlockParagraph(text=RichTextButton(button=button))]
        )
        self.assertEqual(
            rich_message_to_markdown(block), "[Abrir](https://example.com)"
        )
        self.assertEqual(
            rich_message_to_markdown(inline), "[Abrir](https://example.com)"
        )

    def test_rich_mathematical_expression_is_preserved(self):
        rich = RichMessage(
            blocks=[
                RichBlockParagraph(
                    text=RichTextMathematicalExpression(expression="x^2")
                )
            ]
        )
        self.assertEqual(rich_message_to_markdown(rich), "$x^2$")

    def test_expandable_quote_uses_native_10_3_blockquote(self):
        self.assertEqual(
            markdown_for_rich_api("**> título\n> corpo"),
            "<blockquote expandable>\ntítulo\ncorpo\n</blockquote>",
        )

    def test_mini_app_has_one_preview_and_rich_10_3_generators(self):
        index = Path(main.INDEX_PATH).read_text(encoding="utf-8")
        self.assertEqual(index.count('data-view="preview"'), 1)
        self.assertNotIn('data-view="tgrich"', index)
        self.assertNotIn("window.prompt", index)
        for required in (
            '{ l: "H6"',
            'blockquote expandable',
            'tg-button-row',
            'tg-collage',
            'tg-slideshow',
            'tg-map',
            'Fórmula bloco',
            'Documento URL',
        ):
            self.assertIn(required, index)

    def test_legacy_wrapper_fallback_is_rejected(self):
        class LegacyWrapper:
            def to_dict(self):
                return {"markdown": "não deve ser aceito"}

        with self.assertRaisesRegex(TypeError, "Objeto rich não suportado"):
            rich_message_to_markdown(LegacyWrapper())

    def test_native_rich_lists_keep_order_and_checkbox_state(self):
        rich = RichMessage(
            blocks=[
                RichBlockList(
                    items=[
                        RichBlockListItem(
                            label="3.",
                            value=3,
                            type="1",
                            blocks=[RichBlockParagraph(text="terceiro")],
                        ),
                        RichBlockListItem(
                            label="",
                            has_checkbox=True,
                            is_checked=True,
                            blocks=[RichBlockParagraph(text="feito")],
                        ),
                    ]
                )
            ]
        )
        self.assertEqual(
            rich_message_to_markdown(rich), "3. terceiro\n- [x] feito"
        )

    def test_media_filename_matches_the_validated_mime(self):
        self.assertEqual(
            main.media_filename({"name": "foto.bin", "mime": "image/png"}, "abc"),
            "foto.png",
        )
        self.assertEqual(
            main.media_filename({"name": "foto.webp", "mime": "image/webp"}, "abc"),
            "foto.webp",
        )

    async def test_webhook_bootstrap_retries_transient_failure(self):
        class RetryBot:
            def __init__(self):
                self.calls = 0

            async def delete_webhook(self, **kwargs):
                self.calls += 1
                if self.calls == 1:
                    raise TelegramNetworkError(DeleteWebhook(), "temporário")

        delays = []

        async def no_wait(delay):
            delays.append(delay)

        bot = RetryBot()
        await main.delete_webhook_with_retry(bot, sleep=no_wait)
        self.assertEqual(bot.calls, 2)
        self.assertEqual(delays, [1.0])


if __name__ == "__main__":
    unittest.main()
