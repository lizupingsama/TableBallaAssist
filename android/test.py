from pathlib import Path
import os
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent))
import guide_extender as desktop


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    jdk = Path(os.environ.get("JAVA_HOME", r"C:\Program Files\Unity\Hub\Editor\2022.3.8f1c1\Editor\Data\PlaybackEngines\AndroidPlayer\OpenJDK"))
    jars = sorted((Path.home() / ".gradle/caches/modules-2/files-2.1/org.json/json").rglob("json-*.jar"))
    if not jars:
        raise RuntimeError("Pass an installed org.json jar in the local Gradle cache for JVM tests.")
    with tempfile.TemporaryDirectory(prefix="poolguide-tests-") as folder:
        directory = Path(folder)
        original = '\ufeff<html>\r\n<body>中文\r\n<script src="manifest.json"></script>\r\n</body></html>\r\n'.encode("utf-8")
        (directory / "original.html").write_bytes(original)
        (directory / "desktop.html").write_bytes(desktop.build_patch(original, {"length": 220, "bankPrediction": True}))
        classes = directory / "classes"
        classes.mkdir()
        subprocess.run([str(jdk / "bin/javac.exe"), "-encoding", "UTF-8", "--release", "8", "-cp", str(jars[-1]),
                        "-d", str(classes), str(ROOT / "src/io/lizuping/poolguide/PatchEngine.java"),
                        str(ROOT / "tests/PatchEngineTest.java")], check=True)
        result = subprocess.run([str(jdk / "bin/java.exe"), "-cp", str(classes) + os.pathsep + str(jars[-1]),
                                 "io.lizuping.poolguide.PatchEngineTest", str(directory), str(ROOT / "build/assets/loader.js")],
                                capture_output=True, text=True, check=True)
        print(result.stdout.strip())
        for name, expected in [("mobile.html", "fixed"), ("multiply.html", "multiply")]:
            base, config = desktop.split_patch((directory / name).read_bytes())
            assert base == original
            assert config["settings"]["mode"] == expected
            assert config["settings"]["bankPrediction"] == (name == "mobile.html")
            assert desktop.split_patch(desktop.build_patch((directory / name).read_bytes(), {"length": 400}))[0] == original
        print("Desktop / Android patch compatibility: 8 checks passed")


if __name__ == "__main__":
    main()
