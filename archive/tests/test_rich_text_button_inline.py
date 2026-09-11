"""Regressões focadas de RichTextButton inline da Bot API 10.3."""
import unittest
from types import SimpleNamespace

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

    def test_standalone_inline_button_compiles_without_semantic_entity(self):
        source = '<tg-button type="callback_data" data="solto">Solto</tg-button>'

        blocks = rich_explicit.compile_semantic_blocks(source, {})
        data = self._python(blocks)

        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["type"], "paragraph")
        button = data[0]["text"]
        self.assertEqual(button["type"], "button")
        self.assertEqual(button["button"]["text"], "Solto")
        self.assertEqual(button["button"]["callback_data"], "solto")

    def test_public_pipeline_routes_standalone_button_to_blocks(self):
        source = '<tg-button type="callback_data" data="confirmar">Confirmar</tg-button>'
        base = SimpleNamespace(MEDIA={})

        rich_media.install(base)
        message = base.build_rich_message(source)

        self.assertIsNone(message.markdown)
        self.assertIsNotNone(message.blocks)
        self.assertTrue(message.skip_entity_detection)

        data = self._python(message.blocks)
        self.assertEqual(data[0]["type"], "paragraph")
        button = data[0]["text"]
        self.assertEqual(button["type"], "button")
        self.assertEqual(button["button"]["callback_data"], "confirmar")

    def test_public_pipeline_keeps_plain_markdown_on_markdown_path(self):
        base = SimpleNamespace(MEDIA={})
        rich_media.install(base)

        message = base.build_rich_message("Texto simples")

        self.assertIsNotNone(message.markdown)
        self.assertIsNone(message.blocks)

    def test_inline_button_rejects_rich_text_not_allowed_by_bot_api(self):
        source = (
            '<p>'
            '<tg-button type="callback_data" data="confirmar">'
            '<b>Confirmar</b>'
            '</tg-button>'
            '</p>'
        )

        with self.assertRaisesRegex(ValueError, "Texto de botão Rich"):
            rich_explicit.compile_semantic_blocks(source, {})

    def test_button_row_uses_same_text_validation(self):
        source = (
            '<tg-button-row>'
            '<tg-button type="callback_data" data="confirmar">'
            '<b>Confirmar</b>'
            '</tg-button>'
            '</tg-button-row>'
        )

        with self.assertRaisesRegex(ValueError, "Texto de botão Rich"):
            rich_explicit.compile_semantic_blocks(source, {})

    def test_inline_and_row_unknown_types_fail_the_same_way(self):
        inline = '<tg-button type="nao_existe">X</tg-button>'
        row = (
            '<tg-button-row>'
            '<tg-button type="nao_existe">X</tg-button>'
            '</tg-button-row>'
        )

        for source in (inline, row):
            with self.subTest(source=source):
                with self.assertRaisesRegex(
                    ValueError,
                    "Tipo de botão Rich explícito desconhecido",
                ):
                    rich_explicit.compile_semantic_blocks(source, {})

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
