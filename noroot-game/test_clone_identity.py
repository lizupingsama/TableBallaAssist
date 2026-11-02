"""Offline binary identity tests, including the actual supplied game's APK.

The aapt checks parse the rewritten binary manifest/resource table. They do not
install the application or establish that its channel SDK accepts a new identity.
"""
from pathlib import Path
import os
import struct
import subprocess
import sys
import tempfile
import unittest
import zipfile

from clone_identity import (
    ANDROID, NONE, _Document, _StringPool,
    clone_manifest, clone_resources, inspect_manifest,
)

ROOT = Path(__file__).resolve().parent
OLD = "com.krmtqds.aligames"
NEW = "io.lizuping.poolguide.game"
LABEL = "台球大师·测试"
AAPT = Path(os.environ.get("POOL_AAPT", r"C:\Program Files\Unity\Hub\Editor\2022.3.8f1c1\Editor\Data\PlaybackEngines\AndroidPlayer\SDK\build-tools\34.0.0\aapt.exe"))
APK = Path(os.environ.get("POOL_GAME_APK", str(ROOT.parent.parent / "tmp_labels/com.krmtqds.aligames.apk")))


def pool(strings, utf8, styled=True):
    """Independent, short-entry fixture encoder for both Android pool formats."""
    data = bytearray()
    offsets = []
    for value in strings:
        offsets.append(len(data))
        utf16 = value.encode("utf-16-le")
        units = len(utf16) // 2
        if utf8:
            encoded = value.encode("utf-8")
            def size(value):
                return bytes([value]) if value < 128 else bytes([128 | (value >> 8), value & 255])
            data.extend(size(units) + size(len(encoded)) + encoded + b"\0")
        else:
            data.extend(struct.pack("<H", units) + utf16 + b"\0\0")
    data.extend(b"\0" * (-len(data) % 4))
    style = struct.pack("<IIIIII", strings.index("b"), 0, 3, NONE, NONE, NONE) if styled else b""
    style_offsets = struct.pack("<I", 0) if styled else b""
    strings_start = 28 + 4 * len(strings) + len(style_offsets)
    styles_start = strings_start + len(data) if styled else 0
    total = strings_start + len(data) + len(style)
    return (struct.pack("<HHIIIIII", 1, 28, total, len(strings), int(styled), 0x100 if utf8 else 0,
                        strings_start, styles_start)
            + struct.pack("<" + "I" * len(strings), *offsets) + style_offsets + data + style)


def manifest(utf8, *, shared=False, foreign_authority=False, application_label=True):
    strings = ["b", "android", ANDROID]
    ids = {"label": 0x01010001, "name": 0x01010003, "permission": 0x01010006,
           "readPermission": 0x01010007, "writePermission": 0x01010008,
           "permissionGroup": 0x0101000A, "sharedUserId": 0x0101000B,
           "process": 0x01010011, "taskAffinity": 0x01010012, "authorities": 0x01010018,
           "value": 0x01010024, "targetPackage": 0x01010021,
           "targetActivity": 0x01010202, "parentActivityName": 0x010103A7}
    mapped = {}

    def string(value):
        if value not in strings:
            strings.append(value)
        return strings.index(value)

    def node(tag, attrs, children=()):
        attributes = []
        for namespace, name, value in attrs:
            name_index = string(name)
            if namespace == ANDROID:
                mapped[name_index] = ids[name]
            value_index = string(value)
            attributes.append(struct.pack("<IIIHBBI", string(namespace) if namespace else NONE,
                                          name_index, value_index, 8, 0, 3, value_index))
        name = string(tag)
        start = struct.pack("<HHIII", 0x102, 16, 36 + len(attributes) * 20, 1, NONE)
        start += struct.pack("<IIHHHHHH", NONE, name, 20, 20, len(attributes), 0, 0, 0)
        end = struct.pack("<HHIIIII", 0x103, 16, 24, 1, NONE, NONE, name)
        return start + b"".join(attributes) + b"".join(children) + end

    def android(**values):
        return [(ANDROID, name, value) for name, value in values.items()]

    def launcher(label=False):
        return node("intent-filter", android(label="Old") if label else [], [
            node("action", android(name="android.intent.action.MAIN")),
            node("category", android(name="android.intent.category.LAUNCHER")),
        ])

    root_attrs = [(None, "package", OLD)] + (android(sharedUserId="android.uid.shared") if shared else [])
    app_attrs = android(name=".App", process=OLD, taskAffinity=OLD + ".tasks")
    if application_label:
        app_attrs += android(label="Old")
    tree = node("manifest", root_attrs, [
        node("permission-group", android(name=OLD + ".group")),
        node("permission", android(name=OLD + ".CUSTOM", permissionGroup=OLD + ".group")),
        node("uses-permission", android(name=OLD + ".CUSTOM")),
        node("uses-permission", android(name="android.permission.INTERNET")),
        node("application", app_attrs, [
            node("meta-data", android(name="sdk.appid", value="keep-sdk-appid-123")),
            node("activity", android(name=".Main", label="Old", parentActivityName=".Parent"), [launcher(True)]),
            node("activity", android(name="com.sdk.AdActivity", label="SDK")),
            node("activity-alias", android(name=".Alias", targetActivity=".Main"), [launcher()]),
            node("service", android(name="Worker", process=OLD + ":worker", permission=OLD + ".CUSTOM")),
            node("provider", android(name="androidx.core.content.FileProvider",
                 authorities="external.fixed.authority" if foreign_authority else OLD + ".one;" + OLD + ".two",
                 readPermission=OLD + ".CUSTOM", writePermission=OLD + ".CUSTOM")),
        ]),
        node("instrumentation", android(name="Tests", targetPackage=OLD)),
    ])
    namespace_start = struct.pack("<HHIIIII", 0x100, 16, 24, 1, NONE, string("android"), string(ANDROID))
    namespace_end = struct.pack("<HHIIIII", 0x101, 16, 24, 1, NONE, string("android"), string(ANDROID))
    resource_ids = [mapped.get(i, 0) for i in range(len(strings))]
    resource_map = struct.pack("<HHI", 0x180, 8, 8 + len(resource_ids) * 4)
    resource_map += struct.pack("<" + "I" * len(resource_ids), *resource_ids)
    chunks = pool(strings, utf8) + resource_map + namespace_start + tree + namespace_end
    return struct.pack("<HHI", 3, 8, len(chunks) + 8) + chunks


class IdentityTests(unittest.TestCase):
    def test_utf8_and_utf16_preserve_original_indices_styles_and_class_identity(self):
        for utf8 in (False, True):
            with self.subTest(utf8=utf8):
                original = manifest(utf8)
                before = _Document(original)
                changed, report = clone_manifest(original, NEW, LABEL + "🎱")
                after = _Document(changed)
                info = inspect_manifest(changed)
                self.assertEqual(info["package"], NEW)
                self.assertEqual(info["application"]["label"], LABEL + "🎱")
                self.assertTrue(all(item["label"] == LABEL + "🎱" for item in info["launchers"]))
                self.assertEqual(info["component_classes"], inspect_manifest(original)["component_classes"])
                self.assertEqual(after.pool.strings[:before.pool.original_count], before.pool.strings)
                self.assertEqual(after.pool.offsets[:before.pool.original_count], before.pool.offsets)
                self.assertEqual(after.pool.style_offsets, before.pool.style_offsets)
                self.assertEqual(after.pool.style_data, before.pool.style_data)
                self.assertEqual(after.pool.style_count, before.pool.style_count)
                self.assertEqual(after.pool.string_data[:len(before.pool.string_data)], before.pool.string_data)
                self.assertEqual(bool(after.pool.flags & 0x100), utf8)
                self.assertEqual(info["metadata"], inspect_manifest(original)["metadata"])
                self.assertTrue(report["component_classes_preserved"])
                self.assertTrue(set(info["provider_authorities"]).isdisjoint(inspect_manifest(original)["provider_authorities"]))
                self.assertEqual(info["provider_authorities"], [NEW + ".one", NEW + ".two"])
                self.assertIn(NEW + ".CUSTOM", info["permission_uses"])
                self.assertIn("android.permission.INTERNET", info["permission_uses"])
                self.assertEqual({item["name"] for item in info["permission_declarations"]}, {NEW + ".group", NEW + ".CUSTOM"})
                self.assertTrue(all(item["value"].startswith(NEW + ".") for item in info["permission_references"]))
                self.assertEqual(info["application"]["process"], NEW)
                self.assertEqual(info["application"]["taskAffinity"], NEW + ".tasks")
                service = next(item for item in info["components"] if item["tag"] == "service")
                self.assertEqual(service["process"], NEW + ":worker")
                sdk = next(item for item in info["components"] if item.get("name") == "com.sdk.AdActivity")
                self.assertEqual(sdk["label"], "SDK")
                for node in after.elements:
                    if node.tag == "intent-filter" and node.attr("label"):
                        self.assertEqual(node.value("label"), LABEL + "🎱")

    def test_missing_application_label_is_inserted_with_resource_id(self):
        changed, _ = clone_manifest(manifest(True, application_label=False), NEW, LABEL)
        document = _Document(changed)
        app = next(node for node in document.elements if node.tag == "application")
        label = app.attr("label")
        self.assertEqual(label.value, LABEL)
        name_index = struct.unpack_from("<I", label.raw, 4)[0]
        self.assertEqual(document.resource_ids[name_index], 0x01010001)

    def test_shared_uid_and_unisolated_authorities_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "sharedUserId"):
            clone_manifest(manifest(True, shared=True), NEW, LABEL)
        with self.assertRaisesRegex(ValueError, "collide"):
            clone_manifest(manifest(False, foreign_authority=True), NEW, LABEL)
        for value in (OLD, "bad/name", "x.*", "x|y", "", None):
            with self.subTest(package=value), self.assertRaises(ValueError):
                clone_manifest(manifest(True), value, LABEL)

    def test_variable_length_string_encodings_and_sorted_flag(self):
        for utf8, value in ((True, "中文🎱" * 40), (False, "长" * 40000)):
            with self.subTest(utf8=utf8):
                original = _StringPool(pool(["b", "original"], utf8))
                raw = bytearray(original.raw)
                struct.pack_into("<I", raw, 16, original.flags | 1)
                parsed = _StringPool(bytes(raw))
                new_index = parsed.add(value)
                result = _StringPool(parsed.encode())
                self.assertEqual(result.get(new_index), value)
                self.assertEqual(result.strings[:2], ["b", "original"])
                self.assertEqual(result.style_data, original.style_data)
                self.assertFalse(result.flags & 1)
                offset = result.offsets[new_index]
                if utf8:
                    self.assertTrue(result.string_data[offset] & 0x80)
                else:
                    self.assertEqual(result.string_data[offset:offset + 4], struct.pack("<HH", 0x8000, 40000))

    def test_resource_table_changes_only_fixed_name_field(self):
        package_header = bytearray(288)
        struct.pack_into("<HHII", package_header, 0, 0x200, 288, 288, 0x7F)
        encoded = OLD.encode("utf-16-le")
        package_header[12:12 + len(encoded)] = encoded
        package_header[268:] = bytes(range(20))
        original = struct.pack("<HHII", 2, 12, 300, 1) + package_header
        changed, report = clone_resources(original, OLD, NEW)
        self.assertEqual(len(changed), len(original))
        field = report["packages"][0]["name_field_offset"]
        self.assertEqual(changed[:field], original[:field])
        self.assertEqual(changed[field + 256:], original[field + 256:])
        self.assertEqual(changed[field:field + 256].decode("utf-16-le").rstrip("\0"), NEW)
        self.assertEqual(report["packages"][0]["package_id"], 0x7F)
        with self.assertRaisesRegex(ValueError, "matching"):
            clone_resources(original, "other.app", NEW)
        with self.assertRaisesRegex(ValueError, "127"):
            clone_resources(original, OLD, "a." + "b" * 126)

    def test_truncated_or_wrong_binary_formats_are_rejected(self):
        for content in (b"", b"<manifest package='x.y'/>", manifest(True)[:-1]):
            with self.subTest(size=len(content)), self.assertRaises(ValueError):
                clone_manifest(content, NEW, LABEL)
        with self.assertRaises(ValueError):
            clone_resources(b"not a resource table", OLD, NEW)

    @unittest.skipUnless(APK.is_file() and AAPT.is_file(), "Supplied game APK and installed Android aapt required")
    def test_real_game_aapt_parses_new_identity_and_resource_package(self):
        with zipfile.ZipFile(APK) as archive:
            original_manifest = archive.read("AndroidManifest.xml")
            original_resources = archive.read("resources.arsc")
        changed, manifest_report = clone_manifest(original_manifest, NEW, LABEL)
        resources, resource_report = clone_resources(original_resources, OLD, NEW)
        before, after = inspect_manifest(original_manifest), inspect_manifest(changed)
        self.assertEqual(before["component_classes"], after["component_classes"])
        self.assertEqual(before["metadata"], after["metadata"])
        self.assertEqual(len(after["provider_authorities"]), 16)
        self.assertTrue(set(before["provider_authorities"]).isdisjoint(after["provider_authorities"]))
        self.assertIn(NEW + ".openadsdk.permission.TT_PANGOLIN", after["permission_uses"])
        self.assertNotIn(OLD + ".openadsdk.permission.TT_PANGOLIN", after["permission_uses"])
        pullup = next(item for item in after["components"] if item.get("name") == "cn.uc.gamesdk.activity.PullupActivity")
        self.assertEqual(pullup["taskAffinity"], NEW + ".diff")
        offset = resource_report["packages"][0]["name_field_offset"]
        self.assertEqual(resources[:offset], original_resources[:offset])
        self.assertEqual(resources[offset + 256:], original_resources[offset + 256:])
        self.assertTrue(manifest_report["component_classes_preserved"])
        with tempfile.TemporaryDirectory(prefix="poolgame-identity-test-") as folder:
            apk = Path(folder) / "identity.apk"
            with zipfile.ZipFile(apk, "w", zipfile.ZIP_STORED) as archive:
                archive.writestr("AndroidManifest.xml", changed)
                archive.writestr("resources.arsc", resources)

            def dump(*arguments):
                result = subprocess.run([str(AAPT), "dump", *arguments], capture_output=True,
                                        encoding="utf-8", errors="replace", timeout=30)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                return result.stdout

            badging = dump("badging", str(apk))
            self.assertIn("package: name='" + NEW + "'", badging)
            self.assertIn("application-label:'" + LABEL + "'", badging)
            self.assertIn("launchable-activity: name='com.cnandroid.ball8game.LaunchActivity'", badging)
            self.assertIn("label='" + LABEL + "'", badging)
            table = dump("resources", str(apk))
            self.assertIn("name=" + NEW, table)
            self.assertNotIn("name=" + OLD, table)
            xml = dump("xmltree", str(apk), "AndroidManifest.xml")
            self.assertIn('package="' + NEW + '"', xml)
            self.assertIn('"' + NEW + '.fileprovider"', xml)
            self.assertIn('"com.cnandroid.ball8game.GameApplication"', xml)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    unittest.main(verbosity=2)
