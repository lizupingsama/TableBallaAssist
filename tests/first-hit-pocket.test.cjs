const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const hook = fs.readFileSync(path.join(__dirname, '..', 'guide.js'), 'utf8');

const {fixture} = require('./pocket-fixture.cjs');

test('missing switch defaults off and keeps original physical response', () => {
    const f = fixture();
    const original = f.s.Table.prototype.handleCollision;
    f.call('apply'); f.shoot(); f.collide();
    assert.equal(f.s.Table.prototype.handleCollision, original);
    assert.equal(f.balls[1].state, f.s.LogicalBall.nSTATE_IN_PLAY);
    assert.equal(f.balls[1].velocity.x, 200);
    assert.equal(f.pockets().length, 0);
});

test('actual Table.process detects contact and records exactly one target in the runner', () => {
    const f = fixture();
    f.apply();
    f.table.listeners[f.s.TableBallEvent.BALL_ENTERED_POCKET] = [event => {
        assert.equal(f.table.shotResults.ballCollisions.length, 1, 'first contact recorded before entry event');
        assert.equal(event.ball, f.balls[1]);
    }];
    f.shoot();
    f.table.process(.5);
    assert.equal(f.pockets().length, 1);
    assert.equal(f.pockets()[0].ball, f.balls[1]);
    assert.equal(f.pockets()[0].pocketIndex, 1, 'nearest pocket at collision');
    assert.equal(f.balls[1].state, f.s.LogicalBall.nSTATE_IN_BALL_RUNNER);
    assert.equal(f.balls[2].state, f.s.LogicalBall.nSTATE_IN_PLAY);
    assert.equal(f.balls[0].state, f.s.LogicalBall.nSTATE_IN_PLAY);
    assert.deepEqual(f.runnerBalls, [f.balls[1]]);
    assert.deepEqual(f.table.events.filter(e => e.ball).map(e => e.type), ['ballEnteredPocket', 'ballPocketed']);
    assert.equal(f.status().pocketHits, 1);
    assert.equal(f.status().pocketError, null);
    assert.doesNotThrow(() => JSON.stringify(f.status()));
});

test('later cue contacts in the same shot do not pocket another ball; next shot resets', () => {
    const f = fixture(); f.apply(); f.shoot(); f.collide(); f.collide(f.balls[0], f.balls[2]);
    assert.equal(f.pockets().length, 1);
    assert.equal(f.balls[2].state, f.s.LogicalBall.nSTATE_IN_PLAY);
    f.shoot(); f.collide(f.balls[0], f.balls[2]);
    assert.equal(f.pockets().length, 1, 'original takeShot clears previous results');
    assert.equal(f.pockets()[0].ball, f.balls[2]);
    assert.equal(f.status().pocketHits, 2);
});

test('cue may be either ball in the collision object', () => {
    const f = fixture(); f.apply(); f.shoot(); f.collide(f.balls[1], f.balls[0]);
    assert.equal(f.pockets()[0].ball, f.balls[1]);
});

test('target-to-target contact and cushions do not consume the cue first contact', () => {
    const f = fixture(); f.apply(); f.shoot();
    f.collide(f.balls[1], f.balls[2]);
    f.table.handleCollision(new f.s.BallLineCollision(f.balls[0], new f.s.Vector2(0, 0), new f.s.Vector2(400, 0), 0, 10));
    assert.equal(f.pockets().length, 0);
    f.collide();
    assert.equal(f.pockets().length, 1);
});

test('opponent, unknown owner, and push-ball shots keep their original results', () => {
    for (const owner of [1, undefined]) {
        const f = fixture(); f.apply(); f.table.shotPlayerLocalIndex = owner; f.shoot(); f.collide();
        assert.equal(f.pockets().length, 0);
    }
    const f = fixture(); f.apply(); f.table._isTuiQiu = true; f.shoot(); f.collide();
    assert.equal(f.pockets().length, 0);
});

test('prediction queries and an inherited table shadow do not trigger entry', () => {
    const f = fixture(); f.apply(); f.shoot();
    f.table.findFirstCollisionBall(f.balls[0], 1);
    const shadow = Object.create(f.table);
    shadow.handleCollision(new f.s.BallBallCollision(f.balls[0], f.balls[1], 0, 100));
    assert.equal(f.pockets().length, 0);
    f.collide(); assert.equal(f.pockets().length, 1);
});

test('collision with a ball outside the live table does not arm a fake entry', () => {
    const f = fixture(); f.apply(); f.shoot();
    const virtual = new f.s.LogicalBall(9, 2, f.s.LogicalBall.BALL_CLASSIFICATION_VIRTUAL, 60, 80);
    f.collide(f.balls[0], virtual);
    assert.equal(f.pockets().length, 0);
    f.collide(); assert.equal(f.pockets().length, 1);
});

test('switch off before contact stops entry and does not redirect the next contact', () => {
    const f = fixture(); f.apply(); f.shoot();
    f.apply({ firstHitPocket: false }); f.collide();
    f.apply(); f.collide(f.balls[0], f.balls[2]);
    assert.equal(f.pockets().length, 0);
    f.shoot(); f.collide(f.balls[0], f.balls[2]); assert.equal(f.pockets().length, 1);
});

test('enabling during an already running shot waits until the next shot', () => {
    const f = fixture(); f.call('apply'); f.shoot(); f.apply(); f.collide();
    assert.equal(f.pockets().length, 0);
    f.shoot(); f.collide(); assert.equal(f.pockets().length, 1);
});

test('reapply does not stack hooks; restore returns original gameplay functions', () => {
    const f = fixture();
    const originalCollision = f.s.Table.prototype.handleCollision;
    const originalShot = f.s.Table.prototype.takeShot;
    f.apply(); const installed = f.s.Table.prototype.handleCollision;
    f.apply({ bankPrediction: true });
    assert.equal(f.s.Table.prototype.handleCollision, installed);
    f.call('restore');
    assert.equal(f.s.Table.prototype.handleCollision, originalCollision);
    assert.equal(f.s.Table.prototype.takeShot, originalShot);
    f.shoot(); f.collide(); assert.equal(f.pockets().length, 0);
});

test('restoring and reinstalling cannot use an old armed shot', () => {
    const f = fixture(); f.apply(); f.shoot(); f.call('restore'); f.apply(); f.collide();
    assert.equal(f.pockets().length, 0);
});

test('missing pockets fall back to original physics with no extra entry', () => {
    const f = fixture(); f.apply(); f.table.m_cTableProperties.pockets = [];
    f.shoot(); assert.doesNotThrow(() => f.collide());
    assert.equal(f.balls[1].state, f.s.LogicalBall.nSTATE_IN_PLAY);
    assert.equal(f.balls[1].velocity.x, 200);
    assert.equal(f.pockets().length, 0);
    assert.match(f.status().pocketError, /No valid pocket/);
});

test('unsupported game API rejects the enabled option before any hook changes', () => {
    const f = fixture(); f.s.BallPocketCollision = undefined;
    const original = f.s.Table.prototype.handleCollision;
    const result = f.apply();
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'unsupported-first-hit-pocket-api');
    assert.equal(f.s.__poolGuideExtender, undefined);
    assert.equal(f.s.Table.prototype.handleCollision, original);
    assert.equal(f.call('apply').ok, true, 'guide-only option remains supported');
});

test('no runner mode removes the ball from table; ball identity and classification stay original', () => {
    const f = fixture(); f.apply(); f.table.isBallRunnerAni = false;
    f.balls[1].init(8, 2, 8);
    f.shoot(); f.collide();
    assert.equal(f.balls[1].state, f.s.LogicalBall.nSTATE_OFF_TABLE);
    assert.equal(f.pockets()[0].ball.number, 8);
    assert.equal(f.pockets()[0].ball.classification, 8);
    assert.equal(f.table.shotResults.ballCollisions[0].ballB, f.balls[1]);
    assert.equal(f.runnerBalls.length, 0);
});

test('packaged HTML loader enables the feature and labels it only after hooks install', () => {
    const { spawnSync } = require('node:child_process');
    const built = spawnSync('python', ['-c', `import sys; sys.stdout.reconfigure(encoding='utf-8'); import guide_extender as g; print(g.build_patch(b'<html><body><script src="manifest.json"></script></body></html>', {'firstHitPocket':True}).decode('utf-8'))`],
        { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
    assert.equal(built.status, 0, built.stderr);
    const loader = built.stdout.match(/<script>\r?\n([\s\S]+?)\r?\n<\/script>/)[1];
    for (const supported of [true, false]) {
        const f = fixture();
        if (!supported) { f.s.BallPocketCollision = undefined; }
        const badges = [];
        f.s.document.createElement = () => ({ style: {} });
        f.s.document.body = { appendChild: item => badges.push(item) };
        f.s.console = { info() {}, error() {} };
        vm.runInContext(loader, f.s);
        assert.equal(f.s.__poolGuideLoadResult.ok, supported);
        assert.equal(badges.length, supported ? 1 : 0);
        if (supported) {
            assert.equal(f.s.__poolGuideLoadResult.firstHitPocketReady, true);
            assert.match(badges[0].textContent, /首碰必进/);
        }
        f.shoot(); f.collide();
        assert.equal(f.pockets().length, supported ? 1 : 0);
    }
});
