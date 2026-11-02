const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {fixture, Vec} = require('./bank-fixture.cjs');

function physics(targets = [], pockets = []) {
    const f = fixture(targets, pockets, {physics: true});
    f.s.PoolMath.CUE_PROPERTIES_MAX_POWER = 800;
    f.guide.visualCue.power = 800;
    return f;
}

function calculate(f, angle = 0) {
    if (f.guide.__poolGuidePhysicsPreview) f.guide.__poolGuidePhysicsPreview.at = 0;
    const plan = f.draw(angle);
    assert.equal(plan.model, 'game-physics', f.s.__poolGuideExtender.physicsError);
    return plan;
}

test('the game trial engine includes follow after a head-on hit instead of freezing the cue', () => {
    const f = physics([[140, 80]]);
    f.guide._gameView.poolCanvas.englishControl.englishY = -1;
    const before = JSON.stringify(f.balls);
    const plan = calculate(f);
    assert.ok(plan.contact);
    assert.ok(plan.cue.some(line => line[0] >= plan.contact.x - .001 && line[2] > line[0] + .001));
    assert.equal(plan.shot.englishY, -1);
    assert.equal(plan.shot.power, 800);
    assert.equal(JSON.stringify(f.balls), before);
});

test('backspin makes the cue draw backwards after a head-on hit', () => {
    const f = physics([[140, 80]]);
    f.guide._gameView.poolCanvas.englishControl.englishY = 1;
    const plan = calculate(f);
    assert.ok(plan.contact);
    assert.ok(plan.cue.some(line => line[0] > 130 && line[2] < line[0] - .01));
});

test('manual EnglishControl input is read from the same PoolCanvas as a real shot', () => {
    const f = physics([[140, 80]]);
    f.s.Vector2 = Vec;
    f.s.egret.Event = function (type) { this.type = type; };
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'english-control.fixture.js'), 'utf8'), f.s);
    const control = Object.create(f.s.EnglishControl.prototype);
    Object.assign(control, {VISUAL_RADIUS: 20, m_cCrossComponent: {x: 0, y: 0},
        m_nEnglishX: 0, m_nEnglishY: 0, dispatchEvent() {}});
    f.guide._gameView.poolCanvas.englishControl = control;
    assert.equal(f.guide.visualCue.cueCanvas.englishControl, undefined, 'actual cueCanvas is a drawing container');
    const before = JSON.stringify(f.balls);
    control.setEnglishFromUserInput(0, 20);
    const back = calculate(f);
    assert.equal(back.shot.englishY, 1);
    assert.ok(back.cue.some(line => line[0] > 130 && line[2] < line[0] - .01));
    control.setEnglishFromUserInput(0, -20);
    const follow = calculate(f);
    assert.equal(follow.shot.englishY, -1);
    assert.ok(follow.cue.some(line => line[0] >= follow.contact.x - .001 && line[2] > line[0] + .001));
    assert.equal(JSON.stringify(f.balls), before);
});

test('spin changes invalidate the cached trajectory even inside its 60ms throttle window', () => {
    const f = physics([[140, 80]]);
    f.s.Date = {now: () => 10000};
    const control = f.guide._gameView.poolCanvas.englishControl;
    control.englishY = 1;
    const back = f.draw();
    const retained = f.guide.__poolGuidePhysicsPreview.plan;
    control.englishY = -1;
    const follow = f.draw();
    assert.notEqual(f.guide.__poolGuidePhysicsPreview.plan, retained);
    assert.equal(back.shot.englishY, 1);
    assert.equal(follow.shot.englishY, -1);
    assert.notDeepEqual(back.cue, follow.cue);
    assert.equal(f.guide.__poolGuidePhysicsPreview.at, 10000);
});

test('left and right side spin change the post-cushion trajectory', () => {
    const f = physics();
    const control = f.guide._gameView.poolCanvas.englishControl;
    control.englishX = -.8;
    const left = calculate(f, .25);
    control.englishX = .8;
    const right = calculate(f, .25);
    assert.equal(left.shot.englishX, -.8);
    assert.equal(right.shot.englishX, .8);
    assert.ok(left.cueBanks > 0 && right.cueBanks > 0);
    assert.notDeepEqual(left.cue, right.cue);
});

test('real PoolCanvas control overrides a stale drawing-container value and cue owner is a fallback', () => {
    const f = physics();
    f.guide.visualCue.cueCanvas.englishControl = {englishX: 0, englishY: 0};
    f.guide._gameView.poolCanvas.englishControl = {englishX: .35, englishY: -.7};
    assert.equal(f.s.__poolGuidePhysics.inputs(f.guide, .1).englishY, -.7);
    f.guide.visualCue._gameView = f.guide._gameView;
    f.guide._gameView = {};
    const shot = f.s.__poolGuidePhysics.inputs(f.guide, .1);
    assert.equal(shot.englishX, .35);
    assert.equal(shot.englishY, -.7);
});

test('actual pull power changes the trial path: a soft shot stops short and a strong shot reaches the object', () => {
    const f = physics([[140, 80]]);
    f.guide.visualCue.power = 15;
    const soft = calculate(f);
    assert.equal(soft.contact, null);
    f.guide.visualCue.power = 800;
    const strong = calculate(f);
    assert.ok(strong.contact);
    assert.notEqual(soft.cue[soft.cue.length - 1][2], strong.cue[strong.cue.length - 1][2]);
});

test('only the unpulled cue uses full power; a pulled cue uses actual power and live english', () => {
    const f = physics();
    f.guide.visualCue.power = 0;
    const idle = calculate(f, .3);
    assert.equal(idle.shot.estimated, true);
    assert.equal(idle.shot.mode, 'full-power-preview');
    assert.equal(idle.shot.power, 800);
    f.guide.visualCue.power = 270;
    f.guide._gameView.poolCanvas.englishControl.englishX = .4;
    const aimed = calculate(f, .3);
    assert.equal(aimed.shot.estimated, false);
    assert.equal(aimed.shot.power, 270);
    assert.equal(aimed.shot.mode, 'current-power');
    assert.equal(aimed.shot.englishX, .4);
});

test('configurable bank counts constrain both paths and preserve the active hooks', () => {
    const f = physics([[140, 82]]);
    const state = f.s.__poolGuideExtender;
    const wrapper = f.guide.drawGuideLessSharpAngle;
    for (const count of [1, 2, 4, 6]) {
        state.configureBanks(true, count);
        const plan = calculate(f);
        assert.ok(plan.cueBanks <= count);
        assert.ok(plan.targetBanks <= count);
        assert.equal(state.settings.bankCount, count);
        assert.equal(f.guide.drawGuideLessSharpAngle, wrapper);
    }
    assert.throws(() => state.configureBanks(true, 0));
    assert.throws(() => state.configureBanks(true, 2.5));
    assert.throws(() => state.configureBanks(true, 7));
});

test('cached rendering retains the real target association after repeated redraws', () => {
    const f = physics([[140, 80]]);
    calculate(f);
    f.guide._hitBall = null;
    f.draw();
    assert.equal(f.guide._hitBall, f.balls[1]);
});

test('the existing first-hit pocket option removes only the cloned target from the forecast', () => {
    const f = physics([[140, 80]]);
    f.s.__poolGuideExtender.settings.firstHitPocket = true;
    const before = JSON.stringify(f.balls);
    const plan = calculate(f);
    assert.ok(plan.contact);
    assert.equal(plan.target.length, 0);
    assert.ok(plan.pocketStops >= 1);
    assert.equal(JSON.stringify(f.balls), before);
});

test('bulk pocket selection uses the shared read-only policy and leaves the real balls and black eight intact', () => {
    const f = physics([[140, 80, 1], [240, 120, 2], [350, 80, 8]]);
    f.s.BaseDef.gameType = f.s.GameType.BALL_8;
    f.s.__poolGuideExtender.settings.eightBallAllButBlack = true;
    const before = JSON.stringify(f.balls);
    const plan = calculate(f);
    assert.ok(plan.contact);
    assert.equal(plan.target.length, 0);
    assert.ok(plan.pocketStops >= 2);
    const clones = f.guide.__poolGuidePhysicsPreview.sim.m_cBalls;
    assert.equal(clones[1].state, f.s.LogicalBall.nSTATE_OFF_TABLE);
    assert.equal(clones[2].state, f.s.LogicalBall.nSTATE_OFF_TABLE);
    assert.equal(clones[3].state, f.s.LogicalBall.nSTATE_IN_PLAY);
    assert.equal(JSON.stringify(f.balls), before);
});

function geometry(plan) {
    const copy = JSON.parse(JSON.stringify(plan));
    delete copy.elapsedMs;
    return copy;
}

function longRollingShot() {
    const f = physics();
    f.s.PoolMath.CUE_PROPERTIES_MAX_POWER = 350;
    f.guide.visualCue.power = 350;
    f.guide._gameView.poolCanvas.englishControl.englishY = -1;
    f.table.m_cTableShape = [new Vec(0, 0), new Vec(20000, 0), new Vec(20000, 10000), new Vec(0, 10000)];
    f.table.m_cTableCollisionBounds = {left: 0, right: 20000, top: 0, bottom: 10000};
    Object.assign(f.table.m_cTableProperties, {length: 20000, width: 10000});
    return f;
}

test('CPU load does not clip or cache a shorter high-power trajectory', () => {
    const fast = physics([[140, 82]]);
    const slow = physics([[140, 82]]);
    for (const f of [fast, slow]) {
        f.s.__poolGuideExtender.configureBanks(true, 6);
        f.guide._gameView.poolCanvas.englishControl.englishY = -1;
    }
    fast.s.Date = {now: () => 10000};
    let clock = 10000;
    slow.s.Date = {now: () => (clock += 50)};
    const expected = geometry(fast.draw(.2));
    const actual = geometry(slow.draw(.2));
    assert.equal(actual.truncated, false);
    assert.deepEqual(actual, expected);
    assert.deepEqual(geometry(slow.draw(.2)), expected, 'the cached endpoint stays complete');
});

test('a rolling shot lasting over twenty simulated seconds reaches its actual stop', () => {
    const f = longRollingShot();
    let steps = 0;
    const process = f.s.TableTest.prototype.process;
    f.s.TableTest.prototype.process = function (dt) { steps++; return process.call(this, dt); };
    f.s.Date = {now: () => 10000};
    const plan = f.draw(.1);
    assert.ok(steps > 2000, 'this shot must exceed the old twenty-second limit');
    assert.equal(plan.truncated, false);
    assert.equal(f.guide.__poolGuidePhysicsPreview.sim.m_cBalls[0].velocity.length, 0);
    assert.ok(plan.cue.at(-1)[2] > 5600, 'the final deceleration segment is retained');
});

test('small increases in power extend a full rolling trajectory continuously under varying CPU load', () => {
    const f = longRollingShot();
    let clock = 10000;
    f.s.Date = {now: () => (clock += clock % 3 ? 1 : 50)};
    let lastLength = null;
    for (let power = 340; power <= 350; power++) {
        f.guide.visualCue.power = power;
        const plan = f.draw(.1);
        assert.equal(plan.truncated, false);
        const length = plan.cue.reduce((total, line) => total + Math.hypot(line[2] - line[0], line[3] - line[1]), 0);
        if (lastLength !== null) {
            assert.ok(length > lastLength);
            assert.ok(length - lastLength < 33, 'one power unit must not produce a large endpoint jump');
        }
        lastLength = length;
    }
});

test('pure side spin ends the forecast once translation stops without waiting for spin decay', () => {
    const f = longRollingShot();
    f.cue.radius = .2;
    f.guide._gameView.poolCanvas.englishControl.englishX = 1;
    f.guide._gameView.poolCanvas.englishControl.englishY = 0;
    f.s.Date = {now: () => 10000};
    const plan = f.draw(.2);
    const ball = f.guide.__poolGuidePhysicsPreview.sim.m_cBalls[0];
    assert.equal(plan.truncated, false);
    assert.equal(ball.velocity.length, 0);
    assert.ok(ball.spin.x === 0);
    assert.ok(ball.spin.y === 0);
    assert.ok(ball.spin.z > 0, 'remaining vertical-axis spin has no path to draw');
});

test('zero translation with remaining draw spin still resumes the cue path', () => {
    const f = physics([[140, 80]]);
    f.guide._gameView.poolCanvas.englishControl.englishY = 1;
    let stoppedWithDraw = false;
    const process = f.s.TableTest.prototype.process;
    f.s.TableTest.prototype.process = function (dt) {
        const result = process.call(this, dt);
        const data = this.__preview;
        if (data.plan.contact && !stoppedWithDraw) {
            data.cue.ball.velocity.init(0, 0);
            assert.ok(data.cue.ball.spin.x !== 0 || data.cue.ball.spin.y !== 0);
            stoppedWithDraw = true;
        }
        return result;
    };
    const plan = f.draw();
    assert.ok(stoppedWithDraw);
    assert.ok(plan.cue.some(line => line[0] > 130 && line[2] < line[0] - .01));
});
