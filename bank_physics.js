/* Run the game's own trial physics on private cloned balls. ES5 for Android WebView. */
(function (root) {
    'use strict';
    var CACHE = '__poolGuidePhysicsPreview';
    var DT = .01;
    var MAX_STEPS = 2000;
    var CPU_LIMIT_MS = 35;

    function available() {
        return !!(root.TableTest && root.Table && typeof root.Table.calculateShot === 'function' &&
            root.PoolMath && typeof root.PoolMath.tableBallFriction === 'function');
    }
    function inputs(guide, angle) {
        var visualCue = guide.visualCue;
        var canvas = visualCue && visualCue.cueCanvas;
        var english = canvas && canvas.englishControl;
        var max = Number(root.PoolMath.CUE_PROPERTIES_MAX_POWER) || 350;
        var power = Number(visualCue ? visualCue.power : guide.power);
        var estimated = !isFinite(power) || power <= 0;
        if (estimated) { power = max; }
        var x = english ? Number(english.englishX) : 0;
        var y = english ? Number(english.englishY) : 0;
        return {angle: angle, power: Math.max(.01, Math.min(max, power)), maxPower: max,
            mode: estimated ? 'full-power-preview' : 'current-power',
            englishX: isFinite(x) ? x : 0, englishY: isFinite(y) ? y : 0, estimated: estimated};
    }
    function signature(guide, shot, settings) {
        var balls = guide.m_cTable.m_cBalls;
        var values = [shot.angle, shot.power, shot.englishX, shot.englishY, settings.bankCount, settings.firstHitPocket,
            settings.snookerAllReds, settings.eightBallAllButBlack,
            settings.showSplit, guide._isOpenFuZhu, guide._setTargetBallNum, guide.m_bBadContactEnabled,
            guide.m_nLegalContactClass, String(guide.m_nLegalContactClassArr)];
        for (var i = 0; i < balls.length; i++) {
            values.push(balls[i].number, balls[i].position.x, balls[i].position.y, balls[i].radius, balls[i].state);
        }
        return values.join('|');
    }
    function isCollision(collision, type) { return root.egret.is(collision, type); }
    function onTable(ball) {
        return ball.state === root.LogicalBall.nSTATE_IN_PLAY || ball.state === root.LogicalBall.nSTATE_IN_POCKET_BEFORE;
    }
    function role(ball) {
        return {ball: ball, active: true, banks: 0, points: [[ball.position.x, ball.position.y]], locked: 0};
    }
    function record(item, lock) {
        if (!item || !item.active) { return; }
        var x = item.ball.position.x, y = item.ball.position.y;
        if (!isFinite(x) || !isFinite(y)) { throw new Error('Invalid trial physics coordinates'); }
        var points = item.points, last = points[points.length - 1];
        var dx = x - last[0], dy = y - last[1];
        if (dx * dx + dy * dy > .00000001) {
            var merged = false;
            if (points.length > 1 && item.locked !== points.length - 1) {
                var start = points[points.length - 2];
                var ax = last[0] - start[0], ay = last[1] - start[1];
                var cross = ax * dy - ay * dx;
                var tolerance = Math.max(.005, item.ball.radius * .005);
                if (ax * dx + ay * dy >= 0 && cross * cross <= tolerance * tolerance * (ax * ax + ay * ay)) {
                    points[points.length - 1] = [x, y];
                    merged = true;
                }
            }
            if (!merged) { points.push([x, y]); }
        }
        if (lock) { item.locked = points.length - 1; }
    }
    function lines(item) {
        var result = [];
        if (!item) { return result; }
        for (var i = 1; i < item.points.length; i++) {
            result.push([item.points[i - 1][0], item.points[i - 1][1], item.points[i][0], item.points[i][1]]);
        }
        return result;
    }
    function copyPlan(plan) {
        var copy = {};
        for (var key in plan) { if (Object.prototype.hasOwnProperty.call(plan, key)) { copy[key] = plan[key]; } }
        if (plan.contact) {
            copy.contact = {x: plan.contact.x, y: plan.contact.y, radius: plan.contact.radius, ball: plan.contact.ball};
        }
        return copy;
    }
    function simulator(table) {
        var sim = new root.TableTest();
        var properties = table.m_cTableProperties;
        var bounds = table.m_cTableCollisionBounds;
        sim.init(properties.pocketRadius, table.m_cTableShape, properties.pockets,
            properties.length || bounds.right - bounds.left,
            properties.width || bounds.bottom - bounds.top, !!table._isLevelGame);
        sim.m_cTableCollisionBounds = bounds;
        var handle = sim.handleCollision;
        sim.handleCollision = function (event) {
            var data = this.__preview;
            var hit = event.curCollision;
            var firstNow = false;
            record(data.cue, true);
            record(data.target, true);
            if (isCollision(hit, 'BallBallCollision')) {
                var other = hit.ballA === data.cue.ball ? hit.ballB : hit.ballB === data.cue.ball ? hit.ballA : null;
                if (!data.plan.contact && other && data.cue.active) {
                    var index = this.m_cBalls.indexOf(other);
                    var real = data.realBalls[index];
                    if (real && real.number > 0) {
                        firstNow = true;
                        data.plan.contact = {x: data.cue.ball.position.x, y: data.cue.ball.position.y,
                            radius: data.cue.ball.radius, ball: real};
                        data.plan.foul = data.badContact(data.guide, real);
                        if (data.plan.foul || !data.split) { data.cue.active = false; }
                        else { data.target = role(other); }
                    }
                }
                if (!firstNow) {
                    if (hit.ballA === data.cue.ball || hit.ballB === data.cue.ball) { data.cue.active = false; }
                    if (data.target && (hit.ballA === data.target.ball || hit.ballB === data.target.ball)) {
                        data.target.active = false;
                    }
                }
            } else if (isCollision(hit, 'BallLineCollision') || isCollision(hit, 'BallPointCollision')) {
                var item = hit.ball === data.cue.ball ? data.cue :
                    data.target && hit.ball === data.target.ball ? data.target : null;
                if (item && item.active) {
                    if (item.banks >= data.limit) { item.active = false; }
                    else { item.banks++; }
                }
            }
            var result = handle.call(this, event);
            if (firstNow) {
                // Ask the gameplay patch for its selection, then alter private clones only.
                var state = root.__poolGuideExtender;
                var candidates = state && typeof state.previewPocketCandidates === 'function' ?
                    state.previewPocketCandidates(data.realTable, data.plan.contact.ball) :
                    data.forcePocket ? [data.plan.contact.ball] : [];
                for (var p = 0; p < candidates.length; p++) {
                    var cloneIndex = data.realBalls.indexOf(candidates[p]);
                    var clone = this.m_cBalls[cloneIndex];
                    if (!clone || clone === data.cue.ball) { continue; }
                    clone.stopMoving();
                    clone.state = root.LogicalBall.nSTATE_OFF_TABLE;
                    if (data.target && data.target.ball === clone) { data.target.active = false; }
                    data.plan.pocketStops++;
                }
            }
            return result;
        };
        // Rotation matrices only animate textures; translation needs the original friction/spin update.
        sim.rotateBalls = function (dt) {
            var spinning = false;
            for (var i = 0; i < this.m_cBalls.length; i++) {
                var ball = this.m_cBalls[i];
                if (ball.onTable) {
                    spinning = spinning || ball.spin.x !== 0 || ball.spin.y !== 0 || ball.spin.z !== 0;
                    root.PoolMath.tableBallFriction(ball, dt);
                }
            }
            return spinning;
        };
        return sim;
    }
    function predict(guide, angle, settings, badContact, split, force) {
        if (!available()) { return null; }
        var table = guide.m_cTable;
        var cue = typeof guide.getCueBall === 'function' ? guide.getCueBall() : table.cueBall;
        var cueIndex = table.m_cBalls.indexOf(cue);
        if (cueIndex < 0 || !table.m_cTableShape || !table.m_cTableCollisionBounds) { return null; }
        var shot = inputs(guide, angle);
        var key = signature(guide, shot, settings);
        var options = [settings.firstHitPocket, settings.snookerAllReds, settings.eightBallAllButBlack].join('|');
        var cache = guide[CACHE];
        if (!cache || cache.table !== table) {
            if (cache && cache.sim.dispose) { cache.sim.dispose(); }
            cache = guide[CACHE] = {table: table, sim: simulator(table), at: 0};
        }
        if (cache.plan && (cache.key === key || (!force && cache.count === settings.bankCount &&
            cache.options === options && Date.now() - cache.at < 60))) {
            return copyPlan(cache.plan);
        }
        var sim = cache.sim;
        sim.m_cShotResults.clear();
        sim.setTableData(table.m_cTableProperties.pocketRadius, table.m_cTableShape, table.m_cTableProperties.pockets);
        sim.setBalls(table.m_cBalls, null, 0, false);
        sim.resetBalls();
        var ball = sim.m_cBalls[cueIndex];
        root.Table.calculateShot(ball, shot.power, angle, shot.englishX, shot.englishY);
        var plan = {cue: [], target: [], cueBanks: 0, targetBanks: 0, pocketStops: 0,
            contact: null, foul: false, model: 'game-physics', shot: shot, truncated: false};
        var data = {cue: role(ball), target: null, limit: settings.bankCount || 3,
            realBalls: table.m_cBalls, realTable: table, guide: guide, badContact: badContact, split: split,
            forcePocket: settings.firstHitPocket === true, plan: plan};
        sim.__preview = data;
        var started = Date.now();
        try {
            for (var step = 0; step < MAX_STEPS; step++) {
                var moving = sim.process(DT);
                record(data.cue, false);
                record(data.target, false);
                var roles = [data.cue, data.target];
                for (var i = 0; i < roles.length; i++) {
                    if (roles[i] && roles[i].active && !onTable(roles[i].ball)) {
                        roles[i].active = false;
                        plan.pocketStops++;
                    }
                }
                if (!moving || (!data.cue.active && (!data.target || !data.target.active))) { break; }
                if (step === MAX_STEPS - 1 || (step % 20 === 0 && Date.now() - started > CPU_LIMIT_MS)) {
                    plan.truncated = true;
                    break;
                }
            }
            plan.cue = lines(data.cue);
            plan.target = lines(data.target);
            plan.cueBanks = data.cue.banks;
            plan.targetBanks = data.target ? data.target.banks : 0;
            plan.elapsedMs = Date.now() - started;
            cache.key = key;
            cache.count = settings.bankCount;
            cache.options = options;
            cache.at = Date.now();
            cache.plan = plan;
            return copyPlan(plan);
        } finally {
            sim.__preview = null;
        }
    }
    root.__poolGuidePhysics = {predict: predict, inputs: inputs, available: available,
        invalidate: function (guide) {
            var cache = guide[CACHE];
            if (cache) { cache.key = null; cache.at = 0; }
        },
        dispose: function (guide) {
            var cache = guide[CACHE];
            if (cache && cache.sim.dispose) { cache.sim.dispose(); }
            delete guide[CACHE];
        }};
}(window));
