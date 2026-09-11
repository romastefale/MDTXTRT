from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
ACTIVE_PYTHON = (ROOT / "app.py", *sorted((ROOT / "mdtxtrt").glob("*.py")))
LEGACY_MODULES = {
    "canonical",
    "convert",
    "dm_command_ui",
    "drafts",
    "main",
    "map_location",
    "message_buttons",
    "preview_security",
    "rich_buttons",
    "rich_delivery",
    "rich_explicit",
    "rich_integrity",
    "rich_media",
    "rich_media_roundtrip",
    "rich_roundtrip",
    "runtime_commands",
    "runtime_commands_core",
    "runtime_composition",
    "runtime_foundation",
    "runtime_http",
    "runtime_rich",
    "runtime_v2",
}


class ActiveArchitectureBoundaryTests(unittest.TestCase):
    def test_deployment_uses_canonical_composition_root(self):
        self.assertIn("web: python app.py", (ROOT / "Procfile").read_text())
        self.assertIn('"startCommand": "python app.py"', (ROOT / "railway.json").read_text())

    def test_active_python_does_not_import_legacy_modules(self):
        import_pattern = re.compile(r"^(?:from|import)\s+([a-zA-Z_][\w.]*)", re.MULTILINE)
        violations = []
        for path in ACTIVE_PYTHON:
            source = path.read_text()
            for imported in import_pattern.findall(source):
                if imported.split(".", 1)[0] in LEGACY_MODULES:
                    violations.append(f"{path.relative_to(ROOT)} imports {imported}")
        self.assertEqual([], violations)

    def test_active_python_has_no_legacy_monkey_patch_installers(self):
        forbidden = {
            "installer function": re.compile(r"^def\s+install\s*\(", re.MULTILINE),
            "original function slot": re.compile(r"\b_ORIGINAL_[A-Z0-9_]+\b"),
            "attribute replacement": re.compile(r"\b(?:setattr|delattr)\s*\("),
            "module registry mutation": re.compile(r"\bsys\.modules\s*\["),
        }
        violations = []
        for path in ACTIVE_PYTHON:
            source = path.read_text()
            for label, pattern in forbidden.items():
                if pattern.search(source):
                    violations.append(f"{path.relative_to(ROOT)}: {label}")
        self.assertEqual([], violations)

    def test_active_server_serves_only_canonical_frontend(self):
        server = (ROOT / "mdtxtrt/server.py").read_text()
        index = (ROOT / "mdtxtrt/static/index.html").read_text()
        self.assertIn('STATIC_DIR = Path(__file__).resolve().parent / "static"', server)
        self.assertIn('src="/static/app.js"', index)
        self.assertNotRegex(index, r"ui\.\d+\.js")

    def test_railway_does_not_run_blind_unittest_discover(self):
        railway = (ROOT / "railway.json").read_text()
        self.assertNotIn("unittest discover", railway)
        self.assertIn("tests.test_architecture_boundaries", railway)
        self.assertIn("tests.test_canonical_frontend_design", railway)
        self.assertIn("tests.test_error_boundary", railway)

    def test_readme_names_the_live_entrypoint_and_ui(self):
        readme = (ROOT / "README.md").read_text()
        self.assertIn("app.py", readme)
        self.assertIn("mdtxtrt/static", readme)

    def test_legacy_runtime_lives_in_archive_not_at_root(self):
        self.assertTrue((ROOT / "app.py").exists())
        self.assertTrue((ROOT / "archive" / "runtime_v2.py").exists())
        self.assertTrue((ROOT / "archive" / "main.py").exists())
        self.assertTrue((ROOT / "archive" / "canonical.py").exists())
        self.assertFalse((ROOT / "runtime_v2.py").exists())
        self.assertFalse((ROOT / "main.py").exists())
        self.assertFalse((ROOT / "canonical.py").exists())
        self.assertFalse((ROOT / "ui.00.js").exists())
        self.assertFalse((ROOT / "index.html").exists())


if __name__ == "__main__":
    unittest.main()
