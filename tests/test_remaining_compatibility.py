import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from aiogram.types import InputRichMessage

import rich_delivery
import rich_integrity
import rich_media
import rich_roundtrip
import runtime_v2
from canonical import CanonicalDocument
from rich_delivery import RICH_NESTING_LIMIT, validate_rich_structure


class FakeJsonRequest:
    def __init__(self, payload):
        self._payload = payload
        self.headers = {}
        self.remote = "127.0.0.1"
    async def json(self):
        return self._payload


class RemainingCompatibilityTests(unittest.IsolatedAsyncioTestCase):
    async def test_canonical_whitespace_changes_preflight_fingerprint(self):
        base = SimpleNamespace(init_data_from_request=lambda _data, _request: "")
        with patch.object(runtime_v2, "_BASE", base):
            first = await runtime_v2.api_publish(FakeJsonRequest({"content": "  texto\n", "preflight_only": True}))
            second = await runtime_v2.api_publish(FakeJsonRequest({"content": "texto", "preflight_only": True}))
        self.assertNotEqual(json.loads(first.text)["fingerprint"], json.loads(second.text)["fingerprint"])

    def test_telegraph_limit_blocks_before_client_creation_even_if_confirmed(self):
        source = "x" * 70000
        report = runtime_v2.telegraph_preflight(source)
        self.assertFalse(report["publishable"])
        self.assertGreater(report["content_bytes"], report["content_limit_bytes"])
        with patch.object(runtime_v2, "Telegraph", side_effect=AssertionError("remote client must not be created")):
            with self.assertRaises(runtime_v2.TelegraphPreflightRequired):
                runtime_v2.publish_page("Grande", source, allow_adaptations=True, allow_unsupported=True)

    def test_table_caption_and_visual_attributes_survive_telegraph_projection(self):
        source = """<table bordered striped compact data-layout="wide">
<caption><b>Legenda rica</b></caption>
<tr><th>A</th><td>B</td></tr>
</table>"""
        projection = CanonicalDocument.from_markdown(source).telegraph()
        self.assertIn("Legenda: Legenda rica", projection.html)
        self.assertIn("bordered", projection.html)
        self.assertIn("striped", projection.html)
        self.assertIn("compact", projection.html)
        self.assertIn("data-layout=wide", projection.html)
        self.assertTrue(any("tabela" in item.lower() and "atributos" in item.lower() for item in projection.adaptations))

    def test_media_credit_is_preserved_and_reported(self):
        source = '<figure><img src="https://example.com/a.jpg"><figcaption>Foto<cite>Autora</cite></figcaption></figure>'
        projection = CanonicalDocument.from_markdown(source).telegraph()
        self.assertIn("Foto", projection.html)
        self.assertIn("Autora", projection.html)
        self.assertTrue(any("crédito de mídia" in item.lower() for item in projection.adaptations))

    def test_map_figure_and_standalone_share_projection_and_keep_all_attributes(self):
        standalone = CanonicalDocument.from_markdown('<tg-map height="300" long="-46.6" zoom="14" lat="-23.5" width="500"/>').telegraph()
        figured = CanonicalDocument.from_markdown('<figure><tg-map height="300" long="-46.6" zoom="14" lat="-23.5" width="500"/><figcaption>Centro<cite>Fonte</cite></figcaption></figure>').telegraph()
        for projection in (standalone, figured):
            for token in ("-23.5", "-46.6", "zoom=14", "width=500", "height=300"):
                self.assertIn(token, projection.html)
            self.assertTrue(any("dimensões" in item.lower() for item in projection.adaptations))
        self.assertIn("Centro", figured.html)
        self.assertIn("Fonte", figured.html)

    def test_rich_nesting_accepts_16_and_rejects_17(self):
        valid = "<details>" * RICH_NESTING_LIMIT + "x" + "</details>" * RICH_NESTING_LIMIT
        invalid = "<details>" * (RICH_NESTING_LIMIT + 1) + "x" + "</details>" * (RICH_NESTING_LIMIT + 1)
        self.assertEqual(validate_rich_structure(valid)["nesting"], RICH_NESTING_LIMIT)
        with self.assertRaisesRegex(ValueError, "profundidade"):
            validate_rich_structure(invalid)

    def test_markdown_structure_and_inline_formatting_contribute_to_nesting(self):
        source = ("> " * 14) + "**_texto_**"
        with self.assertRaisesRegex(ValueError, "profundidade"):
            validate_rich_structure(source)

    async def _assert_send_rejected_before_api(self, source, message):
        surface = SimpleNamespace(
            build_rich_message=lambda _content: InputRichMessage(markdown=source)
        )
        rich_delivery.install(surface)
        bot = SimpleNamespace(send_rich_message=AsyncMock())
        with self.assertRaisesRegex(ValueError, message):
            await surface.send_rich_message(bot, 42, source)
        bot.send_rich_message.assert_not_awaited()

    async def test_media_must_be_a_separate_rich_block(self):
        await self._assert_send_rejected_before_api(
            '<p>antes<img src="https://example.com/a.jpg">depois</p>',
            "bloco separado",
        )
        with self.assertRaisesRegex(ValueError, "bloco separado"):
            validate_rich_structure('texto ![](https://example.com/a.jpg)')

    async def test_table_cells_reject_block_content_without_reduction(self):
        await self._assert_send_rejected_before_api(
            "<table><tr><td><blockquote>não</blockquote></td></tr></table>",
            "Célula",
        )

    def test_semantic_rich_types_round_trip_with_exact_parameters(self):
        expected = [
            ("mention", "username", "alice", "@alice"),
            ("hashtag", "hashtag", "Topico", "#Topico"),
            ("cashtag", "cashtag", "USD", "$USD"),
            ("bot_command", "bot_command", "help", "/help"),
            ("bank_card_number", "bank_card_number", "424242", "4242 42"),
        ]
        incoming = {"blocks": [{"type": "paragraph", "text": [
            {"type": typ, "text": visible, field: parameter}
            for typ, field, parameter, visible in expected
        ]}]}
        canonical = rich_integrity._blocks_html(rich_roundtrip, incoming["blocks"])
        active_surface = SimpleNamespace(MEDIA={})
        rich_media.install(active_surface)
        outgoing = active_surface.build_rich_message(canonical)
        self.assertIsNone(outgoing.markdown)
        self.assertTrue(outgoing.skip_entity_detection)
        nodes = outgoing.model_dump(exclude_none=True)["blocks"][0]["text"]
        for node, (typ, field, parameter, visible) in zip(nodes, expected):
            self.assertEqual(node["type"], typ)
            self.assertEqual(node[field], parameter)
            self.assertEqual(node["text"], visible)

    def test_button_row_alignment_is_explicit_adaptation(self):
        projection = CanonicalDocument.from_markdown('<tg-button-row align="right"><tg-button type="url" url="https://example.com">Abrir</tg-button></tg-button-row>').telegraph()
        self.assertIn("align=right", projection.html)
        self.assertTrue(any("alinhamento" in item.lower() for item in projection.adaptations))

    def test_preflight_and_published_transform_are_identical(self):
        source = '<table compact><caption>Cap</caption><tr><td>A</td></tr></table>'
        report = runtime_v2.telegraph_preflight(source)
        calls = []
        class FakeTelegraph:
            def create_account(self, **kwargs): calls.append(("account", kwargs))
            def create_page(self, **kwargs): calls.append(("page", kwargs)); return {"url": "https://telegra.ph/x", "path": "x"}
        with patch.object(runtime_v2, "Telegraph", FakeTelegraph):
            result = runtime_v2.publish_page("T", source, allow_adaptations=True, preflight_fingerprint=report["fingerprint"])
        page_kwargs = next(value for kind, value in calls if kind == "page")
        self.assertEqual(page_kwargs["html_content"], report["projection"].html)
        self.assertEqual(result["adaptations"], report["adaptations"])


if __name__ == "__main__":
    unittest.main()
