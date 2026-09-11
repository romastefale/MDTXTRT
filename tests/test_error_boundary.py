import json
import sqlite3
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from mdtxtrt.assets import BlobIntegrityError
from mdtxtrt.server import error_boundary, health
from mdtxtrt.telegram_validation import TelegramDestinationContext, telegram_validation_text


ROOT = Path(__file__).resolve().parents[1]
UNMEASURED_HEALTH_FLAGS = (
    '"canonical_document": True',
    '"telegraph_per_user": True',
    '"local_media": True',
    '"native_location": True',
    '"persistent_pending_imports": True',
    '"positional_output_override": True',
    '"semantic_recovery_review": True',
    '"rich_message_models_available": True',
)


def _payload(response) -> dict:
    return json.loads(response.body)


class TelegramValidationTextTests(unittest.TestCase):
    def test_invalid_thread_id_is_named_not_python_literal(self):
        with self.assertRaises(ValueError) as caught:
            TelegramDestinationContext.from_dict(
                {"message_thread_id": "abc"}, default_chat_id=1
            )
        code = str(caught.exception)
        self.assertEqual(code, "message_thread_id_must_be_integer")
        self.assertNotIn("invalid literal", code)
        self.assertEqual(
            telegram_validation_text(code),
            "message_thread_id deve ser um inteiro.",
        )

    def test_non_positive_topic_id_keeps_own_text(self):
        with self.assertRaises(ValueError) as caught:
            TelegramDestinationContext.from_dict(
                {"direct_messages_topic_id": 0}, default_chat_id=1
            )
        code = str(caught.exception)
        self.assertEqual(code, "direct_messages_topic_id_must_be_positive")
        self.assertEqual(
            telegram_validation_text(code),
            "direct_messages_topic_id deve ser um inteiro positivo.",
        )


class ErrorBoundaryTests(unittest.IsolatedAsyncioTestCase):
    async def test_sqlite_failure_returns_named_code(self):
        async def boom(_request):
            raise sqlite3.OperationalError("database is locked")

        response = await error_boundary(SimpleNamespace(), boom)
        payload = _payload(response)
        self.assertEqual(response.status, 500)
        self.assertEqual(payload["error"], "sqlite_error")
        self.assertNotEqual(payload["error"], "internal_error")
        self.assertIn("banco", payload["detail"])

    async def test_blob_hash_failure_returns_named_code(self):
        async def boom(_request):
            raise BlobIntegrityError("media_sha256_mismatch")

        response = await error_boundary(SimpleNamespace(), boom)
        payload = _payload(response)
        self.assertEqual(response.status, 409)
        self.assertEqual(payload["error"], "media_sha256_mismatch")
        self.assertNotEqual(payload["error"], "internal_error")
        self.assertIn("hash", payload["detail"])

    async def test_telegram_validation_valueerror_includes_own_text(self):
        async def boom(_request):
            raise ValueError("message_thread_id_must_be_integer")

        response = await error_boundary(SimpleNamespace(), boom)
        payload = _payload(response)
        self.assertEqual(response.status, 400)
        self.assertEqual(payload["error"], "message_thread_id_must_be_integer")
        self.assertEqual(payload["detail"], "message_thread_id deve ser um inteiro.")


class HealthSignalTests(unittest.IsolatedAsyncioTestCase):
    def test_health_source_does_not_hardcode_unmeasured_features(self):
        source = (ROOT / "mdtxtrt/health.py").read_text() + (ROOT / "mdtxtrt/server.py").read_text()
        for fragment in UNMEASURED_HEALTH_FLAGS:
            self.assertNotIn(fragment, source)

    async def test_health_reports_only_measured_or_target_fields(self):
        request = SimpleNamespace(
            app={
                "settings": SimpleNamespace(telegraph_key=""),
                "telegram_runtime": SimpleNamespace(
                    telegram_ready=False,
                    polling_ready=False,
                    last_operational_error="TelegramUnauthorizedError",
                ),
            }
        )
        response = await health(request)
        payload = _payload(response)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["target_bot_api_version"], "10.3")
        self.assertFalse(payload["telegram_ready"])
        self.assertFalse(payload["polling_ready"])
        self.assertEqual(payload["last_telegram_error"], "TelegramUnauthorizedError")
        self.assertFalse(payload["telegraph_key_configured"])
        self.assertIsInstance(payload["rich_message_models_available"], bool)
        self.assertIsInstance(payload["aiogram_version"], str)
        for key in (
            "canonical_document",
            "telegraph_per_user",
            "local_media",
            "native_location",
            "persistent_pending_imports",
            "positional_output_override",
            "semantic_recovery_review",
            "telegram_representations",
        ):
            self.assertNotIn(key, payload)

    async def test_health_rich_models_flag_follows_import_probe(self):
        request = SimpleNamespace(
            app={
                "settings": SimpleNamespace(telegraph_key="k"),
                "telegram_runtime": SimpleNamespace(
                    telegram_ready=True,
                    polling_ready=True,
                    last_operational_error=None,
                ),
            }
        )
        with patch("mdtxtrt.health.rich_message_models_available", return_value=False):
            payload = _payload(await health(request))
        self.assertFalse(payload["rich_message_models_available"])
        self.assertTrue(payload["telegraph_key_configured"])


if __name__ == "__main__":
    unittest.main()
