import asyncio
import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import app  # noqa: F401 - instala o runtime ativo
import main
import runtime_v2
from canonical import CanonicalDocument
from rich_delivery import (
    RICH_BLOCK_LIMIT,
    RICH_MEDIA_LIMIT,
    RICH_NESTING_LIMIT,
    RICH_TABLE_COLUMN_LIMIT,
    split_structural_chunks,
    validate_rich_structure,
)


CONTRACT_SOURCE = r"""# H1
## H2
### H3
#### H4
##### H5
###### H6

**bold** *italic* <u>underline</u> ~~strike~~ ==marked== ||spoiler||
<sub>sub</sub> <sup>sup</sup> `inline **literal**` $x^2 + y^2$
[external](https://example.com) <a name="origin"></a>
<a href="#origin">internal</a>
<tg-reference name="note">reference body</tg-reference>

```python
print("**literal**")
```

$$
\int_0^1 x^2 dx
$$

- bullet
1. ordered
- [x] checked
- [ ] unchecked

> normal quote

<blockquote expandable>
**expand bold** and *italic* with `inline **literal**`
</blockquote>

<aside>aside<cite>credit</cite></aside>

<details><summary>Details **summary**</summary>
### nested heading
- nested item
</details>

| Head A | Head B |
|---|---|
| Cell A | Cell B |

<tg-map lat="-23.5" long="-46.6" zoom="14"/>

![](https://example.com/public.jpg "public image")

<tg-collage>
![](https://example.com/a.jpg "A")
![](https://example.com/b.mp4 "B")
</tg-collage>

<tg-slideshow>
![](https://example.com/c.jpg "C")
![](https://example.com/d.mp4 "D")
</tg-slideshow>

<tg-button-row align="center">
<tg-button type="url" style="danger" url="https://example.com">URL</tg-button>
<tg-button type="callback_data" style="link" data="callback-payload">Callback</tg-button>
<tg-button type="web_app" style="primary" url="https://example.com/app">Web App</tg-button>
<tg-button type="login_url" url="https://example.com/login" forward-text="forward" request-write-access>Login</tg-button>
<tg-button type="switch_inline_query" query="q">Inline</tg-button>
<tg-button type="switch_inline_query_current_chat" query="q2">Current</tg-button>
<tg-button type="switch_inline_query_chosen_chat" query="q3" allow-user-chats allow-group-chats allow-channel-chats>Chosen</tg-button>
<tg-button type="copy_text" text="copy value">Copy</tg-button>
<tg-button type="disabled" style="primary">Disabled</tg-button>
</tg-button-row>

![](mdtxtrt://photo/local-photo "local caption")
"""


class FakeJsonRequest:
    def __init__(self, payload, *, headers=None, remote="127.0.0.1"):
        self.payload = payload
        self.headers = headers or {}
        self.remote = remote

    async def json(self):
        return self.payload


class OptimizedCompatibilityTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        runtime_v2._BASE = main
        runtime_v2._PUBLISH_RATE.clear()
        main.MEDIA.clear()

    def tearDown(self):
        runtime_v2._PUBLISH_RATE.clear()
        main.MEDIA.clear()

    def test_single_contract_document_drives_all_three_destinations(self):
        document = CanonicalDocument.from_markdown(CONTRACT_SOURCE)
        self.assertEqual(document.markdown, CONTRACT_SOURCE)

        telegram, refs = document.telegram_markdown()
        self.assertIn("<b>expand bold</b>", telegram)
        self.assertIn("<i>italic</i>", telegram)
        self.assertIn("<code>inline **literal**</code>", telegram)
        self.assertIn("tg://photo?id=local-photo", telegram)
        self.assertEqual([ref.media_id for ref in refs], ["local-photo"])
        for style in ("danger", "link", "primary"):
            self.assertIn(f'style="{style}"', telegram)
        self.assertIn('data="callback-payload"', telegram)
        self.assertIn('text="copy value"', telegram)

        projection = document.telegraph()
        self.assertFalse(projection.compatible)
        self.assertTrue(projection.adaptations)
        self.assertTrue(projection.unsupported)
        rendered = projection.html
        for visible in (
            "H1", "H2", "H3", "H4", "H5", "H6",
            "bold", "italic", "underline", "strike", "marked", "spoiler",
            "sub", "sup", "inline", "x^2 + y^2", "external",
            "origin", "internal", "reference body", "bullet", "ordered",
            "checked", "unchecked", "normal quote", "expand bold", "aside",
            "Details", "nested heading", "nested item", "Head A", "Head B",
            "Cell A", "Cell B", "Mapa", "public image", "URL", "Callback",
            "Web App", "Login", "Inline", "Current", "Chosen", "Copy",
            "copy value", "Disabled", "local caption",
        ):
            self.assertIn(visible, rendered)
        self.assertNotIn("<tg-button", rendered)
        self.assertNotIn("<tg-collage", rendered)
        self.assertNotIn("<tg-slideshow", rendered)
        self.assertEqual(main.optimize_markdown(CONTRACT_SOURCE), CONTRACT_SOURCE)

    def test_markdown_inside_inert_rich_html_gets_semantic_html_only_for_telegram(self):
        source = """<blockquote expandable>
**bold** *italic* ~~strike~~ ==mark== ||spoiler|| [link](https://example.com)
`inline **literal**`
```text
**fenced literal**
```
</blockquote>

<details><summary>Summary</summary>
**markdown remains markdown here**
</details>
"""
        document = CanonicalDocument.from_markdown(source)
        telegram, _ = document.telegram_markdown()
        self.assertIn("<b>bold</b>", telegram)
        self.assertIn("<i>italic</i>", telegram)
        self.assertIn("<s>strike</s>", telegram)
        self.assertIn("<mark>mark</mark>", telegram)
        self.assertIn("<tg-spoiler>spoiler</tg-spoiler>", telegram)
        self.assertIn('<a href="https://example.com">link</a>', telegram)
        self.assertIn("<code>inline **literal**</code>", telegram)
        self.assertIn("**fenced literal**", telegram)
        self.assertNotIn("<b>fenced literal</b>", telegram)
        self.assertIn("**markdown remains markdown here**", telegram)
        self.assertEqual(document.markdown, source)
        self.assertEqual(main.optimize_markdown(source), source)

    async def test_attachment_and_editor_feed_the_same_telegram_renderer(self):
        source = "<blockquote expandable>\n**same**\n</blockquote>"
        document = SimpleNamespace(file_name="same.md", mime_type="text/markdown")
        message = SimpleNamespace(document=document, reply_to_message=None, text=None, caption=None)
        with patch.object(main, "read_document_text", AsyncMock(return_value=source)):
            attached_source = await main.source_for_tgrich(message, SimpleNamespace())
        self.assertEqual(attached_source, source)
        attached = main.build_rich_message(attached_source).markdown
        editor = main.build_rich_message(source).markdown
        self.assertEqual(attached, editor)

    def test_telegraph_preflight_blocks_real_loss_before_create_page(self):
        content = '![](mdtxtrt://photo/local123 "caption")'
        report = runtime_v2.telegraph_preflight(content)
        self.assertFalse(report["compatible"])
        self.assertTrue(report["unsupported"])
        clients = []

        class FakeTelegraph:
            def __init__(self): clients.append(self)
            def create_account(self, **kwargs): raise AssertionError("must not create account before confirmation")
            def create_page(self, **kwargs): raise AssertionError("must not create page before confirmation")

        with patch.object(runtime_v2, "Telegraph", FakeTelegraph):
            with self.assertRaises(runtime_v2.TelegraphPreflightRequired):
                runtime_v2.publish_page("Loss", content)
        self.assertEqual(clients, [])

    async def test_api_preflight_then_explicit_confirmation_is_ordered(self):
        content = "# H1\n\n<blockquote expandable>\n**bold**\n</blockquote>"
        preflight_response = await runtime_v2.api_publish(FakeJsonRequest({"title": "T", "content": content, "preflight_only": True}))
        preflight = json.loads(preflight_response.text)
        self.assertEqual(preflight_response.status, 200)
        self.assertTrue(preflight["requires_confirmation"])
        self.assertTrue(preflight["adaptations"])
        calls = []

        class FakeTelegraph:
            def create_account(self, **kwargs): calls.append(("account", kwargs))
            def create_page(self, **kwargs):
                calls.append(("page", kwargs)); return {"url": "https://telegra.ph/t", "path": "t"}

        with patch.object(runtime_v2, "Telegraph", FakeTelegraph):
            denied = await runtime_v2.api_publish(FakeJsonRequest({"title": "T", "content": content}))
            self.assertEqual(denied.status, 409)
            self.assertEqual(calls, [])
            accepted = await runtime_v2.api_publish(FakeJsonRequest({"title": "T", "content": content, "preflight_fingerprint": preflight["fingerprint"], "confirm_adaptations": True}))
        self.assertEqual(accepted.status, 200)
        self.assertEqual([kind for kind, _ in calls], ["account", "page"])

    def test_telegraph_preserves_anchor_reference_button_actions_formula_table_heading(self):
        source = r"""# Heading
<a name="target"></a>
<a href="#target">go</a>
<tg-reference name="ref-x">body</tg-reference>

<tg-button-row>
<tg-button type="callback_data" style="link" data="payload">Call</tg-button>
<tg-button type="copy_text" text="copy me">Copy</tg-button>
</tg-button-row>

<table>
<tr><th colspan="2">Header</th><td>Third</td></tr>
<tr><td>A</td><td>B</td><td>C</td></tr>
</table>

$$
x^2 + y^2
$$
"""
        projection = CanonicalDocument.from_markdown(source).telegraph()
        rendered = projection.html
        for required in ("Heading", "anchor:target", "→target", "reference:ref-x", "payload", "style=link", "copy me", "Header", "Third", "A", "B", "C", "colspan=2", "x^2 + y^2"):
            self.assertIn(required, rendered)
        self.assertTrue(projection.adaptations)
        self.assertFalse(projection.unsupported)

    def test_rich_limits_are_validated_and_chunked_only_at_safe_boundaries(self):
        nested = "<details>" * (RICH_NESTING_LIMIT + 1) + "x" + "</details>" * (RICH_NESTING_LIMIT + 1)
        with self.assertRaisesRegex(ValueError, "profundidade"):
            validate_rich_structure(nested)

        table = "<table><tr>" + "".join("<td>x</td>" for _ in range(RICH_TABLE_COLUMN_LIMIT + 1)) + "</tr></table>"
        with self.assertRaisesRegex(ValueError, "colunas"):
            validate_rich_structure(table)

        oversized_nested = "<details>\n" + "\n".join("<p>x</p>" for _ in range(RICH_BLOCK_LIMIT + 1)) + "\n</details>"
        with self.assertRaisesRegex(ValueError, "blocos"):
            split_structural_chunks(oversized_nested)

        media = "<tg-collage>\n" + "\n".join(f"![](https://example.com/{i}.jpg)" for i in range(RICH_MEDIA_LIMIT + 1)) + "\n</tg-collage>"
        with self.assertRaisesRegex(ValueError, "mídias"):
            split_structural_chunks(media)

        safe = "\n\n".join("<p>x</p>" for _ in range(RICH_BLOCK_LIMIT + 1))
        chunks = split_structural_chunks(safe)
        self.assertGreaterEqual(len(chunks), 2)
        for chunk in chunks:
            validate_rich_structure(chunk)

    def test_rich_to_markdown_to_rich_preserves_style_actions_media_and_structure(self):
        incoming = {
            "blocks": [
                {"type": "section_heading", "size": 4, "text": {"type": "bold", "text": "Heading"}},
                {"type": "blockquote", "blocks": [{"type": "paragraph", "text": {"type": "italic", "text": "Quote"}}]},
                {"type": "table", "cells": [[{"text": {"type": "bold", "text": "A"}, "is_header": True}, {"text": "B"}]]},
                {"type": "buttons", "align": "center", "buttons": [{"text": "Danger", "style": "danger", "callback_data": "cb"}, {"text": "Copy", "style": "primary", "copy_text": {"text": "value"}}]},
                {"type": "photo", "photo": [{"file_id": "AgAC_ROUNDTRIP_FILE", "file_unique_id": "unique", "width": 10, "height": 10}], "caption": {"text": "caption"}},
            ]
        }
        editable = main.rich_message_to_markdown(incoming)
        self.assertIn('style="danger"', editable)
        self.assertIn('style="primary"', editable)
        self.assertIn('data="cb"', editable)
        self.assertIn('text="value"', editable)
        self.assertIn("AgAC_ROUNDTRIP_FILE", editable)
        self.assertIn("<h4>", editable)
        self.assertIn("<table", editable)
        self.assertIn("<blockquote>", editable)
        outgoing = main.build_rich_message(editable)
        markdown = outgoing.markdown or ""
        self.assertIn('style="danger"', markdown)
        self.assertIn('style="primary"', markdown)
        self.assertIn('data="cb"', markdown)
        self.assertIn('text="value"', markdown)
        self.assertIn("<h4>", markdown)
        self.assertIn("<table", markdown)
        self.assertIn("<blockquote>", markdown)
        self.assertEqual(len(outgoing.media or []), 1)
        self.assertEqual(outgoing.media[0].media.media, "AgAC_ROUNDTRIP_FILE")


if __name__ == "__main__":
    unittest.main()
