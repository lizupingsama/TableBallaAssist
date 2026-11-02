"""Build the existing game hooks as a self-contained, per-document JS asset."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent))
import guide_extender


DEFAULT_PACKAGE_NAME = "com.krmtqds.aligames"

DEFAULT_SETTINGS = {
    "mode": "fixed",
    "length": 220,
    "factor": 6,
    "showSplit": True,
    "bankPrediction": True,
    "bankCount": 3,
    "firstHitPocket": False,
    "snookerAllReds": False,
    "eightBallAllButBlack": False,
}


def build_payload(settings: dict | None = None, package_name: str = DEFAULT_PACKAGE_NAME) -> str:
    """Reuse the canonical patch builder; no device or filesystem mutation occurs."""
    if settings is not None and not isinstance(settings, dict):
        raise TypeError("settings must be a dictionary")
    if not isinstance(package_name, str):
        raise TypeError("package_name must be a string")
    if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)+", package_name):
        raise ValueError("package_name must be a dot-separated Android application ID")
    normalized = guide_extender.validate_settings({**DEFAULT_SETTINGS, **(settings or {})})
    sample = guide_extender.build_patch(
        b'<html><body><script src="manifest.json"></script></body></html>', normalized
    )
    loader = sample.split(b"<script>\n", 1)[1].split(b"\n</script>", 1)[0].decode("utf-8")
    request = json.dumps({"action": "apply", "settings": normalized}, separators=(",", ":"))
    needle = "window.__poolGuideRequest=" + request
    if loader.count(needle) != 1:
        raise RuntimeError("The canonical game loader request format changed")
    loader = loader.replace(
        needle,
        "window.__poolGuideRequest={action:'apply',settings:window.__poolGuideEmbeddedDocument.settings}",
        1,
    )
    ui = (ROOT / "settings_ui.js").read_text(encoding="utf-8")
    local_cues = (ROOT / "local_cues.js").read_text(encoding="utf-8")
    defaults = json.dumps(normalized, ensure_ascii=True, separators=(",", ":"))
    prefix = """/* Pool Guide embedded loader: ES5, local game documents only. */
(function (root) {
    'use strict';
    var href = String(root.location && root.location.href || '');
    try { href = decodeURI(href); } catch (ignored) {}
    href = href.replace(/[?#].*$/, '');
    if (!/^file:\\/+android_asset\\/www\\/index\\.html$/i.test(href) &&
        !/^file:\\/+(?:data\\/user\\/\\d+|data\\/data)\\/__POOL_GUIDE_PACKAGE_PATTERN__\\/files\\/swgn8ball\\/index\\.html$/i.test(href)) {
        return;
    }
    if (root.__poolGuideEmbeddedDocument) { return; }
    var record = {phase: 'waiting', timer: null, attempts: 0, settings: null, error: null};
    root.__poolGuideEmbeddedDocument = record;
"""
    # Validation excludes JavaScript syntax; escaped dots cannot become regex wildcards.
    prefix = prefix.replace("__POOL_GUIDE_PACKAGE_PATTERN__", package_name.replace(".", r"\."), 1)
    return prefix + ui + "\n" + local_cues + "\n    var defaults = " + defaults + ";\n" + """
    function install() {
        record.timer = null;
        if (record.phase !== 'waiting') { return; }
        if (!root.document || !root.document.body || typeof root.VisualGuide !== 'function') {
            if (++record.attempts < 2400) {
                record.timer = root.setTimeout(install, 250);
            } else {
                record.phase = 'failed';
                record.error = 'game-not-ready';
            }
            return;
        }
        record.phase = 'installing';
        try {
            record.settings = root.__poolGuideEmbeddedSettings.readSettings(defaults);
            // VisualGuide is ready, so the canonical loader needs no retry timer.
""" + loader + "\n" + """
            var result = root.__poolGuideLoadResult;
            if (!result || !result.ok || !result.installed || !root.__poolGuideExtender) {
                throw new Error(result && result.reason || 'game-hooks-not-installed');
            }
            root.__poolGuideEmbeddedSettings.attach(root.__poolGuideExtender, defaults);
            root.__poolGuideLocalCues.attach(root.__poolGuideExtender);
            record.phase = 'installed';
        } catch (error) {
            record.phase = 'failed';
            record.error = String(error);
            if (root.console && root.console.error) {
                root.console.error('POOL_GUIDE_EMBEDDED ' + record.error);
            }
        }
    }
    install();
}(window));
"""
