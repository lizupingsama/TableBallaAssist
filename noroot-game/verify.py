"""Verify the delivered APK bytes, signature, alignment, and assembled DEX hook."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import zipfile

from build import BASE_APK, ROOT, SOURCE_SHA256, run, sha256, verify_entries
from payload import build_payload


def dex_class(tool: Path, path: Path, descriptor: str) -> str:
    lines = []
    active = False
    with subprocess.Popen([str(tool), "-d", str(path)], stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, encoding="utf-8", errors="replace") as process:
        for line in process.stdout:
            if line.startswith("Class #"):
                active = False
            if "Class descriptor" in line and descriptor in line:
                active = True
            if active:
                lines.append(line)
        error = process.stderr.read()
        if process.wait() != 0:
            raise RuntimeError(error)
    if not lines:
        raise ValueError("Missing assembled class: " + descriptor)
    return "".join(lines)


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    unity = Path(r"C:\Program Files\Unity\Hub\Editor\2022.3.8f1c1\Editor\Data\PlaybackEngines\AndroidPlayer")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apk", type=Path, default=BASE_APK)
    parser.add_argument("--original", type=Path, default=ROOT.parent.parent / "tmp_labels/com.krmtqds.aligames.apk")
    parser.add_argument("--settings", type=Path, help="Same settings JSON used during build, if any")
    parser.add_argument("--sdk", type=Path, default=unity / "SDK")
    parser.add_argument("--jdk", type=Path, default=unity / "OpenJDK")
    args = parser.parse_args()
    if sha256(args.original) != SOURCE_SHA256:
        raise ValueError("Unexpected original game artifact")
    settings = json.loads(args.settings.read_text(encoding="utf-8")) if args.settings else None
    entries = verify_entries(args.original, args.apk, build_payload(settings).encode("utf-8"))
    tools = args.sdk / "build-tools/34.0.0"
    java = args.jdk / "bin/java.exe"
    run([java, "-jar", tools / "lib/apksigner.jar", "verify", "--verbose", args.apk])
    run([tools / "zipalign.exe", "-c", "-p", "4", args.apk])
    with tempfile.TemporaryDirectory(prefix="poolgame-verify-") as temporary:
        work = Path(temporary)
        with zipfile.ZipFile(args.apk) as archive:
            for name in ["classes2.dex", "classes5.dex"]:
                (work / name).write_bytes(archive.read(name))
        client = dex_class(tools / "dexdump.exe", work / "classes2.dex",
                           "Lorg/apache/cordova/engine/SystemWebViewClient;")
        methods = client.split("      name          : ")
        callback = next(method for method in methods if method.startswith("'onPageFinished'"))
        expected = "Lio/lizuping/poolguide/embedded/Injector;.onPageFinished:"
        if expected not in callback or "invoke-static {v3, v4}" not in callback:
            raise ValueError("The assembled Cordova callback does not call the embedded injector")
        injector = dex_class(tools / "dexdump.exe", work / "classes5.dex",
                             "Lio/lizuping/poolguide/embedded/Injector;")
        if "Landroid/webkit/WebView;.evaluateJavascript:" not in injector or '"poolguide/loader.js"' not in injector:
            raise ValueError("The assembled injector does not evaluate the embedded asset")
    result = {"apk_sha256": sha256(args.apk), "zip_entries": entries,
              "signature_and_alignment": "passed", "assembled_callback_and_injector": "passed",
              "device_runtime_verified": False}
    record = ROOT / "validation.json"
    if record.is_file():
        data = json.loads(record.read_text(encoding="utf-8"))
        if data.get("sha256") == result["apk_sha256"]:
            data["final_package_verification"] = result
            record.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
