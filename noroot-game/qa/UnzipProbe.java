/*
 * Production-method regression probe for Android app_process, UID 2000.
 *
 * Compile this file with JDK 11 --release 8, then convert its classes with D8.
 * Run with CLASSPATH=<probe.dex>:<actual-game.apk> and main class UnzipProbe.
 * Arguments: <existing-or-new-directory-below-/data/local/tmp> <actual-game.apk>
 *
 * This code CREATES a test archive with java.util.zip, but delegates every
 * extraction to the APK's real com.cnandroid.ZipUtils.uncompress(File,...).
 * It neither reimplements extraction nor simulates progress or sleep timing.
 * All its temporary data lives in a fresh child of the supplied work directory.
 */
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import java.util.zip.Deflater;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

public final class UnzipProbe {
    private static final int SMALL_FILES = 4096;
    private static final int LARGE_FILES = 16;
    private static final int LARGE_BYTES = 2 * 1024 * 1024;
    private static final long MIN_INTERVAL_NS = 90_000_000L;
    private static final long MIN_CASE_NS = 200_000_000L;

    private static final class Expected {
        final String name;
        final long size;
        final String sha256;

        Expected(String name, long size, String sha256) {
            this.name = name;
            this.size = size;
            this.sha256 = sha256;
        }
    }

    private static final class Callbacks implements InvocationHandler {
        long progressCalls;
        long firstNs;
        long lastNs;
        long minIntervalNs = Long.MAX_VALUE;
        long maxIntervalNs;
        int firstPercent = -1;
        int lastPercent = -1;
        int successes;
        int failures;
        String failureMessage;

        @Override
        public synchronized Object invoke(Object proxy, Method method, Object[] arguments) {
            String name = method.getName();
            if ("onProgress".equals(name)) {
                long now = System.nanoTime();
                int percent = ((Number) arguments[0]).intValue();
                if (progressCalls == 0) {
                    firstNs = now;
                    firstPercent = percent;
                } else {
                    long interval = now - lastNs;
                    minIntervalNs = Math.min(minIntervalNs, interval);
                    maxIntervalNs = Math.max(maxIntervalNs, interval);
                }
                progressCalls++;
                lastNs = now;
                lastPercent = percent;
                return null;
            }
            if ("onSuccess".equals(name)) {
                successes++;
                return null;
            }
            if ("onFail".equals(name)) {
                failures++;
                failureMessage = String.valueOf(arguments[0]);
                return null;
            }
            if ("toString".equals(name)) {
                return "UnzipProbeCallback";
            }
            if ("hashCode".equals(name)) {
                return System.identityHashCode(proxy);
            }
            if ("equals".equals(name)) {
                return proxy == arguments[0];
            }
            throw new IllegalArgumentException("Unexpected callback method: " + name);
        }
    }

    private static String hex(byte[] value) {
        final char[] digits = "0123456789abcdef".toCharArray();
        char[] result = new char[value.length * 2];
        for (int i = 0; i < value.length; i++) {
            result[i * 2] = digits[(value[i] & 255) >>> 4];
            result[i * 2 + 1] = digits[value[i] & 15];
        }
        return new String(result);
    }

    private static String digest(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] buffer = new byte[64 * 1024];
        try (FileInputStream input = new FileInputStream(file)) {
            int count;
            while ((count = input.read(buffer)) != -1) {
                digest.update(buffer, 0, count);
            }
        }
        return hex(digest.digest());
    }

    private static List<Expected> createArchive(File archive) throws Exception {
        List<Expected> expected = new ArrayList<Expected>();
        byte[] buffer = new byte[64 * 1024];
        try (ZipOutputStream output = new ZipOutputStream(new FileOutputStream(archive))) {
            output.setLevel(Deflater.NO_COMPRESSION);
            int count = SMALL_FILES + LARGE_FILES;
            for (int index = 0; index < count; index++) {
                boolean large = index < LARGE_FILES;
                String name = (large ? "large-" : "small-") + index + ".bin";
                int length = large ? LARGE_BYTES : 512;
                Random random = new Random(0x706f6f6c67756964L + index);
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                ZipEntry entry = new ZipEntry(name);
                entry.setTime(1_600_000_000_000L);
                output.putNextEntry(entry);
                int remaining = length;
                while (remaining > 0) {
                    random.nextBytes(buffer);
                    int current = Math.min(buffer.length, remaining);
                    output.write(buffer, 0, current);
                    digest.update(buffer, 0, current);
                    remaining -= current;
                }
                output.closeEntry();
                expected.add(new Expected(name, length, hex(digest.digest())));
            }
        }
        return expected;
    }

    private static void verifyOutput(File output, List<Expected> expected) throws Exception {
        File[] entries = output.listFiles();
        if (entries == null || entries.length != expected.size()) {
            throw new IOException("Unexpected number of extracted files");
        }
        for (Expected item : expected) {
            File actual = new File(output, item.name);
            if (!actual.isFile() || actual.length() != item.size || !item.sha256.equals(digest(actual))) {
                throw new IOException("Extracted content mismatch: " + item.name);
            }
        }
    }

    private static long invokeProduction(Method uncompress, Class<?> callbackClass,
                                         File archive, File output, Callbacks callbacks) throws Exception {
        if (!output.mkdir()) {
            throw new IOException("Could not create a fresh extraction directory");
        }
        Object proxy = Proxy.newProxyInstance(callbackClass.getClassLoader(),
                new Class<?>[] { callbackClass }, callbacks);
        long started = System.nanoTime();
        try {
            uncompress.invoke(null, archive, output.getAbsolutePath(), null, proxy);
        } catch (InvocationTargetException error) {
            Throwable cause = error.getCause();
            if (cause instanceof Exception) {
                throw (Exception) cause;
            }
            throw new RuntimeException("Production uncompress failed", cause);
        }
        return System.nanoTime() - started;
    }

    private static String quote(String value) {
        if (value == null) {
            return "null";
        }
        StringBuilder result = new StringBuilder("\"");
        for (int i = 0; i < value.length(); i++) {
            char current = value.charAt(i);
            if (current == '\\' || current == '"') {
                result.append('\\').append(current);
            } else if (current < 32 || current > 126) {
                String encoded = Integer.toHexString(current);
                result.append("\\u");
                for (int pad = encoded.length(); pad < 4; pad++) {
                    result.append('0');
                }
                result.append(encoded);
            } else {
                result.append(current);
            }
        }
        return result.append('"').toString();
    }

    private static String milliseconds(long nanoseconds) {
        return String.valueOf(nanoseconds / 1_000_000.0d);
    }

    private static void cleanup(File item, String allowedRoot) throws IOException {
        String canonical = item.getCanonicalPath();
        if (!canonical.equals(allowedRoot) && !canonical.startsWith(allowedRoot + File.separator)) {
            throw new IOException("Cleanup path escaped the probe directory");
        }
        File[] children = item.listFiles();
        if (children != null) {
            for (File child : children) {
                cleanup(child, allowedRoot);
            }
        }
        if (item.exists() && !item.delete()) {
            throw new IOException("Could not remove probe file: " + item.getName());
        }
    }

    public static void main(String[] arguments) throws Exception {
        File work = null;
        String cleanupRoot = null;
        int status = 1;
        try {
            if (arguments.length != 2) {
                throw new IllegalArgumentException("Usage: UnzipProbe <directory-below-/data/local/tmp> <game.apk>");
            }
            int uid = ((Number) Class.forName("android.os.Process").getMethod("myUid").invoke(null)).intValue();
            if (uid != 2000) {
                throw new IllegalStateException("This probe must run as the non-root Android shell UID 2000");
            }
            File base = new File(arguments[0]).getCanonicalFile();
            File apk = new File(arguments[1]).getCanonicalFile();
            if (!base.getPath().startsWith("/data/local/tmp/") || !apk.getPath().startsWith("/data/local/tmp/") || !apk.isFile()) {
                throw new IllegalArgumentException("Work directory and supplied APK must be below /data/local/tmp");
            }
            if ((!base.isDirectory() && !base.mkdirs()) || !base.isDirectory()) {
                throw new IOException("Could not create the probe base directory");
            }
            work = File.createTempFile("case-", ".tmp", base);
            if (!work.delete() || !work.mkdir()) {
                throw new IOException("Could not create an isolated probe directory");
            }
            cleanupRoot = work.getCanonicalPath();
            Class<?> production = Class.forName("com.cnandroid.ZipUtils");
            Class<?> callback = Class.forName("com.cnandroid.ZipUtils$ZipCallback");
            String loader = String.valueOf(production.getClassLoader());
            String classPath = System.getProperty("java.class.path", "");
            if (!loader.contains(apk.getPath()) && !classPath.contains(apk.getPath())) {
                throw new IllegalStateException("Cannot identify the supplied game APK in the production class path");
            }
            Method uncompress = production.getMethod("uncompress", File.class, String.class, String.class, callback);
            System.out.println("{\"kind\":\"provenance\",\"uid\":" + uid
                    + ",\"root_used\":false,\"apk_sha256\":" + quote(digest(apk))
                    + ",\"production_class\":" + quote(production.getName())
                    + ",\"method\":" + quote(uncompress.toString())
                    + ",\"class_loader\":" + quote(loader) + "}");

            File archive = new File(work, "fixture.zip");
            long generationStarted = System.nanoTime();
            List<Expected> expected = createArchive(archive);
            long generationNs = System.nanoTime() - generationStarted;
            File output = new File(work, "extracted");
            Callbacks success = new Callbacks();
            long elapsed = invokeProduction(uncompress, callback, archive, output, success);
            verifyOutput(output, expected);
            long budget = (elapsed + MIN_INTERVAL_NS - 1) / MIN_INTERVAL_NS + 1;
            boolean durationEnough = elapsed >= MIN_CASE_NS;
            boolean limited = success.progressCalls >= 2 && success.progressCalls <= budget
                    && success.minIntervalNs >= MIN_INTERVAL_NS;
            boolean successOk = durationEnough && limited && success.successes == 1 && success.failures == 0;
            System.out.println("{\"kind\":\"production_success_case\",\"ok\":" + successOk
                    + ",\"archive_bytes\":" + archive.length() + ",\"files\":" + expected.size()
                    + ",\"uncompressed_bytes\":" + (LARGE_FILES * (long) LARGE_BYTES + SMALL_FILES * 512L)
                    + ",\"generation_ms\":" + milliseconds(generationNs)
                    + ",\"extraction_ms\":" + milliseconds(elapsed)
                    + ",\"progress_calls\":" + success.progressCalls + ",\"progress_budget\":" + budget
                    + ",\"min_interval_ms\":" + (success.progressCalls > 1 ? milliseconds(success.minIntervalNs) : "null")
                    + ",\"max_interval_ms\":" + (success.progressCalls > 1 ? milliseconds(success.maxIntervalNs) : "null")
                    + ",\"first_percent\":" + success.firstPercent + ",\"last_percent\":" + success.lastPercent
                    + ",\"success_callbacks\":" + success.successes + ",\"failure_callbacks\":" + success.failures
                    + ",\"all_file_sizes_and_sha256_verified\":true,\"duration_sufficient\":" + durationEnough
                    + ",\"rate_limit_verified\":" + limited + "}");

            File invalid = new File(work, "invalid.zip");
            try (FileOutputStream stream = new FileOutputStream(invalid)) {
                stream.write("this-is-not-a-zip-file".getBytes("US-ASCII"));
            }
            Callbacks failure = new Callbacks();
            long failureNs = invokeProduction(uncompress, callback, invalid, new File(work, "invalid-output"), failure);
            boolean failureOk = failure.successes == 0 && failure.failures == 1 && failure.progressCalls == 0;
            System.out.println("{\"kind\":\"production_invalid_zip_case\",\"ok\":" + failureOk
                    + ",\"extraction_ms\":" + milliseconds(failureNs)
                    + ",\"success_callbacks\":" + failure.successes + ",\"failure_callbacks\":" + failure.failures
                    + ",\"progress_calls\":" + failure.progressCalls
                    + ",\"failure_message\":" + quote(failure.failureMessage) + "}");
            status = successOk && failureOk ? 0 : 2;
        } catch (Throwable error) {
            System.out.println("{\"kind\":\"probe_error\",\"ok\":false,\"error\":" + quote(error.toString()) + "}");
            error.printStackTrace(System.err);
        } finally {
            if (work != null && cleanupRoot != null) {
                try {
                    cleanup(work, cleanupRoot);
                    System.out.println("{\"kind\":\"cleanup\",\"ok\":true}");
                } catch (IOException error) {
                    status = 1;
                    System.out.println("{\"kind\":\"cleanup\",\"ok\":false,\"error\":" + quote(error.toString()) + "}");
                }
            }
        }
        System.out.println("{\"kind\":\"summary\",\"ok\":" + (status == 0) + ",\"exit_code\":" + status + "}");
        if (status != 0) {
            System.exit(status);
        }
    }
}
