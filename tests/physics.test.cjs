const { test } = require('node:test');
const assert = require('node:assert/strict');
const {fixture} = require('./bank-fixture.cjs');

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
    f.guide.visualCue.cueCanvas.englishControl.englishY = -1;
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
    f.guide.visualCue.cueCanvas.englishControl.englishY = 1;
    const plan = calculate(f);
    assert.ok(plan.contact);
    assert.ok(plan.cue.some(line => line[0] > 130 && line[2] < line[0] - .01));
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
    f.guide.visualCue.cueCanvas.englishControl.englishX = .4;
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
