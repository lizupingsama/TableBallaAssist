# 超级台球大师 · 免 Root 测试版

本分支 `noroot` 维护内嵌辅助面板的游戏共存版。下载 [PoolGame-NoRoot-Coexist-3.2.1-pg4.apk](https://github.com/lizupingsama/TableBallaAssist/releases/download/noroot-3.2.1-pg4/PoolGame-NoRoot-Coexist-3.2.1-pg4.apk)，或查看 [pg4 发布页](https://github.com/lizupingsama/TableBallaAssist/releases/tag/noroot-3.2.1-pg4)。需要 Root 的独立辅助工具保留在 [`root` 分支](https://github.com/lizupingsama/TableBallaAssist/tree/root)。

安装后应用名为 **台球大师·测试**，包名 `io.lizuping.poolguide.game`，可以和官方游戏共存。不需要 Root、Shizuku、独立辅助 APK 或电脑连接。已安装同签名 pg2 或 pg3 的设备可覆盖安装，保留测试版数据；首次安装时需重新登录和下载资源。

## pg4 本地球杆

- 可选择未拥有球杆的外观和特效，在本机显示。
- 雅典娜（90613）置顶，便于直接选择。
- 选择球杆后，在中八或斯诺克单人练习中自动使用本地模拟的满级力度、旋转和精度。
- 提供恢复入口，清除本地选择后恢复游戏原球杆。

入口在游戏右下角辅助面板的“本地球杆”。先进入球桌，选择球杆、颜色和皮肤后点“应用并记住”；单人练习默认应用满级属性，无需额外勾选。选择按账号保存在本机，新球桌需重新应用。不增加账号背包里的球杆，不向服务器发送装备请求。具体操作和范围见 [免 Root 版说明](noroot-game/README.md)。

## 已包含的辅助功能

反弹预测、1–6 次撞库、碰撞后分裂线、直线长度及倍数设置；默认在手机计算。原有三项入袋开关默认关闭。pg2 的资源解压进度修复继续保留，避免无等待轮询大量提交 UI 回调。

本版本是测试包。pg2 曾在 K90 上运行到九游登录流程；pg4 的球杆效果、真实练习操作及渠道登录仍需手机验证。离线代码和 APK 检查不能代替实际运行；联机服务器是否接受原有入袋功能也未验证。

## 构建与源码

构建入口是 [noroot-game/build.py](noroot-game/build.py) 和 [noroot-game/build_coexist.py](noroot-game/build_coexist.py)。所需原游戏 APK 的 SHA-256、工具路径、构建步骤和验证命令见 [构建说明](noroot-game/README.md#构建和验证)。

源码保存在 `noroot` 分支，完整 APK 作为 GitHub Release 附件提供。原游戏 APK、下载缓存、签名私钥及密码、构建工具均不提交到仓库。

旧版 [pg3 发布页](https://github.com/lizupingsama/TableBallaAssist/releases/tag/noroot-3.2.1-pg3) 继续保留，pg4 单独发布。
