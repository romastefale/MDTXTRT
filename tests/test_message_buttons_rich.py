import asyncio
from types import SimpleNamespace
import unittest

import app  # noqa: F401 - instala o runtime ativo
import main
import message_buttons


class FakeMessage:
    def __init__(self, chat_type):
        self.chat = SimpleNamespace(id=12345, type=chat_type)
        self.direct_messages_topic = None
        self.business_connection_id = None
        self.message_thread_id = None
        self.from_user = SimpleNamespace(id=12345)

    def as_ephemeral_message_parameters(self):
        return None


class FakeBot:
    def __init__(self):
        self.rich = []
        self.messages = []

    async def send_rich_message(self, **kwargs):
        self.rich.append(kwargs)

    async def send_message(self, **kwargs):
        self.messages.append(kwargs)


class MessageButtonsRichTest(unittest.TestCase):
    def setUp(self):
        self.previous_url = main.WEB_APP_URL
        main.WEB_APP_URL = "https://example.com/app"

    def tearDown(self):
        main.WEB_APP_URL = self.previous_url

    def assert_green_web_app(self, bot):
        self.assertEqual(len(bot.rich), 1)
        markdown = bot.rich[0]["rich_message"].markdown or ""
        self.assertIn('type="web_app"', markdown)
        self.assertIn('style="success"', markdown)
        self.assertIn('url="https://example.com/app"', markdown)
        self.assertNotIn("reply_markup", bot.rich[0])

    def test_start_help_and_expired_link_use_rich_green_button(self):
        self.assertIs(main.mini_app_markup(), message_buttons.MESSAGE_APP_BUTTON)

        start_bot = FakeBot()
        asyncio.run(main.start(FakeMessage(main.ChatType.PRIVATE), start_bot, SimpleNamespace(args=None)))
        self.assert_green_web_app(start_bot)
        self.assertEqual(start_bot.messages, [])

        help_bot = FakeBot()
        asyncio.run(main.help_cmd(FakeMessage(main.ChatType.PRIVATE), help_bot))
        self.assert_green_web_app(help_bot)
        self.assertEqual(help_bot.messages, [])

        expired_bot = FakeBot()
        asyncio.run(main.start(FakeMessage(main.ChatType.PRIVATE), expired_bot, SimpleNamespace(args="cnaoexiste")))
        self.assert_green_web_app(expired_bot)
        self.assertEqual(expired_bot.messages, [])

    def test_group_never_falls_back_to_legacy_inline_keyboard(self):
        bot = FakeBot()
        asyncio.run(main.help_cmd(FakeMessage(main.ChatType.GROUP), bot))
        self.assertEqual(bot.rich, [])
        self.assertEqual(len(bot.messages), 1)
        self.assertNotIn("reply_markup", bot.messages[0])


if __name__ == "__main__":
    unittest.main()
