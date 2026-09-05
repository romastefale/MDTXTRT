import asyncio
import tempfile
import time
import unittest
from pathlib import Path
from types import SimpleNamespace

import app  # noqa: F401 - instala exatamente o runtime ativo
import main
from drafts import DraftStore, MEDIA_ORPHAN_GRACE_SECONDS
from rich_delivery import media_for_chunk, split_structural_chunks


class ProgressiveCorrectionTest(unittest.TestCase):
    def test_corrected_failures_do_not_survive_the_real_paths(self):
        calls = []

        class FakeBot:
            async def delete_webhook(self, **kwargs):
                calls.append(kwargs)

        asyncio.run(main.delete_webhook_with_retry(FakeBot()))
        self.assertEqual(len(calls), 1)
        self.assertIs(calls[0]["drop_pending_updates"], False)

        with tempfile.TemporaryDirectory() as tmp:
            store = DraftStore(
                str(Path(tmp) / "drafts.sqlite3"),
                str(Path(tmp) / "media"),
            )
            store.save_media(
                7,
                "keptMedia",
                {
                    "data": b"real-media",
                    "name": "photo.png",
                    "mime": "image/png",
                    "kind": "photo",
                },
            )
            first = store.save(
                7,
                "![](mdtxtrt://photo/keptMedia)",
                base_revision=0,
            )
            self.assertEqual(store.gc_media(7, now=int(time.time()) + 10), [])
            self.assertIsNotNone(store.load_media("keptMedia", 7))

            store.save(7, "mídia removida", base_revision=first["revision"])
            self.assertEqual(store.gc_media(7, now=int(time.time()) + 10), [])
            removed = store.gc_media(
                7,
                now=int(time.time()) + MEDIA_ORPHAN_GRACE_SECONDS + 10,
            )
            self.assertEqual(removed, ["keptMedia"])
            self.assertIsNone(store.load_media("keptMedia", 7))

        table = "<table>\n<tr><td>estrutura inteira</td></tr>\n</table>"
        chunks = split_structural_chunks(table + "\n\n" + ("x" * 45), limit=55)
        self.assertEqual(chunks[0], table)
        self.assertEqual(chunks[1], "x" * 45)

        media = [SimpleNamespace(id="first"), SimpleNamespace(id="second")]
        selected = media_for_chunk("![](tg://photo?id=second)", media)
        self.assertEqual([item.id for item in selected], ["second"])

        incoming = {
            "is_rtl": True,
            "blocks": [
                {
                    "type": "paragraph",
                    "text": [
                        {
                            "type": "custom_emoji",
                            "custom_emoji_id": "5368324170671202286",
                            "alternative_text": "👍",
                        },
                        " ",
                        {
                            "type": "date_time",
                            "text": "22:45 tomorrow",
                            "unix_time": 1647531900,
                            "date_time_format": "wDT",
                        },
                    ],
                },
                {
                    "type": "list",
                    "items": [
                        {
                            "label": "vii.",
                            "blocks": [{"type": "paragraph", "text": "item"}],
                            "has_checkbox": True,
                            "is_checked": True,
                            "value": 7,
                            "type": "i",
                        }
                    ],
                },
                {
                    "type": "table",
                    "cells": [
                        [
                            {
                                "text": "cell",
                                "is_header": True,
                                "colspan": 2,
                                "align": "center",
                            }
                        ]
                    ],
                    "is_bordered": True,
                    "is_striped": True,
                    "is_compact": True,
                    "caption": "table caption",
                },
                {
                    "type": "buttons",
                    "align": "center",
                    "buttons": [
                        {
                            "text": "callback",
                            "style": "link",
                            "callback_data": "payload",
                        }
                    ],
                },
                {
                    "type": "photo",
                    "photo": [
                        {
                            "file_id": "AgAC_REAL_TELEGRAM_FILE_ID",
                            "file_unique_id": "unique",
                            "width": 10,
                            "height": 10,
                        }
                    ],
                },
            ],
        }

        editable = main.rich_message_to_markdown(incoming)
        self.assertTrue(editable.startswith("<!--mdtxtrt:rtl-->\n"))
        self.assertIn(
            '<tg-emoji emoji-id="5368324170671202286">👍</tg-emoji>', editable
        )
        self.assertIn(
            '<tg-time unix="1647531900" format="wDT">22:45 tomorrow</tg-time>',
            editable,
        )
        self.assertIn('<li value="7" type="i"><input type="checkbox" checked>', editable)
        self.assertIn("<table bordered striped compact>", editable)
        self.assertIn('type="callback_data"', editable)
        self.assertIn('style="link"', editable)
        self.assertIn("file=AgAC_REAL_TELEGRAM_FILE_ID", editable)

        outgoing = main.build_rich_message(editable)
        self.assertIs(outgoing.is_rtl, True)
        self.assertEqual(len(outgoing.media or []), 1)
        self.assertEqual(
            outgoing.media[0].media.media,
            "AgAC_REAL_TELEGRAM_FILE_ID",
        )
        self.assertNotIn("&file=", outgoing.markdown or "")
        self.assertIn("tg://photo?id=r_", outgoing.markdown or "")


if __name__ == "__main__":
    unittest.main()
