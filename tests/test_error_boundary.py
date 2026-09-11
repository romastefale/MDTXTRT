import json
import sqlite3
from types import SimpleNamespace
import unittest

from mdtxtrt.assets import BlobIntegrityError
from mdtxtrt.server import error_boundary, health


class ErrorBoundaryTests(unittest.IsolatedAsyncioTestCase):
    async def test_telegram_value_error_has_stable_code_and_detail(self):
        request = SimpleNamespace(path="/api/publish/telegram/preview")

        async def invalid(_request):
            raise ValueError("message_thread_id_must_be_positive")

        response = await error_boundary(request, invalid)
        payload = json.loads(response.text)
        self.assertEqual(response.status, 422)
        self.assertEqual(payload["error"], "telegram_validation_error")
        self.assertEqual(payload["detail"], "message_thread_id_must_be_positive")

    async def test_sqlite_failure_does_not_become_internal_error(self):
        request = SimpleNamespace(path="/api/drafts")

        async def unavailable(_request):
            raise sqlite3.OperationalError("database is locked")

        response = await error_boundary(request, unavailable)
        self.assertEqual(response.status, 503)
        self.assertEqual(json.loads(response.text)["error"], "storage_error")

    async def test_blob_hash_failure_has_named_boundary_error(self):
        request = SimpleNamespace(path="/public/media/token")

        async def corrupt(_request):
            raise BlobIntegrityError("media_sha256_mismatch")

        response = await error_boundary(request, corrupt)
        payload = json.loads(response.text)
        self.assertEqual(response.status, 500)
        self.assertEqual(payload["error"], "blob_integrity_error")
        self.assertEqual(payload["reason"], "media_sha256_mismatch")

    async def test_health_only_reports_runtime_state(self):
        request = SimpleNamespace(
            app={
                "settings": SimpleNamespace(telegraph_key=""),
                "telegram_runtime": SimpleNamespace(
                    telegram_ready=True,
                    polling_ready=False,
                    last_operational_error=None,
                ),
            }
        )
        payload = json.loads((await health(request)).text)
        self.assertNotIn("canonical_document", payload)
        self.assertNotIn("rich_message_models_available", payload)
        self.assertNotIn("telegram_representations", payload)
        self.assertEqual(payload["telegram_ready"], True)


if __name__ == "__main__":
    unittest.main()
