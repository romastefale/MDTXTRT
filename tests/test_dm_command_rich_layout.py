import asyncio
from types import SimpleNamespace
import unittest

import app  # noqa: F401 - instala o runtime ativo
import main


class FakeMessage:
    def __init__(self, text="", *, chat_type=None):
        self.chat = SimpleNamespace(id=12345, type=chat_type or main.ChatType.PRIVATE)
        self.message_id = 1
        self.direct_messages_topic = None
        self.business_connection_id = None
        self.message_thread_id = None
        self.from_user = SimpleNamespace(id=12345)
        self.text = text
        self.caption = None
        self.document = None
        self.reply_to_message = None

    def as_ephemeral_message_parameters(self):
        return None


class FakeBot:
    def __init__(self):
        self.rich = []
        self.messages = []
        self.documents = []

    async def send_rich_message(self, **kwargs):
        self.rich.append(kwargs)

    async def send_message(self, **kwargs):
        self.messages.append(kwargs)

    async def send_document(self, **kwargs):
        self.documents.append(kwargs)


class DmCommandRichLayoutTest(unittest.TestCase):
    def setUp(self):
        self.previous_url = main.WEB_APP_URL
        main.WEB_APP_URL = "https://example.com/app"

    def tearDown(self):
        main.WEB_APP_URL = self.previous_url

    def assert_layout(self, bot, command, subtitle):
        self.assertEqual(len(bot.rich), 1)
        self.assertEqual(bot.messages, [])
        markdown = bot.rich[0]["rich_message"].markdown or ""
        self.assertIn("<h1>MDTXTRT</h1>", markdown)
        self.assertIn(f"<h3>{subtitle}</h3>", markdown)
        self.assertIn(f"\n{command}\n", markdown)
        self.assertNotIn(f"<code>{command}</code>", markdown)
        self.assertIn("<p>", markdown)
        self.assertIn('type="web_app"', markdown)
        self.assertIn('style="success"', markdown)
        self.assertIn('url="https://example.com/app"', markdown)
        self.assertNotIn("InlineKeyboardMarkup", markdown)
        return markdown

    def test_start_and_help_use_native_rich_layout(self):
        start_bot = FakeBot()
        asyncio.run(main.start(FakeMessage("/start"), start_bot, SimpleNamespace(args=None)))
        start_md = self.assert_layout(start_bot, "/start", "Início")
        self.assertIn("</p>\n<p>", start_md)
        self.assertIn("<br>", start_md)

        help_bot = FakeBot()
        asyncio.run(main.help_cmd(FakeMessage("/help"), help_bot))
        help_md = self.assert_layout(help_bot, "/help", "Comandos")
        self.assertIn("/start", help_md)
        self.assertIn("/tgrich", help_md)
        self.assertIn("/mdrich", help_md)
        self.assertIn("<br>", help_md)

    def test_tgrich_and_mdrich_control_messages_use_same_layout(self):
        tgrich_bot = FakeBot()
        asyncio.run(main.tgrich(FakeMessage("/tgrich"), tgrich_bot))
        tgrich_md = self.assert_layout(tgrich_bot, "/tgrich", "Markdown → Rich Text")
        self.assertIn("Responda a um arquivo", tgrich_md)

        mdrich_bot = FakeBot()
        asyncio.run(main.mdrich(FakeMessage("/mdrich"), mdrich_bot))
        mdrich_md = self.assert_layout(mdrich_bot, "/mdrich", "Telegram → Markdown")
        self.assertIn("Responda a uma mensagem", mdrich_md)


if __name__ == "__main__":
    unittest.main()
