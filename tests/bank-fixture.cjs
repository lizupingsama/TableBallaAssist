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
    add(x, y) { this.x += x; this.y += y; }
    normalize() { if (this.length) this.scale(1 / this.length); }
    get length() { return Math.hypot(this.x, this.y); }
    set length(value) { this.scale(value / this.length); }
}

class Ball {
    constructor(number = 0, radius = 2, classification = 0) {
        this.init(number, radius, classification);
        this.position = new Vec();
        this.velocity = new Vec();
        this.spin = { x: 0, y: 0, z: 0, init(x, y, z) { Object.assign(this, { x, y, z }); } };
        this.state = 1;
        this.ballIndex = 0;
    }
    init(number, radius, classification) { Object.assign(this, { number, radius, classification }); }
    isMoving() { return this.velocity.length > 0; }
    isMovingOrSpinning() { return this.isMoving() || this.spin.x !== 0 || this.spin.y !== 0 || this.spin.z !== 0; }
    get onTable() { return this.state === 1 || this.state === 6; }
    move(dt) { this.position.add(this.velocity.x * dt, this.velocity.y * dt); this.modified = true; }
    stopMoving() { this.velocity.init(0, 0); this.spin.init(0, 0, 0); }
    rotate() {}
}
Object.assign(Ball, { nSTATE_IN_PLAY: 1, nSTATE_OFF_TABLE: 0, nSTATE_IN_POCKET_BEFORE: 6, nSTATE_IN_POCKET: 2, BALL_CLASSIFICATION_VIRTUAL: -2, BALL_BREAD_NUMBER: 28 });

function fixture(targets = [], pockets = [], options = {}) {
    const graphics = () => ({
        lines: [], circles: [],
        clear() { this.lines = []; this.circles = []; },
        lineStyle() {}, moveTo(x, y) { this.start = [x, y]; },
        lineTo(x, y) { this.lines.push([...this.start, x, y]); },
        drawCircle(...circle) { this.circles.push(circle); }
    });
    const sandbox = {
        Date,
        console, Math, isFinite, LogicalBall: Ball,
        BaseDef: { gameType: 0 }, GameType: { BALL_8: 1, RANK_BALL_8: 2, BALL_8_PRIVATE: 3 },
        egret: { HashObject: function () {}, EventDispatcher: function () {}, getTimer: () => Date.now(),
            Rectangle: function (x, y, width, height) { Object.assign(this, { left: x, top: y, right: x + width, bottom: y + height }); }, Sprite: function () {}, Matrix: function () {},
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
    if (options.physics) {
        const collisions = [];
        sandbox.pool = { ObjectPool: { instance: {
            getObj(name, args) { const item = collisions.pop(); if (item) { item.reset(...args); return item; } return new sandbox[name](...args); },
            pushObj(name, item) { collisions.push(item); }
        } } };
        vm.runInContext(fs.readFileSync(path.join(__dirname, 'physics-engine.fixture.js'), 'utf8'), sandbox);
        vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'bank_physics.js'), 'utf8'), sandbox);
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
        m_cTableProperties: { length: 400, width: 200, pockets: pockets.map(([x, y]) => ({ x, y })), pocketRadius: 8 }
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
    if (options.physics) {
        guide.visualCue = { power: 350, visible: true, setRotationRate() {},
            cueCanvas: { englishControl: { englishX: 0, englishY: 0 } } };
    }
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


module.exports = {fixture, Ball, Vec, assertBounds};
