"""Build a signed standalone APK using the existing Android SDK and JDK."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import secrets
import shutil
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent))
import guide_extender as desktop


def run(args):
    result = subprocess.run([str(value) for value in args], capture_output=True,
                            encoding="utf-8", errors="replace")
    if result.returncode:
        raise RuntimeError(result.stdout + "\n" + result.stderr)
    if result.stdout.strip():
        print(result.stdout.strip(), flush=True)


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    unity = Path(r"C:\Program Files\Unity\Hub\Editor\2022.3.8f1c1\Editor\Data\PlaybackEngines\AndroidPlayer")
    parser.add_argument("--sdk", type=Path, default=Path(os.environ.get("ANDROID_HOME", unity / "SDK")))
    parser.add_argument("--jdk", type=Path, default=Path(os.environ.get("JAVA_HOME", unity / "OpenJDK")))
    args = parser.parse_args()
    java = args.jdk / "bin/java.exe"
    javac = args.jdk / "bin/javac.exe"
    keytool = args.jdk / "bin/keytool.exe"
    tools = args.sdk / "build-tools/34.0.0"
    android = args.sdk / "platforms/android-33/android.jar"
    for path in [java, javac, keytool, android, tools / "aapt2.exe", tools / "lib/d8.jar", tools / "lib/apksigner.jar", tools / "zipalign.exe"]:
        if not path.is_file():
            raise RuntimeError("Missing Android build dependency: " + str(path))
    # Some Android SDK Windows executables cannot open non-ASCII resource paths.
    work = Path(tempfile.mkdtemp(prefix="poolguide-build-"))
    project = work / "project"
    shutil.copytree(ROOT / "res", project / "res")
    shutil.copytree(ROOT / "src", project / "src")
    shutil.copyfile(ROOT / "AndroidManifest.xml", project / "AndroidManifest.xml")
    build = work / "build"
    assets = build / "assets"
    generated = build / "generated"
    classes = build / "classes"
    dex = build / "dex"
    for directory in [build, assets, generated, classes, dex]:
        directory.mkdir(parents=True, exist_ok=True)
    settings = desktop.validate_settings({})
    sample = desktop.build_patch(b'<html><body><script src="manifest.json"></script></body></html>', settings)
    script = sample.split(b"<script>\n", 1)[1].split(b"\n</script>", 1)[0].decode("utf-8")
    request = json.dumps({"action": "apply", "settings": settings}, separators=(",", ":"))
    needle = "window.__poolGuideRequest=" + request
    if script.count(needle) != 1:
        raise RuntimeError("Desktop loader format changed")
    script = script.replace(needle, "window.__poolGuideRequest=__POOL_GUIDE_REQUEST_JSON__")
    (assets / "loader.js").write_text(script, encoding="utf-8")
    aapt = tools / "aapt2.exe"
    print("Compile Android resources", flush=True)
    run([aapt, "compile", "--dir", project / "res", "-o", build / "resources.zip"])
    run([aapt, "link", "-o", build / "resources.apk", "--manifest", project / "AndroidManifest.xml",
         "-I", android, "--java", generated, "-A", assets, "--auto-add-overlay", build / "resources.zip"])
    sources = sorted((project / "src").rglob("*.java")) + sorted(generated.rglob("*.java"))
    print("Compile Java source", flush=True)
    run([javac, "-J-Dfile.encoding=UTF-8", "-encoding", "UTF-8", "--release", "8",
         "-classpath", android, "-d", classes, *sources])
    with zipfile.ZipFile(build / "classes.jar", "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(classes.rglob("*.class")):
            archive.write(path, path.relative_to(classes).as_posix())
    print("Convert to DEX", flush=True)
    run([java, "-cp", tools / "lib/d8.jar", "com.android.tools.r8.D8", "--release", "--min-api", "26",
         "--lib", android, "--output", dex, build / "classes.jar"])
    with zipfile.ZipFile(build / "resources.apk") as source, zipfile.ZipFile(build / "unsigned.apk", "w", zipfile.ZIP_DEFLATED) as target:
        for info in source.infolist():
            target.writestr(info, source.read(info.filename))
        target.write(dex / "classes.dex", "classes.dex")
    run([tools / "zipalign.exe", "-f", "4", build / "unsigned.apk", build / "aligned.apk"])
    signing = ROOT / ".signing"
    signing.mkdir(exist_ok=True)
    password_file = signing / "password.txt"
    key = signing / "poolguide.p12"
    if key.exists() and not password_file.exists():
        raise RuntimeError("Signing key exists but password file is missing; preserve the original key.")
    if not password_file.exists():
        password_file.write_text(secrets.token_hex(24), encoding="ascii")
    if not key.exists():
        run([keytool, "-genkeypair", "-keystore", key, "-storetype", "PKCS12", "-storepass:file", password_file,
             "-alias", "poolguide", "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000",
             "-dname", "CN=Pool Guide Local Build,O=Local Development,C=CN"])
    output = work / "PoolGuide-1.5.1.apk"
    print("Sign and verify APK", flush=True)
    signer = [java, "-jar", tools / "lib/apksigner.jar"]
    key_password = work / "keypass.txt"
    shutil.copyfile(password_file, key_password)
    run([*signer, "sign", "--ks", key, "--ks-key-alias", "poolguide", "--ks-pass", "file:" + str(password_file),
         "--key-pass", "file:" + str(key_password), "--out", output, build / "aligned.apk"])
    run([*signer, "verify", "--verbose", "--print-certs", output])
    run([tools / "zipalign.exe", "-c", "4", output])
    delivered = ROOT.parent / output.name
    shutil.copy2(output, delivered)
    shutil.copytree(build, ROOT / "build", dirs_exist_ok=True)
    output = delivered
    print(json.dumps({"apk": str(output), "bytes": output.stat().st_size,
                      "sha256": hashlib.sha256(output.read_bytes()).hexdigest()}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
