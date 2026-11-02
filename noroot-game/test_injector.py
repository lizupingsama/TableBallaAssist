"""Exercise the actual Java injector against minimal, offline Android API stubs.

These tests establish routing, payload delivery, and failure isolation on a JVM.
They do not run Android, Cordova, a WebView JavaScript engine, or the game.
"""

from pathlib import Path
import argparse
import os
import subprocess
import sys
import tempfile
import textwrap


ROOT = Path(__file__).resolve().parent
DEFAULT_JDK = Path(
    r"C:\Program Files\Unity\Hub\Editor\2022.3.8f1c1\Editor\Data\PlaybackEngines\AndroidPlayer\OpenJDK"
)

SOURCES = {
    "android/content/res/AssetManager.java": r'''
        package android.content.res;

        import java.io.ByteArrayInputStream;
        import java.io.IOException;
        import java.io.InputStream;

        public final class AssetManager {
            public byte[] data;
            public int opens;
            public boolean closed;
            public boolean missing;
            public String requestedPath;

            public AssetManager(byte[] data) {
                this.data = data;
            }

            public InputStream open(String path) throws IOException {
                opens++;
                requestedPath = path;
                if (missing) {
                    throw new IOException("Test asset missing");
                }
                return new ByteArrayInputStream(data) {
                    @Override
                    public void close() throws IOException {
                        closed = true;
                        super.close();
                    }
                };
            }
        }
    ''',
    "android/content/Context.java": r'''
        package android.content;

        import android.content.res.AssetManager;
        import java.io.File;

        public final class Context {
            private final File files;
            private final AssetManager assets;

            public Context(File files, AssetManager assets) {
                this.files = files;
                this.assets = assets;
            }

            public File getFilesDir() {
                return files;
            }

            public AssetManager getAssets() {
                return assets;
            }
        }
    ''',
    "android/webkit/ValueCallback.java": r'''
        package android.webkit;

        public interface ValueCallback<T> {
            void onReceiveValue(T value);
        }
    ''',
    "android/webkit/WebView.java": r'''
        package android.webkit;

        import android.content.Context;

        public final class WebView {
            private final Context context;
            public String url;
            public int evaluations;
            public String evaluatedScript;
            public ValueCallback<String> callback;
            public boolean failEvaluation;

            public WebView(Context context, String url) {
                this.context = context;
                this.url = url;
            }

            public Context getContext() {
                return context;
            }

            public String getUrl() {
                return url;
            }

            public void evaluateJavascript(String script, ValueCallback<String> callback) {
                if (failEvaluation) {
                    throw new IllegalStateException("Test WebView unavailable");
                }
                evaluations++;
                evaluatedScript = script;
                this.callback = callback;
            }
        }
    ''',
    "android/util/Log.java": r'''
        package android.util;

        public final class Log {
            public static int errors;
            public static Throwable lastError;

            public static int e(String tag, String message, Throwable error) {
                errors++;
                lastError = error;
                return 0;
            }
        }
    ''',
    "io/lizuping/poolguide/embedded/InjectorJvmTest.java": r'''
        package io.lizuping.poolguide.embedded;

        import android.content.Context;
        import android.content.res.AssetManager;
        import android.util.Log;
        import android.webkit.WebView;
        import java.io.File;
        import java.lang.reflect.Field;
        import java.nio.charset.StandardCharsets;

        public final class InjectorJvmTest {
            private static final String ASSET_PAGE = "file:///android_asset/www/index.html";
            private static final String PRIVATE_PAGE =
                    "file:///data/user/0/com.krmtqds.aligames/files/swgn8ball/index.html";
            private static final String SCRIPT = "window.__poolGuideFixture = '中文球桌';\n";
            private static int checks;

            private static void check(boolean condition, String message) {
                checks++;
                if (!condition) {
                    throw new AssertionError(message);
                }
            }

            private static void resetCache() throws Exception {
                Field field = Injector.class.getDeclaredField("payload");
                field.setAccessible(true);
                field.set(null, null);
                Log.errors = 0;
                Log.lastError = null;
            }

            private static Context context(AssetManager assets) {
                // File canonicalization uses the host filesystem; no files are created.
                return new Context(new File("/data/user/0/com.krmtqds.aligames/files"), assets);
            }

            private static AssetManager assets() {
                return new AssetManager(SCRIPT.getBytes(StandardCharsets.UTF_8));
            }

            private static void delivers(String url) throws Exception {
                resetCache();
                AssetManager assets = assets();
                WebView view = new WebView(context(assets), url);
                Injector.onPageFinished(view, url);
                check(view.evaluations == 1 && SCRIPT.equals(view.evaluatedScript),
                        "Exact UTF-8 asset must reach the legal game WebView: " + url);
                check(assets.opens == 1 && assets.closed &&
                        "poolguide/loader.js".equals(assets.requestedPath) &&
                        view.callback == null && Log.errors == 0,
                        "Legal route must use the embedded asset and close its stream: " + url);
            }

            private static void rejects(String callbackUrl, String currentUrl) throws Exception {
                resetCache();
                AssetManager assets = assets();
                WebView view = new WebView(context(assets), currentUrl);
                Injector.onPageFinished(view, callbackUrl);
                check(view.evaluations == 0 && assets.opens == 0,
                        "Rejected route must not read or inject payload. callback=" + callbackUrl +
                        ", current=" + currentUrl);
            }

            public static void main(String[] args) throws Exception {
                delivers(ASSET_PAGE);
                delivers("file:/android_asset/www/index.html?mode=practice#cue");
                delivers(PRIVATE_PAGE);
                delivers("file:/data/user/0/com.krmtqds.aligames/files/swgn8ball/index.html?x=1#aim");
                delivers(PRIVATE_PAGE + "?version=42#table");
                delivers("file:///data/user/0/com.krmtqds.aligames/files/swgn8ball/./index.html");
                delivers("file:///android_asset/www/%69ndex.html");

                resetCache();
                String clonePage = "file:///data/user/0/io.lizuping.poolguide.game/files/swgn8ball/index.html?table=1";
                AssetManager cloneAssets = assets();
                Context cloneContext = new Context(new File("/data/user/0/io.lizuping.poolguide.game/files"), cloneAssets);
                WebView cloneView = new WebView(cloneContext, clonePage);
                Injector.onPageFinished(cloneView, clonePage);
                check(cloneView.evaluations == 1 && SCRIPT.equals(cloneView.evaluatedScript),
                        "Coexist app must inject into its own independent private directory");
                cloneView.url = PRIVATE_PAGE;
                Injector.onPageFinished(cloneView, PRIVATE_PAGE);
                check(cloneView.evaluations == 1, "Coexist app must reject the original app private directory");
                cloneView.url = ASSET_PAGE;
                Injector.onPageFinished(cloneView, ASSET_PAGE);
                check(cloneView.evaluations == 2, "Coexist app must retain the APK asset entry route");
                rejects(clonePage, clonePage);

                String[] disallowed = {
                    "http://game.example/swgn8ball/index.html",
                    "https://game.example/data/user/0/com.krmtqds.aligames/files/swgn8ball/index.html",
                    "https://game.example/android_asset/www/index.html",
                    "file:///android_asset/www/login.html",
                    "file:///android_asset/www/sub/index.html",
                    "file:///data/local/tmp/swgn8ball/index.html",
                    "file:///data/user/0/com.other.app/files/swgn8ball/index.html",
                    "file:///data/user/0/com.krmtqds.aligames/files/other/index.html",
                    "file:///data/user/0/com.krmtqds.aligames/files/swgn8ball/index.html.bak",
                    "file:///data/user/0/com.krmtqds.aligames/files/swgn8ball/../../secret/index.html",
                    "file://localhost/android_asset/www/index.html",
                    "file://evil.example/android_asset/www/index.html",
                    "content://game.example/android_asset/www/index.html",
                    "javascript:window.__poolGuideFixture=1",
                    "/android_asset/www/index.html",
                    "file:android_asset/www/index.html",
                    null
                };
                for (String url : disallowed) {
                    // Callback filtering must apply even while a real game document is current.
                    rejects(url, ASSET_PAGE);
                    // A valid old callback must not inject into a WebView that navigated away.
                    rejects(ASSET_PAGE, url);
                }

                resetCache();
                Injector.onPageFinished(null, ASSET_PAGE);
                check(Log.errors == 0, "Null WebView must be ignored");
                rejects("file:///android_asset/www/index.html#bad fragment", ASSET_PAGE);
                check(Log.errors == 1, "Malformed callback URL must be caught and logged");

                resetCache();
                AssetManager missing = assets();
                missing.missing = true;
                WebView missingView = new WebView(context(missing), ASSET_PAGE);
                Injector.onPageFinished(missingView, ASSET_PAGE);
                check(missingView.evaluations == 0 && Log.errors == 1 && Log.lastError != null,
                        "Missing optional asset must fail without escaping into navigation");

                resetCache();
                AssetManager oversized = new AssetManager(new byte[1024 * 1024 + 1]);
                WebView oversizedView = new WebView(context(oversized), PRIVATE_PAGE);
                Injector.onPageFinished(oversizedView, PRIVATE_PAGE);
                check(oversizedView.evaluations == 0 && oversized.closed && Log.errors == 1,
                        "Oversized payload must be rejected and its input stream closed");

                resetCache();
                AssetManager cached = assets();
                WebView cachedView = new WebView(context(cached), ASSET_PAGE);
                Injector.onPageFinished(cachedView, ASSET_PAGE);
                cachedView.url = PRIVATE_PAGE + "?reload=1";
                Injector.onPageFinished(cachedView, cachedView.url);
                check(cached.opens == 1 && cachedView.evaluations == 2 &&
                        SCRIPT.equals(cachedView.evaluatedScript),
                        "Repeated game navigation must reuse the asset while injecting each document");

                resetCache();
                AssetManager failing = assets();
                WebView failingView = new WebView(context(failing), ASSET_PAGE);
                failingView.failEvaluation = true;
                Injector.onPageFinished(failingView, ASSET_PAGE);
                check(Log.errors == 1 && failing.closed,
                        "A WebView evaluation failure must be caught without breaking navigation");

                System.out.println("Offline JVM injector checks: " + checks + " passed");
            }
        }
    ''',
}


def run(arguments):
    result = subprocess.run(
        [str(value) for value in arguments],
        capture_output=True,
        encoding="utf-8",
        errors="replace",
    )
    if result.returncode:
        raise RuntimeError(result.stdout + "\n" + result.stderr)
    if result.stdout.strip():
        print(result.stdout.strip())


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--jdk", type=Path, default=Path(os.environ.get("JAVA_HOME", DEFAULT_JDK)))
    args = parser.parse_args()
    injector = ROOT / "src/io/lizuping/poolguide/embedded/Injector.java"
    if not injector.is_file():
        raise FileNotFoundError(injector)
    with tempfile.TemporaryDirectory(prefix="poolguide-injector-test-") as folder:
        work = Path(folder)
        sources = []
        for name, source in SOURCES.items():
            path = work / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(textwrap.dedent(source), encoding="utf-8")
            sources.append(path)
        classes = work / "classes"
        classes.mkdir()
        run([
            args.jdk / "bin/javac.exe", "-encoding", "UTF-8", "--release", "8",
            "-d", classes, injector, *sources,
        ])
        run([
            args.jdk / "bin/java.exe", "-Dfile.encoding=UTF-8", "-cp", classes,
            "io.lizuping.poolguide.embedded.InjectorJvmTest",
        ])
    print("Scope: minimal Android API stubs on a JVM; no Android, Cordova, JavaScript, or game execution.")


if __name__ == "__main__":
    main()
