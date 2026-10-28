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
        check(parsed.settings.bankPrediction, "desktop bank toggle recognized");
        check(parsed.settings.firstHitPocket, "desktop first-hit toggle recognized");
        check(parsed.settings.snookerAllReds, "desktop snooker sweep recognized");
        check(parsed.settings.eightBallAllButBlack, "desktop eight-ball sweep recognized");
        org.json.JSONObject legacy = new PatchEngine.Settings("fixed", 220, 6, true).json();
        legacy.remove("bankPrediction");
        legacy.remove("firstHitPocket");
        legacy.remove("snookerAllReds");
        legacy.remove("eightBallAllButBlack");
        check(!PatchEngine.Settings.from(legacy).bankPrediction, "legacy patches default to banks disabled");
        check(!PatchEngine.Settings.from(legacy).firstHitPocket, "legacy patches default to first-hit disabled");
        check(!PatchEngine.Settings.from(legacy).snookerAllReds, "legacy patches default to snooker sweep disabled");
        check(!PatchEngine.Settings.from(legacy).eightBallAllButBlack, "legacy patches default to eight-ball sweep disabled");
        PatchEngine.Settings fixed = new PatchEngine.Settings("fixed", 300, 6, true, true, true, true, true);
        byte[] mobile = PatchEngine.build(desktop, fixed, loader);
        PatchEngine.Snapshot split = PatchEngine.split(mobile);
        check(Arrays.equals(split.base, original), "Android restore round trip");
        check(split.settings.length == 300, "Android fixed length changed");
        check(split.settings.bankPrediction, "Android bank toggle preserved");
        check(split.settings.firstHitPocket, "Android first-hit toggle preserved");
        check(split.settings.snookerAllReds, "Android snooker sweep preserved");
        check(split.settings.eightBallAllButBlack, "Android eight-ball sweep preserved");
        byte[] second = PatchEngine.build(mobile, fixed, loader);
        check(Arrays.equals(mobile, second), "Android apply is idempotent");
        PatchEngine.Settings multiplied = new PatchEngine.Settings("multiply", 220, 8, false);
        byte[] multiple = PatchEngine.build(mobile, multiplied, loader);
        check(PatchEngine.split(multiple).settings.factor == 8, "multiplier updated");
        check(!PatchEngine.split(multiple).settings.showSplit, "split option preserved");
        check(!PatchEngine.split(multiple).settings.bankPrediction, "bank toggle can be turned off");
        check(!PatchEngine.split(multiple).settings.firstHitPocket, "first-hit toggle can be turned off");
        check(!PatchEngine.split(multiple).settings.snookerAllReds, "snooker sweep can be turned off");
        check(!PatchEngine.split(multiple).settings.eightBallAllButBlack, "eight-ball sweep can be turned off");
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
