from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
INDEX = ROOT / "mdtxtrt" / "static" / "index.html"
APP = ROOT / "mdtxtrt" / "static" / "app.js"

class CanonicalFrontendDesignTests(unittest.TestCase):
    def test_toolbar_uses_fixed_icon_targets_without_horizontal_scroll(self):
        index = INDEX.read_text()
        self.assertIn(".toolbar{display:flex", index)
        self.assertIn("min-width:44px", index)
        self.assertIn('title="Texto"', index)
        self.assertIn('title="Bloco"', index)
        self.assertNotIn("overflow-x:auto", index)
        self.assertNotIn("repeat(13", index)
        self.assertNotIn('id="tool-more"', index)

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

    def test_pr54_visual_language_is_applied_to_canonical_ui(self):
        index = INDEX.read_text()
        self.assertEqual(index.count("<style>"), 1)
        self.assertIn('family=IBM+Plex+Mono', index)
        self.assertIn('--bg:#fff;--text:#111;--hint:#5c5c5c', index)
        self.assertIn('/* Visual do layout #54', index)
        self.assertIn('.bottom .action{height:48px', index)
        self.assertIn("dialog{border-radius:0", index)
        self.assertIn("grid-template-columns:44px 1fr", index)
        self.assertNotIn("backdrop-filter", index)
        self.assertNotIn("border-radius:9", index)
        self.assertNotIn("font-weight:760", index)
        self.assertNotIn(".bottom{grid-template-columns:repeat(3", index)

if __name__ == "__main__":
    unittest.main()
