import asyncio
import unittest

import app  # noqa: F401 - instala exatamente o runtime ativo
import main
import rich_buttons


class RichButtonsStyleContractTest(unittest.TestCase):
    def test_generator_defaults_to_success_but_existing_styles_are_preserved(self):
        page = asyncio.run(main.serve_index(None)).text
        self.assertIn('id="mdtxtrt-rich-buttons-green"', page)
        for button_type in (
            "url", "callback_data", "web_app", "login_url",
            "switch_inline_query", "switch_inline_query_current_chat",
            "switch_inline_query_chosen_chat", "copy_text", "disabled",
        ):
            self.assertIn("type:'" + button_type + "'", page)
        # success permanece exclusivamente no ponto de criação do gerador MDTXTRT.
        self.assertIn("var attrs=['type=\"'+def.type+'\"','style=\"success\"']", page)

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
                        {"text": "link", "style": "link", "callback_data": "link-cb"},
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
                {"type": "buttons", "buttons": [{"text": "off", "disabled": {}}]},
            ]
        }
        editable = main.rich_message_to_markdown(incoming)
        self.assertIn('style="danger"', editable)
        self.assertIn('style="primary"', editable)
        self.assertIn('style="link"', editable)
        self.assertNotIn('style="success"', editable)
        self.assertIn('type="callback_data"', editable)
        self.assertIn('type="switch_inline_query_chosen_chat"', editable)
        self.assertIn('type="copy_text" text="copy me"', editable)
        self.assertIn('type="disabled"', editable)

        outgoing = main.build_rich_message(editable).markdown or ""
        self.assertIn('style="danger"', outgoing)
        self.assertIn('style="primary"', outgoing)
        self.assertIn('style="link"', outgoing)
        self.assertNotIn('style="success"', outgoing)
        self.assertIn('data="cb"', outgoing)
        self.assertIn('text="copy me"', outgoing)

        manual = (
            '<tg-button-row><tg-button type="url" style="danger" '
            'url="https://example.com">manual</tg-button></tg-button-row>\n'
            '<tg-button type="copy_text" text="x">sem estilo</tg-button>\n'
            '```html\n<tg-button type="url" style="danger" url="https://example.com">exemplo</tg-button>\n```'
        )
        normalized = main.build_rich_message(manual).markdown or ""
        self.assertIn(
            '<tg-button type="url" style="danger" url="https://example.com">manual</tg-button>',
            normalized,
        )
        self.assertIn(
            '<tg-button type="copy_text" text="x">sem estilo</tg-button>',
            normalized,
        )
        self.assertNotIn('text="x" style="success"', normalized)
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
