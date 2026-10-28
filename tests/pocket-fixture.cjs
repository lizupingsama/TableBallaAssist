const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const hook = fs.readFileSync(path.join(__dirname, '..', 'guide.js'), 'utf8');

function fixture() {
    function Event(type) { this.type = type; }
    function Dispatcher() { this.events = []; this.listeners = {}; }
    Dispatcher.prototype.dispatchEvent = function (event) {
        this.events.push(event);
        for (const listener of this.listeners[event.type] || []) { listener(event); }
    };
    Dispatcher.prototype.dispatchEventWith = function (type) { this.dispatchEvent(new Event(type)); };
    function Guide() {}
    Guide.calculateGuideLength = speed => 42.5 * speed;
    Guide.prototype.drawGuideLessSharpAngle = function () {};
    const s = {
        console, Math, isFinite, document: { title: 'physics test' },
        egret: { Event, EventDispatcher: Dispatcher, HashObject: function () {},
            getTimer: () => 1000, is: (value, name) => value && value.__gameClass === name,
            MainContext: { instance: { stage: { $children: [] } } } },
        __extends(derived, base) { derived.prototype = Object.create(base.prototype); derived.prototype.constructor = derived; },
        __reflect(proto, name) { proto.__gameClass = name; },
        VisualGuide: Guide, BaseDef: { gameType: 10, isSnk: false },
        GameType: { BALL_8: 10, LEVEL_MODE: 20, LUCK_SHOOT: 30 }
    };
    s.window = s;
    vm.createContext(s);
    for (const name of ['collision.fixture.js', 'first-hit-game.fixture.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname, name), 'utf8'), s);
    }
    s.BaseDef.gameType = s.GameType.BALL_8;
    const balls = [0, 1, 2].map((number, index) => {
        const ball = new s.LogicalBall(number, 2, number === 0 ? 0 : 1, 40 + index * 80, 80);
        ball.ballIndex = index;
        ball.state = s.LogicalBall.nSTATE_IN_PLAY;
        return ball;
    });
    const table = Object.create(s.Table.prototype);
    Dispatcher.call(table);
    const runnerBalls = [];
    Object.assign(table, {
        m_cBalls: balls, shotPlayerLocalIndex: 0, _isLevelGame: false, _isTuiQiu: false,
        m_cShotResults: new s.ShotResults(),
        m_cBallBallCollision: new s.TableCollisionEvent(s.TableCollisionEvent.BALL_BALL_COLLISION),
        m_cBallCushionCollision: new s.TableCollisionEvent(s.TableCollisionEvent.BALL_CUSHION_COLLISION),
        m_cTableProperties: { pockets: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 400, y: 200 }], pocketRadius: 8 },
        m_cTableShape: [new s.Vector2(0, 0), new s.Vector2(400, 0), new s.Vector2(400, 200), new s.Vector2(0, 200)],
        m_cTableCollisionBounds: { left: 0, right: 400, top: 0, bottom: 200 },
        HELP_VECTOR2: new s.Vector2(), isBallRunnerAni: true, _ballNotMoveTime: 0,
        m_cAnimator: { animating: false, start() { this.animating = true; }, stop() { this.animating = false; } },
        m_cBallRunner: { addBall(ball) {
            runnerBalls.push(ball);
            ball.stopMoving();
            ball.state = s.LogicalBall.nSTATE_IN_BALL_RUNNER;
        } }
    });
    function call(action, settings = {}) {
        s.__poolGuideRequest = { action, settings };
        return vm.runInContext(hook, s);
    }
    function collide(a = balls[0], b = balls[1]) {
        return table.handleCollision(new s.BallBallCollision(a, b, 0, 100));
    }
    return { s, table, balls, runnerBalls, call, collide,
        apply: settings => call('apply', { firstHitPocket: true, ...settings }),
        shoot: () => table.takeShot(200, 0, 0, 0),
        pockets: () => table.shotResults.pocketCollisions,
        status: () => call('status') };
}

module.exports = {fixture};
