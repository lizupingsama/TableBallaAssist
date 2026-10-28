const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const hook = fs.readFileSync(path.join(__dirname, '..', 'guide.js'), 'utf8');

class Vec {
    constructor(x = 0, y = 0) { this.init(x, y); }
    init(x, y) { this.x = x; this.y = y; }
    rotate(a) { const x = this.x; this.x = x * Math.cos(a) - this.y * Math.sin(a); this.y = x * Math.sin(a) + this.y * Math.cos(a); }
    scale(k) { this.x *= k; this.y *= k; }
    normalize() { if (this.length) this.scale(1 / this.length); }
    get length() { return Math.hypot(this.x, this.y); }
    set length(value) { this.scale(value / this.length); }
}

class Ball {
    constructor(number = 0, radius = 2, classification = 0) {
        this.init(number, radius, classification);
        this.position = new Vec();
        this.velocity = new Vec();
        this.spin = { x: 0, y: 0, z: 0 };
        this.state = 1;
        this.ballIndex = 0;
    }
    init(number, radius, classification) { Object.assign(this, { number, radius, classification }); }
    isMoving() { return this.velocity.length > 0; }
}
Object.assign(Ball, { nSTATE_IN_PLAY: 1, nSTATE_OFF_TABLE: 0, BALL_CLASSIFICATION_VIRTUAL: -2, BALL_BREAD_NUMBER: 28 });

function fixture(targets = [], pockets = []) {
    const graphics = () => ({
        lines: [], circles: [],
        clear() { this.lines = []; this.circles = []; },
        lineStyle() {}, moveTo(x, y) { this.start = [x, y]; },
        lineTo(x, y) { this.lines.push([...this.start, x, y]); },
        drawCircle(...circle) { this.circles.push(circle); }
    });
    const sandbox = {
        console, Math, isFinite, LogicalBall: Ball,
        BaseDef: { gameType: 0 }, GameType: { BALL_8: 1, RANK_BALL_8: 2, BALL_8_PRIVATE: 3 },
        egret: { HashObject: function () {}, Sprite: function () {}, Matrix: function () {},
            Event: { REMOVED_FROM_STAGE: 'removedFromStage' },
            Shape: function () { this.graphics = graphics(); },
            is: (object, name) => object && object.__gameClass === name,
            MainContext: { instance: { stage: { $children: [] } } } },
        __extends(derived, base) { derived.prototype = Object.create(base.prototype); derived.prototype.constructor = derived; },
        __reflect(prototype, name) { prototype.__gameClass = name; }
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    for (const file of ['collision.fixture.js', 'visual-guides.fixture.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), sandbox);
    }
    const cue = new Ball(0);
    cue.position.init(40, 80);
    const balls = [cue, ...targets.map(([x, y, number = 1]) => {
        const ball = new Ball(number);
        ball.position.init(x, y);
        return ball;
    })];
    const table = new sandbox.BankTestTable();
    Object.assign(table, {
        cueBall: cue, m_cBalls: balls,
        m_cTableShape: [new Vec(0, 0), new Vec(400, 0), new Vec(400, 200), new Vec(0, 200)],
        m_cTableCollisionBounds: { left: 0, right: 400, top: 0, bottom: 200 },
        m_cTableProperties: { pockets: pockets.map(([x, y]) => ({ x, y })), pocketRadius: 8 }
    });
    const guide = Object.create(sandbox.VisualGuide.prototype);
    Object.assign(guide, {
        m_cTable: table, _setTargetBallNum: -1, m_nLegalContactClass: 0,
        _isOpenFuZhu: false, _logicalBallPool: [], _lineColor: 0xffffff, lineSize: 2,
        _gameView: { isMainPlayerOperation: () => true },
        m_cUnitConverter: { getVisualXPosition: v => v, getVisualYPosition: v => v, getVisualSize: v => v },
        _visualLine: { lines: [], lineStyle() {}, circleStyle() {}, drawCircle() {}, drawLine(...line) { this.lines.push(line); } },
        children: [], addChild(child) { child.parent = this; this.children.push(child); },
        removeChild(child) { child.parent = null; this.children = this.children.filter(item => item !== child); },
        listeners: {}, addEventListener(event, listener) { this.listeners[event] = listener; },
        removeEventListener(event, listener) { if (this.listeners[event] === listener) delete this.listeners[event]; }
    });
    sandbox.call = (settings = {}) => {
        sandbox.__poolGuideRequest = { action: 'apply', settings: { bankPrediction: true, showSplit: true, ...settings } };
        return vm.runInContext(hook, sandbox);
    };
    sandbox.call();
    return { s: sandbox, guide, table, cue, balls,
        draw(angle = 0, method = 'drawGuideLessSharpAngle') {
            guide[method](angle, .5);
            assert.equal(sandbox.__poolGuideExtender.bankError, null);
            return sandbox.__poolGuideExtender.lastPrediction;
        }
    };
}

function assertBounds(lines) {
    for (const line of lines) {
        for (let i = 0; i < 4; i++) {
            assert.ok(Number.isFinite(line[i]));
            assert.ok(line[i] >= 2 - 1e-7 && line[i] <= (i % 2 ? 198 : 398) + 1e-7, String(line));
        }
    }
}

test('cue follows three cushions using the extracted game response; real balls stay unchanged', () => {
    const f = fixture();
    const before = JSON.stringify(f.balls);
    const plan = f.draw(.19);
    assert.equal(plan.cueBanks, 3);
    assert.equal(plan.cue.length, 4);
    assert.equal(plan.target.length, 0);
    assertBounds(plan.cue);
    const incoming = new Ball(0);
    incoming.velocity.init(Math.cos(.19), Math.sin(.19));
    f.s.PoolMath.ballLineCollision(incoming, -Math.PI / 2);
    const next = plan.cue[1];
    const cross = (next[2] - next[0]) * incoming.velocity.y - (next[3] - next[1]) * incoming.velocity.x;
    assert.ok(Math.abs(cross) < 1e-7);
    assert.equal(JSON.stringify(f.balls), before);
});

test('a cut shot traces both outgoing balls and ignores the vacated cue/target positions', () => {
    const f = fixture([[140, 82]]);
    const before = JSON.stringify(f.balls);
    const plan = f.draw();
    assert.ok(Math.abs(plan.contact.x - (140 - Math.sqrt(12))) < 1e-7);
    assert.equal(plan.cueBanks, 3);
    assert.equal(plan.targetBanks, 3);
    assert.equal(plan.cue.length, 5);
    assert.equal(plan.target.length, 4);
    assertBounds([...plan.cue, ...plan.target]);
    assert.equal(JSON.stringify(f.balls), before);
    assert.equal(f.guide._hitBall, f.balls[1]);
    assert.equal(f.guide._isOpenFuZhu, false);
});

test('target path stops at the next ball instead of passing through or simulating another split', () => {
    const f = fixture([[140, 80], [240, 80]]);
    const plan = f.draw();
    assert.equal(plan.targetBanks, 0);
    assert.equal(plan.target.length, 1);
    assert.ok(Math.abs(plan.target[0][2] - 236) < 1e-7);
    assert.equal(plan.cue.length, 1); // Head-on impact leaves the cue at rest.
});

test('pocket entry terminates the cue preview before the far cushion', () => {
    const f = fixture([], [[400, 80]]);
    const plan = f.draw();
    assert.equal(plan.pocketStops, 1);
    assert.equal(plan.cueBanks, 0);
    assert.equal(plan.cue.length, 1);
    assert.ok(Math.abs(plan.cue[0][2] - 392) < 1e-7);
});

test('banked first contact still splits into cue and object paths', () => {
    const f = fixture([[200, 130]]);
    // First contact with the top cushion, then the target placed on the reflected ray.
    f.cue.position.init(40, 30);
    const angle = -.45;
    const start = new Ball(0);
    start.position.init(40, 30);
    start.velocity.init(Math.cos(angle), Math.sin(angle));
    const hit = f.table.findFirstCollisionBall(start, 10000);
    start.position.x += start.velocity.x * hit.time;
    start.position.y += start.velocity.y * hit.time;
    f.s.PoolMath.ballLineCollision(start, hit.theta);
    f.balls[1].position.init(start.position.x + start.velocity.x * 90, start.position.y + start.velocity.y * 90 + 1);
    const plan = f.draw(angle);
    assert.ok(plan.contact);
    assert.equal(plan.cueBanks, 3);
    assert.ok(plan.target.length > 0);
});

test('foul first contact ends the preview and preserves the foul marker', () => {
    const f = fixture([[140, 80]]);
    f.guide.m_bBadContactEnabled = true;
    f.guide.m_nLegalContactClass = 99;
    const plan = f.draw();
    assert.equal(plan.foul, true);
    assert.equal(plan.target.length, 0);
    assert.equal(f.guide.children[0].graphics.circles.length, 1);
});

test('split toggle is respected and the skin branch supports bank lines', () => {
    const f = fixture([[140, 82]]);
    f.s.call({ showSplit: false });
    const plan = f.draw(0, 'drawGuideLessSharpAngle2');
    assert.ok(plan.contact);
    assert.equal(plan.target.length, 0);
    assert.equal(f.guide._isOpenFuZhu, false);
});

test('disabling banks restores straight rendering; restore removes the added overlay and hooks', () => {
    const f = fixture([[140, 82]]);
    f.draw();
    const shape = f.guide.children[0];
    assert.ok(shape.graphics.lines.length > 0);
    f.s.call({ bankPrediction: false });
    f.guide.drawGuideLessSharpAngle(0, .5);
    assert.equal(shape.visible, false);
    assert.equal(shape.graphics.lines.length, 0);
    assert.equal(f.guide._visualLine.lines.length, 3);
    f.s.__poolGuideRequest = { action: 'restore' };
    vm.runInContext(hook, f.s);
    assert.equal(f.guide.children.length, 0);
    assert.equal(f.s.__poolGuideExtender, undefined);
});

test('prediction exceptions fall back to original drawing without changing real balls', () => {
    const f = fixture();
    const before = JSON.stringify(f.balls);
    f.s.PoolMath.ballLineCollision = () => { throw Error('physics unavailable'); };
    f.guide.drawGuideLessSharpAngle(.2, .5);
    assert.match(f.s.__poolGuideExtender.bankError, /physics unavailable/);
    assert.equal(f.guide._visualLine.lines.length, 1);
    assert.equal(JSON.stringify(f.balls), before);
    assert.equal(f.guide._isOpenFuZhu, false);
});

test('cardinal and near-corner angles produce finite bounded paths with a strict bank limit', () => {
    const f = fixture();
    const before = JSON.stringify(f.balls);
    for (let degrees = 0; degrees < 360; degrees += 3) {
        const plan = f.draw(degrees * Math.PI / 180);
        assert.ok(plan.cueBanks <= 3);
        assert.ok(plan.cue.length <= 4);
        assertBounds(plan.cue);
    }
    assert.equal(JSON.stringify(f.balls), before);
    assert.equal(f.guide.children.length, 1); // Reuse the overlay across redraws.
});

test('a pocket jaw point terminates the path without applying a cushion reflection', () => {
    const f = fixture();
    f.table.findFirstCollisionBall = ball => new f.s.BallPointCollision(ball, new Vec(101, 80), 59, 1);
    const plan = f.draw();
    assert.equal(plan.cueBanks, 0);
    assert.equal(plan.cue.length, 1);
    assert.equal(plan.cue[0][2], 99);
});

test('spectator drawing continues to use the untouched game path with banks enabled', () => {
    const f = fixture();
    f.guide._isGuanZhan = true;
    f.guide.drawGuideLessSharpAngle(0, .5);
    assert.equal(f.guide._visualLine.lines.length, 1);
    assert.equal(f.guide.children.length, 0);
});

test('leaving the table releases the prediction overlay and its scene references', () => {
    const f = fixture();
    f.draw();
    assert.equal(f.s.__poolGuideExtender.overlays.length, 1);
    f.guide.listeners.removedFromStage();
    assert.equal(f.s.__poolGuideExtender.overlays.length, 0);
    assert.equal(f.guide.children.length, 0);
    assert.equal(f.guide.listeners.removedFromStage, undefined);
    f.draw();
    assert.equal(f.guide.children.length, 1);
});
