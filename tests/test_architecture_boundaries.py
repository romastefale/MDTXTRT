from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
ACTIVE_PYTHON = (ROOT / "app.py", *sorted((ROOT / "mdtxtrt").glob("*.py")))

class ActiveArchitectureBoundaryTests(unittest.TestCase):
    def test_deployment_uses_canonical_composition_root(self):
        self.assertIn("web: python app.py", (ROOT / "Procfile").read_text())
        self.assertIn('"startCommand": "python app.py"', (ROOT / "railway.json").read_text())

    def test_active_server_serves_only_canonical_frontend(self):
        server = (ROOT / "mdtxtrt/server.py").read_text()
        index = (ROOT / "mdtxtrt/static/index.html").read_text()
        self.assertIn('STATIC_DIR = Path(__file__).resolve().parent / "static"', server)
        self.assertIn('src="/static/app.js"', index)
        self.assertNotRegex(index, r"ui\.\d+\.js")

    def test_railway_runs_the_complete_active_test_suite(self):
        railway = (ROOT / "railway.json").read_text()
        self.assertIn("python -m unittest discover -s tests -v", railway)

    def test_readme_names_the_live_entrypoint_and_ui(self):
        readme = (ROOT / "README.md").read_text()
        self.assertIn("app.py", readme)
        self.assertIn("mdtxtrt/static", readme)


if __name__ == "__main__":
    unittest.main()
