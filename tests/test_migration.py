import unittest
from datetime import datetime, timezone

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
from convert import rich_message_to_markdown


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


class MigrationTests(unittest.IsolatedAsyncioTestCase):
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
