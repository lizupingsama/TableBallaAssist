/* Executed inside the game's WebView. ES5 syntax for older Android WebViews. */
(function (root) {
    'use strict';
    var KEY = '__poolGuideExtender';
    var previous = root[KEY];
    var request = root.__poolGuideRequest || {action: 'status'};
    var constructors = [root.VisualGuide, root.VisualGuideJiaoCheng];

    function discoverGuides() {
        var stage = root.egret && root.egret.MainContext &&
            root.egret.MainContext.instance && root.egret.MainContext.instance.stage;
        var stack = stage ? [stage] : [];
        var result = [];
        var visited = 0;
        while (stack.length && visited++ < 20000) {
            var item = stack.pop();
            if (!item) { continue; }
            for (var c = 0; c < constructors.length; c++) {
                if (constructors[c] && item instanceof constructors[c]) {
                    result.push(item);
                    break;
                }
            }
            var children = item.$children || item._children;
            if (children && typeof children.length === 'number') {
                for (var i = 0; i < children.length; i++) { stack.push(children[i]); }
            }
        }
        return result;
    }

    function redraw() {
        var guides = discoverGuides();
        var errors = [];
        for (var i = 0; i < guides.length; i++) {
            try { guides[i].updateGuide(); } catch (error) { errors.push(String(error)); }
        }
        return {guides: guides.length, errors: errors};
    }

    function status(state) {
        return {
            ok: true,
            installed: !!state,
            settings: state ? state.settings : null,
            methods: state ? state.records.length : 0,
            lengthCalls: state ? state.lengthCalls : 0,
            lastLength: state ? state.lastLength : null,
            lastPrediction: state ? state.lastPrediction : null,
            bankError: state ? state.bankError : null,
            guides: discoverGuides().length,
            title: root.document ? root.document.title : ''
        };
    }

    if (typeof root.VisualGuide !== 'function') {
        return {ok: false, reason: 'game-not-ready', title: root.document ? root.document.title : ''};
    }
    if (typeof root.VisualGuide.calculateGuideLength !== 'function' ||
        typeof root.VisualGuide.prototype.drawGuideLessSharpAngle !== 'function') {
        return {ok: false, reason: 'unsupported-guide-api'};
    }
    if (request.action === 'status') { return status(previous); }
    if (request.action === 'restore') {
        if (previous) {
            var overlays = (previous.overlays || []).slice();
            for (var o = 0; o < overlays.length; o++) {
                if (overlays[o].dispose) { overlays[o].dispose(); continue; }
                overlays[o].shape.graphics.clear();
                if (overlays[o].shape.parent) { overlays[o].shape.parent.removeChild(overlays[o].shape); }
            }
            for (var r = previous.records.length - 1; r >= 0; r--) {
                var record = previous.records[r];
                // Do not overwrite a subsequent hook owned by another tool.
                if (record.owner[record.name] === record.replacement) {
                    record.owner[record.name] = record.original;
                }
            }
            delete root[KEY];
        }
        var restored = status(null);
        restored.redraw = redraw();
        return restored;
    }
    if (request.action !== 'apply') { throw new Error('Unknown action'); }
    var input = request.settings || {};
    var mode = input.mode || 'fixed';
    var length = Number(input.length === undefined ? 220 : input.length);
    var factor = Number(input.factor === undefined ? 6 : input.factor);
    if ((mode !== 'fixed' && mode !== 'multiply') || !isFinite(length) ||
        length < 10 || length > 1500 || !isFinite(factor) || factor < 1 || factor > 30) {
        throw new Error('Invalid guide length settings');
    }
    var settings = {mode: mode, length: length, factor: factor,
        showSplit: input.showSplit === true, bankPrediction: input.bankPrediction === true};
    if (previous) {
        previous.settings = settings;
        if (!settings.bankPrediction) { previous.lastPrediction = null; previous.bankError = null; }
        var updated = status(previous);
        updated.redraw = redraw();
        return updated;
    }

    var state = {settings: settings, records: [], overlays: [], bankPool: [], active: 0,
        lengthCalls: 0, lastLength: null, lastPrediction: null, bankError: null};
    var MAX_BANKS = 3;
    var EPSILON = 0.000001;

    function overlayFor(guide, create) {
        for (var i = 0; i < state.overlays.length; i++) {
            if (state.overlays[i].guide === guide) { return state.overlays[i].shape; }
        }
        if (!create) { return null; }
        var shape = new root.egret.Shape();
        shape.touchEnabled = false;
        var removedEvent = root.egret.Event && root.egret.Event.REMOVED_FROM_STAGE;
        var entry = {guide: guide, shape: shape, dispose: function () {
            if (removedEvent && typeof guide.removeEventListener === 'function') {
                guide.removeEventListener(removedEvent, entry.dispose, guide);
            }
            shape.graphics.clear();
            if (shape.parent) { shape.parent.removeChild(shape); }
            state.overlays = state.overlays.filter(function (item) { return item !== entry; });
        }};
        state.overlays.push(entry);
        if (removedEvent && typeof guide.addEventListener === 'function') {
            guide.addEventListener(removedEvent, entry.dispose, guide);
        }
        return shape;
    }
    function virtualBall(source) {
        var ball = state.bankPool.length ? state.bankPool.pop() :
            new root.LogicalBall(source.number, source.radius, root.LogicalBall.BALL_CLASSIFICATION_VIRTUAL);
        ball.init(source.number, source.radius, root.LogicalBall.BALL_CLASSIFICATION_VIRTUAL);
        ball.position.x = source.position.x;
        ball.position.y = source.position.y;
        ball.velocity.x = 0;
        ball.velocity.y = 0;
        ball.spin.x = ball.spin.y = ball.spin.z = 0;
        ball.ballIndex = -1;
        ball.state = root.LogicalBall.nSTATE_IN_PLAY;
        ball.isOutTable = false;
        return ball;
    }
    function collisionIs(hit, name) {
        return !!hit && root.egret.is(hit, name);
    }
    function badFirstContact(guide, target) {
        var invalid;
        if (guide._setTargetBallNum !== undefined && guide._setTargetBallNum !== -1) {
            invalid = guide._setTargetBallNum !== target.number;
        } else if (guide.m_nLegalContactClassArr && guide.m_nLegalContactClassArr.length) {
            invalid = guide.m_nLegalContactClassArr.indexOf(target.classification) < 0;
        } else {
            invalid = target.classification !== guide.m_nLegalContactClass;
        }
        if (guide.m_bBadContactEnabled && invalid &&
            (!guide._gameView || guide._gameView.isMainPlayerOperation())) { return true; }
        var types = root.GameType;
        var gameType = root.BaseDef && root.BaseDef.gameType;
        return !!(types && !guide.m_bBadContactEnabled && target.number === 8 &&
            (gameType === types.BALL_8 || gameType === types.RANK_BALL_8 || gameType === types.BALL_8_PRIVATE));
    }
    function pocketTime(ball, properties, limit) {
        var pockets = properties.pockets || [];
        var radius = properties.pocketRadius;
        if (!(radius > 0) || !isFinite(radius)) { return null; }
        var vx = ball.velocity.x, vy = ball.velocity.y;
        var a = vx * vx + vy * vy;
        var nearest = null;
        for (var i = 0; i < pockets.length; i++) {
            var dx = ball.position.x - pockets[i].x, dy = ball.position.y - pockets[i].y;
            var c = dx * dx + dy * dy - radius * radius;
            var b = 2 * (dx * vx + dy * vy);
            var discriminant = b * b - 4 * a * c;
            if (c <= 0) { return 0; }
            if (discriminant < 0 || b >= 0) { continue; }
            var time = (-b - Math.sqrt(discriminant)) / (2 * a);
            if (time >= 0 && time <= limit && (nearest === null || time < nearest)) { nearest = time; }
        }
        return nearest;
    }
    function traceBankPath(ball, scene, banks, budget, segments) {
        // Queries run on a shadow table. No live ball state or velocity is changed.
        for (var step = 0; step <= MAX_BANKS; step++) {
            var speed = Math.sqrt(ball.velocity.x * ball.velocity.x + ball.velocity.y * ball.velocity.y);
            if (!isFinite(speed) || speed <= EPSILON || budget <= EPSILON) { break; }
            var limit = budget / speed;
            var hit = scene.findFirstCollisionBall(ball, limit);
            var time = hit ? hit.time : limit;
            if (!isFinite(time) || time < 0 || time > limit + EPSILON) { break; }
            var pocket = pocketTime(ball, scene.m_cTableProperties, time);
            if (pocket !== null) { time = pocket; hit = null; }
            var startX = ball.position.x, startY = ball.position.y;
            ball.position.x += ball.velocity.x * time;
            ball.position.y += ball.velocity.y * time;
            if (!isFinite(ball.position.x) || !isFinite(ball.position.y)) { throw new Error('Invalid bank coordinates'); }
            if (time * speed > EPSILON) {
                segments.push([startX, startY, ball.position.x, ball.position.y]);
            }
            budget -= time * speed;
            if (pocket !== null) { return {banks: banks, budget: budget, pocket: true}; }
            if (!hit || time * speed <= EPSILON) { break; }
            if (collisionIs(hit, 'BallBallCollision')) { return {banks: banks, budget: budget, hit: hit}; }
            // Pocket jaws / point collisions end the preview; only actual cushion faces reflect.
            if (!collisionIs(hit, 'BallLineCollision') || banks >= MAX_BANKS) { break; }
            root.PoolMath.ballLineCollision(ball, hit.theta);
            banks++;
        }
        return {banks: banks, budget: budget};
    }
    function bankPlan(guide, angle, split) {
        var table = guide.m_cTable;
        var cue = typeof guide.getCueBall === 'function' ? guide.getCueBall() : table && table.cueBall;
        if (!table || !cue) { return null; }
        if (!root.LogicalBall || !root.PoolMath || typeof root.PoolMath.ballLineCollision !== 'function' ||
            typeof root.PoolMath.ballBallCollision !== 'function' || !table.m_cBalls ||
            !table.m_cTableProperties || typeof guide.addChild !== 'function' || !root.egret.Shape) {
            throw new Error('Bank prediction API unavailable');
        }
        var scene = Object.create(table);
        scene.m_cBalls = table.m_cBalls.filter(function (ball) { return ball !== cue; });
        var bounds = table.m_cTableCollisionBounds;
        var diagonal = bounds ? Math.sqrt(Math.pow(bounds.right - bounds.left, 2) +
            Math.pow(bounds.bottom - bounds.top, 2)) : 1500;
        var budget = (isFinite(diagonal) && diagonal > 0 ? diagonal : 1500) * (MAX_BANKS + 2);
        var plan = {cue: [], target: [], cueBanks: 0, targetBanks: 0, pocketStops: 0, contact: null, foul: false};
        var moving = virtualBall(cue);
        var target = null;
        try {
            moving.velocity.x = Math.cos(angle);
            moving.velocity.y = Math.sin(angle);
            var first = traceBankPath(moving, scene, 0, budget, plan.cue);
            plan.cueBanks = first.banks;
            plan.pocketStops += first.pocket ? 1 : 0;
            if (!first.hit || !first.hit.ballB) { return plan; }
            var struck = first.hit.ballB;
            plan.contact = {x: moving.position.x, y: moving.position.y, radius: cue.radius, ball: struck};
            plan.foul = badFirstContact(guide, struck);
            if (plan.foul || !split) { return plan; }
            target = virtualBall(struck);
            root.PoolMath.ballBallCollision(moving, target);
            scene.m_cBalls = scene.m_cBalls.filter(function (ball) { return ball !== struck; });
            var cueResult = traceBankPath(moving, scene, first.banks, first.budget, plan.cue);
            var targetResult = traceBankPath(target, scene, 0, budget, plan.target);
            plan.cueBanks = cueResult.banks;
            plan.targetBanks = targetResult.banks;
            plan.pocketStops += (cueResult.pocket ? 1 : 0) + (targetResult.pocket ? 1 : 0);
            return plan;
        } finally {
            state.bankPool.push(moving);
            if (target) { state.bankPool.push(target); }
        }
    }
    function drawBankPlan(guide, plan, alpha) {
        var shape = overlayFor(guide, true);
        var graphics = shape.graphics;
        var units = guide.m_cUnitConverter;
        var width = guide.lineSize || 2;
        graphics.clear();
        function draw(segments, color) {
            graphics.lineStyle(width, color, alpha);
            for (var i = 0; i < segments.length; i++) {
                var line = segments[i];
                graphics.moveTo(units.getVisualXPosition(line[0]), units.getVisualYPosition(line[1]));
                graphics.lineTo(units.getVisualXPosition(line[2]), units.getVisualYPosition(line[3]));
            }
        }
        draw(plan.cue, 0x79fff0);
        draw(plan.target, 0xffd479);
        if (plan.contact) {
            var x = units.getVisualXPosition(plan.contact.x), y = units.getVisualYPosition(plan.contact.y);
            graphics.lineStyle(width, plan.foul ? 0xff0000 : 0x79fff0, alpha);
            graphics.drawCircle(x, y, units.getVisualSize(plan.contact.radius));
            if (plan.foul) {
                graphics.moveTo(x - 5, y - 5);
                graphics.lineTo(x + 5, y + 5);
            } else {
                guide._hitBall = plan.contact.ball;
                if (guide.visualCue) { guide.visualCue.setRotationRate(.2); }
            }
        }
        shape.visible = true;
        if (shape.parent !== guide) { guide.addChild(shape); }
        // Keep only scalar/coordinate diagnostics; never retain a live ball in status.
        plan.contact = plan.contact ? {x: plan.contact.x, y: plan.contact.y, radius: plan.contact.radius} : null;
        state.lastPrediction = plan;
    }
    function replace(owner, name, factory) {
        if (!owner || typeof owner[name] !== 'function') { return; }
        var original = owner[name];
        var replacement = factory(original);
        state.records.push({owner: owner, name: name, original: original, replacement: replacement});
        owner[name] = replacement;
    }
    function lengthFactory(original) {
        return function (speed) {
            var oldLength = original.apply(this, arguments);
            // A stopped ball has no direction. Scaling its zero vector can produce NaN.
            if (!state.active || !isFinite(speed) || speed <= 0.000001 || !isFinite(oldLength)) {
                return oldLength;
            }
            var config = state.settings;
            var next = config.mode === 'fixed' ? Math.max(oldLength, config.length) :
                Math.min(1500, Math.max(0, oldLength) * config.factor);
            state.lengthCalls++;
            state.lastLength = {original: oldLength, extended: next};
            return next;
        };
    }
    function drawFactory(original) {
        return function () {
            var overlay = overlayFor(this, false);
            if (overlay) { overlay.graphics.clear(); overlay.visible = false; }
            if (this._isGuanZhan) { return original.apply(this, arguments); }
            var hadFlag = Object.prototype.hasOwnProperty.call(this, '_isOpenFuZhu');
            var savedFlag = this._isOpenFuZhu;
            state.active++;
            if (state.settings.showSplit) { this._isOpenFuZhu = true; }
            try {
                if (state.settings.bankPrediction) {
                    try {
                        var plan = bankPlan(this, arguments[0], this._isOpenFuZhu);
                        if (plan) {
                            drawBankPlan(this, plan, isFinite(arguments[1]) ? arguments[1] : .5);
                            state.bankError = null;
                            return;
                        }
                    } catch (error) {
                        state.bankError = String(error);
                        overlay = overlayFor(this, false);
                        if (overlay) { overlay.graphics.clear(); overlay.visible = false; }
                    }
                }
                return original.apply(this, arguments);
            } finally {
                state.active--;
                if (hadFlag) { this._isOpenFuZhu = savedFlag; }
                else { delete this._isOpenFuZhu; }
            }
        };
    }
    for (var n = 0; n < constructors.length; n++) {
        var ctor = constructors[n];
        if (typeof ctor !== 'function') { continue; }
        replace(ctor, 'calculateGuideLength', lengthFactory);
        replace(ctor, 'calculateGuideLength2', lengthFactory);
        replace(ctor.prototype, 'drawGuideLessSharpAngle', drawFactory);
        replace(ctor.prototype, 'drawGuideLessSharpAngle2', drawFactory);
    }
    root[KEY] = state;
    var applied = status(state);
    applied.redraw = redraw();
    return applied;
}(window));
