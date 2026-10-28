import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from guide_extender import START, ToolError, build_patch, digest, split_patch

SOURCE = b'<html><body><script src="manifest.json"></script></body></html>'


class PatchTests(unittest.TestCase):
    def test_append_preserves_original_and_round_trips(self):
        patched = build_patch(SOURCE, {"length": 220})
        base, config = split_patch(patched)
        self.assertEqual(base, SOURCE)
        self.assertEqual(config["base_sha256"], digest(SOURCE))
        self.assertEqual(config["settings"]["length"], 220)

    def test_reapplying_changes_settings_without_stacking(self):
        patched = build_patch(build_patch(SOURCE, {"length": 220}), {"length": 400})
        self.assertEqual(patched.count(START), 1)
        self.assertEqual(split_patch(patched)[1]["settings"]["length"], 400)

    def test_modified_original_is_rejected(self):
        patched = build_patch(SOURCE, {"length": 220})
        with self.assertRaises(ToolError):
            split_patch(b"/* modified */" + patched)

    def test_damaged_trailer_is_rejected(self):
        patched = build_patch(SOURCE, {"length": 220})
        with self.assertRaises(ToolError):
            split_patch(patched + b"other patch")

    def test_unsupported_source_is_rejected(self):
        with self.assertRaises(ToolError):
            build_patch(b"console.log('new game version')", {})

    def test_nonfinite_values_are_rejected(self):
        with self.assertRaises(ToolError):
            build_patch(SOURCE, {"length": float("nan")})


if __name__ == "__main__":
    unittest.main()
