import json
import time
import unittest
from unittest.mock import AsyncMock, patch

from aiogram.types import InputMediaVideo, InputRichMessage

import main
import runtime_v2
from canonical import CanonicalDocument


class FakeJsonRequest:
    def __init__(self, payload, headers=None, remote="127.0.0.1"):
        self.payload = payload
        self.headers = headers or {}
        self.remote = remote

    async def json(self):
        return self.payload


class RuntimeV2Tests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        runtime_v2._BASE = main
        runtime_v2._PUBLISH_RATE.clear()
        main.MEDIA.clear()

    def tearDown(self):
        runtime_v2._PUBLISH_RATE.clear()
        main.MEDIA.clear()

    def test_http_media_stays_native_rich_markdown(self):
        md, refs = CanonicalDocument.from_markdown(
            '![](https://example.com/photo.jpg "foto")'
        ).telegram_markdown()
        self.assertEqual(md, '![](https://example.com/photo.jpg "foto")')
        self.assertEqual(refs, ())

    def test_local_video_upload_becomes_typed_rich_attachment(self):
        main.MEDIA["abc123"] = {
            "data": b"video",
            "name": "clip.mp4",
            "mime": "video/mp4",
            "kind": "video",
            "exp": time.time() + 60,
        }
        rich = runtime_v2.build_rich_message(
            '![](mdtxtrt://video/abc123 "clip")'
        )
        self.assertIsInstance(rich, InputRichMessage)
        self.assertIn("tg://video?id=abc123", rich.markdown)
        self.assertEqual(len(rich.media), 1)
        self.assertIsInstance(rich.media[0].media, InputMediaVideo)

    def test_telegraph_uses_fresh_account_and_reports_degradation(self):
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

        with patch.object(runtime_v2, "Telegraph", FakeTelegraph):
            first = runtime_v2.publish_page("Primeira", "# H1\n\n$$x^2$$")
            second = runtime_v2.publish_page("Segunda", "texto")

        self.assertEqual(len(clients), 2)
        self.assertIsNot(clients[0], clients[1])
        self.assertTrue(first["degradations"])
        self.assertEqual(second["degradations"], [])
        for client in clients:
            self.assertEqual(client.account_calls, [{"short_name": "MDTXTRT"}])
            self.assertNotIn("author_name", client.page_calls[0])

    async def test_publish_api_allows_anonymous_telegraph(self):
        request = FakeJsonRequest({"title": "Teste", "content": "texto"})
        result = {
            "url": "https://telegra.ph/x",
            "path": "x",
            "title": "Teste",
            "degradations": [],
        }
        with patch.object(runtime_v2, "publish_page_async", AsyncMock(return_value=result)):
            response = await runtime_v2.api_publish(request)
        self.assertEqual(response.status, 200)
        self.assertTrue(json.loads(response.text)["ok"])

    def test_telegraph_projection_is_explicit_about_non_native_features(self):
        projection = CanonicalDocument.from_markdown(
            "# H1\n\n| a | b |\n|---|---|\n|1|2|\n\n$$x^2$$"
        ).telegraph()
        self.assertIn("<h3>", projection.html)
        self.assertIn("<pre>", projection.html)
        self.assertGreaterEqual(len(projection.degradations), 3)

    def test_active_editor_has_persistent_contextual_toolbar(self):
        index = runtime_v2.render_index()
        self.assertNotIn('id="btnInsert"', index)
        self.assertIn("replaceSelection('<u>','</u>')", index)
        self.assertNotIn("replaceSelection('__','__')", index)
        for required in (
            'data-menu="text"', 'data-menu="heading"', 'data-menu="quote"',
            'data-menu="code"', 'data-menu="math"', 'data-menu="list"',
            'data-menu="media"', 'data-menu="structure"', "['H'+n",
            'blockquote expandable', 'tg-button-row', 'tg-collage',
            'tg-slideshow', 'tg-map', 'mdtxtrt://',
        ):
            self.assertIn(required, index)
        self.assertNotIn('# Título"', index)
        self.assertNotIn('==texto marcado==', index)

    def test_install_replaces_only_semantic_runtime_surfaces(self):
        original_start = main.start
        original_dispatcher = main.build_dispatcher
        runtime_v2.install(main)
        self.assertIs(main.start, original_start)
        self.assertIs(main.build_dispatcher, original_dispatcher)
        self.assertIs(main.build_rich_message, runtime_v2.build_rich_message)
        self.assertIs(main.api_publish, runtime_v2.api_publish)
        self.assertIs(main.api_media, runtime_v2.api_media)
        self.assertIs(main.serve_index, runtime_v2.serve_index)


if __name__ == "__main__":
    unittest.main()
