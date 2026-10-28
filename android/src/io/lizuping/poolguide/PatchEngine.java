package io.lizuping.poolguide;

import org.json.JSONObject;

import java.nio.ByteBuffer;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Locale;

/** Patch format shared with the desktop version. Contains no device operations. */
public final class PatchEngine {
    public static final String START = "\n<!--__POOL_GUIDE_EXTENDER_START_v1__-->\n";
    public static final String END = "\n<!--__POOL_GUIDE_EXTENDER_END_v1__-->\n";
    private static final String CONFIG = "<!-- POOL_GUIDE_CONFIG=";

    public static final class Settings {
        public final String mode;
        public final double length;
        public final double factor;
        public final boolean showSplit;
        public final boolean bankPrediction;
        public final boolean firstHitPocket;
        public final boolean snookerAllReds;
        public final boolean eightBallAllButBlack;

        public Settings(String mode, double length, double factor, boolean showSplit) {
            this(mode, length, factor, showSplit, false);
        }

        public Settings(String mode, double length, double factor, boolean showSplit, boolean bankPrediction) {
            this(mode, length, factor, showSplit, bankPrediction, false);
        }

        public Settings(String mode, double length, double factor, boolean showSplit, boolean bankPrediction, boolean firstHitPocket) {
            this(mode, length, factor, showSplit, bankPrediction, firstHitPocket, false, false);
        }

        public Settings(String mode, double length, double factor, boolean showSplit, boolean bankPrediction,
                        boolean firstHitPocket, boolean snookerAllReds, boolean eightBallAllButBlack) {
            if ((!"fixed".equals(mode) && !"multiply".equals(mode)) ||
                    !Double.isFinite(length) || length < 10 || length > 1500 ||
                    !Double.isFinite(factor) || factor < 1 || factor > 30) {
                throw new IllegalArgumentException("长度需为 10–1500，倍数需为 1–30。");
            }
            this.mode = mode;
            this.length = length;
            this.factor = factor;
            this.showSplit = showSplit;
            this.bankPrediction = bankPrediction;
            this.firstHitPocket = firstHitPocket;
            this.snookerAllReds = snookerAllReds;
            this.eightBallAllButBlack = eightBallAllButBlack;
        }

        public JSONObject json() throws Exception {
            JSONObject json = new JSONObject();
            json.put("mode", mode);
            json.put("length", length);
            json.put("factor", factor);
            json.put("showSplit", showSplit);
            json.put("bankPrediction", bankPrediction);
            json.put("firstHitPocket", firstHitPocket);
            json.put("snookerAllReds", snookerAllReds);
            json.put("eightBallAllButBlack", eightBallAllButBlack);
            return json;
        }

        public static Settings from(JSONObject json) throws Exception {
            return new Settings(json.getString("mode"), json.getDouble("length"),
                    json.getDouble("factor"), json.getBoolean("showSplit"), json.optBoolean("bankPrediction", false),
                    json.optBoolean("firstHitPocket", false), json.optBoolean("snookerAllReds", false),
                    json.optBoolean("eightBallAllButBlack", false));
        }
    }

    public static final class Snapshot {
        public final byte[] base;
        public final Settings settings;

        Snapshot(byte[] base, Settings settings) {
            this.base = base;
            this.settings = settings;
        }

        public boolean installed() {
            return settings != null;
        }
    }

    public static String utf8(byte[] bytes) throws Exception {
        return StandardCharsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes)).toString();
    }

    public static String sha256(byte[] bytes) throws Exception {
        byte[] hash = MessageDigest.getInstance("SHA-256").digest(bytes);
        StringBuilder result = new StringBuilder();
        for (byte value : hash) {
            result.append(String.format(Locale.US, "%02x", value & 255));
        }
        return result.toString();
    }

    public static Snapshot split(byte[] content) throws Exception {
        String text = utf8(content);
        int start = text.indexOf(START);
        if (start < 0) {
            return new Snapshot(content, null);
        }
        int end = text.indexOf(END, start + START.length());
        if (end < 0 || text.indexOf(START, start + START.length()) >= 0 ||
                text.indexOf(END, end + END.length()) >= 0) {
            throw new Exception("已有补丁的边界异常，已停止修改。");
        }
        String payload = text.substring(start + START.length(), end);
        int lineEnd = payload.indexOf('\n');
        String line = lineEnd < 0 ? payload : payload.substring(0, lineEnd);
        if (!line.startsWith(CONFIG) || !line.endsWith(" -->")) {
            throw new Exception("已有补丁的配置损坏，已停止修改。");
        }
        JSONObject config = new JSONObject(line.substring(CONFIG.length(), line.length() - 4));
        byte[] base = (text.substring(0, start) + text.substring(end + END.length()))
                .getBytes(StandardCharsets.UTF_8);
        if (!sha256(base).equals(config.getString("base_sha256"))) {
            throw new Exception("入口文件已被其他程序改动，已停止覆盖。");
        }
        return new Snapshot(base, Settings.from(config.getJSONObject("settings")));
    }

    public static byte[] build(byte[] current, Settings settings, String loader) throws Exception {
        Snapshot snapshot = split(current);
        String base = utf8(snapshot.base);
        String lower = base.toLowerCase(Locale.ROOT);
        int position = lower.lastIndexOf("</body>");
        if (position < 0 || !lower.contains("<html") || !base.contains("manifest.json")) {
            throw new Exception("游戏入口结构与适配版本不匹配，未作修改。");
        }
        if (!loader.contains("__POOL_GUIDE_REQUEST_JSON__")) {
            throw new Exception("APK 内的绘制脚本缺失，请重新安装工具。");
        }
        JSONObject config = new JSONObject();
        config.put("base_sha256", sha256(snapshot.base));
        config.put("settings", settings.json());
        JSONObject request = new JSONObject();
        request.put("action", "apply");
        request.put("settings", settings.json());
        String script = loader.replace("__POOL_GUIDE_REQUEST_JSON__", request.toString());
        String addition = START + CONFIG + config + " -->\n<script>\n" + script + "\n</script>" + END;
        return (base.substring(0, position) + addition + base.substring(position))
                .getBytes(StandardCharsets.UTF_8);
    }

    private PatchEngine() {}
}
