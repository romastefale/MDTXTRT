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
        served = asyncio.run(main.serve_index(None))
        self.assertEqual(served.status, 200)
        self.assertIn('id="mdtxtrt-preview-sanitizer"', served.text)
        self.assertIn("Object.defineProperty(preview,'innerHTML'", served.text)
        self.assertIn("safeClasses=new Set(['preview-note','spoiler','revealed'])", served.text)

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

        same_file_id = "AgAC_REAL_TELEGRAM_FILE_ID"
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
                            "blocks": [
                                {
                                    "type": "paragraph",
                                    "text": {"type": "bold", "text": "item"},
                                }
                            ],
                            "has_checkbox": True,
                            "is_checked": True,
                            "value": 7,
                            "type": "i",
                        }
                    ],
                },
                {
                    "type": "blockquote",
                    "blocks": [
                        {
                            "type": "paragraph",
                            "text": {"type": "bold", "text": "quoted"},
                        }
                    ],
                    "credit": {"type": "italic", "text": "author"},
                },
                {
                    "type": "table",
                    "cells": [
                        [
                            {
                                "text": {
                                    "type": "bold",
                                    "text": "cell & value",
                                },
                                "is_header": True,
                                "colspan": 2,
                                "align": "center",
                            }
                        ]
                    ],
                    "is_bordered": True,
                    "is_striped": True,
                    "is_compact": True,
                    "caption": {"type": "italic", "text": "table caption"},
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
                            "file_id": same_file_id,
                            "file_unique_id": "unique",
                            "width": 10,
                            "height": 10,
                        }
                    ],
                },
                {
                    "type": "photo",
                    "photo": [
                        {
                            "file_id": same_file_id,
                            "file_unique_id": "unique",
                            "width": 20,
                            "height": 20,
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
        self.assertIn(
            '<li value="7" type="i"><input type="checkbox" checked><p><b>item</b></p></li>',
            editable,
        )
        self.assertIn(
            "<blockquote><p><b>quoted</b></p><cite><i>author</i></cite></blockquote>",
            editable,
        )
        self.assertIn("<table bordered striped compact>", editable)
        self.assertIn(
            '<th colspan="2" align="center"><b>cell &amp; value</b></th>', editable
        )
        self.assertIn("<caption><i>table caption</i></caption>", editable)
        self.assertIn('type="callback_data"', editable)
        self.assertIn('style="link"', editable)
        self.assertEqual(editable.count("file=AgAC_REAL_TELEGRAM_FILE_ID"), 2)

        outgoing = main.build_rich_message(editable)
        self.assertIs(outgoing.is_rtl, True)
        self.assertEqual(len(outgoing.media or []), 2)
        self.assertEqual(
            [item.media.media for item in outgoing.media],
            [same_file_id, same_file_id],
        )
        self.assertEqual(len({item.id for item in outgoing.media}), 2)
        self.assertNotIn("&file=", outgoing.markdown or "")
        self.assertEqual((outgoing.markdown or "").count("tg://photo?id=r_"), 2)
        self.assertIn("<td", (outgoing.markdown or "").replace("<th", "<td"))
        self.assertIn("<b>cell &amp; value</b>", outgoing.markdown or "")
        self.assertNotIn("**cell & value**", outgoing.markdown or "")

        collage_plain = {
            "blocks": [
                {
                    "type": "collage",
                    "blocks": [
                        {
                            "type": "photo",
                            "photo": [
                                {
                                    "file_id": "AgAC_COLLAGE_FILE_ID",
                                    "file_unique_id": "collection",
                                    "width": 10,
                                    "height": 10,
                                }
                            ],
                            "caption": {"text": 'legenda "exata"'},
                        }
                    ],
                }
            ]
        }
        collage_editable = main.rich_message_to_markdown(collage_plain)
        self.assertIn('\\"exata\\"', collage_editable)
        collage_outgoing = main.build_rich_message(collage_editable)
        self.assertEqual(len(collage_outgoing.media or []), 1)
        self.assertEqual(collage_outgoing.media[0].media.media, "AgAC_COLLAGE_FILE_ID")
        self.assertNotIn("&file=", collage_outgoing.markdown or "")

        collage_rich_caption = {
            "blocks": [
                {
                    "type": "collage",
                    "blocks": [
                        {
                            "type": "photo",
                            "photo": [
                                {
                                    "file_id": "AgAC_COLLAGE_RICH",
                                    "file_unique_id": "collection-rich",
                                    "width": 10,
                                    "height": 10,
                                }
                            ],
                            "caption": {
                                "text": {"type": "bold", "text": "não achatar"}
                            },
                        }
                    ],
                }
            ]
        }
        with self.assertRaisesRegex(ValueError, "Legenda Rich"):
            main.rich_message_to_markdown(collage_rich_caption)


if __name__ == "__main__":
    unittest.main()
