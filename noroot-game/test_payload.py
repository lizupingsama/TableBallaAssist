"""Execute the generated embedded loader against existing game-class fixtures."""
import json
import subprocess
import sys
import unittest
from pathlib import Path

from payload import DEFAULT_PACKAGE_NAME, build_payload

ROOT = Path(__file__).resolve().parent

HARNESS = r"""
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const {fixture} = require(path.resolve('../tests/pocket-fixture.cjs'));
class Element {
    constructor(tag) {
        this.tagName = tag; this.style = {}; this.children = [];
        this.events = {}; this.attributes = {}; this.value = ''; this.checked = false;
    }
    appendChild(item) { item.parentNode = this; this.children.push(item); return item; }
    removeChild(item) { this.children = this.children.filter(child => child !== item); item.parentNode = null; }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, callback) { this.events[name] = callback; }
    fire(name = 'click') { this.events[name]({stopPropagation() {}}); }
}
function setup(saved = new Map(), url = 'file:///data/user/0/com.krmtqds.aligames/files/swgn8ball/index.html') {
    const f = fixture();
    const s = f.s;
    s.console = {info() {}, error() {}};
    s.location = {href: url};
    const body = new Element('body');
    function find(node, id) {
        if (node.id === id) return node;
        for (const child of node.children) { const result = find(child, id); if (result) return result; }
        return null;
    }
    s.document = {body, createElement: tag => new Element(tag), getElementById: id => find(body, id)};
    s.localStorage = {getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value)};
    let next = 0;
    const timeouts = new Map(), intervals = new Map();
    s.setTimeout = callback => { timeouts.set(++next, callback); return next; };
    s.clearTimeout = id => timeouts.delete(id);
    s.setInterval = callback => { intervals.set(++next, callback); return next; };
    s.clearInterval = id => intervals.delete(id);
    // Exercise actual length hooks and split-flag preservation during a draw.
    s.VisualGuide.prototype.drawGuideLessSharpAngle = function () {
        return {length: s.VisualGuide.calculateGuideLength(1), split: this._isOpenFuZhu};
    };
    const guide = Object.create(s.VisualGuide.prototype);
    guide._isOpenFuZhu = false;
    guide.updateGuide = function () { this.lastDraw = this.drawGuideLessSharpAngle(0, .5); };
    s.egret.MainContext.instance.stage.$children = [guide];
    function run() { vm.runInContext(input.payload, s, {timeout: 3000}); }
    function tick() {
        const pending = [...timeouts.entries()];
        for (const [id, callback] of pending) { timeouts.delete(id); callback(); }
    }
    return {...f, guide, saved, timeouts, intervals, run, tick, get: id => s.document.getElementById(id)};
}
const KEY = 'poolguide-embedded-settings-v1';
"""


class PayloadTests(unittest.TestCase):
    def run_js(self, assertions, settings=None, package_name=DEFAULT_PACKAGE_NAME):
        completed = subprocess.run(
            ["node", "-e", HARNESS + "\n" + assertions],
            cwd=ROOT,
            input=json.dumps({"payload": build_payload(settings, package_name=package_name)}),
            capture_output=True,
            encoding="utf-8",
            timeout=20,
        )
        self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)

    def test_waits_once_and_does_not_reinstall_or_duplicate_timers(self):
        self.run_js(r"""
const f = setup();
const ctor = f.s.VisualGuide;
f.s.VisualGuide = undefined;
f.run(); f.run();
assert.equal(f.timeouts.size, 1);
assert.equal(f.intervals.size, 0);
assert.equal(f.s.__poolGuideEmbeddedDocument.phase, 'waiting');
f.s.VisualGuide = ctor; f.tick();
assert.equal(f.s.__poolGuideEmbeddedDocument.phase, 'installed');
assert.equal(f.timeouts.size, 0);
assert.equal(f.intervals.size, 1);
const installed = ctor.calculateGuideLength;
const state = f.s.__poolGuideExtender;
f.run(); f.run();
assert.equal(ctor.calculateGuideLength, installed);
assert.equal(f.s.__poolGuideExtender, state);
assert.equal(f.intervals.size, 1);
assert.equal(f.s.document.body.children.length, 3);
assert.equal(state.settings.bankPrediction, true);
assert.equal(state.settings.bankCount, 3);
assert.equal(state.settings.length, 220);
assert.equal(state.settings.showSplit, true);
assert.equal(state.settings.firstHitPocket, false);
assert.equal(f.get('poolguide-line-options').style.display, 'none');
f.get('poolguide-line-expand').fire();
assert.equal(f.get('poolguide-line-options').style.display, 'block');
""")

    def test_game_controls_change_live_behavior_and_restore_after_relaunch(self):
        self.run_js(r"""
const f = setup(); f.run();
const state = f.s.__poolGuideExtender;
const hooks = f.s.VisualGuide.calculateGuideLength;
const toggle = f.get('poolguide-live-controls').children[0].children[0];
toggle.fire();
assert.equal(state.settings.bankPrediction, false);
f.get('poolguide-line-length').value = '440';
f.get('poolguide-line-split').checked = false;
f.get('poolguide-line-apply').fire();
assert.equal(state.settings.length, 440);
assert.equal(f.guide.lastDraw.length, 440);
assert.equal(f.guide.lastDraw.split, false);
f.get('poolguide-line-mode').value = 'multiply';
f.get('poolguide-line-mode').fire('change');
f.get('poolguide-line-factor').value = '8';
f.get('poolguide-line-split').checked = true;
f.get('poolguide-line-apply').fire();
assert.equal(f.guide.lastDraw.length, 42.5 * 8);
assert.equal(f.guide.lastDraw.split, true);
assert.equal(f.s.VisualGuide.calculateGuideLength, hooks);
f.get('poolguide-live-controls').children[0].children[3].fire();
assert.equal(state.settings.bankCount, 4);
f.get('poolguide-toggle-firstHitPocket').fire();
assert.equal(state.settings.firstHitPocket, true);
assert.equal(state.pocketHooks, true);
f.get('poolguide-controls-hide').fire();
assert.equal(f.get('poolguide-live-controls').style.display, 'none');
const again = setup(f.saved); again.run();
assert.equal(again.s.__poolGuideEmbeddedDocument.phase, 'installed');
const restored = again.s.__poolGuideExtender.settings;
assert.equal(restored.mode, 'multiply');
assert.equal(restored.length, 440);
assert.equal(restored.factor, 8);
assert.equal(restored.showSplit, true);
assert.equal(restored.bankPrediction, false);
assert.equal(restored.bankCount, 4);
assert.equal(restored.firstHitPocket, true);
assert.equal(restored.snookerAllReds, false);
assert.equal(restored.eightBallAllButBlack, false);
assert.equal(again.get('poolguide-live-controls').style.display, 'none');
again.get('poolguide-controls-show').fire();
assert.equal(again.get('poolguide-live-controls').style.display, '');
assert.equal(again.intervals.size, 1);
""")

    def test_invalid_input_storage_and_unavailable_storage_do_not_break_install(self):
        self.run_js(r"""
const saved = new Map([[KEY, '{bad json'], ['poolguide-bank-count-v1', '6']]);
const f = setup(saved); f.run();
assert.equal(f.s.__poolGuideExtender.settings.bankCount, 3);
const before = f.saved.get(KEY);
f.get('poolguide-line-length').value = '0';
f.get('poolguide-line-apply').fire();
assert.equal(f.s.__poolGuideExtender.settings.length, 220);
assert.equal(f.saved.get(KEY), before);
assert.match(f.get('poolguide-line-message').textContent, /10/);
const partial = setup(new Map([[KEY, JSON.stringify({mode:'multiply', length:9000, factor:4, showSplit:'false', bankCount:9})]]));
partial.run();
assert.equal(partial.s.__poolGuideExtender.settings.mode, 'multiply');
assert.equal(partial.s.__poolGuideExtender.settings.length, 220);
assert.equal(partial.s.__poolGuideExtender.settings.factor, 4);
assert.equal(partial.s.__poolGuideExtender.settings.showSplit, true);
assert.equal(partial.s.__poolGuideExtender.settings.bankCount, 3);
const denied = setup();
denied.s.localStorage = {getItem() {throw Error('denied');}, setItem() {throw Error('denied');}};
denied.run();
assert.equal(denied.s.__poolGuideEmbeddedDocument.phase, 'installed');
denied.get('poolguide-line-length').value = '330';
denied.get('poolguide-line-apply').fire();
assert.equal(denied.s.__poolGuideExtender.settings.length, 330);
assert.match(denied.get('poolguide-line-message').textContent, /无法保存/);
""")

    def test_only_local_game_pages_are_eligible(self):
        self.run_js(r"""
for (const url of [
    'https://example.com/swgn8ball/index.html',
    'file:///android_asset/www/login.html',
    'file:///data/user/0/other.app/files/swgn8ball/index.html',
    'file:///data/user/0/com.krmtqds.aligames/files/swgn8ball/other.html',
    'about:blank'
]) {
    const f = setup(new Map(), url); f.run();
    assert.equal(f.s.__poolGuideEmbeddedDocument, undefined, url);
    assert.equal(f.timeouts.size + f.intervals.size, 0, url);
}
for (const url of [
    'file:///android_asset/www/index.html',
    'file:/android_asset/www/index.html?foo=1#game',
    'file:///data/data/com.krmtqds.aligames/files/swgn8ball/index.html#game',
    'file:/data/user/0/com.krmtqds.aligames/files/swgn8ball/index.html?version=3'
]) {
    const f = setup(new Map(), url); f.run();
    assert.equal(f.s.__poolGuideEmbeddedDocument.phase, 'installed', url);
}
""")

    def test_build_overrides_are_used_and_disposal_releases_the_panel_timer(self):
        self.run_js(r"""
const f = setup(); f.run();
const state = f.s.__poolGuideExtender;
assert.equal(state.settings.length, 500);
assert.equal(state.settings.bankPrediction, false);
assert.equal(state.settings.bankCount, 5);
assert.equal(f.guide.lastDraw.length, 500);
f.s.__poolGuideRequest = {action:'restore'};
vm.runInContext(fs.readFileSync(path.resolve('../guide.js'), 'utf8'), f.s);
assert.equal(f.intervals.size, 0);
assert.equal(f.get('poolguide-live-controls'), null);
assert.equal(f.get('poolguide-line-options'), null);
""", {"length": 500, "bankPrediction": False, "bankCount": 5})

    def test_coexisting_package_keeps_all_feature_settings_and_rejects_other_packages(self):
        settings = {
            "mode": "multiply", "length": 440, "factor": 8, "showSplit": True,
            "bankPrediction": True, "bankCount": 6, "firstHitPocket": True,
            "snookerAllReds": True, "eightBallAllButBlack": True,
        }
        self.run_js(r"""
for (const url of [
    'file:///data/user/0/io.lizuping.poolguide.game/files/swgn8ball/index.html',
    'file:/data/user/10/io.lizuping.poolguide.game/files/swgn8ball/index.html?version=3#table',
    'file:///data/data/io.lizuping.poolguide.game/files/swgn8ball/index.html#cue',
    'file:///android_asset/www/index.html'
]) {
    const f = setup(new Map(), url); f.run();
    assert.equal(f.s.__poolGuideEmbeddedDocument.phase, 'installed', url);
    const state = f.s.__poolGuideExtender;
    assert.equal(state.settings.mode, 'multiply');
    assert.equal(state.settings.length, 440);
    assert.equal(state.settings.factor, 8);
    assert.equal(state.settings.showSplit, true);
    assert.equal(state.settings.bankPrediction, true);
    assert.equal(state.settings.bankCount, 6);
    assert.equal(state.settings.firstHitPocket, true);
    assert.equal(state.settings.snookerAllReds, true);
    assert.equal(state.settings.eightBallAllButBlack, true);
    assert.equal(state.pocketHooks, true);
    for (const name of ['firstHitPocket', 'snookerAllReds', 'eightBallAllButBlack']) {
        assert.ok(f.get('poolguide-toggle-' + name), name + ' control must exist');
    }
    // The same live controls and length hooks remain usable under the new identity.
    f.get('poolguide-live-controls').children[0].children[0].fire();
    assert.equal(state.settings.bankPrediction, false);
    assert.equal(f.guide.lastDraw.length, 42.5 * 8);
    assert.equal(f.guide.lastDraw.split, true);
    const again = setup(f.saved, url); again.run();
    assert.equal(again.s.__poolGuideEmbeddedDocument.phase, 'installed');
    assert.equal(again.s.__poolGuideExtender.settings.bankPrediction, false);
    assert.equal(again.s.__poolGuideExtender.settings.bankCount, 6);
    assert.equal(again.s.__poolGuideExtender.settings.snookerAllReds, true);
}
for (const url of [
    'file:///data/user/0/com.krmtqds.aligames/files/swgn8ball/index.html',
    'file:///data/data/com.krmtqds.aligames/files/swgn8ball/index.html?version=3',
    'file:///data/user/10/other.app/files/swgn8ball/index.html',
    'file:///data/user/0/ioXlizupingXpoolguideXgame/files/swgn8ball/index.html',
    'file:///data/user/0/io.lizuping.poolguide.game.extra/files/swgn8ball/index.html',
    'https://example.com/data/user/0/io.lizuping.poolguide.game/files/swgn8ball/index.html'
]) {
    const f = setup(new Map(), url); f.run();
    assert.equal(f.s.__poolGuideEmbeddedDocument, undefined, url);
    assert.equal(f.timeouts.size + f.intervals.size, 0, url);
}
""", settings, package_name="io.lizuping.poolguide.game")

    def test_package_name_rejects_regex_and_javascript_injection(self):
        for package_name in [
            "", "game", "io..game", "io.game.", ".io.game", "io.1game",
            "io.game|com.krmtqds.aligames", "io.game.*", "io.game/../../other.app",
            "io.game\\.other", "io.game[abc]", "io.game\n", "io.game');throw 1;//",
        ]:
            with self.subTest(package_name=package_name), self.assertRaises(ValueError):
                build_payload(package_name=package_name)
        for package_name in [None, 7, {}, ["io.game"]]:
            with self.subTest(package_name=package_name), self.assertRaises(TypeError):
                build_payload(package_name=package_name)

    def test_local_cue_controls_are_in_the_generated_asset_and_follow_guide_disposal(self):
        self.run_js(r"""
const f = setup(); f.run();
const state = f.s.__poolGuideExtender;
assert.equal(f.s.__poolGuideEmbeddedDocument.phase, 'installed');
assert.equal(typeof f.s.__poolGuideLocalCues.attach, 'function');
assert.ok(state.localCues);
assert.equal(f.s.__poolGuideLocalCues.attach(state), state.localCues);
assert.ok(f.get('poolguide-cue-expand'));
assert.ok(f.get('poolguide-cue-options'));
assert.ok(f.get('poolguide-cue-apply'));
assert.ok(f.get('poolguide-cue-reset'));
f.run(); f.run();
assert.equal(f.intervals.size, 1);
f.s.__poolGuideRequest = {action:'restore'};
vm.runInContext(fs.readFileSync(path.resolve('../guide.js'), 'utf8'), f.s);
assert.equal(f.intervals.size, 0);
assert.equal(f.get('poolguide-cue-expand'), null);
assert.equal(f.get('poolguide-cue-options'), null);
""")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    unittest.main()
