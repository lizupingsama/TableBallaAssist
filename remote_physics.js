/* ES5 phone client: capture state and render desktop results; never simulate here. */
(function (root) {
    'use strict';
    var config = root.__poolGuideRemoteConfig;
    if (!config) { return; }
    if (root.__poolGuideRemote) { root.__poolGuideRemote.disposeAll(); }
    var socket = null, timer = null, active = null, inflight = null, sequence = 0;
    var retryAt = 0, disposed = false, lastPing = 0, lastReceived = 0, connectingAt = 0;
    var stats = {connected: false, rttMs: null, computeMs: null, error: null, received: 0};
    var now = function () { return Date.now(); };
    function vector(value) { return {x: Number(value.x), y: Number(value.y)}; }
    function numericConstants(owner) {
        var result = {};
        for (var key in owner) {
            if (typeof owner[key] === 'number' && isFinite(owner[key])) { result[key] = owner[key]; }
        }
        return result;
    }
    function shotInputs(guide, angle) {
        return root.__poolGuideReadShotInputs(guide, angle);
    }
    function capture(guide, angle, settings, badContact, split) {
        var table = guide.m_cTable, balls = table.m_cBalls, properties = table.m_cTableProperties;
        var cue = typeof guide.getCueBall === 'function' ? guide.getCueBall() : table.cueBall;
        var state = root.__poolGuideExtender, snapshots = [], fouls = [], candidates = [];
        for (var i = 0; i < balls.length; i++) {
            var ball = balls[i], spin = ball.spin || {};
            snapshots.push({number: ball.number, radius: ball.radius, classification: ball.classification,
                state: ball.state, position: vector(ball.position), velocity: vector(ball.velocity),
                spin: {x: Number(spin.x) || 0, y: Number(spin.y) || 0, z: Number(spin.z) || 0},
                ballIndex: ball.ballIndex, isOutTable: !!ball.isOutTable});
            fouls.push(!!badContact(guide, ball));
            var selected = state && state.previewPocketCandidates ? state.previewPocketCandidates(table, ball) : [];
            var indexes = [];
            for (var p = 0; p < selected.length; p++) { indexes.push(balls.indexOf(selected[p])); }
            candidates.push(indexes);
        }
        var bounds = table.m_cTableCollisionBounds;
        return {balls: snapshots, cueIndex: balls.indexOf(cue),
            table: {shape: table.m_cTableShape.map(vector),
                bounds: {left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom},
                properties: {pockets: properties.pockets.map(vector), pocketRadius: properties.pocketRadius,
                    length: properties.length, width: properties.width}, isLevelGame: !!table._isLevelGame},
            shot: shotInputs(guide, angle), settings: settings, split: !!split, fouls: fouls,
            pocketCandidates: candidates, constants: numericConstants(root.PoolMath),
            ballConstants: numericConstants(root.LogicalBall),
            baseDef: {isSnk: !!(root.BaseDef && root.BaseDef.isSnk), isEditor: !!(root.BaseDef && root.BaseDef.isEditor),
                isIce: !!(root.BaseDef && root.BaseDef.isIce)}};
    }
    function redraw(guide) {
        if (!guide || guide._isGuanZhan || (guide.visualCue && guide.visualCue.visible === false)) { return; }
        try { guide.updateGuide(); } catch (error) { stats.error = String(error); }
    }
    function disconnect(error) {
        var old = socket;
        socket = null; stats.connected = false; inflight = null; retryAt = now() + 1000;
        if (error) { stats.error = error; }
        if (old) { old.close(); }
        if (active) { active.plan = null; redraw(active.guide); }
    }
    function connect() {
        if (disposed || socket || now() < retryAt) { return; }
        try {
            socket = new root.WebSocket(config.url + '/predict?token=' + encodeURIComponent(config.token));
            connectingAt = now();
            var current = socket;
            current.onopen = function () {
                if (socket !== current) { return; }
                stats.connected = true; stats.error = null; lastReceived = now();
            };
            current.onmessage = function (event) {
                if (socket !== current) { return; }
                try {
                    var message = JSON.parse(event.data);
                    lastReceived = now();
                    if (message.type === 'pong') { return; }
                    if (message.type === 'settings') {
                        var state = root.__poolGuideExtender, settings = message.settings;
                        if (!state || !settings) { return; }
                        state.settings.mode = settings.mode;
                        state.settings.length = settings.length;
                        state.settings.factor = settings.factor;
                        state.settings.showSplit = settings.showSplit;
                        state.configureBanks(settings.bankPrediction, settings.bankCount);
                        for (var p = 0; p < 3; p++) {
                            var name = ['firstHitPocket', 'snookerAllReds', 'eightBallAllButBlack'][p];
                            state.configurePocket(name, settings[name]);
                        }
                        try { root.localStorage.setItem('poolguide-bank-count-v1', String(settings.bankCount)); } catch (ignored) {}
                        if (state.controls) { state.controls.refresh(); }
                        current.send(JSON.stringify({type: 'state', settings: state.settings}));
                        return;
                    }
                    if (!inflight || message.id !== inflight.id) { return; }
                    var request = inflight;
                    inflight = null;
                    if (message.error) { stats.error = message.error; return; }
                    var elapsed = now() - request.at;
                    stats.rttMs = elapsed;
                    stats.computeMs = message.computeMs;
                    stats.received++;
                    // An unchanged shot is still exact after a slow computation. Only
                    // results for changing inputs use the short display grace period.
                    if (!active || active !== request.active ||
                        (active.key !== request.key && elapsed > config.maxAgeMs)) {
                        if (active) { redraw(active.guide); } return;
                    }
                    var plan = message.plan;
                    if (!plan || !Array.isArray(plan.cue) || !Array.isArray(plan.target)) { return; }
                    if (plan.contact) {
                        var ball = active.guide.m_cTable.m_cBalls[plan.contact.ballIndex];
                        if (!ball) { return; }
                        plan.contact.ball = ball;
                    }
                    plan.remote = {rttMs: elapsed, computeMs: message.computeMs};
                    active.plan = plan;
                    active.planAt = request.at;
                    active.planKey = request.key;
                    stats.error = null;
                    redraw(active.guide);
                } catch (error) { stats.error = String(error); }
            };
            current.onerror = function () {
                if (socket !== current) { return; }
                stats.error = '无法连接电脑，请检查 IP、端口和防火墙';
            };
            current.onclose = function () {
                if (socket !== current) { return; }
                disconnect();
            };
        } catch (error) { socket = null; stats.error = String(error); retryAt = now() + 1000; }
    }
    function tick() {
        if (disposed) { return; }
        var state = root.__poolGuideExtender;
        if (!state) { return; }
        connect();
        if (socket && socket.readyState === 0 && now() - connectingAt > 3000) { disconnect('连接电脑超时'); return; }
        if (socket && socket.readyState === 1 && now() - lastReceived > 3500) { disconnect('电脑响应超时'); return; }
        if (socket && socket.readyState === 1 && now() - lastPing > 2000) {
            lastPing = now(); socket.send(JSON.stringify({type: 'state', settings: state.settings,
                rttMs: stats.rttMs, received: stats.received}));
            socket.send(JSON.stringify({type: 'ping', at: lastPing}));
        }
        if (inflight && now() - inflight.at > 1500 && socket) { disconnect('预测响应超时'); return; }
        if (!active || !state.settings.bankPrediction || (root.document && root.document.hidden)) { return; }
        redraw(active.guide);
    }
    function predict(guide, angle, settings, badContact, split) {
        var snapshot = capture(guide, angle, settings, badContact, split);
        var shot = snapshot.shot;
        snapshot.shot = null;
        // Never display or accept a forecast computed for a different manual spin.
        var layout = JSON.stringify(snapshot) + '|english:' + shot.englishX + ',' + shot.englishY;
        snapshot.shot = shot;
        var key = layout + JSON.stringify(shot);
        if (!active || active.guide !== guide || active.layout !== layout) {
            active = {guide: guide, layout: layout, plan: null, planKey: null, planAt: 0};
        }
        active.key = key;
        connect();
        if (!timer) { timer = root.setInterval(tick, 16); }
        if (socket && socket.readyState === 1 && !inflight && socket.bufferedAmount < 32768 &&
            active.planKey !== key) {
            inflight = {id: ++sequence, at: now(), key: key, active: active};
            socket.send(JSON.stringify({type: 'predict', id: sequence, snapshot: snapshot}));
        } else if (socket && socket.readyState === 1 && !inflight && now() - lastPing > 2000) {
            lastPing = now(); socket.send(JSON.stringify({type: 'ping', at: lastPing}));
        }
        if (active.plan && (active.planKey === key || now() - active.planAt <= config.maxAgeMs)) {
            // drawBankPlan removes its live ball association from diagnostics, so copy it per draw.
            var copy = {}, plan = active.plan;
            for (var name in plan) { if (Object.prototype.hasOwnProperty.call(plan, name)) { copy[name] = plan[name]; } }
            if (plan.contact) {
                copy.contact = {x: plan.contact.x, y: plan.contact.y, radius: plan.contact.radius,
                    ballIndex: plan.contact.ballIndex, ball: guide.m_cTable.m_cBalls[plan.contact.ballIndex]};
            }
            return copy;
        }
        return {cue: [], target: [], contact: null, foul: false, cueBanks: 0, targetBanks: 0,
            pocketStops: 0, model: 'remote-pending', shot: shot, truncated: false};
    }
    root.__poolGuideRemote = {predict: predict, stats: stats, capture: capture,
        dispose: function (guide) { if (active && active.guide === guide) { active = null; } },
        disposeAll: function () {
            disposed = true; active = null; inflight = null;
            if (timer) { root.clearInterval(timer); timer = null; }
            if (socket) { var old = socket; socket = null; old.close(); }
            stats.connected = false;
        }};
    timer = root.setInterval(tick, 16);
}(window));
