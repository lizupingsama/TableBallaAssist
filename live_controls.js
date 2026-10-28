/* Small in-game controls. No Android overlay permission or game restart is needed. */
(function (root) {
    'use strict';
    var ID = 'poolguide-live-controls';
    var COUNT_KEY = 'poolguide-bank-count-v1';
    function mount(state) {
        var doc = root.document;
        if (!state || !doc || typeof doc.getElementById !== 'function' || !doc.body) { return; }
        if (state.controls) { state.controls.dispose(); }
        var existing = doc.getElementById(ID);
        if (existing && existing.parentNode) { existing.parentNode.removeChild(existing); }
        var panel = doc.createElement('div');
        panel.id = ID;
        panel.style.cssText = 'position:fixed;right:8px;bottom:30px;z-index:2147483647;pointer-events:auto;color:#e7f6f3;background:rgba(11,27,34,.92);border:1px solid #68e8c9;border-radius:8px;padding:6px;font:13px sans-serif;max-width:calc(100vw - 24px);box-sizing:border-box;';
        var row = doc.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:6px;';
        var toggle = doc.createElement('button');
        toggle.type = 'button';
        toggle.setAttribute('aria-label', '反弹预测开关');
        toggle.style.cssText = 'font:inherit;color:#0b1b22;background:#68e8c9;border:0;border-radius:5px;padding:8px 10px;min-height:36px;';
        function stepButton(text, label) {
            var button = doc.createElement('button');
            button.type = 'button';
            button.textContent = text;
            button.setAttribute('aria-label', label);
            button.style.cssText = 'font:inherit;color:#e7f6f3;background:#152d36;border:1px solid #9ab7bb;border-radius:5px;min-width:30px;min-height:36px;padding:5px;';
            return button;
        }
        var minus = stepButton('−', '减少反弹次数');
        var plus = stepButton('＋', '增加反弹次数');
        var count = doc.createElement('span');
        count.setAttribute('aria-label', '预测反弹次数');
        count.style.cssText = 'min-width:36px;text-align:center;';
        var hint = doc.createElement('div');
        hint.style.cssText = 'font-size:10px;color:#b3cdc9;margin-top:4px;max-width:240px;';
        row.appendChild(toggle);
        row.appendChild(minus);
        row.appendChild(count);
        row.appendChild(plus);
        panel.appendChild(row);
        panel.appendChild(hint);
        var pocketButtons = [];
        var pocketHint = null;
        if (typeof state.configurePocket === 'function') {
            var expand = doc.createElement('button');
            expand.type = 'button';
            expand.id = 'poolguide-pocket-expand';
            expand.textContent = '入袋开关 ▸';
            expand.setAttribute('aria-expanded', 'false');
            expand.style.cssText = 'font:inherit;color:#e7f6f3;background:transparent;border:0;padding:8px 2px;min-height:36px;';
            var pocketPanel = doc.createElement('div');
            pocketPanel.id = 'poolguide-pocket-options';
            pocketPanel.style.display = 'none';
            var options = [
                ['firstHitPocket', '首碰目标必进'],
                ['snookerAllReds', '斯诺克：碰红全红入袋'],
                ['eightBallAllButBlack', '中八：碰球非黑八全入袋']
            ];
            for (var p = 0; p < options.length; p++) {
                (function (key, label) {
                    var button = doc.createElement('button');
                    button.type = 'button';
                    button.id = 'poolguide-toggle-' + key;
                    button.setAttribute('aria-label', label);
                    button.style.cssText = 'display:block;width:100%;text-align:left;font:inherit;color:#0b1b22;border:0;border-radius:5px;margin:4px 0;padding:8px;min-height:40px;';
                    button.addEventListener('click', function (event) {
                        event.stopPropagation();
                        try {
                            state.configurePocket(key, !state.settings[key]);
                            pocketHint.textContent = '开启从下一杆生效；关闭阻止后续触发。已入袋球不会还原。';
                        } catch (error) { pocketHint.textContent = String(error); }
                        refresh();
                    });
                    pocketButtons.push({key: key, label: label, button: button});
                    pocketPanel.appendChild(button);
                }(options[p][0], options[p][1]));
            }
            pocketHint = doc.createElement('div');
            pocketHint.style.cssText = 'font-size:10px;color:#b3cdc9;max-width:240px;margin-top:6px;';
            pocketHint.setAttribute('aria-live', 'polite');
            pocketHint.textContent = '开启从下一杆生效；模式专用开关优先，原有犯规规则继续生效。';
            pocketPanel.appendChild(pocketHint);
            expand.addEventListener('click', function (event) {
                event.stopPropagation();
                var opened = pocketPanel.style.display === 'none';
                pocketPanel.style.display = opened ? 'block' : 'none';
                expand.textContent = '入袋开关 ' + (opened ? '▾' : '▸');
                expand.setAttribute('aria-expanded', String(opened));
            });
            panel.appendChild(expand);
            panel.appendChild(pocketPanel);
        }
        doc.body.appendChild(panel);
        function refresh() {
            toggle.textContent = '反弹预测：' + (state.settings.bankPrediction ? '开' : '关');
            toggle.setAttribute('aria-pressed', String(state.settings.bankPrediction));
            toggle.style.background = state.settings.bankPrediction ? '#68e8c9' : '#9ab7bb';
            count.textContent = state.settings.bankCount + ' 次';
            minus.disabled = state.settings.bankCount <= 1;
            plus.disabled = state.settings.bankCount >= 6;
            minus.style.opacity = minus.disabled ? '.4' : '1';
            plus.style.opacity = plus.disabled ? '.4' : '1';
            var plan = state.lastPrediction;
            if (!state.settings.bankPrediction) { hint.textContent = '未拉杆按满力预览，拉杆后跟随实际力度'; }
            else if (plan && plan.model === 'game-physics') {
                hint.textContent = (plan.shot.estimated ? '未拉杆：100% 满力预览' :
                    '当前力度：' + Math.round(plan.shot.power / plan.shot.maxPower * 100) + '%') +
                    (plan.truncated ? ' · 轨迹已截断' : '');
            } else {
                hint.textContent = state.physicsError || (plan && plan.model !== 'game-physics') ||
                    !root.__poolGuidePhysics || !root.__poolGuidePhysics.available() ?
                    '物理试算暂不可用，显示方向近似' : '未拉杆按满力预览，拉杆后跟随实际力度';
            }
            for (var p = 0; p < pocketButtons.length; p++) {
                var option = pocketButtons[p];
                var enabled = state.settings[option.key] === true;
                option.button.textContent = option.label + '：' + (enabled ? '开' : '关');
                option.button.setAttribute('aria-pressed', String(enabled));
                option.button.style.background = enabled ? '#68e8c9' : '#9ab7bb';
            }
            var badge = doc.getElementById('poolguide-status');
            if (badge) {
                badge.textContent = state.settings.bankPrediction ? '反弹预测 · 最多' + state.settings.bankCount + '次' :
                    '辅助线 ' + (state.settings.mode === 'fixed' ? state.settings.length : state.settings.factor + 'x');
                if (state.settings.firstHitPocket && state.pocketHooks) { badge.textContent += ' · 首碰必进'; }
                if (state.settings.snookerAllReds && state.pocketHooks) { badge.textContent += ' · 全红'; }
                if (state.settings.eightBallAllButBlack && state.pocketHooks) { badge.textContent += ' · 非黑八全入'; }
            }
        }
        function change(enabled, value) {
            state.configureBanks(enabled, Number(value));
            try { root.localStorage.setItem(COUNT_KEY, String(state.settings.bankCount)); } catch (ignored) {}
            refresh();
        }
        toggle.addEventListener('click', function (event) {
            event.stopPropagation();
            change(!state.settings.bankPrediction, state.settings.bankCount);
        });
        minus.addEventListener('click', function (event) {
            event.stopPropagation();
            change(state.settings.bankPrediction, Math.max(1, state.settings.bankCount - 1));
        });
        plus.addEventListener('click', function (event) {
            event.stopPropagation();
            change(state.settings.bankPrediction, Math.min(6, state.settings.bankCount + 1));
        });
        var stop = function (event) { event.stopPropagation(); };
        for (var e = 0; e < 4; e++) {
            panel.addEventListener(['touchstart', 'touchmove', 'touchend', 'mousedown'][e], stop);
        }
        try {
            var saved = Number(root.localStorage.getItem(COUNT_KEY));
            if (saved >= 1 && saved <= 6 && Math.floor(saved) === saved) {
                state.configureBanks(state.settings.bankPrediction, saved);
            }
        } catch (ignored) {}
        var timer = root.setInterval(function () {
            if (root[ '__poolGuideExtender' ] !== state) { dispose(); return; }
            if (state.settings.bankPrediction && !doc.hidden) {
                var guides = state.findGuides();
                for (var g = 0; g < guides.length; g++) {
                    var guide = guides[g];
                    if (!guide._isGuanZhan && (!guide.visualCue || guide.visualCue.visible !== false)) {
                        try { guide.updateGuide(); } catch (error) { state.physicsError = String(error); }
                    }
                }
            }
            refresh();
        }, 200);
        function dispose() {
            root.clearInterval(timer);
            if (panel.parentNode) { panel.parentNode.removeChild(panel); }
        }
        state.controls = {refresh: refresh, dispose: dispose};
        refresh();
    }
    root.__poolGuideControls = {mount: mount};
}(window));
