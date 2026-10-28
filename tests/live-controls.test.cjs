const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {fixture} = require('./bank-fixture.cjs');
const hook = fs.readFileSync(path.join(__dirname, '..', 'guide.js'), 'utf8');
const controls = fs.readFileSync(path.join(__dirname, '..', 'live_controls.js'), 'utf8');

function setup(savedCount) {
    const f = fixture([[140, 82]], [], {physics: true});
    class Element {
        constructor(tag) { this.tagName = tag; this.style = {}; this.children = []; this.events = {}; this.attributes = {}; }
        appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
        removeChild(child) { this.children = this.children.filter(item => item !== child); child.parentNode = null; }
        setAttribute(name, value) { this.attributes[name] = value; }
        addEventListener(name, callback) { this.events[name] = callback; }
        fire(name) { this.events[name]({stopPropagation() {}}); }
    }
    const body = new Element('body');
    function find(node, id) { if (node.id === id) return node; for (const child of node.children) { const result = find(child, id); if (result) return result; } return null; }
    f.s.document = {body, createElement: tag => new Element(tag), getElementById: id => find(body, id)};
    const saved = new Map(savedCount ? [['poolguide-bank-count-v1', String(savedCount)]] : []);
    f.s.localStorage = {getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value)};
    const timers = new Map();
    let timerId = 0;
    f.s.setInterval = callback => { timers.set(++timerId, callback); return timerId; };
    f.s.clearInterval = id => timers.delete(id);
    f.s.egret.MainContext.instance.stage.$children = [f.guide];
    f.guide.updateGuide = function () { this.drawGuideLessSharpAngle(this.m_nAimAngle || 0, .5); };
    vm.runInContext(controls, f.s);
    f.s.__poolGuideControls.mount(f.s.__poolGuideExtender);
    const panel = body.children[0];
    const [button, minus, count, plus] = panel.children[0].children;
    return {...f, panel, button, minus, count, plus, timers, saved};
}

test('in-game button changes the existing state and redraws immediately without reinstalling hooks', () => {
    const f = setup();
    const state = f.s.__poolGuideExtender;
    const hookBefore = f.guide.drawGuideLessSharpAngle;
    f.guide.updateGuide();
    assert.equal(f.button.textContent, '反弹预测：开');
    f.button.fire('click');
    assert.equal(state.settings.bankPrediction, false);
    assert.equal(f.button.textContent, '反弹预测：关');
    assert.equal(f.guide.children[0].visible, false);
    f.button.fire('click');
    assert.equal(state.settings.bankPrediction, true);
    assert.equal(f.guide.children[0].visible, true);
    assert.equal(f.guide.drawGuideLessSharpAngle, hookBefore);
});

test('bank count selection redraws both paths, saves the count and keeps other options intact', () => {
    const f = setup();
    const state = f.s.__poolGuideExtender;
    state.settings.firstHitPocket = true;
    f.minus.fire('click');
    f.minus.fire('click');
    assert.equal(state.settings.bankCount, 1);
    assert.ok(state.lastPrediction.cueBanks <= 1);
    assert.ok(state.lastPrediction.targetBanks <= 1);
    assert.equal(state.settings.firstHitPocket, true);
    assert.equal(f.minus.disabled, true);
    assert.equal(f.saved.get('poolguide-bank-count-v1'), '1');
    const again = setup(5);
    assert.equal(again.s.__poolGuideExtender.settings.bankCount, 5);
    assert.equal(again.count.textContent, '5 次');
    again.plus.fire('click');
    assert.equal(again.count.textContent, '6 次');
    assert.equal(again.plus.disabled, true);
});

test('polling changes the full-power idle hint to actual pull power and refreshes english', () => {
    const f = setup();
    const tick = [...f.timers.values()][0];
    f.guide.visualCue.power = 0;
    tick();
    assert.match(f.panel.children[1].textContent, /未拉杆：100% 满力预览/);
    f.guide.visualCue.power = 220;
    f.guide.visualCue.cueCanvas.englishControl.englishX = .4;
    f.s.__poolGuidePhysics.invalidate(f.guide);
    tick();
    assert.match(f.panel.children[1].textContent, /当前力度/);
    assert.equal(f.s.__poolGuideExtender.lastPrediction.shot.power, 220);
    assert.equal(f.s.__poolGuideExtender.lastPrediction.shot.englishX, .4);
});

test('remount and restore release the old DOM panel and polling timer', () => {
    const f = setup();
    f.s.__poolGuideControls.mount(f.s.__poolGuideExtender);
    assert.equal(f.timers.size, 1);
    assert.equal(f.s.document.body.children.length, 1);
    f.s.__poolGuideRequest = {action: 'restore'};
    vm.runInContext(hook, f.s);
    assert.equal(f.timers.size, 0);
    assert.equal(f.s.document.body.children.length, 0);
});
