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
    var settings = {mode: mode, length: length, factor: factor, showSplit: input.showSplit === true};
    if (previous) {
        previous.settings = settings;
        var updated = status(previous);
        updated.redraw = redraw();
        return updated;
    }

    var state = {settings: settings, records: [], active: 0, lengthCalls: 0, lastLength: null};
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
            if (this._isGuanZhan) { return original.apply(this, arguments); }
            var hadFlag = Object.prototype.hasOwnProperty.call(this, '_isOpenFuZhu');
            var savedFlag = this._isOpenFuZhu;
            state.active++;
            if (state.settings.showSplit) { this._isOpenFuZhu = true; }
            try {
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
