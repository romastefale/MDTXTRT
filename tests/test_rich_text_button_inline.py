"""Regressões focadas de RichTextButton inline da Bot API 10.3."""
import unittest

from aiogram.utils.serialization import deserialize_telegram_object_to_python

import rich_explicit


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
