import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from guide_extender import START, ToolError, build_patch, digest, split_patch, validate_settings

SOURCE = b'<html><body><script src="manifest.json"></script></body></html>'


class PatchTests(unittest.TestCase):
    def test_legacy_settings_disable_banks_by_default(self):
        self.assertFalse(validate_settings({})["bankPrediction"])
        self.assertFalse(validate_settings({})["firstHitPocket"])
        self.assertFalse(validate_settings({})["snookerAllReds"])
        self.assertFalse(validate_settings({})["eightBallAllButBlack"])

    def test_sweep_switches_round_trip_independently_and_preserve_defaults(self):
        for name in ("snookerAllReds", "eightBallAllButBlack"):
            patched = build_patch(SOURCE, {name: True})
            base, config = split_patch(patched)
            self.assertEqual(base, SOURCE)
            self.assertTrue(config["settings"][name])
            self.assertFalse(config["settings"]["firstHitPocket"])
            disabled = build_patch(patched, {})
            self.assertFalse(split_patch(disabled)[1]["settings"][name])
            self.assertEqual(disabled.count(START), 1)

    def test_first_hit_pocket_toggle_survives_patch_and_can_be_disabled(self):
        patched = build_patch(SOURCE, {"firstHitPocket": True, "bankPrediction": True})
        base, config = split_patch(patched)
        self.assertEqual(base, SOURCE)
        self.assertTrue(config["settings"]["firstHitPocket"])
        self.assertTrue(config["settings"]["bankPrediction"])
        updated = build_patch(patched, {"firstHitPocket": False})
        self.assertFalse(split_patch(updated)[1]["settings"]["firstHitPocket"])
        self.assertEqual(updated.count(START), 1)

    def test_bank_toggle_survives_patch_round_trip_and_reapplication(self):
        patched = build_patch(SOURCE, {"bankPrediction": True})
        base, config = split_patch(patched)
        self.assertEqual(base, SOURCE)
        self.assertTrue(config["settings"]["bankPrediction"])
        updated = build_patch(patched, {"bankPrediction": False})
        self.assertFalse(split_patch(updated)[1]["settings"]["bankPrediction"])
        self.assertEqual(updated.count(START), 1)

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
