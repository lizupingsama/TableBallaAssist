const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {fixture} = require('./pocket-fixture.cjs');

function addBall(f, number, classification) {
    const ball = new f.s.LogicalBall(number, 2, classification, 100 + f.balls.length * 6, 80);
    ball.ballIndex = f.balls.length;
    ball.state = f.s.LogicalBall.nSTATE_IN_PLAY;
    f.balls.push(ball);
    return ball;
}

function snooker() {
    const f = fixture();
    f.s.BaseDef.gameType = f.s.GameType.SNK;
    f.s.BaseDef.isSnk = true;
    f.balls.splice(1);
    f.reds = Array.from({length: 15}, () => addBall(f, 1, 1));
    f.colors = [2, 3, 4, 5, 6, 7].map(number => addBall(f, number, 2));
    return f;
}

function eight() {
    const f = fixture();
    f.balls.splice(1);
    for (let number = 1; number <= 15; number++) {
        addBall(f, number, number === 8 ? 3 : number < 8 ? 1 : 2);
    }
    f.black = f.balls.find(ball => ball.number === 8);
    return f;
}

test('snooker red contact pots all 15 distinct red objects once and leaves all colors and cue', () => {
    const f = snooker(); f.call('apply', {snookerAllReds: true}); f.shoot(); f.collide();
    assert.equal(f.pockets().length, 15);
    assert.equal(new Set(f.pockets().map(hit => hit.ball)).size, 15, 'repeated red number 1 must not deduplicate');
    assert.equal(f.runnerBalls.length, 15);
    assert.ok(f.reds.every(ball => ball.state === f.s.LogicalBall.nSTATE_IN_BALL_RUNNER));
    assert.ok(f.colors.every(ball => ball.state === f.s.LogicalBall.nSTATE_IN_PLAY));
    assert.equal(f.balls[0].state, f.s.LogicalBall.nSTATE_IN_PLAY);
    assert.equal(f.table.shotResults.ballCollisions[0].ballB, f.reds[0]);
    assert.equal(f.status().pocketHits, 15);
});

test('snooker colored-ball contact does not sweep; a later cue-red contact triggers it', () => {
    const f = snooker(); f.call('apply', {snookerAllReds: true, firstHitPocket: true}); f.shoot();
    f.collide(f.balls[0], f.colors[0]);
    assert.equal(f.pockets().length, 0, 'snooker sweep has priority over the single-ball option');
    f.collide(f.balls[0], f.reds[0]);
    assert.equal(f.pockets().length, 15);
    assert.ok(f.colors.every(ball => ball.state === f.s.LogicalBall.nSTATE_IN_PLAY));
});

test('red-to-red collision alone does not trigger a snooker sweep', () => {
    const f = snooker(); f.call('apply', {snookerAllReds: true}); f.shoot();
    f.collide(f.reds[0], f.reds[1]);
    assert.equal(f.pockets().length, 0);
    f.collide(f.reds[0], f.balls[0]); assert.equal(f.pockets().length, 15);
});

test('snooker sweep skips already pocketed balls, virtual balls, and non-red classifications', () => {
    const f = snooker();
    f.reds[1].state = f.s.LogicalBall.nSTATE_OFF_TABLE;
    const fakeRed = addBall(f, 1, 2);
    const virtual = addBall(f, 1, f.s.LogicalBall.BALL_CLASSIFICATION_VIRTUAL);
    f.call('apply', {snookerAllReds: true}); f.shoot(); f.collide();
    assert.equal(f.pockets().length, 14);
    assert.equal(fakeRed.state, f.s.LogicalBall.nSTATE_IN_PLAY);
    assert.equal(virtual.state, f.s.LogicalBall.nSTATE_IN_PLAY);
});

test('eight-ball sweep pots every numbered target except 8, including opponent color group', () => {
    const f = eight(); f.call('apply', {eightBallAllButBlack: true}); f.shoot(); f.collide();
    assert.deepEqual(Array.from(f.pockets(), hit => hit.ball.number), [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15]);
    assert.equal(f.black.state, f.s.LogicalBall.nSTATE_IN_PLAY);
    assert.equal(f.balls[0].state, f.s.LogicalBall.nSTATE_IN_PLAY);
});

test('hitting black 8 still triggers the non-black sweep but single-ball toggle cannot pot black', () => {
    const f = eight();
    f.call('apply', {eightBallAllButBlack: true, firstHitPocket: true, snookerAllReds: true});
    f.shoot(); f.collide(f.balls[0], f.black);
    assert.equal(f.pockets().length, 14);
    assert.equal(f.black.state, f.s.LogicalBall.nSTATE_IN_PLAY);
    assert.equal(f.table.shotResults.ballCollisions[0].ballB, f.black, 'original illegal first contact stays recorded');
    f.collide(f.balls[0], f.black);
    assert.equal(f.pockets().length, 14);
});

test('sweeps are constrained to original supported modes and do not leak into nine-ball or levels', () => {
    for (const type of ['BALL_9', 'LEVEL_MODE', 'BALL_8_QIANGFEN', 'BALL_8_WUJIN']) {
        const f = eight(); f.s.BaseDef.gameType = f.s.GameType[type];
        f.call('apply', {snookerAllReds: true, eightBallAllButBlack: true}); f.shoot(); f.collide();
        assert.equal(f.pockets().length, 0, type);
    }
    const f = eight(); f.call('apply', {snookerAllReds: true}); f.shoot(); f.collide();
    assert.equal(f.pockets().length, 0, 'an eight-ball number 1 is not a snooker red');
});

test('private, ranked, club, practice, and tournament modes use the same verified mode constants', () => {
    for (const type of ['SNK_PRIVATE', 'RANK_BALL_SNK', 'SNK_CLUB', 'SNK_Practice', 'DJS_SNK']) {
        const f = snooker(); f.s.BaseDef.gameType = f.s.GameType[type];
        f.call('apply', {snookerAllReds: true}); f.shoot(); f.collide(); assert.equal(f.pockets().length, 15, type);
    }
    for (const type of ['BALL_8_PRIVATE', 'RANK_BALL_8', 'BALL_8_CLUB', 'BALL_8_Practice', 'DJS_8BALL']) {
        const f = eight(); f.s.BaseDef.gameType = f.s.GameType[type];
        f.call('apply', {eightBallAllButBlack: true}); f.shoot(); f.collide(); assert.equal(f.pockets().length, 14, type);
    }
});

test('opponent and push-ball shots cannot trigger either sweep', () => {
    for (const create of [snooker, eight]) {
        for (const push of [false, true]) {
            const f = create(); f.table.shotPlayerLocalIndex = push ? 0 : 1; f.table._isTuiQiu = push;
            f.call('apply', {snookerAllReds: true, eightBallAllButBlack: true}); f.shoot(); f.collide();
            assert.equal(f.pockets().length, 0);
        }
    }
});

test('each dynamic toggle can be enabled from the default-off installation without reloading', () => {
    for (const [create, key, expected] of [[eight, 'firstHitPocket', 1], [snooker, 'snookerAllReds', 15], [eight, 'eightBallAllButBlack', 14]]) {
        const f = create(); f.call('apply');
        const state = f.s.__poolGuideExtender;
        assert.equal(state.pocketHooks, false);
        state.configurePocket(key, true);
        assert.equal(state.settings[key], true);
        f.shoot(); f.collide(); assert.equal(f.pockets().length, expected);
    }
});

test('enabling a sweep during motion waits for next shot; disabling before contact takes effect immediately', () => {
    const f = snooker(); f.call('apply'); const state = f.s.__poolGuideExtender;
    f.shoot(); state.configurePocket('snookerAllReds', true); f.collide();
    assert.equal(f.pockets().length, 0);
    f.shoot(); state.configurePocket('snookerAllReds', false); f.collide();
    assert.equal(f.pockets().length, 0);
    state.configurePocket('snookerAllReds', true); f.shoot(); f.collide();
    assert.equal(f.pockets().length, 15);
});

test('sweeps skip duplicate records when only a subset remains on the table', () => {
    const f = eight(); f.balls[3].state = f.s.LogicalBall.nSTATE_IN_BALL_RUNNER;
    f.call('apply', {eightBallAllButBlack: true}); f.shoot(); f.collide();
    assert.equal(f.pockets().length, 13);
    f.collide(f.balls[0], f.black);
    assert.equal(f.pockets().length, 13);
});

test('dynamic options reject unknown names and incompatible APIs without corrupting existing settings', () => {
    const f = fixture(); f.call('apply'); const state = f.s.__poolGuideExtender;
    assert.throws(() => state.configurePocket('foo', true));
    assert.throws(() => state.configurePocket('firstHitPocket', 'true'));
    f.s.BallPropertiesSnk = undefined;
    assert.throws(() => state.configurePocket('snookerAllReds', true), /红球接口/);
    assert.equal(state.settings.snookerAllReds, false);
    f.s.BallPocketCollision = undefined;
    assert.throws(() => state.configurePocket('eightBallAllButBlack', true));
    assert.doesNotThrow(() => state.configurePocket('eightBallAllButBlack', false));
});

test('batch failures remain visible even if a later ball succeeds', () => {
    const f = snooker(); f.call('apply', {snookerAllReds: true});
    f.reds[2].position.x = NaN;
    f.shoot(); f.collide();
    assert.equal(f.pockets().length, 14);
    assert.match(f.status().pocketError, /No valid pocket/);
});

test('preview selection returns all distinct reds without changing live state, results, or arrays', () => {
    const f = snooker(); f.call('apply', {snookerAllReds: true, firstHitPocket: true});
    const before = JSON.stringify(f.balls);
    const state = f.s.__poolGuideExtender;
    const selected = state.previewPocketCandidates(f.table, f.reds[0]);
    assert.equal(selected.length, 15);
    assert.equal(new Set(selected).size, 15);
    assert.deepEqual(Array.from(selected), f.reds);
    selected.pop();
    assert.equal(state.previewPocketCandidates(f.table, f.reds[0]).length, 15);
    assert.equal(JSON.stringify(f.balls), before);
    assert.equal(f.pockets().length, 0);
    assert.equal(state.pocketHits, 0);
    assert.equal(state.previewPocketCandidates(f.table, f.colors[0]).length, 0);
});

test('preview selection obeys black-eight priority and reads dynamic switch changes immediately', () => {
    const f = eight(); f.call('apply', {eightBallAllButBlack: true, firstHitPocket: true});
    const state = f.s.__poolGuideExtender;
    const before = JSON.stringify(f.balls);
    const selected = state.previewPocketCandidates(f.table, f.black);
    assert.equal(selected.length, 14);
    assert.ok(selected.every(ball => ball !== f.black && ball !== f.balls[0]));
    state.configurePocket('eightBallAllButBlack', false);
    assert.deepEqual(Array.from(state.previewPocketCandidates(f.table, f.black)), [f.black]);
    assert.equal(JSON.stringify(f.balls), before);
});

test('preview selection rejects non-table and virtual targets and uses the supplied cloned table', () => {
    const f = eight(); f.call('apply', {eightBallAllButBlack: true});
    const state = f.s.__poolGuideExtender;
    assert.equal(state.previewPocketCandidates(null, null).length, 0);
    assert.equal(state.previewPocketCandidates(f.table, f.balls[0]).length, 0);
    assert.equal(state.previewPocketCandidates(f.table, {number: 1}).length, 0);
    const cloneBalls = f.balls.map(ball => ({number: ball.number, classification: ball.classification, state: ball.state}));
    const cloneTable = {m_cBalls: cloneBalls, cueBall: cloneBalls[0]};
    const selected = state.previewPocketCandidates(cloneTable, cloneBalls[1]);
    assert.equal(selected.length, 14);
    assert.ok(selected.every(ball => cloneBalls.includes(ball) && !f.balls.includes(ball)));
    cloneBalls[1].classification = f.s.LogicalBall.BALL_CLASSIFICATION_VIRTUAL;
    assert.equal(state.previewPocketCandidates(cloneTable, cloneBalls[1]).length, 0);
});

test('DOM pocket switches update live settings, preserve bank options, and collapse independently', () => {
    const f = snooker(); f.call('apply', {bankCount: 5});
    class Element {
        constructor() { this.style = {}; this.children = []; this.events = {}; this.attributes = {}; }
        appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
        removeChild(child) { this.children = this.children.filter(item => item !== child); child.parentNode = null; }
        setAttribute(name, value) { this.attributes[name] = value; }
        addEventListener(name, callback) { this.events[name] = callback; }
        fire(name) { this.events[name]({stopPropagation() {}}); }
    }
    const body = new Element();
    function find(node, id) { if (node.id === id) return node; for (const child of node.children) { const match = find(child, id); if (match) return match; } return null; }
    f.s.document = {body, createElement: () => new Element(), getElementById: id => find(body, id)};
    const timers = new Map(); let next = 0;
    f.s.setInterval = callback => { timers.set(++next, callback); return next; };
    f.s.clearInterval = id => timers.delete(id);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'live_controls.js'), 'utf8'), f.s);
    const state = f.s.__poolGuideExtender;
    f.s.__poolGuideControls.mount(state);
    const expand = find(body, 'poolguide-pocket-expand');
    const panel = find(body, 'poolguide-pocket-options');
    assert.equal(panel.style.display, 'none');
    expand.fire('click'); assert.equal(panel.style.display, 'block');
    for (const key of ['firstHitPocket', 'snookerAllReds', 'eightBallAllButBlack']) {
        const button = find(body, 'poolguide-toggle-' + key);
        assert.equal(button.attributes['aria-pressed'], 'false');
        button.fire('click');
        assert.equal(state.settings[key], true);
        assert.equal(button.attributes['aria-pressed'], 'true');
    }
    assert.equal(state.settings.bankCount, 5);
    f.shoot(); f.collide(); assert.equal(f.pockets().length, 15);
    find(body, 'poolguide-toggle-snookerAllReds').fire('click');
    assert.equal(state.settings.snookerAllReds, false);
    assert.equal(f.pockets().length, 15, 'turning off cannot restore already pocketed balls');
    f.call('restore');
    assert.equal(body.children.length, 0);
    assert.equal(timers.size, 0);
});
