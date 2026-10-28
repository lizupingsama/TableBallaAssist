const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const hook = fs.readFileSync(path.join(__dirname, '..', 'guide.js'), 'utf8');

function fixture(stubDrawing = true) {
    const sandbox = { console, Math, isFinite };
    sandbox.window = sandbox;
    sandbox.document = { title: 'test' };
    sandbox.PoolMath = { CUE_PROPERTIES_ACCURACY: 2 };
    sandbox.egret = { Sprite: function () {}, Shape: function () {}, Matrix: function () {}, MainContext: { instance: { stage: { $children: [] } } } };
    sandbox.__extends = function (derived, base) {
        derived.prototype = Object.create(base.prototype);
        derived.prototype.constructor = derived;
    };
    sandbox.__reflect = function () {};
    vm.createContext(sandbox);
    const realSource = path.join(__dirname, 'visual-guides.fixture.js');
    vm.runInContext(fs.readFileSync(realSource, 'utf8'), sandbox, { timeout: 2000 });
    // Keep the real game's static length functions; isolate the draw-call contract.
    for (const name of stubDrawing ? ['VisualGuide', 'VisualGuideJiaoCheng'] : []) {
        const ctor = sandbox[name];
        ctor.prototype.drawGuideLessSharpAngle = function (speed, fail) {
            if (fail) throw Error('drawing failed');
            return { length: ctor.calculateGuideLength(speed, 1, true, false), flag: this._isOpenFuZhu };
        };
        ctor.prototype.drawGuideLessSharpAngle2 = function (speed) {
            return ctor.calculateGuideLength2 ? ctor.calculateGuideLength2(speed, 1, false) : 0;
        };
    }
    sandbox.call = (action, settings) => {
        sandbox.__poolGuideRequest = { action, settings };
        return vm.runInContext(hook, sandbox, { timeout: 2000 });
    };
    sandbox.guide = Object.create(sandbox.VisualGuide.prototype);
    sandbox.guide._isOpenFuZhu = false;
    return sandbox;
}

test('real game uses 42.5 * speed * accuracy; skin path uses 42.5 * accuracy', () => {
    const s = fixture();
    assert.equal(s.VisualGuide.calculateGuideLength(.5, 1, true, false), 42.5);
    assert.equal(s.VisualGuide.calculateGuideLength2(.5, 1, true), 85);
    assert.equal(s.VisualGuideJiaoCheng.calculateGuideLength(.5, 1), 100);
});
test('fixed length affects normal and skin drawing, without changing calls outside drawing', () => {
    const s = fixture();
    s.call('apply', { mode: 'fixed', length: 220, showSplit: true });
    assert.equal(s.guide.drawGuideLessSharpAngle(.5).length, 220);
    assert.equal(s.guide.drawGuideLessSharpAngle2(.5), 220);
    assert.equal(s.VisualGuide.calculateGuideLength(.5, 1, true, false), 42.5);
    assert.equal(s.guide._isOpenFuZhu, false);
});
test('multiplier and zero-speed guard preserve directionless balls', () => {
    const s = fixture();
    s.call('apply', { mode: 'multiply', factor: 6 });
    assert.equal(s.guide.drawGuideLessSharpAngle(.5).length, 255);
    assert.equal(s.guide.drawGuideLessSharpAngle(0).length, 0);
});
test('updating settings is idempotent; restore returns original function identities', () => {
    const s = fixture();
    const original = s.VisualGuide.calculateGuideLength;
    const draw = s.VisualGuide.prototype.drawGuideLessSharpAngle;
    s.call('apply', { length: 220 });
    const installed = s.VisualGuide.calculateGuideLength;
    s.call('apply', { length: 400 });
    assert.equal(s.VisualGuide.calculateGuideLength, installed);
    assert.equal(s.guide.drawGuideLessSharpAngle(.5).length, 400);
    s.call('restore');
    assert.equal(s.VisualGuide.calculateGuideLength, original);
    assert.equal(s.VisualGuide.prototype.drawGuideLessSharpAngle, draw);
});
test('draw failures restore the split flag and leave no active length override', () => {
    const s = fixture();
    s.call('apply', { length: 220, showSplit: true });
    assert.throws(() => s.guide.drawGuideLessSharpAngle(.5, true));
    assert.equal(s.guide._isOpenFuZhu, false);
    assert.equal(s.__poolGuideExtender.active, 0);
    assert.equal(s.VisualGuide.calculateGuideLength(.5, 1, true, false), 42.5);
});
test('spectator drawings keep original length', () => {
    const s = fixture();
    s.guide._isGuanZhan = true;
    s.call('apply', { length: 220, showSplit: true });
    assert.equal(s.guide.drawGuideLessSharpAngle(.5).length, 42.5);
});
test('invalid settings fail before installing anything', () => {
    const s = fixture();
    assert.throws(() => s.call('apply', { length: Infinity }));
    assert.equal(s.__poolGuideExtender, undefined);
});
test('actual drawGuideLessSharpAngle keeps first contact and extends both outgoing segments', () => {
    const s = fixture(false);
    class Vec {
        constructor(x = 0, y = 0) { this.init(x, y); }
        init(x, y) { this.x = x; this.y = y; }
        rotate(a) { const x = this.x; this.x = x * Math.cos(a) - this.y * Math.sin(a); this.y = x * Math.sin(a) + this.y * Math.cos(a); }
        scale(k) { this.x *= k; this.y *= k; }
        normalize() { this.scale(1 / this.length); }
        get length() { return Math.hypot(this.x, this.y); }
        set length(v) { this.scale(v / this.length); }
    }
    s.LogicalBall = class { constructor() { this.position = new Vec(); this.velocity = new Vec(); } };
    s.LogicalBall.nSTATE_IN_PLAY = 0;
    s.BaseDef = { gameType: 0 };
    s.GameType = { BALL_8: 1, RANK_BALL_8: 2, BALL_8_PRIVATE: 3 };
    s.egret.is = (object, type) => object.kind === type;
    s.PoolMath.ballBallCollision = (a, b) => {
        const nx = (b.position.x - a.position.x) / Math.hypot(b.position.x - a.position.x, b.position.y - a.position.y);
        const ny = (b.position.y - a.position.y) / Math.hypot(b.position.x - a.position.x, b.position.y - a.position.y);
        const transfer = a.velocity.x * nx + a.velocity.y * ny;
        b.velocity.init(nx * transfer, ny * transfer);
        a.velocity.init(a.velocity.x - b.velocity.x, a.velocity.y - b.velocity.y);
    };
    const g = s.guide;
    g._setTargetBallNum = -1;
    g._logicalBallPool = [];
    g._lineColor = 0xffffff;
    g.lineSize = 2;
    g._isBaoDiLength = false;
    g.m_cTable = {
        cueBall: { position: new Vec(0, 0), radius: 2 },
        findFirstCollisionBall: () => ({ kind: 'BallBallCollision', time: 100, ballB: { position: new Vec(102, 2), number: 1 } })
    };
    g.m_cUnitConverter = { getVisualXPosition: v => v, getVisualYPosition: v => v, getVisualSize: v => v };
    const lines = [];
    g._visualLine = { lineStyle() {}, circleStyle() {}, drawCircle() {}, drawLine: (...args) => lines.push(args) };
    s.call('apply', { length: 220, showSplit: true });
    g.drawGuideLessSharpAngle(0, .5);
    assert.equal(lines.length, 3);
    assert.deepEqual(lines[0], [0, 0, 100, 0]);
    for (const line of lines.slice(1)) {
        assert.ok(Math.abs(Math.hypot(line[2] - line[0], line[3] - line[1]) - 220) < 1e-8);
    }
    assert.ok(lines[1][3] < lines[1][1]);
    assert.ok(lines[2][3] > lines[2][1]);
    assert.equal(g._isOpenFuZhu, false);
    assert.equal(g._logicalBallPool.length, 2);
});
test('HTML loader waits for main.js, then installs the patch and its loaded badge', () => {
    const { spawnSync } = require('node:child_process');
    const script = `import sys; sys.stdout.reconfigure(encoding='utf-8'); import guide_extender as g; print(g.build_patch(b'<html><body><script src="manifest.json"></script></body></html>', {'length':220}).decode('utf-8'))`;
    const built = spawnSync('python', ['-c', script], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
    assert.equal(built.status, 0, built.stderr);
    const loader = built.stdout.match(/<script>\r?\n([\s\S]+?)\r?\n<\/script>/)[1];
    const s = fixture();
    const saved = s.VisualGuide;
    s.VisualGuide = undefined;
    const timers = [], badges = [];
    s.setTimeout = callback => timers.push(callback);
    s.console = { info() {}, error() {} };
    s.document.createElement = () => ({ style: {} });
    s.document.body = { appendChild: item => badges.push(item) };
    vm.runInContext(loader, s, { timeout: 2000 });
    assert.equal(timers.length, 1);
    s.VisualGuide = saved;
    timers.shift()();
    assert.equal(s.__poolGuideLoadResult.installed, true);
    assert.equal(badges[0].textContent, '辅助线 220');
});
