import asyncio
import unittest

import app  # noqa: F401 - instala exatamente o runtime ativo
import main
import rich_buttons


class RichButtonsGreenTest(unittest.TestCase):
    def test_all_rich_button_types_are_green_and_callback_is_answered(self):
        page = asyncio.run(main.serve_index(None)).text
        self.assertIn('id="mdtxtrt-rich-buttons-green"', page)
        for button_type in (
            "url",
            "callback_data",
            "web_app",
            "login_url",
            "switch_inline_query",
            "switch_inline_query_current_chat",
            "switch_inline_query_chosen_chat",
            "copy_text",
            "disabled",
        ):
            self.assertIn("type:'" + button_type + "'", page)
        self.assertIn("style=\"success\"", page)

        incoming = {
            "blocks": [
                {
                    "type": "paragraph",
                    "text": {
                        "type": "button",
                        "button": {
                            "text": "callback",
                            "style": "danger",
                            "callback_data": "cb",
                        },
                    },
                },
                {
                    "type": "buttons",
                    "align": "center",
                    "buttons": [
                        {"text": "url", "style": "primary", "url": "https://example.com"},
                        {"text": "app", "web_app": {"url": "https://example.com/app"}},
                        {
                            "text": "login",
                            "login_url": {
                                "url": "https://example.com/login",
                                "forward_text": "forward",
                                "request_write_access": True,
                            },
                        },
                        {"text": "inline", "switch_inline_query": "q"},
                        {"text": "current", "switch_inline_query_current_chat": "q2"},
                        {
                            "text": "chosen",
                            "switch_inline_query_chosen_chat": {
                                "query": "q3",
                                "allow_user_chats": True,
                                "allow_group_chats": True,
                            },
                        },
                        {"text": "copy", "copy_text": {"text": "copy me"}},
                    ],
                },
                {
                    "type": "buttons",
                    "buttons": [{"text": "off", "disabled": {}}],
                },
            ]
        }
        editable = main.rich_message_to_markdown(incoming)
        self.assertEqual(editable.count('style="success"'), 9)
        self.assertNotIn('style="primary"', editable)
        self.assertNotIn('style="danger"', editable)
        self.assertIn('type="callback_data"', editable)
        self.assertIn('type="switch_inline_query_chosen_chat"', editable)
        self.assertIn('type="disabled"', editable)

        outgoing = main.build_rich_message(editable)
        self.assertEqual((outgoing.markdown or "").count('style="success"'), 9)

        manual = (
            '<tg-button-row><tg-button type="url" style="danger" '
            'url="https://example.com">manual</tg-button></tg-button-row>\n'
            '<tg-button type="copy_text" text="x">sem estilo</tg-button>\n'
            '```html\n<tg-button type="url" style="danger" url="https://example.com">exemplo</tg-button>\n```'
        )
        normalized = main.build_rich_message(manual).markdown or ""
        self.assertIn(
            '<tg-button type="url" url="https://example.com" style="success">manual</tg-button>',
            normalized,
        )
        self.assertIn(
            '<tg-button type="copy_text" text="x" style="success">sem estilo</tg-button>',
            normalized,
        )
        self.assertIn(
            '<tg-button type="url" style="danger" url="https://example.com">exemplo</tg-button>',
            normalized,
        )

        calls = []

        class FakeQuery:
            async def answer(self):
                calls.append(True)

        asyncio.run(rich_buttons.handle_callback(FakeQuery()))
        self.assertEqual(calls, [True])

        dispatcher = main.build_dispatcher()
        self.assertGreaterEqual(len(dispatcher.callback_query.handlers), 1)


if __name__ == "__main__":
    unittest.main()
