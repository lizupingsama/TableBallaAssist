package io.lizuping.poolguide;

import android.content.Context;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

/** All device mutations are limited to the selected game's entry and its backups. */
public final class RootBackend {
    public static final String GAME_PACKAGE = "com.krmtqds.aligames";
    public static final String GAME_ROOT = "/data/user/0/" + GAME_PACKAGE + "/files/swgn8ball";
    public static final String ENTRY = GAME_ROOT + "/index.html";
    private final Context context;
    private final Progress progress;

    public interface Progress {
        void message(String message);
    }

    public static final class Result {
        public PatchEngine.Snapshot snapshot;
        public String entryHash;
        public String backup;
        public String message;
    }

    public RootBackend(Context context, Progress progress) {
        this.context = context.getApplicationContext();
        this.progress = progress;
    }

    private static final class Reader extends Thread {
        private final InputStream stream;
        private final ByteArrayOutputStream data = new ByteArrayOutputStream();
        private Exception error;

        Reader(InputStream stream) {
            this.stream = stream;
            setDaemon(true);
        }

        @Override public void run() {
            try (InputStream input = stream) {
                byte[] buffer = new byte[8192];
                int count;
                while ((count = input.read(buffer)) >= 0) {
                    if (data.size() + count > 16 * 1024 * 1024) {
                        throw new Exception("读取的文件过大，已停止操作。");
                    }
                    data.write(buffer, 0, count);
                }
            } catch (Exception exception) {
                error = exception;
            }
        }

        byte[] bytes() throws Exception {
            if (error != null) {
                throw error;
            }
            return data.toByteArray();
        }
    }

    private byte[] su(String command) throws Exception {
        Process process = null;
        Exception startError = null;
        String[] candidates = {"su", "/system/bin/su", "/system/xbin/su", "/sbin/su", "/debug_ramdisk/su"};
        for (String candidate : candidates) {
            try {
                process = new ProcessBuilder(candidate, "-M", "-c", command).start();
                break;
            } catch (java.io.IOException error) {
                startError = error;
            }
        }
        if (process == null) {
            String diagnostic = "PATH=" + System.getenv("PATH") + "\n" + startError;
            for (String candidate : candidates) {
                File file = new File(candidate);
                diagnostic += "\n" + candidate + ": exists=" + file.exists() + ", executable=" + file.canExecute();
            }
            write(new File(context.getFilesDir(), "root-diagnostic.txt"), diagnostic.getBytes(StandardCharsets.UTF_8));
            throw new Exception("本应用看不到 Root 命令。若使用 Magisk Delta 的隐藏 su 功能，请先把“台球辅助线”加入允许列表，再重新打开。", startError);
        }
        process.getOutputStream().close();
        Reader output = new Reader(process.getInputStream());
        Reader errors = new Reader(process.getErrorStream());
        output.start();
        errors.start();
        if (!process.waitFor(35, TimeUnit.SECONDS)) {
            process.destroyForcibly();
            throw new Exception("Root 操作超时。请在 Magisk 中允许“台球辅助线”，再重新读取状态。");
        }
        output.join(1500);
        errors.join(1500);
        if (output.isAlive() || errors.isAlive()) {
            throw new Exception("Root 命令尚未完成，请重试。");
        }
        byte[] result = output.bytes();
        String error = new String(errors.bytes(), StandardCharsets.UTF_8).trim();
        if (process.exitValue() != 0) {
            if (error.contains("Permission denied") || error.contains("permission denied") || error.contains("denied")) {
                throw new Exception("Root 授权未通过。请在 Magisk 中允许“台球辅助线”，再重试。");
            }
            if (error.contains("No such file")) {
                throw new Exception("找不到游戏资源。请先打开阿里渠道版超级台球大师，完成资源下载后重试。");
            }
            throw new Exception("操作失败：" + (error.isEmpty() ? new String(result, StandardCharsets.UTF_8) : error));
        }
        return result;
    }

    private String text(String command) throws Exception {
        return new String(su(command), StandardCharsets.UTF_8).trim();
    }

    private static String quote(String path) {
        return "'" + path.replace("'", "'\\''") + "'";
    }

    private String remoteHash(String path) throws Exception {
        String value = text("sha256sum " + quote(path)).split("\\s+")[0];
        if (!value.matches("[0-9a-f]{64}")) {
            throw new Exception("无法校验文件完整性，未继续修改。");
        }
        return value;
    }

    private byte[] read(String path) throws Exception {
        byte[] content = su("cat " + quote(path));
        if (!PatchEngine.sha256(content).equals(remoteHash(path))) {
            throw new Exception("读取期间游戏文件发生变化，请稍后重试。");
        }
        return content;
    }

    private static void write(File file, byte[] content) throws Exception {
        try (FileOutputStream output = new FileOutputStream(file)) {
            output.write(content);
            output.getFD().sync();
        }
    }

    private String loader() throws Exception {
        try (InputStream input = context.getAssets().open("loader.js")) {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int count;
            while ((count = input.read(buffer)) >= 0) {
                output.write(buffer, 0, count);
            }
            return new String(output.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private void launchGame() throws Exception {
        String resolved = text("cmd package resolve-activity --brief " + GAME_PACKAGE);
        String component = null;
        for (String line : resolved.split("\\r?\\n")) {
            if (line.matches(java.util.regex.Pattern.quote(GAME_PACKAGE) + "/[A-Za-z0-9_.$]+")) {
                component = line;
            }
        }
        if (component == null) {
            throw new Exception("文件已处理，请手动打开超级台球大师。");
        }
        text("am start -W -n " + quote(component));
    }

    public synchronized Result execute(String action, PatchEngine.Settings settings) throws Exception {
        progress.message("正在检查 Root 权限…如有授权提示，请选择允许。");
        if (!text("id").contains("uid=0(")) {
            throw new Exception("尚未取得 Root 权限，请在 Magisk 中允许本工具。");
        }
        progress.message("正在读取游戏设置…");
        byte[] current = read(ENTRY);
        PatchEngine.Snapshot snapshot = PatchEngine.split(current);
        Result result = new Result();
        result.snapshot = snapshot;
        result.entryHash = PatchEngine.sha256(current);
        if ("status".equals(action)) {
            result.message = snapshot.installed() ? "已安装辅助线补丁，可直接调整。" : "当前为原始辅助线，可以应用加长。";
            return result;
        }
        if (!"apply".equals(action) && !"restore".equals(action)) {
            throw new IllegalArgumentException("未知操作。");
        }
        if ("restore".equals(action) && !snapshot.installed()) {
            result.message = "当前已是原始设置，无需恢复。";
            return result;
        }
        if ("apply".equals(action)) {
            String source = PatchEngine.utf8(read(GAME_ROOT + "/js/main.min.js"));
            String[] required = {"var VisualGuide=", "calculateGuideLength", "calculateGuideLength2", "drawGuideLessSharpAngle", "isOpenFuZhu"};
            for (String key : required) {
                if (!source.contains(key)) {
                    throw new Exception("游戏的辅助线接口已改变，当前版本暂不适配，未作修改。");
                }
            }
            if (settings.bankPrediction) {
                String[] bankRequired = {"findFirstCollisionBall", "ballLineCollision", "ballBallCollision", "BallLineCollision", "m_cTableShape"};
                for (String key : bankRequired) {
                    if (!source.contains(key)) {
                        throw new Exception("游戏的库边碰撞接口已改变，当前版本暂不支持反弹预测，未作修改。");
                    }
                }
            }
            if (settings.firstHitPocket || settings.snookerAllReds || settings.eightBallAllButBlack) {
                String[] pocketRequired = {"var Table=", "handleCollision", "shotPlayerLocalIndex", "BallPocketCollision",
                        "BALL_ENTERED_POCKET", "BALL_POCKETED", "ballPocketed", "nSTATE_IN_BALL_RUNNER"};
                for (String key : pocketRequired) {
                    if (!source.contains(key)) {
                        throw new Exception("游戏的碰撞入袋接口已改变，当前版本暂不支持首碰必进，未作修改。");
                    }
                }
            }
            if (settings.snookerAllReds && (!source.contains("BallPropertiesSnk") || !source.contains("BALL_CLASSIFICATION_REDBALL"))) {
                throw new Exception("游戏的斯诺克红球接口已改变，未作修改。");
            }
        }
        byte[] replacement = "apply".equals(action) ? PatchEngine.build(current, settings, loader()) : snapshot.base;
        String baseHash = PatchEngine.sha256(snapshot.base);
        String backup = ENTRY + ".poolguide-original-" + baseHash;
        File directory = new File(context.getFilesDir(), "backups");
        if (!directory.isDirectory() && !directory.mkdirs()) {
            throw new Exception("无法创建本地备份目录。");
        }
        File localBackup = new File(directory, baseHash + ".html");
        if (localBackup.exists() && !PatchEngine.sha256(Files.readAllBytes(localBackup.toPath())).equals(baseHash)) {
            throw new Exception("本地备份校验失败，已停止修改。");
        }
        write(localBackup, snapshot.base);
        if (!snapshot.installed()) {
            text("if [ ! -f " + quote(backup) + " ]; then cp -p " + quote(ENTRY) + " " + quote(backup) + "; fi");
        }
        if (!remoteHash(backup).equals(baseHash)) {
            throw new Exception("游戏目录的原始备份校验失败，未写入补丁。");
        }
        String token = UUID.randomUUID().toString();
        File staged = new File(context.getCacheDir(), "entry-" + token + ".html");
        File rollback = new File(context.getCacheDir(), "rollback-" + token + ".html");
        boolean stopped = false;
        boolean wrote = false;
        try {
            write(staged, replacement);
            write(rollback, current);
            if (!remoteHash(staged.getAbsolutePath()).equals(PatchEngine.sha256(replacement)) ||
                    !remoteHash(rollback.getAbsolutePath()).equals(result.entryHash)) {
                throw new Exception("写入缓存的文件校验失败。");
            }
            if (!remoteHash(ENTRY).equals(result.entryHash)) {
                throw new Exception("游戏文件正在更新，请稍后重试。");
            }
            progress.message("备份已验证，正在保存并重启游戏…");
            text("am force-stop " + GAME_PACKAGE);
            stopped = true;
            if (!remoteHash(ENTRY).equals(result.entryHash)) {
                throw new Exception("停止游戏时文件发生变化，未覆盖文件。");
            }
            wrote = true;
            text("cat " + quote(staged.getAbsolutePath()) + " > " + quote(ENTRY));
            if (!remoteHash(ENTRY).equals(PatchEngine.sha256(replacement))) {
                throw new Exception("写入后的文件校验失败。");
            }
            result.snapshot = PatchEngine.split(replacement);
            result.entryHash = PatchEngine.sha256(replacement);
            result.backup = backup;
            result.message = "apply".equals(action) ? "已应用补丁设置，正在打开游戏。" : "已恢复游戏原始设置，正在打开游戏。";
            launchGame();
            return result;
        } catch (Exception failure) {
            if (wrote) {
                try {
                    text("cat " + quote(rollback.getAbsolutePath()) + " > " + quote(ENTRY));
                    if (!remoteHash(ENTRY).equals(PatchEngine.sha256(current))) {
                        throw new Exception("回滚校验失败");
                    }
                } catch (Exception rollbackFailure) {
                    throw new Exception("自动回滚未能完成。原始备份保留在：\n" + backup + "\n" + failure.getMessage(), rollbackFailure);
                }
            }
            if (stopped) {
                try { launchGame(); } catch (Exception ignored) {}
            }
            throw new Exception(failure.getMessage() + (wrote ? "\n已恢复本次操作之前的文件。" : ""), failure);
        } finally {
            staged.delete();
            rollback.delete();
        }
    }
}
