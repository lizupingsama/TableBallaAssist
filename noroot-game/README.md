# 游戏内嵌补丁 · 免 Root pg5

下载 [PoolGame-NoRoot-Coexist-3.2.1-pg5.apk](https://github.com/lizupingsama/TableBallaAssist/releases/download/noroot-3.2.1-pg5/PoolGame-NoRoot-Coexist-3.2.1-pg5.apk)。应用名“台球大师·测试”，独立包名 `io.lizuping.poolguide.game`，基于已分析的阿里渠道版 3.2.1 / 10022。支持和官方版共存，运行不需要 Root、Shizuku、独立辅助 APK、屏幕捕获或悬浮窗权限。

源码在 [`noroot` 分支](https://github.com/lizupingsama/TableBallaAssist/tree/noroot)，安装包在 [pg5 Release](https://github.com/lizupingsama/TableBallaAssist/releases/tag/noroot-3.2.1-pg5)。原 Root 版本继续放在 [`root` 分支](https://github.com/lizupingsama/TableBallaAssist/tree/root)。

## 安装与原有面板

保留官方游戏，安装共存版即可。同签名 pg2、pg3 或 pg4 可覆盖安装；两个应用的本地缓存、设置和登录记录隔离，同一账号的服务器数据仍由游戏服务器管理。首次打开测试版时可能需要重新登录、下载资源。

游戏加载完成后，右下角显示辅助面板。默认开启本机物理反弹预测（3 次）、固定直线长度 220、碰撞后分裂线；三项入袋开关默认关闭。

- 反弹预测可切换，撞库次数可调为 1–6 次。
- “线长设置”可调整固定长度（10–1500）、倍数（1–30）及分裂线；点击“应用并记住”保存。直线长度与倍数在关闭反弹预测后生效。
- “隐藏”收起面板，保留“辅助”入口；各项辅助设置保存在本机。

## 本地球杆

1. 进入球桌，展开辅助面板中的“本地球杆”。
2. 在“名称 / ID”中查找，选择“球杆”、“颜色”和“皮肤 / 特效”。雅典娜（90613）置顶；每页最多列出 20 根球杆，可点“下一页”浏览。
3. 点“应用并记住”，查看面板状态。普通对局在本人回合显示所选外观；在中八单人练习或斯诺克单人练习中，自动应用所选球杆的本地模拟满级属性，无需勾选开关。
4. 点“恢复原球杆”可恢复原显示和属性，并清除当前账号的本地选择。

未在账号中解锁的球杆也可以加入本地选择，显示仍取决于当前版本是否提供相应资源。本地外观只改变本人球杆在本设备上的显示。普通对局按当前击球者身份判断：仅在本人回合替换，对手回合或无法可靠确认身份时保持游戏原显示，轮次切换时恢复该轮应显示的球杆。观战、回放和自动演示不替换外观。

练习按所选球杆的最高等级配置在本地模拟力度、旋转和精度，再经游戏原有换算应用；仅支持中八单人练习和斯诺克单人练习，联机、观战、回放和自动演示不应用练习属性。

满级按当前游戏配置中可达到的升级、升星和品质突破终点计算：`floor(基础属性 × (100 + 星级加成率) / 100) + 等级累计加成`。缺少配置时显示提示并保留原击球属性。雅典娜是固定 UR 杆，等级 1、星级 0、品质 14 已是该杆配置上限；其力度 1263、精度 1321、旋转 1332。纯粒子组成的球杆和特效使用游戏原生加载器。

本地满级不包含服务器活动、旧天赋或经济收益加成。配置中的时间属性会核对并显示在接口数据中，单人练习原有的计时规则不改动。

选择按账号保存在本机，启动时只载入选项，不自动应用。进入新球桌、切换账号或退出场景时自动恢复，需再次点“应用并记住”。

此功能不改变账号背包、星级、耐久、有效期或服务器装备状态，不发送装备请求。它不赋予服务器结算的增益，也不等于永久解锁球杆。资源缺失或接口变化时保留原游戏行为，并在面板提示。

pg5 单独发布，旧版 [pg4 Release](https://github.com/lizupingsama/TableBallaAssist/releases/tag/noroot-3.2.1-pg4) 和 [pg3 Release](https://github.com/lizupingsama/TableBallaAssist/releases/tag/noroot-3.2.1-pg3) 及其安装包继续保留。

## pg2 解压修复继续保留

原 `ZipUtils.uncompress(File,...)` 的进度轮询使用 `Thread.sleep(0)`，可能连续向主线程提交进度 Runnable。共存版将此间隔设为 100ms，最多约每秒 10 次进度更新，不改变资源内容或 Java 堆上限。

pg2 曾在 K90 上完成资源更新并进入九游登录流程；独立探针校验过 4,112 个文件（34MiB），只产生 7 次进度回调，最短间隔约 100ms。历史证据见 [unzip-fix-validation.json](unzip-fix-validation.json) 和 [UnzipProbe.java](qa/UnzipProbe.java)。这些结果不代表 pg5 新球杆功能已经完成手机验证。

## 实现

Cordova `SystemWebViewClient.onPageFinished` 调用新增 `Injector` 类，读取 APK 内的 `poolguide/loader.js`，通过游戏自身 WebView 执行。页面白名单只接受 APK 的 `www/index.html` 和当前应用私有目录的 `swgn8ball/index.html`；登录页、外部网页和其他应用的数据路径不注入。

载荷复用现有辅助线与物理预测模块，额外加入免 Root 设置持久化和本地球杆模块。每个新游戏文档加载后重新注入，避免直接改热更新主脚本后被覆盖；游戏更新改变接口时仍可能需要适配。

共存构建替换安装包名、标签、Provider authority、自定义权限和任务归属，保留资源 ID、Java 类名和渠道 SDK 配置。传给游戏 JS 的渠道识别参数仍为原渠道包名。原包及构建后的成员变更由脚本逐项校验，完整清单和 SHA-256 由 [validation.json](validation.json) 与 [coexist-validation.json](coexist-validation.json) 记录。

## 构建和验证

在本分支仓库根目录运行下面的 PowerShell 命令。需要 Python 3.10+、Node.js，以及现有 Android SDK / JDK；默认使用 Unity 2022.3.8f1c1 附带路径，也可用构建器的 `--sdk`、`--jdk` 参数指定。

原游戏 APK 不随仓库分发。通过 `--original` 指定文件；本机默认位置为仓库父目录的 `tmp_labels/com.krmtqds.aligames.apk`。只接受已分析版本，SHA-256 为 `e677e9529351bc558d010d4ae5bd173a555a8fba811deb75174065fc5f938214`。

先构建同包名中间产物，再生成可安装的共存版：

```bash
python -B .\noroot-game\build.py
```

```bash
python -B .\noroot-game\verify.py
```

```bash
python -B .\noroot-game\build_coexist.py
```

默认中间产物为 `noroot-game/.work/PoolGame-NoRoot-3.2.1-pg5-base.apk`，共存成品为仓库根目录的 `PoolGame-NoRoot-Coexist-3.2.1-pg5.apk`。中间产物仅用于构建，不作为安装版本发布。

重新验证共存成品：

```bash
python -B .\noroot-game\build_coexist.py --verify-only
```

载荷、注入器和共存身份检查：

```bash
python -B .\noroot-game\test_payload.py
```

```bash
python -B .\noroot-game\test_injector.py
```

```bash
python -B .\noroot-game\test_clone_identity.py
```

本地球杆行为与练习场景隔离检查：

```bash
node --test .\noroot-game\test_local_cues.cjs
```

Apktool 2.12.1 首次缺失时从官方 Release 下载，并核对固定 SHA-256；工具缓存在 `.tools`。签名保存在 `.signing`，升级已有测试版必须保留原签名。缓存、签名及密码均由 `.gitignore` 排除，不能公开。APK 超过 GitHub 普通 Git 文件上限，因此作为 Release 附件上传，源码提交到 `noroot` 分支。

## 验证范围

构建检查包括 APK 成员逐项比较、签名、ZIP 对齐、包名及标签解析、最终 DEX 的注入与渠道识别调用、100ms 解压进度间隔。JS/JVM 测试使用离线环境，不能证明 Android 上实际显示或操作正确。

pg5 仍需真机确认：渠道登录兼容性、未解锁球杆资源与特效、手动练习时的力度和旋转、场景切换后的恢复、未来热更新接口兼容性。原有入袋功能的联机接受情况尚未验证。
