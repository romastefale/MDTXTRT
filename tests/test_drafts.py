import tempfile
import unittest
from pathlib import Path

from drafts import DraftStore, durable_draft_content


class DraftPersistenceTests(unittest.TestCase):
    def test_draft_survives_store_reopen(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = str(Path(tmp) / "drafts.sqlite3")
            first = DraftStore(path)
            saved = first.save(123456, "# Rascunho\n\ncontinua amanhã")
            self.assertEqual(saved["content"], "# Rascunho\n\ncontinua amanhã")

            reopened = DraftStore(path)
            loaded = reopened.load(123456)
            self.assertIsNotNone(loaded)
            self.assertEqual(loaded["content"], "# Rascunho\n\ncontinua amanhã")

    def test_users_are_isolated_by_telegram_id(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = DraftStore(str(Path(tmp) / "drafts.sqlite3"))
            store.save(100, "rascunho A")
            store.save(200, "rascunho B")
            self.assertEqual(store.load(100)["content"], "rascunho A")
            self.assertEqual(store.load(200)["content"], "rascunho B")

    def test_local_media_tokens_are_not_persisted(self):
        source = (
            "antes\n\n"
            '![](mdtxtrt://photo/abc123 "foto")\n\n'
            "meio\n\n"
            "![](https://example.com/permanente.png)\n\n"
            "![](mdtxtrt://video/xyz789)\n\n"
            "![](mdtxtrt://media/legacy123)\n\n"
            "depois"
        )
        durable = durable_draft_content(source)
        self.assertNotIn("mdtxtrt://", durable)
        self.assertIn("https://example.com/permanente.png", durable)
        self.assertIn("antes", durable)
        self.assertIn("depois", durable)

    def test_saving_again_updates_same_user(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = DraftStore(str(Path(tmp) / "drafts.sqlite3"))
            store.save(123, "primeiro")
            store.save(123, "segundo")
            self.assertEqual(store.load(123)["content"], "segundo")


if __name__ == "__main__":
    unittest.main()
