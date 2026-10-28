"""Back up and extend the game's downloaded JS. Python standard library only."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import queue
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import threading
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PACKAGE = "com.krmtqds.aligames"
GAME_ROOT = f"/data/user/0/{PACKAGE}/files/swgn8ball"
GAME_JS = GAME_ROOT + "/js/main.min.js"
GAME_ENTRY = GAME_ROOT + "/index.html"
START = b"\n<!--__POOL_GUIDE_EXTENDER_START_v1__-->\n"
END = b"\n<!--__POOL_GUIDE_EXTENDER_END_v1__-->\n"
CONFIG = b"<!-- POOL_GUIDE_CONFIG="


class ToolError(RuntimeError):
    pass


def digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def split_patch(content: bytes) -> tuple[bytes, dict | None]:
    if START not in content:
        return content, None
    if content.count(START) != 1 or content.count(END) != 1:
        raise ToolError("已有补丁的边界异常；为保护文件，停止修改。")
    prefix, tail = content.split(START, 1)
    payload, suffix = tail.split(END, 1)
    base = prefix + suffix
    line = payload.split(b"\n", 1)[0]
    if not line.startswith(CONFIG) or not line.endswith(b" -->"):
        raise ToolError("补丁配置损坏。")
    config = json.loads(line[len(CONFIG):-4])
    if config.get("base_sha256") != digest(base):
        raise ToolError("原脚本在打补丁后被其他程序修改，停止覆盖。")
    return base, config


def validate_settings(settings: dict) -> dict:
    mode = settings.get("mode", "fixed")
    length = float(settings.get("length", 220))
    factor = float(settings.get("factor", 6))
    if mode not in ("fixed", "multiply") or not math.isfinite(length) or not 10 <= length <= 1500 or not math.isfinite(factor) or not 1 <= factor <= 30:
        raise ToolError("固定长度需为 10–1500，倍数需为 1–30。")
    return {"mode": mode, "length": length, "factor": factor, "showSplit": bool(settings.get("showSplit", True))}


def build_patch(content: bytes, settings: dict) -> bytes:
    base, _ = split_patch(content)
    position = base.lower().rfind(b"</body>")
    if position < 0 or b"<html" not in base.lower() or b"manifest.json" not in base:
        raise ToolError("游戏入口页面结构与已分析版本不匹配，未作修改。")
    config = {"base_sha256": digest(base), "settings": validate_settings(settings)}
    request = json.dumps({"action": "apply", "settings": config["settings"]}, separators=(",", ":"))
    hook = (ROOT / "guide.js").read_text(encoding="utf-8").rstrip().rstrip(";")
    payload = "(function(){var attempts=0;function install(){if(typeof window.VisualGuide!=='function'){if(++attempts<2400){setTimeout(install,250);}return;}try{window.__poolGuideRequest=" + request + ";var result=(" + hook + ");window.__poolGuideLoadResult=result;if(result.ok&&result.installed){var badge=document.createElement('div');badge.id='poolguide-status';badge.textContent='辅助线 '+(result.settings.mode==='fixed'?result.settings.length:result.settings.factor+'x');badge.style.cssText='position:fixed;right:8px;bottom:5px;z-index:2147483647;pointer-events:none;color:#79fff0;background:rgba(0,0,0,.5);padding:3px 7px;border-radius:4px;font:12px sans-serif;';document.body.appendChild(badge);}console.info('POOL_GUIDE_EXTENDER '+JSON.stringify(result));}catch(e){window.__poolGuideLoadResult={ok:false,reason:String(e)};console.error('POOL_GUIDE_EXTENDER '+e);}finally{delete window.__poolGuideRequest;}}install();}());"
    metadata = json.dumps(config, separators=(",", ":")).encode("utf-8")
    addition = START + CONFIG + metadata + b" -->\n<script>\n" + payload.encode("utf-8") + b"\n</script>" + END
    return base[:position] + addition + base[position:]


def run(args: list[str], timeout: int = 30, check: bool = True) -> str:
    result = subprocess.run(args, capture_output=True, encoding="utf-8", errors="replace", timeout=timeout, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if check and result.returncode:
        raise ToolError((result.stderr.strip() or result.stdout.strip())[-2000:])
    return result.stdout.strip()


class Connection:
    def __init__(self, serial: str | None = None, log=print):
        self.serial = serial
        self.log = log
        self.adb = shutil.which("adb")
        if not self.adb:
            raise ToolError("未找到 adb，请先安装 Android Platform Tools 并加入 PATH。")

    def command(self, *args: str, check=True) -> str:
        return run([self.adb, "-s", self.serial, *args], check=check)

    def root(self, command: str, check=True) -> str:
        return self.command("shell", "su -c " + shlex.quote(command), check=check)

    def connect(self):
        devices = re.findall(r"^([^\s]+)\s+device\s*$", run([self.adb, "devices"]), re.MULTILINE)
        if self.serial and self.serial not in devices:
            raise ToolError(f"设备 {self.serial} 未连接或未授权。")
        if not self.serial:
            if len(devices) != 1:
                raise ToolError("请连接一台已授权的手机；多台设备时使用 --serial。")
            self.serial = devices[0]
        if "uid=0(" not in self.root("id"):
            raise ToolError("此工具需要手机 Root，并给 ADB Shell 授予 su 权限。")

    def remote_hash(self, path: str) -> str:
        output = self.root("sha256sum " + path)
        value = output.split()[0] if output else ""
        if not re.fullmatch(r"[0-9a-f]{64}", value):
            raise ToolError("无法校验手机文件。")
        return value

    def read(self, remote: str) -> bytes:
        temporary = "/data/local/tmp/poolguide-read-" + uuid.uuid4().hex + ".js"
        with tempfile.TemporaryDirectory(prefix="poolguide-") as folder:
            local = Path(folder) / "source.js"
            try:
                self.root(f"cp {remote} {temporary}; chmod 644 {temporary}")
                self.command("pull", temporary, str(local))
                content = local.read_bytes()
                if digest(content) != self.remote_hash(remote):
                    raise ToolError("读取期间游戏脚本发生变化，请重试。")
                return content
            finally:
                self.root("rm -f " + temporary, check=False)

    def launch(self):
        resolved = self.command("shell", "cmd", "package", "resolve-activity", "--brief", PACKAGE)
        components = re.findall(r"^" + re.escape(PACKAGE) + r"/[^\s]+$", resolved, re.MULTILINE)
        if len(components) != 1:
            raise ToolError("找不到游戏启动入口，请手动启动游戏。")
        self.command("shell", "am", "start", "-W", "-n", components[0])

    def execute(self, action: str, settings: dict | None = None) -> dict:
        self.connect()
        self.log("读取手机热更新脚本并校验…")
        current = self.read(GAME_ENTRY)
        base, config = split_patch(current)
        base_sha = digest(base)
        backup = GAME_ENTRY + ".poolguide-original-" + base_sha
        result = {"serial": self.serial, "installed": config is not None, "sha256": digest(current), "base_sha256": base_sha, "settings": config["settings"] if config else None, "path": GAME_ENTRY}
        if action == "status":
            return result
        if action not in ("apply", "restore"):
            raise ToolError("未知操作。")
        if action == "restore" and config is None:
            return result
        if action == "apply":
            logic = self.read(GAME_JS).decode("utf-8")
            required = ["var VisualGuide=", "calculateGuideLength", "calculateGuideLength2", "drawGuideLessSharpAngle", "isOpenFuZhu"]
            if any(key not in logic for key in required):
                raise ToolError("当前主脚本的辅助线结构与已分析版本不匹配，未作修改。")
        replacement = build_patch(current, settings or {}) if action == "apply" else base
        # Preserve a local, content-addressed backup before any phone-side write.
        backup_dir = ROOT / ".backups" / re.sub(r"[^A-Za-z0-9_.-]", "_", self.serial)
        backup_dir.mkdir(parents=True, exist_ok=True)
        local_backup = backup_dir / (base_sha + ".html")
        if local_backup.exists() and digest(local_backup.read_bytes()) != base_sha:
            raise ToolError("本地原脚本备份校验失败。")
        local_backup.write_bytes(base)
        if config is None:
            # cp -n retains a previous backup; its digest must still match.
            self.root(f"cp -pn {GAME_ENTRY} {backup}")
        if self.remote_hash(backup) != base_sha:
            raise ToolError("手机端原脚本备份校验失败，未写入补丁。")
        token = uuid.uuid4().hex
        upload = f"/data/local/tmp/poolguide-write-{token}.js"
        rollback = f"/data/local/tmp/poolguide-rollback-{token}.js"
        with tempfile.TemporaryDirectory(prefix="poolguide-") as folder:
            local = Path(folder) / "index.html"
            node = shutil.which("node")
            if node and action == "apply":
                script = replacement.split(START, 1)[1].split(b"<script>\n", 1)[1].split(b"\n</script>", 1)[0]
                check_file = Path(folder) / "check.js"
                check_file.write_bytes(script)
                run([node, "--check", str(check_file)])
            local.write_bytes(replacement)
            self.log("备份完成，准备应用并重启游戏…")
            self.command("push", str(local), upload)
            local.write_bytes(current)
            self.command("push", str(local), rollback)
            stopped = False
            wrote = False
            try:
                if self.remote_hash(GAME_ENTRY) != digest(current):
                    raise ToolError("写入前检测到游戏更新，请重新连接。")
                self.command("shell", "am", "force-stop", PACKAGE)
                stopped = True
                if self.remote_hash(GAME_ENTRY) != digest(current):
                    raise ToolError("停止游戏时脚本发生变化，未覆盖文件，请重试。")
                wrote = True
                # Writing the existing inode keeps its UID, permissions and SELinux label.
                self.root(f"cat {upload} > {GAME_ENTRY}")
                if self.remote_hash(GAME_ENTRY) != digest(replacement):
                    raise ToolError("写入后的哈希不符。")
                self.launch()
            except Exception:
                if wrote:
                    self.root(f"cat {rollback} > {GAME_ENTRY}")
                    if self.remote_hash(GAME_ENTRY) != digest(current):
                        raise ToolError("自动回滚未通过校验；原脚本备份位于：" + backup)
                if stopped:
                    self.launch()
                raise
            finally:
                self.root(f"rm -f {upload} {rollback}", check=False)
        result.update(installed=action == "apply", sha256=digest(replacement), settings=validate_settings(settings or {}) if action == "apply" else None, backup=str(local_backup), remote_backup=backup, restarted=True)
        return result


def gui(serial: str | None):
    import tkinter as tk
    from tkinter import ttk

    root = tk.Tk()
    root.title("超级台球大师 · 辅助线加长")
    root.geometry("640x500")
    root.minsize(600, 480)
    events = queue.Queue()
    backend = Connection(serial, lambda value: events.put(("log", value)))
    frame = ttk.Frame(root, padding=22)
    frame.pack(fill="both", expand=True)
    ttk.Label(frame, text="辅助线加长", font=("Microsoft YaHei UI", 19, "bold")).pack(anchor="w")
    ttk.Label(frame, text="ADB + Root · 自动备份原脚本 · 应用或恢复时会重启游戏").pack(anchor="w", pady=(6, 18))
    mode = tk.StringVar(value="固定长度")
    length = tk.StringVar(value="220")
    factor = tk.StringVar(value="6")
    split = tk.BooleanVar(value=True)
    grid = ttk.Frame(frame)
    grid.pack(fill="x")
    for row, label in enumerate(["加长方式", "固定长度（逻辑单位）", "加长倍数"]):
        ttk.Label(grid, text=label).grid(row=row, column=0, sticky="w", pady=6)
    ttk.Combobox(grid, textvariable=mode, values=["固定长度", "按倍数加长"], state="readonly", width=20).grid(row=0, column=1, padx=12)
    ttk.Spinbox(grid, from_=10, to=1500, increment=10, textvariable=length, width=22).grid(row=1, column=1, padx=12)
    ttk.Spinbox(grid, from_=1, to=30, textvariable=factor, width=22).grid(row=2, column=1, padx=12)
    ttk.Checkbutton(frame, text="同时显示碰撞后的分裂线", variable=split).pack(anchor="w", pady=12)
    ttk.Label(frame, text="请先结束当前对局。进入练习球桌后转动球杆查看效果。\n这里只延长直线，不预测后续碰撞或反弹；长度过大时会穿过库边。", wraplength=590).pack(anchor="w")
    actions = ttk.Frame(frame)
    actions.pack(fill="x", pady=16)
    status = tk.StringVar(value="尚未连接。关闭面板会保留设置，可随时再次打开并恢复。")
    ttk.Label(frame, textvariable=status, wraplength=585, foreground="#245a79").pack(anchor="w", pady=6)
    busy = False
    buttons = []

    def submit(action):
        nonlocal busy
        if busy:
            return
        try:
            config = validate_settings({"mode": "fixed" if mode.get() == "固定长度" else "multiply", "length": float(length.get()), "factor": float(factor.get()), "showSplit": split.get()})
        except (ValueError, ToolError) as error:
            status.set(str(error))
            return
        busy = True
        for button in buttons:
            button.configure(state="disabled")
        status.set("正在连接手机…")

        def work():
            try:
                events.put(("done", (action, backend.execute(action, config))))
            except Exception as error:
                events.put(("error", str(error)))
        threading.Thread(target=work, daemon=True).start()

    for label, action in [("连接 / 读取状态", "status"), ("应用并重启游戏", "apply"), ("恢复并重启游戏", "restore")]:
        button = ttk.Button(actions, text=label, command=lambda a=action: submit(a))
        button.pack(side="left", padx=(0, 8))
        buttons.append(button)

    def drain():
        nonlocal busy
        while True:
            try:
                kind, value = events.get_nowait()
            except queue.Empty:
                break
            if kind == "log":
                status.set(value)
                continue
            busy = False
            for button in buttons:
                button.configure(state="normal")
            if kind == "error":
                status.set("操作失败：" + value)
                continue
            action, result = value
            if result["installed"]:
                current = result["settings"]
                mode.set("固定长度" if current["mode"] == "fixed" else "按倍数加长")
                length.set(str(current["length"]))
                factor.set(str(current["factor"]))
                split.set(current["showSplit"])
                status.set("已写入加长补丁并重启游戏，进入练习球桌查看。" if action == "apply" else "手机已连接，当前已安装加长补丁。")
            else:
                status.set("已恢复原脚本并重启游戏。" if action == "restore" and result.get("restarted") else "手机已连接，当前为原始线长。")
        root.after(100, drain)

    def close():
        if busy:
            status.set("正在完成写入或备份，请等待操作完成后关闭。")
        else:
            root.destroy()

    root.protocol("WM_DELETE_WINDOW", close)
    root.after(100, drain)
    root.mainloop()


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description="超级台球大师辅助线加长（ADB + Root，自动备份）")
    parser.add_argument("action", nargs="?", choices=["gui", "status", "apply", "restore"], default="gui")
    parser.add_argument("--serial")
    parser.add_argument("--mode", choices=["fixed", "multiply"], default="fixed")
    parser.add_argument("--length", type=float, default=220)
    parser.add_argument("--factor", type=float, default=6)
    parser.add_argument("--keep-split-setting", action="store_true")
    args = parser.parse_args()
    if args.action == "gui":
        gui(args.serial)
    else:
        connection = Connection(args.serial, lambda text: print(text, file=sys.stderr, flush=True))
        result = connection.execute(args.action, {"mode": args.mode, "length": args.length, "factor": args.factor, "showSplit": not args.keep_split_setting})
        print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print("错误：" + str(error), file=sys.stderr)
        sys.exit(1)
