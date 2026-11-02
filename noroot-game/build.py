"""Embed the existing guide in the inspected game APK; no device/root needed."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parent
SOURCE_SHA256 = "e677e9529351bc558d010d4ae5bd173a555a8fba811deb75174065fc5f938214"
APKTOOL_SHA256 = "66cf4524a4a45a7f56567d08b2c9b6ec237bcdd78cee69fd4a59c8a0243aeafa"
APKTOOL_URL = "https://github.com/iBotPeaches/Apktool/releases/download/v2.12.1/apktool_2.12.1.jar"
CLIENT = "smali_classes2/org/apache/cordova/engine/SystemWebViewClient.smali"
HOOK = "Lio/lizuping/poolguide/embedded/Injector;->onPageFinished(Landroid/webkit/WebView;Ljava/lang/String;)V"
ASSET = "assets/poolguide/loader.js"
BUILD = "pg4"
BASE_APK = ROOT / ".work" / ("PoolGame-NoRoot-3.2.1-" + BUILD + "-base.apk")
COEXIST_APK = ROOT.parent / ("PoolGame-NoRoot-Coexist-3.2.1-" + BUILD + ".apk")


def sha256(path: Path) -> str:
    with path.open("rb") as stream:
        digest = hashlib.sha256()
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def run(args: list, *, timeout: int = 300) -> str:
    result = subprocess.run([str(value) for value in args], capture_output=True,
                            encoding="utf-8", errors="replace", timeout=timeout,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if result.returncode:
        raise RuntimeError(result.stdout + "\n" + result.stderr)
    if result.stdout.strip():
        print(result.stdout.strip(), flush=True)
    return result.stdout


def patch_client(source: str) -> str:
    if HOOK in source:
        raise ValueError("The input WebView client already contains the embedded guide")
    signature = ".method public onPageFinished(Landroid/webkit/WebView;Ljava/lang/String;)V"
    methods = list(re.finditer(re.escape(signature) + r"\n.*?\.end method", source, re.S))
    if len(methods) != 1:
        raise ValueError("The inspected Cordova callback changed")
    match = methods[0]
    method = match.group()
    anchor = "    invoke-super {p0, p1, p2}, Landroid/webkit/WebViewClient;->onPageFinished(Landroid/webkit/WebView;Ljava/lang/String;)V"
    if method.count(anchor) != 1:
        raise ValueError("The inspected WebView callback no longer matches")
    replacement = method.replace(anchor, anchor + "\n\n    invoke-static {p1, p2}, " + HOOK)
    return source[:match.start()] + replacement + source[match.end():]


def is_old_signature(name: str) -> bool:
    return bool(re.fullmatch(r"META-INF/(?:MANIFEST\.MF|[^/]+\.(?:SF|RSA|DSA|EC))", name, re.I))


def check_interfaces(source: bytes) -> None:
    required = [b"var VisualGuide=", b"calculateGuideLength", b"calculateGuideLength2",
                b"drawGuideLessSharpAngle", b"isOpenFuZhu", b"findFirstCollisionBall",
                b"ballLineCollision", b"ballBallCollision", b"BallLineCollision",
                b"m_cTableShape", b"var Table=", b"handleCollision", b"shotPlayerLocalIndex",
                b"BallPocketCollision", b"BALL_ENTERED_POCKET", b"BALL_POCKETED",
                b"ballPocketed", b"nSTATE_IN_BALL_RUNNER", b"BallPropertiesSnk",
                b"BALL_CLASSIFICATION_REDBALL"]
    missing = [word.decode("ascii") for word in required if word not in source]
    if missing:
        raise ValueError("Game interfaces changed: " + ", ".join(missing))


def verify_entries(original: Path, result: Path, payload: bytes) -> dict:
    expected_changes = {"classes2.dex"}
    expected_additions = {"classes5.dex", ASSET}
    with zipfile.ZipFile(original) as before, zipfile.ZipFile(result) as after:
        original_names = {name for name in before.namelist() if not is_old_signature(name)}
        result_names = {name for name in after.namelist() if not is_old_signature(name)}
        if len(after.namelist()) != len(set(after.namelist())):
            raise ValueError("Duplicate ZIP entries in rebuilt APK")
        if result_names != original_names | expected_additions:
            raise ValueError("Unexpected APK member additions/removals")
        changed = {name for name in original_names if before.read(name) != after.read(name)}
        if changed != expected_changes or after.read(ASSET) != payload:
            raise ValueError("Unexpected APK changes or payload mismatch")
        for name in ["classes2.dex", "classes5.dex"]:
            if not after.read(name).startswith(b"dex\n"):
                raise ValueError("Invalid DEX header: " + name)
        return {"unchanged_original_entries": len(original_names) - len(changed),
                "changed_entries": sorted(changed), "added_entries": sorted(expected_additions),
                "manifest_and_permissions": "byte-for-byte identical to original"}


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    unity = Path(r"C:\Program Files\Unity\Hub\Editor\2022.3.8f1c1\Editor\Data\PlaybackEngines\AndroidPlayer")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--original", type=Path, default=ROOT.parent.parent / "tmp_labels/com.krmtqds.aligames.apk")
    parser.add_argument("--output", type=Path, default=BASE_APK)
    parser.add_argument("--sdk", type=Path, default=Path(os.environ.get("ANDROID_HOME", unity / "SDK")))
    parser.add_argument("--jdk", type=Path, default=Path(os.environ.get("JAVA_HOME", unity / "OpenJDK")))
    parser.add_argument("--apktool", type=Path, default=ROOT / ".tools/apktool_2.12.1.jar")
    parser.add_argument("--settings", type=Path, help="Optional guide settings JSON")
    args = parser.parse_args()
    original, output = args.original.resolve(), args.output.resolve()
    if sha256(original) != SOURCE_SHA256:
        raise ValueError("This build supports only the inspected com.krmtqds.aligames 3.2.1 APK")
    if output == original or output.suffix.lower() != ".apk":
        raise ValueError("Output must be a separate .apk file")
    tools = args.sdk / "build-tools/34.0.0"
    java, javac, keytool = [args.jdk / "bin" / (name + ".exe") for name in ["java", "javac", "keytool"]]
    android = args.sdk / "platforms/android-33/android.jar"
    for dependency in [java, javac, keytool, android, tools / "lib/d8.jar",
                       tools / "lib/apksigner.jar", tools / "zipalign.exe"]:
        if not dependency.is_file():
            raise FileNotFoundError(str(dependency))
    args.apktool.parent.mkdir(parents=True, exist_ok=True)
    if not args.apktool.exists():
        print("Download pinned Apktool from its official release", flush=True)
        urllib.request.urlretrieve(APKTOOL_URL, args.apktool)
    if sha256(args.apktool) != APKTOOL_SHA256:
        raise ValueError("Apktool digest differs from the official release")
    from payload import build_payload
    settings = json.loads(args.settings.read_text(encoding="utf-8")) if args.settings else None
    payload = build_payload(settings).encode("utf-8")
    with zipfile.ZipFile(original) as archive:
        check_interfaces(archive.read("assets/www/js/main.min.js"))
        if "classes5.dex" in archive.namelist() or ASSET in archive.namelist():
            raise ValueError("Original APK already contains the proposed embedded members")
    # ASCII work paths avoid Android SDK Windows executable path limitations.
    with tempfile.TemporaryDirectory(prefix="poolgame-build-") as temporary:
        work = Path(temporary)
        source = work / "original.apk"
        shutil.copy2(original, source)
        decoded = work / "decoded"
        print("Decode the inspected game APK", flush=True)
        run([java, "-Xmx1024m", "-jar", args.apktool.resolve(), "d", "-r", "-o", decoded, source])
        client = decoded / CLIENT
        original_client = client.read_text(encoding="utf-8")
        client.write_text(patch_client(original_client), encoding="utf-8", newline="\n")
        print("Rebuild the Cordova callback DEX", flush=True)
        rebuilt = work / "rebuilt.apk"
        run([java, "-Xmx1024m", "-jar", args.apktool.resolve(), "b", decoded, "-o", rebuilt])
        classes, dex = work / "classes", work / "dex"
        classes.mkdir()
        dex.mkdir()
        run([javac, "-J-Dfile.encoding=UTF-8", "-encoding", "UTF-8", "--release", "8",
             "-classpath", android, "-d", classes, *sorted((ROOT / "src").rglob("*.java"))])
        jar = work / "injector.jar"
        with zipfile.ZipFile(jar, "w", zipfile.ZIP_DEFLATED) as archive:
            for item in sorted(classes.rglob("*.class")):
                archive.write(item, item.relative_to(classes).as_posix())
        run([java, "-cp", tools / "lib/d8.jar", "com.android.tools.r8.D8", "--release",
             "--min-api", "24", "--lib", android, "--output", dex, jar])
        unsigned = work / "unsigned.apk"
        with zipfile.ZipFile(source) as archive, zipfile.ZipFile(rebuilt) as patched, zipfile.ZipFile(unsigned, "w") as target:
            for info in archive.infolist():
                if not is_old_signature(info.filename):
                    content = patched.read("classes2.dex") if info.filename == "classes2.dex" else archive.read(info)
                    target.writestr(info, content)
            target.write(dex / "classes.dex", "classes5.dex", compress_type=zipfile.ZIP_DEFLATED)
            target.writestr(ASSET, payload, compress_type=zipfile.ZIP_DEFLATED)
        aligned = work / "aligned.apk"
        run([tools / "zipalign.exe", "-f", "-p", "4", unsigned, aligned])
        signing = ROOT / ".signing"
        signing.mkdir(exist_ok=True)
        key, password = signing / "poolgame.p12", signing / "password.txt"
        if key.exists() and not password.exists():
            raise ValueError("Signing key exists without its password file; preserve the key")
        if not password.exists():
            password.write_text(secrets.token_hex(24), encoding="ascii")
        if not key.exists():
            run([keytool, "-genkeypair", "-keystore", key, "-storetype", "PKCS12",
                 "-storepass:file", password, "-alias", "poolgame", "-keyalg", "RSA",
                 "-keysize", "2048", "-validity", "10000",
                 "-dname", "CN=Pool Game Embedded Local Build,O=Local Development,C=CN"])
        signed = work / output.name
        signer = [java, "-jar", tools / "lib/apksigner.jar"]
        # apksigner consumes file passwords sequentially when a path is reused.
        key_password = work / "key-password.txt"
        shutil.copyfile(password, key_password)
        run([*signer, "sign", "--ks", key, "--ks-key-alias", "poolgame",
             "--ks-pass", "file:" + str(password), "--key-pass", "file:" + str(key_password),
             "--min-sdk-version", "24", "--out", signed, aligned])
        signature = run([*signer, "verify", "--verbose", "--print-certs", signed])
        run([tools / "zipalign.exe", "-c", "-p", "4", signed])
        members = verify_entries(source, signed, payload)
        output.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(signed, output)
        record = {"apk": str(output), "package": "com.krmtqds.aligames", "version": "3.2.1", "build": BUILD,
                  "bytes": output.stat().st_size, "sha256": sha256(output),
                  "original_sha256": SOURCE_SHA256, "apktool_sha256": APKTOOL_SHA256,
                  "payload_bytes": len(payload), "payload_sha256": hashlib.sha256(payload).hexdigest(),
                  "callback_source_sha256": hashlib.sha256(original_client.encode()).hexdigest(),
                  "zip_verification": members, "signature_verification": signature.strip(),
                  "root_required": False, "shizuku_required": False,
                  "device_runtime_verified": False,
                  "runtime_unknowns": ["installation on an unrooted phone", "channel SDK login after resigning",
                                       "live table physics and rendering", "local cue appearance and practice attributes on a physical phone",
                                       "server acceptance of pocket changes",
                                       "compatibility with downloaded game updates"]}
        (ROOT / "validation.json").write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"apk": str(output), "bytes": record["bytes"], "sha256": record["sha256"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
