"""Build or verify a separately installable copy of the embedded-guide game."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

from build import APKTOOL_SHA256, ASSET, BASE_APK, BUILD, COEXIST_APK, ROOT, SOURCE_SHA256, is_old_signature, run, sha256, verify_entries
from payload import DEFAULT_PACKAGE_NAME, build_payload
from verify import dex_class

PACKAGE = "io.lizuping.poolguide.game"
LABEL = "台球大师·测试"
ACTIVITY = "smali/com/cnandroid/ball8game/MainActivity.smali"
ZIP_UTILS = "smali/com/cnandroid/ZipUtils.smali"
BASE_DEX_HASHES = {
    "classes2.dex": "ad23a757177cb5962797dde3bde8275ce60d1a52c6372163e18334bc36ab2a80",
    "classes5.dex": "006c934f1f2a903ea741673695b3f0a0c6a3ef459cc2adc0dc2365f6c313cfcb",
}
CHANGED = {"AndroidManifest.xml", "resources.arsc", "classes.dex", ASSET}


def patch_channel_bridge(source: str) -> str:
    """Keep the JS game's existing channel ID while Android uses the new ID."""
    signature = ".method public loadEgretComplete()V"
    methods = list(re.finditer(re.escape(signature) + r"\n.*?\.end method", source, re.S))
    if len(methods) != 1:
        raise ValueError("The inspected game initialization method changed")
    match = methods[0]
    method = match.group()
    if '"NativeCordovaUtils.loadEgretCompleteRet"' not in method:
        raise ValueError("The inspected JS initialization callback changed")
    pattern = (r"    invoke-virtual \{p0\}, Lcom/cnandroid/ball8game/MainActivity;"
               r"->getPackageName\(\)Ljava/lang/String;\n\s*move-result-object v4")
    if len(re.findall(pattern, method)) != 1:
        raise ValueError("The inspected channel identity parameter changed")
    method = re.sub(pattern, '    const-string v4, "' + DEFAULT_PACKAGE_NAME + '"', method, count=1)
    return source[:match.start()] + method + source[match.end():]


def patch_unzip_progress(source: str) -> str:
    """Limit polling of the background extractor before it posts UI callbacks."""
    signature = ".method public static uncompress(Ljava/io/File;Ljava/lang/String;Ljava/lang/String;Lcom/cnandroid/ZipUtils$ZipCallback;)V"
    methods = list(re.finditer(re.escape(signature) + r"\n.*?\.end method", source, re.S))
    if len(methods) != 1:
        raise ValueError("The inspected file extraction method changed")
    match = methods[0]
    method = match.group()
    anchor = ("    const-wide/16 p1, 0x0\n\n    .line 131\n"
              "    invoke-static {p1, p2}, Ljava/lang/Thread;->sleep(J)V")
    if method.count(anchor) != 1:
        raise ValueError("The inspected extraction progress polling loop changed")
    method = method.replace(anchor, anchor.replace("p1, 0x0", "p1, 0x64"), 1)
    return source[:match.start()] + method + source[match.end():]


def validate_base(original: Path, base: Path) -> None:
    if sha256(original) != SOURCE_SHA256:
        raise ValueError("Unexpected original game artifact")
    verify_entries(original, base, build_payload().encode("utf-8"))
    with zipfile.ZipFile(base) as archive:
        for name, expected in BASE_DEX_HASHES.items():
            if hashlib.sha256(archive.read(name)).hexdigest() != expected:
                raise ValueError("Unexpected embedded guide DEX: " + name)


def verify_coexist(base: Path, apk: Path, loader: bytes, manifest: bytes, resources: bytes,
                   tools: Path, java: Path) -> dict:
    with zipfile.ZipFile(base) as before, zipfile.ZipFile(apk) as after:
        original_names = {name for name in before.namelist() if not is_old_signature(name)}
        result_names = {name for name in after.namelist() if not is_old_signature(name)}
        if len(after.namelist()) != len(set(after.namelist())) or result_names != original_names:
            raise ValueError("Unexpected coexist APK entries")
        changed = {name for name in original_names if before.read(name) != after.read(name)}
        if changed != CHANGED:
            raise ValueError("Unexpected coexist modifications: " + str(changed))
        expected = {"AndroidManifest.xml": manifest, "resources.arsc": resources, ASSET: loader}
        for name, content in expected.items():
            if after.read(name) != content:
                raise ValueError("Unexpected coexist member: " + name)
        # No original code/resources are silently replaced by a full Apktool rebuild.
        main_dex = after.read("classes.dex")
    with tempfile.TemporaryDirectory(prefix="poolgame-coexist-verify-") as temporary:
        work = Path(temporary)
        local = work / "coexist.apk"
        shutil.copy2(apk, local)
        result = subprocess.run([str(tools / "aapt.exe"), "dump", "badging", str(local)],
                                capture_output=True, encoding="utf-8", errors="replace", timeout=30)
        if result.returncode:
            raise ValueError("Android could not parse the coexist APK: " + result.stderr)
        badging = result.stdout
        if "package: name='" + PACKAGE + "'" not in badging:
            raise ValueError("Android aapt did not report the distinct application ID")
        if LABEL not in badging:
            raise ValueError("Android aapt did not report the test application label")
        run([java, "-jar", tools / "lib/apksigner.jar", "verify", "--verbose", local])
        run([tools / "zipalign.exe", "-c", "-p", "4", local])
        dex = work / "classes.dex"
        dex.write_bytes(main_dex)
        activity = dex_class(tools / "dexdump.exe", dex, "Lcom/cnandroid/ball8game/MainActivity;")
        method = next(part for part in activity.split("      name          : ")
                      if part.startswith("'loadEgretComplete'"))
        if 'const-string v4, "' + DEFAULT_PACKAGE_NAME + '"' not in method or "getPackageName:" in method:
            raise ValueError("The final DEX did not preserve the JS game's channel identity")
        zip_utils = dex_class(tools / "dexdump.exe", dex, "Lcom/cnandroid/ZipUtils;")
        descriptor = "'(Ljava/io/File;Ljava/lang/String;Ljava/lang/String;Lcom/cnandroid/ZipUtils$ZipCallback;)V'"
        extraction = next(part for part in zip_utils.split("      name          : ")
                          if part.startswith("'uncompress'") and descriptor in part)
        if "const-wide/16 v3, #int 100 " not in extraction:
            raise ValueError("The final file extractor does not use the 100ms progress interval")
        if "Ljava/lang/Thread;.sleep:(J)V" not in extraction:
            raise ValueError("The final file extractor does not wait between progress callbacks")
    return {"apk_sha256": sha256(apk), "package": PACKAGE, "label": LABEL,
            "changed_entries_from_base": sorted(changed),
            "unchanged_base_entries": len(original_names) - len(changed),
            "aapt_package_and_label": "passed", "signature_and_alignment": "passed",
            "assembled_channel_identity": "passed", "extraction_progress_interval_ms": 100,
            "device_runtime_verified": False}


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    unity = Path(r"C:\Program Files\Unity\Hub\Editor\2022.3.8f1c1\Editor\Data\PlaybackEngines\AndroidPlayer")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--original", type=Path, default=ROOT.parent.parent / "tmp_labels/com.krmtqds.aligames.apk")
    parser.add_argument("--base", type=Path, default=BASE_APK)
    parser.add_argument("--output", type=Path, default=COEXIST_APK)
    parser.add_argument("--sdk", type=Path, default=Path(os.environ.get("ANDROID_HOME", unity / "SDK")))
    parser.add_argument("--jdk", type=Path, default=Path(os.environ.get("JAVA_HOME", unity / "OpenJDK")))
    parser.add_argument("--apktool", type=Path, default=ROOT / ".tools/apktool_2.12.1.jar")
    parser.add_argument("--verify-only", action="store_true")
    args = parser.parse_args()
    original, base, output = args.original.resolve(), args.base.resolve(), args.output.resolve()
    if output in [base, original] or output.suffix.lower() != ".apk":
        raise ValueError("The coexist output must be a separate .apk file")
    tools = args.sdk / "build-tools/34.0.0"
    java = args.jdk / "bin/java.exe"
    from clone_identity import clone_manifest, clone_resources
    validate_base(original, base)
    with zipfile.ZipFile(base) as archive:
        manifest, manifest_report = clone_manifest(archive.read("AndroidManifest.xml"), PACKAGE, LABEL)
        resources, resource_report = clone_resources(archive.read("resources.arsc"), DEFAULT_PACKAGE_NAME, PACKAGE)
    loader = build_payload(package_name=PACKAGE).encode("utf-8")
    if not args.verify_only:
        if sha256(args.apktool) != APKTOOL_SHA256:
            raise ValueError("Unexpected Apktool build dependency")
        with tempfile.TemporaryDirectory(prefix="poolgame-coexist-") as temporary:
            work = Path(temporary)
            source = work / "base.apk"
            shutil.copy2(base, source)
            decoded = work / "decoded"
            print("Decode the embedded-guide base APK", flush=True)
            run([java, "-Xmx1024m", "-jar", args.apktool.resolve(), "d", "-r", "-o", decoded, source])
            activity = decoded / ACTIVITY
            activity.write_text(patch_channel_bridge(activity.read_text(encoding="utf-8")),
                                encoding="utf-8", newline="\n")
            zip_utils = decoded / ZIP_UTILS
            zip_utils.write_text(patch_unzip_progress(zip_utils.read_text(encoding="utf-8")),
                                 encoding="utf-8", newline="\n")
            rebuilt = work / "rebuilt.apk"
            print("Rebuild the game channel bridge", flush=True)
            run([java, "-Xmx1024m", "-jar", args.apktool.resolve(), "b", decoded, "-o", rebuilt])
            unsigned = work / "unsigned.apk"
            with zipfile.ZipFile(source) as archive, zipfile.ZipFile(rebuilt) as patched, zipfile.ZipFile(unsigned, "w") as target:
                replacements = {"AndroidManifest.xml": manifest, "resources.arsc": resources,
                                "classes.dex": patched.read("classes.dex"), ASSET: loader}
                for info in archive.infolist():
                    if not is_old_signature(info.filename):
                        content = replacements[info.filename] if info.filename in replacements else archive.read(info)
                        target.writestr(info, content)
            aligned = work / "aligned.apk"
            run([tools / "zipalign.exe", "-f", "-p", "4", unsigned, aligned])
            signing = ROOT / ".signing"
            key, password = signing / "poolgame.p12", signing / "password.txt"
            if not key.is_file() or not password.is_file():
                raise ValueError("Preserve the embedded guide signing files before creating the coexist variant")
            key_password = work / "key-password.txt"
            shutil.copyfile(password, key_password)
            signed = work / "coexist.apk"
            run([java, "-jar", tools / "lib/apksigner.jar", "sign", "--ks", key,
                 "--ks-key-alias", "poolgame", "--ks-pass", "file:" + str(password),
                 "--key-pass", "file:" + str(key_password), "--min-sdk-version", "24", "--out", signed, aligned])
            # Validate the concrete signed artifact before delivering it.
            checks = verify_coexist(base, signed, loader, manifest, resources, tools, java)
            output.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(signed, output)
    else:
        checks = verify_coexist(base, output, loader, manifest, resources, tools, java)
    record = {"apk": str(output), "bytes": output.stat().st_size, "sha256": sha256(output),
              "base_sha256": sha256(base), "original_sha256": sha256(original),
              "package": PACKAGE, "label": LABEL, "version": "3.2.1", "build": BUILD, "build_date": "2026-11-02",
              "manifest_changes": manifest_report, "resource_changes": resource_report,
              "js_channel_identity": DEFAULT_PACKAGE_NAME, "payload_sha256": hashlib.sha256(loader).hexdigest(),
              "fixes": {"unzip_progress_poll_interval_ms": 100, "java_heap_limit_changed": False},
              "offline_verification": checks, "root_required": False, "shizuku_required": False,
              "device_runtime_verified": False,
              "runtime_unknowns": ["side-by-side installation on a physical phone", "channel SDK login under new package/signature",
                                   "live game rendering and physics", "local cue appearance and practice attributes on a physical phone",
                                   "server acceptance of pocket changes"]}
    (ROOT / "coexist-validation.json").write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"apk": str(output), "package": PACKAGE, "label": LABEL,
                      "bytes": record["bytes"], "sha256": record["sha256"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
