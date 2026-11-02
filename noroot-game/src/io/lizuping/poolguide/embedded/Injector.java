package io.lizuping.poolguide.embedded;

import android.content.Context;
import android.util.Log;
import android.webkit.WebView;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.InputStream;
import java.net.URI;
import java.nio.charset.StandardCharsets;

/** Loads the embedded guide only into the game's own local document. */
public final class Injector {
    private static final String ASSET = "poolguide/loader.js";
    private static String payload;

    private Injector() {
    }

    static boolean isGamePage(Context context, String url) throws Exception {
        if (url == null) {
            return false;
        }
        URI uri = new URI(url);
        if (!"file".equalsIgnoreCase(uri.getScheme()) ||
                (uri.getRawAuthority() != null && !uri.getRawAuthority().isEmpty())) {
            return false;
        }
        String path = uri.getPath();
        if ("/android_asset/www/index.html".equals(path)) {
            return true;
        }
        if (path == null || !path.startsWith("/")) {
            return false;
        }
        File expected = new File(context.getFilesDir(), "swgn8ball/index.html").getCanonicalFile();
        return expected.equals(new File(path).getCanonicalFile());
    }

    private static String readPayload(Context context) throws Exception {
        if (payload == null) {
            try (InputStream input = context.getAssets().open(ASSET);
                    ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    if (output.size() + count > 1024 * 1024) {
                        throw new IllegalStateException("Embedded guide exceeds its size limit");
                    }
                    output.write(buffer, 0, count);
                }
                payload = new String(output.toByteArray(), StandardCharsets.UTF_8);
            }
        }
        return payload;
    }

    /** Called by Cordova on the UI thread, before it reuses its WebView register. */
    public static void onPageFinished(WebView view, String url) {
        try {
            if (view == null || !isGamePage(view.getContext(), url) ||
                    !isGamePage(view.getContext(), view.getUrl())) {
                return;
            }
            view.evaluateJavascript(readPayload(view.getContext()), null);
        } catch (Exception error) {
            // Failure to load an optional guide must not interrupt game navigation.
            Log.e("PoolGuideEmbedded", "Unable to load the embedded guide", error);
        }
    }
}
