import tempfile
import threading
import unittest
from pathlib import Path

from mdtxtrt.assets import AssetService, MAX_STORED_MEDIA_BYTES
from mdtxtrt.domain import CanonicalDocument, CanonicalNode
from mdtxtrt.storage import SQLiteRepository
from mdtxtrt.telegram_representations import plan_telegram_representations
from mdtxtrt.telegram_validation import TelegramDestinationContext, validate_telegram_document


def doc(*blocks):
    return CanonicalDocument("doc", CanonicalDocument.CURRENT_SCHEMA_VERSION, blocks)


class FinalContractTests(unittest.TestCase):
    def test_duplicate_node_ids_are_rejected(self):
        a = CanonicalNode("same", "paragraph", children=(CanonicalNode.create("text", text="a"),))
        b = CanonicalNode("same", "paragraph", children=(CanonicalNode.create("text", text="b"),))
        with self.assertRaisesRegex(ValueError, "duplicate_canonical_node_id"):
            doc(a, b)

    def test_table_spans_use_effective_width_not_raw_cell_count(self):
        row1 = CanonicalNode.create("table_row", children=(
            CanonicalNode.create("table_header", attrs={"colspan": 2}, children=(CanonicalNode.create("text", text="A"),)),
            CanonicalNode.create("table_header", children=(CanonicalNode.create("text", text="B"),)),
        ))
        row2 = CanonicalNode.create("table_row", children=(
            CanonicalNode.create("table_cell", children=(CanonicalNode.create("text", text="1"),)),
            CanonicalNode.create("table_cell", children=(CanonicalNode.create("text", text="2"),)),
            CanonicalNode.create("table_cell", children=(CanonicalNode.create("text", text="3"),)),
        ))
        table = CanonicalNode.create("table", attrs={"bordered": True, "compact": True}, children=(row1, row2))
        self.assertEqual(validate_telegram_document(doc(table)), [])
        plan = plan_telegram_representations(doc(table)).options["blocks"]
        self.assertTrue(plan.available)
        self.assertEqual(plan.blocks[0]["type"], "table")
        self.assertEqual(plan.blocks[0]["cells"][0][0]["align"], "left")
        self.assertEqual(plan.blocks[0]["cells"][0][0]["valign"], "top")
        self.assertEqual(plan.blocks[0]["cells"][0][0]["colspan"], 2)

    def test_table_rows_count_toward_rich_block_limit(self):
        rows = tuple(
            CanonicalNode.create("table_row", children=(CanonicalNode.create("table_cell"),))
            for _ in range(500)
        )
        table = CanonicalNode.create("table", children=rows)
        errors = validate_telegram_document(doc(table))
        self.assertTrue(any("500 blocos" in error for error in errors))
        plan = plan_telegram_representations(doc(table)).options["blocks"]
        self.assertTrue(plan.blocking)

    def test_list_items_and_nested_blocks_count_toward_limit(self):
        items = tuple(
            CanonicalNode.create("list_item", children=(CanonicalNode.create("text", text="x"),))
            for _ in range(250)
        )
        listing = CanonicalNode.create("list", children=items)
        errors = validate_telegram_document(doc(listing))
        self.assertTrue(any("500 blocos" in error for error in errors))
        plan = plan_telegram_representations(doc(listing)).options["blocks"]
        self.assertTrue(plan.blocking)

    def test_table_rowspan_occupancy_counts_toward_effective_width(self):
        spanning = CanonicalNode.create("table_cell", attrs={"colspan": 10, "rowspan": 2})
        row1 = CanonicalNode.create("table_row", children=(spanning,))
        row2 = CanonicalNode.create("table_row", children=(
            CanonicalNode.create("table_cell", attrs={"colspan": 11}),
        ))
        table = CanonicalNode.create("table", children=(row1, row2))
        errors = validate_telegram_document(doc(table))
        self.assertTrue(any("20 colunas" in error for error in errors))

    def test_table_over_twenty_effective_columns_is_rejected(self):
        cell = CanonicalNode.create("table_cell", attrs={"colspan": 21})
        table = CanonicalNode.create("table", children=(CanonicalNode.create("table_row", children=(cell,)),))
        errors = validate_telegram_document(doc(table))
        self.assertTrue(any("20 colunas" in error for error in errors))
        from mdtxtrt.projections import telegram_projection
        review = telegram_projection(doc(table))
        for error in errors:
            if error not in review.blocking:
                review.blocking.append(error)
        plan = plan_telegram_representations(doc(table), html_review=review).options["blocks"]
        self.assertTrue(plan.blocking)

    def test_button_rows_compile_to_typed_blocks(self):
        button = CanonicalNode.create("button", attrs={"type": "copy_text", "copy_text": "abc", "style": "success"}, children=(CanonicalNode.create("text", text="Copiar"),))
        row = CanonicalNode.create("button_row", attrs={"align": "center"}, children=(button,))
        plan = plan_telegram_representations(doc(row)).options["blocks"]
        self.assertTrue(plan.available)
        self.assertEqual(plan.blocks[0]["type"], "buttons")
        self.assertEqual(plan.blocks[0]["buttons"][0]["copy_text"], {"text": "abc"})

    def test_review_identity_and_adaptation_consent_are_separate(self):
        paragraph = CanonicalNode.create("paragraph", children=(CanonicalNode.create("text", text="ok"),))
        plan = plan_telegram_representations(doc(paragraph), fingerprint_context={"destination": {"chat_id": "1"}}).options["html"]
        self.assertTrue(plan.requires_review)
        self.assertFalse(plan.requires_confirmation)
        self.assertEqual(plan.public()["destination_context"], {"chat_id": "1"})

    def test_fingerprint_changes_with_execution_context(self):
        paragraph = CanonicalNode.create("paragraph", children=(CanonicalNode.create("text", text="ok"),))
        d = doc(paragraph)
        one = plan_telegram_representations(d, fingerprint_context={"destination": {"chat_id": "1"}, "native_operations": []}).options["html"]
        two = plan_telegram_representations(d, fingerprint_context={"destination": {"chat_id": "2"}, "native_operations": []}).options["html"]
        three = plan_telegram_representations(d, fingerprint_context={"destination": {"chat_id": "1"}, "native_operations": [{"kind": "location", "latitude": 1.0, "longitude": 2.0}]}).options["html"]
        self.assertNotEqual(one.fingerprint, two.fingerprint)
        self.assertNotEqual(one.fingerprint, three.fingerprint)

    def test_private_thread_requires_forum_mode(self):
        paragraph = CanonicalNode.create("paragraph", children=(CanonicalNode.create("text", text="ok"),))
        errors = validate_telegram_document(doc(paragraph), TelegramDestinationContext(1, "private", message_thread_id=10, is_forum=False))
        self.assertTrue(any("forum topic mode" in error for error in errors))
        self.assertEqual(validate_telegram_document(doc(paragraph), TelegramDestinationContext(1, "private", message_thread_id=10, is_forum=True)), [])

    def test_sqlite_context_closes_connection(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = SQLiteRepository(str(Path(tmp) / "db.sqlite"))
            repo.initialize()
            with repo.connect() as db:
                db.execute("SELECT 1").fetchone()
            with self.assertRaises(Exception):
                db.execute("SELECT 1")

    def test_media_hard_limit_is_enforced(self):
        self.assertEqual(MAX_STORED_MEDIA_BYTES, 50 * 1024 * 1024)

    def test_edit_destination_and_upload_limits_are_enforced_at_http_boundary(self):
        root = Path(__file__).resolve().parents[1]
        server = (root / "mdtxtrt" / "server.py").read_text()
        app_js = (root / "mdtxtrt" / "static" / "app.js").read_text()
        self.assertIn('edit_payload["destination_chat_id"] = saved_destination', server)
        self.assertIn('_stored_telegram_destination(publication_record, identity.user_id)', server)
        self.assertIn('media_kind == "photo" and len(data) > MAX_PHOTO_BYTES', server)
        self.assertIn('media_kind not in {"photo", "video", "animation", "audio", "voice_note", "document"}', server)
        self.assertIn('if(target&&(!editing||operation==="republish")) body.destination_chat_id=target;', app_js)
        self.assertIn('adaptations_confirmed:plan.requires_confirmation?true:undefined', app_js)
        self.assertIn('adaptations_confirmed=payload.get("adaptations_confirmed") is True', server)
        bot = (root / "mdtxtrt" / "bot.py").read_text()
        self.assertIn('self.router.callback_query.register(self.callback_query)', bot)
        self.assertIn('await query.answer("Ação recebida pelo MDTXTRT.")', bot)

    def test_location_request_is_claimed_once_under_concurrency(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = SQLiteRepository(str(Path(tmp) / "db.sqlite"))
            repo.initialize()
            assets = AssetService(repo)
            assets.initialize()
            draft = repo.create_draft(user_id=7, name="x", document=CanonicalDocument.empty())
            assets.create_location_request(user_id=7, draft_id=draft["id"])
            barrier = threading.Barrier(2)
            results = []
            def worker():
                barrier.wait()
                results.append(assets.fulfill_latest_location(user_id=7, latitude=1, longitude=2))
            threads = [threading.Thread(target=worker) for _ in range(2)]
            for t in threads: t.start()
            for t in threads: t.join()
            self.assertEqual(sum(item is not None for item in results), 1)


if __name__ == "__main__":
    unittest.main()
