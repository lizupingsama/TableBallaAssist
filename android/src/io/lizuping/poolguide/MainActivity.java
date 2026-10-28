package io.lizuping.poolguide;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.res.ColorStateList;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.RadioButton;
import android.widget.RadioGroup;
import android.widget.ScrollView;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final int BACKGROUND = Color.rgb(11, 27, 34);
    private static final int CARD = Color.rgb(21, 45, 54);
    private static final int TEXT = Color.rgb(231, 246, 243);
    private static final int MUTED = Color.rgb(154, 183, 187);
    private static final int ACCENT = Color.rgb(104, 232, 201);
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final List<View> controls = new ArrayList<>();
    private TextView state;
    private TextView permission;
    private RadioGroup modes;
    private EditText length;
    private EditText factor;
    private CheckBox split;
    private Switch banks;
    private Switch firstPocket;
    private Switch snookerReds;
    private Switch eightSweep;
    private LinearLayout lengthRow;
    private LinearLayout factorRow;
    private volatile boolean busy;

    @Override protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(BACKGROUND);
        getWindow().setNavigationBarColor(BACKGROUND);
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(BACKGROUND);
        LinearLayout page = column();
        page.setPadding(dp(24), dp(22), dp(24), dp(30));
        scroll.addView(page, new ScrollView.LayoutParams(-1, -2));

        TextView eyebrow = label("POOL GUIDE   /   1.4", 12, ACCENT);
        eyebrow.setLetterSpacing(.14f);
        page.addView(eyebrow);
        TextView title = label("辅助线加长", 30, TEXT);
        title.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        add(page, title, 9, 5);
        add(page, label("在手机上调整，不需要连接电脑。", 14, MUTED), 0, 22);

        LinearLayout statusCard = card();
        permission = label("需要 Root 授权", 13, ACCENT);
        statusCard.addView(permission);
        state = label("先读取当前设置，首次使用请允许 Root 权限。", 15, TEXT);
        state.setId(R.id.status_text);
        state.setMinHeight(dp(50));
        add(statusCard, state, 10, 10);
        Button read = button("检查 Root / 读取设置", false, R.id.read_status);
        read.setOnClickListener(view -> execute("status"));
        statusCard.addView(read);
        add(page, statusCard, 0, 16);

        LinearLayout settings = card();
        TextView heading = label("辅助线设置", 19, TEXT);
        heading.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        settings.addView(heading);
        modes = new RadioGroup(this);
        modes.setOrientation(LinearLayout.HORIZONTAL);
        RadioButton fixed = radio("固定长度", R.id.mode_fixed);
        RadioButton multiply = radio("按倍数加长", R.id.mode_multiply);
        modes.addView(fixed, new RadioGroup.LayoutParams(0, dp(50), 1));
        modes.addView(multiply, new RadioGroup.LayoutParams(0, dp(50), 1));
        add(settings, modes, 8, 10);
        modes.check(R.id.mode_fixed);

        lengthRow = column();
        lengthRow.addView(label("延长到（逻辑单位）", 13, MUTED));
        length = number("220", R.id.line_length);
        lengthRow.addView(length);
        add(settings, lengthRow, 0, 8);
        factorRow = column();
        factorRow.addView(label("原线长的倍数", 13, MUTED));
        factor = number("6", R.id.line_factor);
        factorRow.addView(factor);
        add(settings, factorRow, 0, 8);
        split = new CheckBox(this);
        split.setId(R.id.show_split);
        split.setText("同时显示碰撞后的分裂线");
        split.setTextSize(14);
        split.setTextColor(TEXT);
        split.setChecked(true);
        split.setButtonTintList(ColorStateList.valueOf(ACCENT));
        controls.add(split);
        settings.addView(split);
        banks = new Switch(this);
        banks.setId(R.id.bank_prediction);
        banks.setText("启动时开启反弹预测");
        banks.setTextSize(14);
        banks.setTextColor(TEXT);
        banks.setChecked(false);
        banks.setMinHeight(dp(48));
        banks.setSwitchPadding(dp(12));
        banks.setShowText(false);
        banks.setThumbTintList(new ColorStateList(new int[][]{{android.R.attr.state_checked}, {}},
                new int[]{ACCENT, MUTED}));
        banks.setTrackTintList(new ColorStateList(new int[][]{{android.R.attr.state_checked}, {}},
                new int[]{Color.rgb(44, 119, 108), Color.rgb(60, 79, 85)}));
        banks.setOnCheckedChangeListener((button, checked) -> updateMode());
        controls.add(banks);
        settings.addView(banks);
        add(settings, label("游戏右下角可实时开关，并选择 1–6 次反弹。青色为母球，黄色为目标球；目标球轨迹需启用分裂线。未拉杆时按 100% 满力预览，拉杆后按实际力度与当前旋转试算。", 12, MUTED), 9, 0);
        firstPocket = new Switch(this);
        firstPocket.setId(R.id.first_hit_pocket);
        firstPocket.setText("启动时开启首碰目标必进");
        firstPocket.setTextSize(14);
        firstPocket.setTextColor(TEXT);
        firstPocket.setChecked(false);
        firstPocket.setMinHeight(dp(48));
        firstPocket.setSwitchPadding(dp(12));
        firstPocket.setShowText(false);
        firstPocket.setThumbTintList(new ColorStateList(new int[][]{{android.R.attr.state_checked}, {}},
                new int[]{ACCENT, MUTED}));
        firstPocket.setTrackTintList(new ColorStateList(new int[][]{{android.R.attr.state_checked}, {}},
                new int[]{Color.rgb(44, 119, 108), Color.rgb(60, 79, 85)}));
        controls.add(firstPocket);
        add(settings, firstPocket, 14, 0);
        snookerReds = pocketSwitch("启动时开启斯诺克全红入袋", R.id.snooker_all_reds);
        add(settings, snookerReds, 4, 0);
        eightSweep = pocketSwitch("启动时开启中八非黑八全入袋", R.id.eight_ball_all_but_black);
        add(settings, eightSweep, 4, 0);
        add(settings, label("应用后，在游戏内展开“入袋开关”可动态切换三项功能。开启从下一杆生效，关闭阻止后续触发；已入袋球不会还原。斯诺克碰红收全红，中八碰目标球收非黑八；模式专用开关优先，原有犯规规则继续生效。", 12, MUTED), 9, 0);
        add(page, settings, 0, 20);
        modes.setOnCheckedChangeListener((group, checked) -> updateMode());

        Button apply = button("应用设置并打开游戏", true, R.id.apply_settings);
        apply.setOnClickListener(view -> execute("apply"));
        add(page, apply, 0, 10);
        Button restore = button("恢复游戏原始设置", false, R.id.restore_settings);
        restore.setOnClickListener(view -> execute("restore"));
        add(page, restore, 0, 10);
        Button open = button("只打开游戏", false, R.id.open_game);
        open.setOnClickListener(view -> openGame());
        add(page, open, 0, 18);
        add(page, label("应用或恢复会重启游戏，请先结束当前对局。原文件会自动备份；卸载本工具前，可先点击恢复。", 12, MUTED), 0, 0);
        setContentView(scroll);
        updateMode();
        restoreInputs();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private Switch pocketSwitch(String text, int id) {
        Switch control = new Switch(this);
        control.setId(id);
        control.setText(text);
        control.setTextSize(14);
        control.setTextColor(TEXT);
        control.setChecked(false);
        control.setMinHeight(dp(48));
        control.setSwitchPadding(dp(12));
        control.setShowText(false);
        control.setThumbTintList(new ColorStateList(new int[][]{{android.R.attr.state_checked}, {}},
                new int[]{ACCENT, MUTED}));
        control.setTrackTintList(new ColorStateList(new int[][]{{android.R.attr.state_checked}, {}},
                new int[]{Color.rgb(44, 119, 108), Color.rgb(60, 79, 85)}));
        controls.add(control);
        return control;
    }

    private LinearLayout column() {
        LinearLayout view = new LinearLayout(this);
        view.setOrientation(LinearLayout.VERTICAL);
        return view;
    }

    private LinearLayout card() {
        LinearLayout view = column();
        view.setPadding(dp(18), dp(18), dp(18), dp(18));
        GradientDrawable background = new GradientDrawable();
        background.setColor(CARD);
        background.setCornerRadius(dp(17));
        view.setBackground(background);
        return view;
    }

    private TextView label(String value, int size, int color) {
        TextView text = new TextView(this);
        text.setText(value);
        text.setTextSize(size);
        text.setTextColor(color);
        text.setLineSpacing(dp(4), 1);
        return text;
    }

    private void add(LinearLayout parent, View child, int top, int bottom) {
        LinearLayout.LayoutParams layout = new LinearLayout.LayoutParams(-1, -2);
        layout.topMargin = dp(top);
        layout.bottomMargin = dp(bottom);
        parent.addView(child, layout);
    }

    private Button button(String text, boolean primary, int id) {
        Button button = new Button(this);
        button.setId(id);
        button.setText(text);
        button.setTextSize(15);
        button.setAllCaps(false);
        button.setMinHeight(dp(52));
        button.setTextColor(primary ? BACKGROUND : TEXT);
        button.setBackgroundTintList(ColorStateList.valueOf(primary ? ACCENT : Color.rgb(34, 64, 74)));
        controls.add(button);
        return button;
    }

    private RadioButton radio(String text, int id) {
        RadioButton button = new RadioButton(this);
        button.setText(text);
        button.setId(id);
        button.setTextSize(14);
        button.setTextColor(TEXT);
        button.setButtonTintList(ColorStateList.valueOf(ACCENT));
        controls.add(button);
        return button;
    }

    private EditText number(String value, int id) {
        EditText input = new EditText(this);
        input.setId(id);
        input.setText(value);
        input.setTextColor(TEXT);
        input.setTextSize(30);
        input.setSelectAllOnFocus(true);
        input.setSingleLine(true);
        input.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_FLAG_DECIMAL);
        input.setBackgroundTintList(ColorStateList.valueOf(ACCENT));
        controls.add(input);
        return input;
    }

    private void updateMode() {
        boolean fixed = modes.getCheckedRadioButtonId() == R.id.mode_fixed;
        lengthRow.setVisibility(fixed ? View.VISIBLE : View.GONE);
        factorRow.setVisibility(fixed ? View.GONE : View.VISIBLE);
        length.setEnabled(!busy && !banks.isChecked());
        factor.setEnabled(!busy && !banks.isChecked());
    }

    private void setInputs(PatchEngine.Settings settings) {
        modes.check("fixed".equals(settings.mode) ? R.id.mode_fixed : R.id.mode_multiply);
        length.setText(format(settings.length));
        factor.setText(format(settings.factor));
        split.setChecked(settings.showSplit);
        banks.setChecked(settings.bankPrediction);
        firstPocket.setChecked(settings.firstHitPocket);
        snookerReds.setChecked(settings.snookerAllReds);
        eightSweep.setChecked(settings.eightBallAllButBlack);
    }

    private String format(double value) {
        return value == Math.rint(value) ? Long.toString((long) value) : Double.toString(value);
    }

    private void restoreInputs() {
        android.content.SharedPreferences saved = getPreferences(MODE_PRIVATE);
        try {
            setInputs(new PatchEngine.Settings(saved.getString("mode", "fixed"),
                    Double.parseDouble(saved.getString("length", "220")),
                    Double.parseDouble(saved.getString("factor", "6")), saved.getBoolean("split", true),
                    saved.getBoolean("banks", false), saved.getBoolean("firstPocket", false),
                    saved.getBoolean("snookerReds", false), saved.getBoolean("eightSweep", false)));
        } catch (Exception ignored) {}
    }

    private void execute(String action) {
        if (busy) {
            return;
        }
        PatchEngine.Settings settings;
        try {
            settings = new PatchEngine.Settings(modes.getCheckedRadioButtonId() == R.id.mode_fixed ? "fixed" : "multiply",
                    Double.parseDouble(length.getText().toString()), Double.parseDouble(factor.getText().toString()),
                    split.isChecked(), banks.isChecked(), firstPocket.isChecked(), snookerReds.isChecked(), eightSweep.isChecked());
        } catch (Exception error) {
            state.setText("请输入 10–1500 的长度和 1–30 的倍数。");
            return;
        }
        busy = true;
        for (View control : controls) {
            control.setEnabled(false);
        }
        executor.execute(() -> {
            RootBackend backend = new RootBackend(this, message -> runOnUiThread(() -> state.setText(message)));
            try {
                RootBackend.Result result = backend.execute(action, settings);
                runOnUiThread(() -> {
                    permission.setText(result.snapshot.installed() ? "Root 已授权 · 补丁已应用" : "Root 已授权 · 原始设置");
                    state.setText(result.message);
                    if (result.snapshot.settings != null) {
                        setInputs(result.snapshot.settings);
                        getPreferences(MODE_PRIVATE).edit().putString("mode", result.snapshot.settings.mode)
                                .putString("length", Double.toString(result.snapshot.settings.length))
                                .putString("factor", Double.toString(result.snapshot.settings.factor))
                                .putBoolean("split", result.snapshot.settings.showSplit)
                                .putBoolean("banks", result.snapshot.settings.bankPrediction)
                                .putBoolean("firstPocket", result.snapshot.settings.firstHitPocket)
                                .putBoolean("snookerReds", result.snapshot.settings.snookerAllReds)
                                .putBoolean("eightSweep", result.snapshot.settings.eightBallAllButBlack).apply();
                    }
                    if (!"status".equals(action)) {
                        Toast.makeText(this, result.message, Toast.LENGTH_LONG).show();
                    }
                    finishWork();
                });
            } catch (Exception error) {
                runOnUiThread(() -> {
                    state.setText(error.getMessage());
                    new AlertDialog.Builder(this).setTitle("未完成操作").setMessage(error.getMessage())
                            .setPositiveButton("知道了", null).show();
                    finishWork();
                });
            }
        });
    }

    private void finishWork() {
        busy = false;
        for (View control : controls) {
            control.setEnabled(true);
        }
        updateMode();
    }

    private void openGame() {
        Intent intent = getPackageManager().getLaunchIntentForPackage(RootBackend.GAME_PACKAGE);
        if (intent != null) {
            startActivity(intent);
        } else {
            state.setText("未找到阿里渠道版超级台球大师，请先安装并打开一次游戏。");
        }
    }

    @Override public void onBackPressed() {
        if (busy) {
            Toast.makeText(this, "正在保存或备份，请稍后返回。", Toast.LENGTH_SHORT).show();
        } else {
            super.onBackPressed();
        }
    }

    @Override protected void onDestroy() {
        executor.shutdown();
        super.onDestroy();
    }
}
