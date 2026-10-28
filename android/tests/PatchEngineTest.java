package io.lizuping.poolguide;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.Arrays;

public final class PatchEngineTest {
    private static int assertions;

    private static void check(boolean condition, String message) {
        assertions++;
        if (!condition) { throw new AssertionError(message); }
    }

    public static void main(String[] args) throws Exception {
        Path directory = Paths.get(args[0]);
        byte[] original = Files.readAllBytes(directory.resolve("original.html"));
        byte[] desktop = Files.readAllBytes(directory.resolve("desktop.html"));
        String loader = new String(Files.readAllBytes(Paths.get(args[1])), StandardCharsets.UTF_8);
        PatchEngine.Snapshot parsed = PatchEngine.split(desktop);
        check(parsed.installed(), "desktop patch recognized");
        check(Arrays.equals(parsed.base, original), "desktop base preserved byte for byte");
        check(parsed.settings.length == 220, "desktop settings recognized");
        PatchEngine.Settings fixed = new PatchEngine.Settings("fixed", 300, 6, true);
        byte[] mobile = PatchEngine.build(desktop, fixed, loader);
        PatchEngine.Snapshot split = PatchEngine.split(mobile);
        check(Arrays.equals(split.base, original), "Android restore round trip");
        check(split.settings.length == 300, "Android fixed length changed");
        byte[] second = PatchEngine.build(mobile, fixed, loader);
        check(Arrays.equals(mobile, second), "Android apply is idempotent");
        PatchEngine.Settings multiplied = new PatchEngine.Settings("multiply", 220, 8, false);
        byte[] multiple = PatchEngine.build(mobile, multiplied, loader);
        check(PatchEngine.split(multiple).settings.factor == 8, "multiplier updated");
        check(!PatchEngine.split(multiple).settings.showSplit, "split option preserved");
        boolean rejected = false;
        try { PatchEngine.split(("<!-- changed -->" + new String(mobile, StandardCharsets.UTF_8)).getBytes(StandardCharsets.UTF_8)); }
        catch (Exception expected) { rejected = true; }
        check(rejected, "modified base rejected");
        rejected = false;
        try { PatchEngine.split(Arrays.copyOf(mobile, mobile.length - 25)); }
        catch (Exception expected) { rejected = true; }
        check(rejected, "truncated patch rejected");
        rejected = false;
        try { new PatchEngine.Settings("fixed", Double.NaN, 6, true); }
        catch (Exception expected) { rejected = true; }
        check(rejected, "nonfinite values rejected");
        Files.write(directory.resolve("mobile.html"), mobile);
        Files.write(directory.resolve("multiply.html"), multiple);
        System.out.println("Android patch core: " + assertions + " checks passed");
    }
}
