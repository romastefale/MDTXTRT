import asyncio
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest

from aiogram.enums import ChatType

import message_buttons


ROOT = Path(__file__).resolve().parents[1]


def _load_message_runtime():
    spec = importlib.util.spec_from_file_location(
        "_mdtxtrt_message_buttons_main", ROOT / "main.py"
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("Não foi possível carregar main.py para o teste isolado")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    message_buttons.install(module)
    return module


class FakeMessage:
    def __init__(self, chat_type):
        self.chat = SimpleNamespace(id=12345, type=chat_type)
        self.message_id = 1
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
        self.runtime = _load_message_runtime()
        self.runtime.WEB_APP_URL = "https://example.com/app"

    def assert_green_web_app(self, bot):
        self.assertEqual(len(bot.rich), 1)
        markdown = bot.rich[0]["rich_message"].markdown or ""
        self.assertIn('type="web_app"', markdown)
        self.assertIn('style="success"', markdown)
        self.assertIn('url="https://example.com/app"', markdown)
        self.assertIn(">MDTXTRT</tg-button>", markdown)
        self.assertNotIn("Abrir Mini App", markdown)
        self.assertNotIn("reply_markup", bot.rich[0])

    def test_start_help_and_expired_link_use_rich_green_button(self):
        self.assertIs(
            self.runtime.mini_app_markup(), message_buttons.MESSAGE_APP_BUTTON
        )

        start_bot = FakeBot()
        asyncio.run(
            self.runtime.start(
                FakeMessage(ChatType.PRIVATE), start_bot, SimpleNamespace(args=None)
            )
        )
        self.assert_green_web_app(start_bot)
        self.assertEqual(start_bot.messages, [])

        help_bot = FakeBot()
        asyncio.run(self.runtime.help_cmd(FakeMessage(ChatType.PRIVATE), help_bot))
        self.assert_green_web_app(help_bot)
        self.assertEqual(help_bot.messages, [])

        expired_bot = FakeBot()
        asyncio.run(
            self.runtime.start(
                FakeMessage(ChatType.PRIVATE),
                expired_bot,
                SimpleNamespace(args="cnaoexiste"),
            )
        )
        self.assert_green_web_app(expired_bot)
        self.assertEqual(expired_bot.messages, [])

    def test_group_never_falls_back_to_legacy_inline_keyboard(self):
        bot = FakeBot()
        asyncio.run(self.runtime.help_cmd(FakeMessage(ChatType.GROUP), bot))
        self.assertEqual(bot.rich, [])
        self.assertEqual(len(bot.messages), 1)
        self.assertNotIn("reply_markup", bot.messages[0])


if __name__ == "__main__":
    unittest.main()
