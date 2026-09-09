"""Regressões focadas de RichTextButton inline da Bot API 10.3."""
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from aiogram.utils.serialization import deserialize_telegram_object_to_python

import rich_explicit
import rich_media


class RichTextButtonInlineTests(unittest.TestCase):
    @staticmethod
    def _python(blocks):
        return deserialize_telegram_object_to_python(
            blocks,
            include_api_method_name=False,
        )

    def test_semantic_entity_and_inline_button_compile_together(self):
        source = (
            '<p>Use '
            '<tg-entity type="hashtag" hashtag="#teste">#teste</tg-entity> '
            '<tg-button type="callback_data" style="success" data="confirmar">'
            'Confirmar'
            '</tg-button>'
            '</p>'
        )

        blocks = rich_explicit.compile_semantic_blocks(source, {})
        data = self._python(blocks)

        self.assertEqual(data[0]["type"], "paragraph")
        rich_text = data[0]["text"]
        self.assertIsInstance(rich_text, list)

        entity = next(
            item
            for item in rich_text
            if isinstance(item, dict) and item.get("type") == "hashtag"
        )
        button = next(
            item
            for item in rich_text
            if isinstance(item, dict) and item.get("type") == "button"
        )

        self.assertEqual(entity["hashtag"], "#teste")
        self.assertEqual(button["button"]["text"], "Confirmar")
        self.assertEqual(button["button"]["style"], "success")
        self.assertEqual(button["button"]["callback_data"], "confirmar")

    def test_root_inline_button_is_preserved_as_paragraph(self):
        source = (
            '<tg-button type="callback_data" data="solto">Solto</tg-button>'
            '<p>'
            '<tg-entity type="hashtag" hashtag="#teste">#teste</tg-entity>'
            '</p>'
        )

        blocks = rich_explicit.compile_semantic_blocks(source, {})
        data = self._python(blocks)

        self.assertEqual(len(data), 2)
        self.assertEqual(data[0]["type"], "paragraph")
        button = data[0]["text"]
        self.assertIsInstance(button, dict)
        self.assertEqual(button["type"], "button")
        self.assertEqual(button["button"]["text"], "Solto")
        self.assertEqual(button["button"]["callback_data"], "solto")
        self.assertEqual(data[1]["type"], "paragraph")

    def test_inline_button_rejects_rich_text_not_allowed_by_bot_api(self):
        source = (
            '<p>'
            '<tg-entity type="hashtag" hashtag="#teste">#teste</tg-entity> '
            '<tg-button type="callback_data" data="confirmar">'
            '<b>Confirmar</b>'
            '</tg-button>'
            '</p>'
        )

        with self.assertRaisesRegex(ValueError, "Texto de botão Rich"):
            rich_explicit.compile_semantic_blocks(source, {})

    def test_inline_disabled_button_serializes_disabled_object(self):
        source = (
            '<p>'
            '<tg-entity type="hashtag" hashtag="#teste">#teste</tg-entity> '
            '<tg-button type="disabled">Indisponível</tg-button>'
            '</p>'
        )

        blocks = rich_explicit.compile_semantic_blocks(source, {})
        data = self._python(blocks)
        rich_text = data[0]["text"]
        button = next(
            item
            for item in rich_text
            if isinstance(item, dict) and item.get("type") == "button"
        )

        self.assertEqual(button["button"]["text"], "Indisponível")
        self.assertIn("disabled", button["button"])
        self.assertEqual(button["button"]["disabled"], {})

    def test_rich_media_pipeline_builds_blocks_for_semantic_entity_and_inline_button(self):
        source = (
            '<p>Use '
            '<tg-entity type="hashtag" hashtag="#teste">#teste</tg-entity> '
            '<tg-button type="callback_data" style="success" data="confirmar">'
            'Confirmar'
            '</tg-button>'
            '</p>'
        )
        projection = SimpleNamespace(telegram_markdown=lambda: (source, []))
        base = SimpleNamespace(MEDIA={})

        with patch.object(
            rich_media.canonical.CanonicalDocument,
            "from_markdown",
            return_value=projection,
        ):
            rich_media.install(base)
            message = base.build_rich_message(source)

        self.assertIsNone(message.markdown)
        self.assertIsNotNone(message.blocks)
        self.assertTrue(message.skip_entity_detection)

        data = self._python(message.blocks)
        rich_text = data[0]["text"]
        button = next(
            item
            for item in rich_text
            if isinstance(item, dict) and item.get("type") == "button"
        )
        self.assertEqual(button["button"]["callback_data"], "confirmar")

    def test_existing_button_row_contract_stays_valid(self):
        source = (
            '<tg-button-row align="center">'
            '<tg-button type="url" style="primary" url="https://example.com">'
            'Abrir'
            '</tg-button>'
            '</tg-button-row>'
        )

        blocks = rich_explicit.compile_semantic_blocks(source, {})
        data = self._python(blocks)

        self.assertEqual(data[0]["type"], "buttons")
        self.assertEqual(data[0]["align"], "center")
        self.assertEqual(data[0]["buttons"][0]["text"], "Abrir")
        self.assertEqual(data[0]["buttons"][0]["url"], "https://example.com")


if __name__ == "__main__":
    unittest.main()
