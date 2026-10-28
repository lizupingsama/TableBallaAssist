# 超级台球大师辅助线加长工具（Root 版）

本仓库的 `root` 分支专门维护需要 Root 的版本，包含独立 Android APK、Windows 桌面工具、源码及测试。

下载 [PoolGuide-1.0.0.apk](PoolGuide-1.0.0.apk)，可在手机上直接调整、应用和恢复，无需电脑。使用说明见 [Android APK](android/README.md)。下面为原桌面版说明。

适配本次分析的阿里渠道版 `com.krmtqds.aligames`。Windows 面板使用 Python 标准库，手机通过 ADB 连接并需要 Root。

## 使用

1. 双击 `启动.cmd`。
2. 点“连接 / 读取状态”，确认手机已连接。
3. 选固定长度（初始 220）或加长倍数（初始 6），点“应用并重启游戏”。请先结束当前对局。
4. 进入练习球桌并转动球杆。游戏右下角出现“辅助线 220”等标识，说明绘制补丁已加载。

“同时显示碰撞后的分裂线”只在绘制期间临时打开对应视觉开关；取消勾选则遵循游戏原来的开关。

点“恢复并重启游戏”即可恢复原始页面。关闭面板会保留已应用的设置。

## 实现与范围

游戏会在启动时更新 `files/swgn8ball/js/main.min.js`，直接改主脚本会被覆盖。本工具在同目录的 `index.html` 中加入一个等待加载的脚本，等 `VisualGuide` 出现后挂接：

- `VisualGuide.calculateGuideLength`：普通辅助线。
- `VisualGuide.calculateGuideLength2`：特殊球杆皮肤辅助线。
- `VisualGuideJiaoCheng.calculateGuideLength`：教程辅助线。

仅在绘制辅助线时改变返回长度，其他调用沿用原函数。原有首碰预测、犯规标记和球运动逻辑由游戏继续处理。零速度不放大，防止零向量变成非法坐标。

固定长度为逻辑坐标单位，且不会缩短原本更长的线。倍数模式保留原线长比例，结果上限为 1500。这里只延长首碰后的方向线，不预测后续碰撞、库边反弹或入袋；长线可以穿过球或台边。球杆皮肤本身只画目标球方向线时，工具沿用其原有绘制内容。

报告中的 `50 × 精准度 + speed × (10 + 10 × 距离因子) − 10` 实际对应教程类。真机普通对局为 `42.5 × speed × 精准度`，特殊皮肤为 `42.5 × 精准度`，因此三个函数分别处理。

## 备份与恢复

- 改动前在手机入口页面旁生成带 SHA-256 的原始备份，并在工具目录 `.backups/<设备>/` 保存相同内容。
- 写入前、写入后分别校验 SHA-256；异常时尝试恢复本次操作之前的完整页面。
- 写入现有文件，保留原 UID、文件权限和 SELinux 标签。
- 重复应用会更新原有补丁，不会叠加。若文件被其他程序改动而校验不符，停止修改。
- 主脚本的日常热更新不影响此加载方式；入口页面被游戏更新替换后，需要重新应用。

## 环境与命令行

需要 Python 3.10+（含 tkinter）、ADB，以及已给 ADB Shell 授予 su 权限的手机。没有 Root 的设备不支持这一版工具。以下命令均在仓库根目录的 PowerShell 中运行。

读取状态：

```bash
python .\guide_extender.py status
```

应用 220 逻辑单位的线长：

```bash
python .\guide_extender.py apply --length 220
```

按原线长放大 6 倍：

```bash
python .\guide_extender.py apply --mode multiply --factor 6
```

恢复原状：

```bash
python .\guide_extender.py restore
```

多台手机时在命令末尾添加 `--serial <adb devices 显示的序列号>`。

## 验证记录

2026-10-28，Redmi K50 / Android 13：已验证读取原文件、双端备份、写入校验、游戏重启、入口补丁在重启后保留，以及实际页面出现加载成功标识。恢复后的入口页面 SHA-256 应与原始备份完全一致。

测试包含从手机热更新脚本提取的实际 VisualGuide 类；检查普通/皮肤/教程线长、零速度、重复应用、异常恢复，以及补丁完整性。测试不等于对局轨迹精度验证。

早期 Frida 注入测试在这台手机上导致游戏闪退，最终工具已移除 Frida 路径，运行无需下载注入组件。

开发验证命令：

```bash
node --test .\tests\guide.test.cjs
```

```bash
python -m unittest discover -s .\tests -p 'test_*.py'
```
