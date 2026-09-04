import tempfile
import unittest
from pathlib import Path

from drafts import DraftStore, durable_draft_content


class DraftPersistenceTests(unittest.TestCase):
    def test_draft_survives_store_reopen(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = str(Path(tmp) / "drafts.sqlite3")
            first = DraftStore(path)
            saved = first.save(
                123456,
                "# Rascunho\n\ncontinua amanhã",
                "Documento importante",
            )
            self.assertEqual(saved["content"], "# Rascunho\n\ncontinua amanhã")
            self.assertEqual(saved["title"], "Documento importante")

            reopened = DraftStore(path)
            loaded = reopened.load(123456)
            self.assertIsNotNone(loaded)
            self.assertEqual(loaded["content"], "# Rascunho\n\ncontinua amanhã")
            self.assertEqual(loaded["title"], "Documento importante")

    def test_users_are_isolated_by_telegram_id(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = DraftStore(str(Path(tmp) / "drafts.sqlite3"))
            store.save(100, "rascunho A", "A")
            store.save(200, "rascunho B", "B")
            self.assertEqual(store.load(100)["content"], "rascunho A")
            self.assertEqual(store.load(100)["title"], "A")
            self.assertEqual(store.load(200)["content"], "rascunho B")
            self.assertEqual(store.load(200)["title"], "B")

    def test_local_media_tokens_are_persisted(self):
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
        self.assertEqual(durable, source)
        self.assertIn("mdtxtrt://photo/abc123", durable)
        self.assertIn("mdtxtrt://video/xyz789", durable)
        self.assertIn("mdtxtrt://media/legacy123", durable)

    def test_media_survives_store_reopen(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = str(Path(tmp) / "drafts.sqlite3")
            media_dir = str(Path(tmp) / "media")
            first = DraftStore(path, media_dir)
            first.save_media(
                123,
                "mediaABC123",
                {
                    "data": b"persistent-media-bytes",
                    "name": "foto.png",
                    "mime": "image/png",
                    "kind": "photo",
                },
            )

            reopened = DraftStore(path, media_dir)
            loaded = reopened.load_media("mediaABC123")
            self.assertIsNotNone(loaded)
            self.assertEqual(loaded["data"], b"persistent-media-bytes")
            self.assertEqual(loaded["name"], "foto.png")
            self.assertEqual(loaded["mime"], "image/png")
            self.assertEqual(loaded["kind"], "photo")
            self.assertEqual(loaded["telegram_user_id"], 123)

    def test_saving_again_updates_same_user(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = DraftStore(str(Path(tmp) / "drafts.sqlite3"))
            store.save(123, "primeiro", "Título 1")
            store.save(123, "segundo", "Título 2")
            loaded = store.load(123)
            self.assertEqual(loaded["content"], "segundo")
            self.assertEqual(loaded["title"], "Título 2")


if __name__ == "__main__":
    unittest.main()
