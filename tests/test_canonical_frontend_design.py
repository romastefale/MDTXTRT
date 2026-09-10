from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "mdtxtrt" / "static" / "index.html"
APP = ROOT / "mdtxtrt" / "static" / "app.js"

class CanonicalFrontendDesignTests(unittest.TestCase):
    def test_toolbar_is_a_fixed_thirteen_column_grid(self):
        index = INDEX.read_text()
        self.assertIn("grid-template-columns:repeat(13,minmax(0,1fr))", index)
        self.assertNotIn(".toolbar{display:flex", index)
        self.assertNotIn("overflow-x:auto", index)

    def test_view_tabs_expose_accessible_state(self):
        index, script = INDEX.read_text(), APP.read_text()
        self.assertIn('role="tablist"', index)
        self.assertIn('role="tab" aria-selected="true"', index)
        self.assertIn('role="tab" aria-selected="false"', index)
        self.assertIn('id="telegram-preview"', index)
        self.assertIn('tab.setAttribute("aria-selected"', script)

    def test_format_state_and_safe_areas_are_supported(self):
        index, script = INDEX.read_text(), APP.read_text()
        self.assertIn('[aria-pressed="true"]', index)
        self.assertIn('button.setAttribute("aria-pressed"', script)
        self.assertIn("--tg-content-safe-area-inset-top", index)
        self.assertIn("--tg-content-safe-area-inset-bottom", index)

if __name__ == "__main__":
    unittest.main()
