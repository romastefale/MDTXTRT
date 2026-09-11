from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class ModuleSplitTests(unittest.TestCase):
    def test_telegraph_adapter_is_outside_telegram_publishing(self):
        publishing = (ROOT / "mdtxtrt/publishing.py").read_text()
        telegraph = (ROOT / "mdtxtrt/telegraph_publishing.py").read_text()
        self.assertNotIn("class TelegraphPublicationService", publishing)
        self.assertIn("class TelegramPublicationService", publishing)
        self.assertIn("class TelegraphPublicationService", telegraph)

    def test_health_payload_lives_in_its_own_module(self):
        health = (ROOT / "mdtxtrt/health.py").read_text()
        server = (ROOT / "mdtxtrt/server.py").read_text()
        self.assertIn("async def health(", health)
        self.assertNotIn("async def health(", server)
        self.assertIn("from mdtxtrt.health import health", server)

    def test_import_workflow_controller_is_its_own_module(self):
        app = (ROOT / "mdtxtrt/static/app.js").read_text()
        importer = (ROOT / "mdtxtrt/static/import_ui.js").read_text()
        self.assertIn('from "/static/import_ui.js"', app)
        self.assertIn("createImportChosen", app)
        self.assertIn("createImportChosen", importer)
        self.assertIn("unsupported_import_format", importer)
        self.assertNotIn("const importErrors={", app)
