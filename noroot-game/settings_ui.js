/* Persistent settings extend the existing in-game panel without another timer. */
(function (root) {
    'use strict';
    var KEY = 'poolguide-embedded-settings-v1';
    var FIELDS = ['mode', 'length', 'factor', 'showSplit', 'bankPrediction', 'bankCount',
        'firstHitPocket', 'snookerAllReds', 'eightBallAllButBlack'];

    function snapshot(settings) {
        var value = {};
        for (var i = 0; i < FIELDS.length; i++) { value[FIELDS[i]] = settings[FIELDS[i]]; }
        return value;
    }
    function valid(name, value) {
        if (name === 'mode') { return value === 'fixed' || value === 'multiply'; }
        if (name === 'length') { return typeof value === 'number' && isFinite(value) && value >= 10 && value <= 1500; }
        if (name === 'factor') { return typeof value === 'number' && isFinite(value) && value >= 1 && value <= 30; }
        if (name === 'bankCount') { return typeof value === 'number' && Math.floor(value) === value && value >= 1 && value <= 6; }
        return typeof value === 'boolean';
    }
    function readSettings(defaults) {
        var settings = snapshot(defaults);
        try {
            var saved = JSON.parse(root.localStorage.getItem(KEY) || 'null');
            if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
                for (var i = 0; i < FIELDS.length; i++) {
                    var key = FIELDS[i];
                    if (valid(key, saved[key])) { settings[key] = saved[key]; }
                }
            }
        } catch (ignored) {}
        // The embedded config is authoritative over an older panel's count key.
        try { root.localStorage.setItem('poolguide-bank-count-v1', String(settings.bankCount)); } catch (ignored) {}
        return settings;
    }

    function attach(state) {
        if (state.embeddedSettings) { return state.embeddedSettings; }
        var doc = root.document;
        var panel = doc.getElementById('poolguide-live-controls');
        if (!panel) { throw new Error('game-controls-not-mounted'); }

        function persist() {
            try {
                root.localStorage.setItem(KEY, JSON.stringify(snapshot(state.settings)));
                return true;
            } catch (ignored) { return false; }
        }
        // Existing buttons keep using their original API; all their changes persist.
        var banks = state.configureBanks;
        state.configureBanks = function () {
            var result = banks.apply(state, arguments);
            persist();
            return result;
        };
        var pocket = state.configurePocket;
        state.configurePocket = function () {
            var result = pocket.apply(state, arguments);
            persist();
            return result;
        };

        var expand = doc.createElement('button');
        expand.id = 'poolguide-line-expand';
        expand.type = 'button';
        expand.textContent = '线长设置 ▸';
        expand.setAttribute('aria-expanded', 'false');
        expand.style.cssText = 'font:inherit;color:#e7f6f3;background:transparent;border:0;padding:8px 2px;min-height:36px;';
        var section = doc.createElement('div');
        section.id = 'poolguide-line-options';
        section.style.cssText = 'max-width:260px;';
        section.style.display = 'none';
        expand.setAttribute('aria-controls', section.id);

        function row(label, input) {
            var container = doc.createElement('label');
            container.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin:6px 0;';
            var caption = doc.createElement('span');
            caption.textContent = label;
            container.appendChild(caption);
            input.setAttribute('aria-label', label);
            input.style.cssText = 'font:inherit;max-width:112px;min-height:34px;color:#e7f6f3;background:#152d36;border:1px solid #9ab7bb;border-radius:4px;padding:4px;box-sizing:border-box;';
            container.appendChild(input);
            section.appendChild(container);
        }
        var mode = doc.createElement('select');
        mode.id = 'poolguide-line-mode';
        var fixed = doc.createElement('option'); fixed.value = 'fixed'; fixed.textContent = '固定长度'; mode.appendChild(fixed);
        var multiply = doc.createElement('option'); multiply.value = 'multiply'; multiply.textContent = '按倍数'; mode.appendChild(multiply);
        row('加长方式', mode);
        var length = doc.createElement('input');
        length.id = 'poolguide-line-length'; length.type = 'number'; length.min = '10'; length.max = '1500'; length.step = '10';
        row('直线长度（10–1500）', length);
        var factor = doc.createElement('input');
        factor.id = 'poolguide-line-factor'; factor.type = 'number'; factor.min = '1'; factor.max = '30'; factor.step = '1';
        row('加长倍数（1–30）', factor);
        var split = doc.createElement('input');
        split.id = 'poolguide-line-split'; split.type = 'checkbox';
        row('显示碰撞后分裂线', split);
        var apply = doc.createElement('button');
        apply.id = 'poolguide-line-apply'; apply.type = 'button'; apply.textContent = '应用并记住';
        apply.style.cssText = 'font:inherit;color:#0b1b22;background:#68e8c9;border:0;border-radius:5px;padding:8px;min-height:36px;width:100%;';
        var message = doc.createElement('div');
        message.id = 'poolguide-line-message';
        message.setAttribute('aria-live', 'polite');
        message.style.cssText = 'font-size:10px;color:#b3cdc9;margin-top:6px;';
        message.textContent = '直线模式使用线长；开启反弹时使用物理预测。设置自动记住。';
        section.appendChild(apply);
        section.appendChild(message);
        panel.appendChild(expand);
        panel.appendChild(section);

        function refresh() {
            mode.value = state.settings.mode;
            length.value = String(state.settings.length);
            factor.value = String(state.settings.factor);
            split.checked = state.settings.showSplit;
            length.disabled = mode.value !== 'fixed';
            factor.disabled = mode.value !== 'multiply';
        }
        function configure(patch) {
            var next = snapshot(state.settings);
            var names = ['mode', 'length', 'factor', 'showSplit'];
            for (var i = 0; i < names.length; i++) {
                var key = names[i];
                if (!Object.prototype.hasOwnProperty.call(patch, key)) { continue; }
                if (!valid(key, patch[key])) { throw new Error('长度需为 10–1500，倍数需为 1–30。'); }
                next[key] = patch[key];
            }
            for (var n = 0; n < names.length; n++) { state.settings[names[n]] = next[names[n]]; }
            // This API already invalidates physics caches and redraws active guides.
            state.configureBanks(state.settings.bankPrediction, state.settings.bankCount);
            var saved = persist();
            refresh();
            if (state.controls) { state.controls.refresh(); }
            return saved;
        }
        expand.addEventListener('click', function (event) {
            event.stopPropagation();
            var opened = section.style.display === 'none';
            section.style.display = opened ? 'block' : 'none';
            expand.textContent = '线长设置 ' + (opened ? '▾' : '▸');
            expand.setAttribute('aria-expanded', String(opened));
        });
        mode.addEventListener('change', function () {
            length.disabled = mode.value !== 'fixed';
            factor.disabled = mode.value !== 'multiply';
        });
        apply.addEventListener('click', function (event) {
            event.stopPropagation();
            try {
                var saved = configure({mode: mode.value, length: Number(length.value),
                    factor: Number(factor.value), showSplit: split.checked === true});
                message.textContent = saved ? '已应用并保存，重新打开游戏后继续生效。' : '已应用；当前无法保存，重新打开后恢复默认。';
            } catch (error) { message.textContent = String(error.message || error); }
        });
        state.embeddedSettings = {configure: configure, refresh: refresh};
        refresh();
        persist();
        return state.embeddedSettings;
    }
    root.__poolGuideEmbeddedSettings = {readSettings: readSettings, attach: attach};
}(window));
