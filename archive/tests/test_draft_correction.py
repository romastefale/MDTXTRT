import tempfile
import unittest
from pathlib import Path

from drafts import DraftConflict, DraftStore


class DraftCorrectionTest(unittest.TestCase):
    def test_stale_save_cannot_overwrite_and_media_cannot_cross_users(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = DraftStore(
                str(Path(tmp) / "drafts.sqlite3"),
                str(Path(tmp) / "media"),
            )

            first = store.save(100, "primeiro", base_revision=0)
            current = store.save(100, "mais novo", base_revision=first["revision"])

            with self.assertRaises(DraftConflict):
                store.save(100, "gravação velha", base_revision=first["revision"])

            self.assertEqual(store.load(100)["content"], "mais novo")
            self.assertEqual(store.load(100)["revision"], current["revision"])

            store.save_media(
                100,
                "media123",
                {
                    "data": b"conteudo-real",
                    "name": "foto.png",
                    "mime": "image/png",
                    "kind": "photo",
                },
            )
            self.assertIsNotNone(store.load_media("media123", 100))
            self.assertIsNone(store.load_media("media123", 200))


if __name__ == "__main__":
    unittest.main()
