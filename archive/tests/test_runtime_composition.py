"""Regressions for the active runtime composition boundary."""
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]


class RuntimeCompositionArchitectureTests(unittest.TestCase):
    def test_active_entrypoint_has_no_install_chain(self):
        source = (ROOT / "app.py").read_text(encoding="utf-8")
        self.assertNotIn(".install(", source)
        self.assertIn("runtime_composition", source)

    def test_composition_has_no_dynamic_dependency_fallback(self):
        for name in (
            "runtime_foundation.py",
            "runtime_rich.py",
            "runtime_http.py",
            "runtime_commands.py",
            "runtime_composition.py",
        ):
            source = (ROOT / name).read_text(encoding="utf-8")
            self.assertNotIn("def __getattr__(", source, name)


if __name__ == "__main__":
    unittest.main()
