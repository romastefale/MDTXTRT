import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from aiogram.types import InlineQueryResultArticle

import main
import runtime_v2


class FakeJsonRequest:
    def __init__(self, payload, *, app=None, headers=None, remote="127.0.0.1"):
        self.payload = payload
        self.app = app or {}
        self.headers = headers or {}
        self.remote = remote

    async def json(self):
        return self.payload


class TitleFlowTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        runtime_v2._BASE = main

    def test_editor_moves_title_to_export_and_telegraph_actions(self):
        index = runtime_v2.render_index()
        self.assertNotIn('<label>Título<input id="inpTitle"', index)
        self.assertIn('id="inpTitle" type="hidden"', index)
        self.assertIn("legacyTitle.remove()", index)
        self.assertIn("localStorage.removeItem('mdtxtrt_title')", index)
        self.assertIn("find(item=>item.trim())", index)
        self.assertIn("input.placeholder=suggestion", index)
        self.assertIn("deliver('chat','Sem título')", index)
        self.assertIn("titleForm('md')", index)
        self.assertIn("titleForm('telegraph')", index)

    def test_telegraph_success_exposes_copy_open_and_native_share(self):
        index = runtime_v2.render_index()
        self.assertIn("Publicação criada", index)
        self.assertIn("Copiar link", index)
        self.assertIn("Abrir publicação", index)
        self.assertIn("Compartilhar no Telegram", index)
        self.assertIn("tg.shareMessage(prepared.prepared_message_id", index)
        self.assertNotIn("?start=", index.split("function renderTelegraphSuccess", 1)[-1])

    def test_entrypoint_registers_native_share_endpoint(self):
        entrypoint = Path("app.py").read_text(encoding="utf-8")
        self.assertIn('app.router.add_post("/api/share-telegraph", runtime_v2.api_share_telegraph)', entrypoint)

    async def test_native_share_requires_valid_telegram_session(self):
        request = FakeJsonRequest(
            {"title": "Artigo", "url": "https://telegra.ph/artigo-01"}
        )
        with patch.object(main, "init_data_from_request", return_value=""), patch.object(
            main, "validate_init_data", return_value=None
        ):
            response = await runtime_v2.api_share_telegraph(request)
        self.assertEqual(response.status, 401)
        self.assertFalse(json.loads(response.text)["ok"])

    async def test_native_share_prepares_message_for_all_chat_types(self):
        save_prepared = AsyncMock(return_value=SimpleNamespace(id="prepared-123"))
        bot_runtime = SimpleNamespace(bot=SimpleNamespace(save_prepared_inline_message=save_prepared))
        request = FakeJsonRequest(
            {"title": "Artigo", "url": "https://telegra.ph/artigo-01"},
            app={"bot": bot_runtime},
        )
        with patch.object(main, "init_data_from_request", return_value="signed"), patch.object(
            main, "validate_init_data", return_value={"id": 123456}
        ):
            response = await runtime_v2.api_share_telegraph(request)

        payload = json.loads(response.text)
        self.assertEqual(response.status, 200)
        self.assertEqual(payload["prepared_message_id"], "prepared-123")
        kwargs = save_prepared.await_args.kwargs
        self.assertEqual(kwargs["user_id"], 123456)
        self.assertTrue(kwargs["allow_user_chats"])
        self.assertTrue(kwargs["allow_bot_chats"])
        self.assertTrue(kwargs["allow_group_chats"])
        self.assertTrue(kwargs["allow_channel_chats"])
        self.assertIsInstance(kwargs["result"], InlineQueryResultArticle)
        self.assertEqual(
            kwargs["result"].input_message_content.message_text,
            "Acabei de publicar este artigo no Telegraph\nhttps://telegra.ph/artigo-01",
        )

    async def test_native_share_rejects_non_telegraph_url(self):
        request = FakeJsonRequest(
            {"title": "Artigo", "url": "https://example.com/not-telegraph"}
        )
        with patch.object(main, "init_data_from_request", return_value="signed"), patch.object(
            main, "validate_init_data", return_value={"id": 123456}
        ):
            response = await runtime_v2.api_share_telegraph(request)
        self.assertEqual(response.status, 400)
        self.assertIn("Telegraph", json.loads(response.text)["error"])


if __name__ == "__main__":
    unittest.main()
