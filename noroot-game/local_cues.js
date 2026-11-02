/* Local display choices and explicitly armed, isolated practice attributes. */
(function (root) {
    'use strict';
    var KEY = 'poolguide-local-cue-v1:';
    var FIELD_NAMES = ['_cueForce', '_cueTipLine', '_cueSpin', '_cueShowSpin'];
    var MATH_NAMES = ['CUE_PROPERTIES_MAX_POWER', 'CUE_PROPERTIES_ACCURACY', 'CUE_PROPERTIES_SPIN'];

    function own(object, name) { return Object.prototype.hasOwnProperty.call(object, name); }
    function integer(value) { return typeof value === 'number' && isFinite(value) && Math.floor(value) === value; }
    function validId(value) { return integer(value) && value > 0 && value <= 2147483647; }
    function number(value) { return typeof value === 'number' && isFinite(value); }
    function snapshot(object, names) {
        var result = {};
        for (var i = 0; i < names.length; i++) { result[names[i]] = object[names[i]]; }
        return result;
    }
    function equal(object, values, names) {
        for (var i = 0; i < names.length; i++) {
            if (object[names[i]] !== values[names[i]]) { return false; }
        }
        return true;
    }
    function copy(object, values, names) {
        for (var i = 0; i < names.length; i++) { object[names[i]] = values[names[i]]; }
    }
    function account() {
        try {
            var user = root.MainUser && root.MainUser.instance;
            return user && user.id !== undefined && user.id !== null ? String(user.id) : '';
        } catch (ignored) { return ''; }
    }
    function config(id) {
        if (!validId(id)) { return null; }
        try {
            if (root.CueConfigModel && root.CueConfigModel.instance) {
                return root.CueConfigModel.instance.getCueConfigData(id) || null;
            }
            return root.cf && root.cn ? root.cf.getItem(root.cn.ArtifactInfo, id) || null : null;
        } catch (ignored) { return null; }
    }
    function resources(cue) {
        var result = [];
        if (!cue || !Array.isArray(cue.fxbag) || !root.cf || !root.cn) { return result; }
        for (var i = 0; i < cue.fxbag.length; i++) {
            var pair = cue.fxbag[i];
            if (!Array.isArray(pair) || !validId(Number(pair[1]))) { continue; }
            try {
                var data = root.cf.getItem(root.cn.cue_res, Number(pair[1]));
                if (data && ((data.pic && String(data.pic) !== '0') || (data.mc && String(data.mc) !== '0'))) {
                    result.push({id: Number(pair[1]), color: Number(pair[0]) || 0,
                        name: '颜色 ' + pair[0] + ' · 资源 ' + pair[1], data: data});
                }
            } catch (ignored) {}
        }
        return result;
    }
    function title(cue) {
        try {
            if (root.LG && typeof root.LG.getInfo === 'function') {
                var value = root.LG.getInfo(cue.name);
                if (value) { return String(value); }
            }
        } catch (ignored) {}
        return cue.name === undefined ? '球杆 ' + cue.id : String(cue.name);
    }
    function listed(cue) {
        var variants = resources(cue), result = [];
        for (var i = 0; i < variants.length; i++) {
            result.push({id: variants[i].id, color: variants[i].color, name: variants[i].name});
        }
        return {id: Number(cue.id), name: title(cue), color: Number(cue.color) || 0,
            resources: result, force: cue.force, spin: cue.spin, line: cue.line};
    }
    function list(query, offset, limit) {
        query = String(query || '').toLowerCase();
        offset = integer(offset) && offset >= 0 ? offset : 0;
        limit = integer(limit) && limit > 0 ? Math.min(limit, 30) : 20;
        var source = [], matches = [], items = [];
        try {
            if (root.cf && root.cn && typeof root.cf.getItemByCondition === 'function') {
                source = root.cf.getItemByCondition(root.cn.ArtifactInfo, '', '', true) || [];
            }
            if (!Array.isArray(source)) {
                var converted = [];
                for (var key in source) { if (own(source, key)) { converted.push(source[key]); } }
                source = converted;
            }
            for (var i = 0; i < source.length; i++) {
                var cue = source[i];
                if (!cue || !validId(Number(cue.id))) { continue; }
                if (query && String(cue.id).indexOf(query) < 0 && title(cue).toLowerCase().indexOf(query) < 0) { continue; }
                matches.push(cue);
            }
            matches.sort(function (a, b) { return Number(a.id) - Number(b.id); });
            for (var n = offset; n < Math.min(matches.length, offset + limit); n++) { items.push(listed(matches[n])); }
        } catch (ignored) {}
        return {items: items, total: matches.length, offset: offset};
    }

    function attach(state) {
        if (state.localCues) { return state.localCues; }
        var selected = null, armedView = null, practice = false, records = [];
        var lastAccount = account(), disposed = false, busy = false, error = '', message = '';
        var ui = null, oldRefresh = null, wrappedRefresh = null, oldDispose = null, wrappedDispose = null;

        function guides() {
            try { return typeof state.findGuides === 'function' ? state.findGuides() || [] : []; }
            catch (ignored) { return []; }
        }
        function viewFor(guide) {
            var cue = guide && guide.visualCue;
            var view = guide && (guide._gameView || (cue && cue._gameView));
            if (!cue || !view || !view.stage || view.visible === false || guide._isGuanZhan ||
                view._isGuanZhan || view.isGuanZhan || view.isPlayback || view._isPlayback ||
                view._playback || !view.poolCanvas || view.poolCanvas.visualCue !== cue) { return null; }
            var name = view.__class__ || (view.constructor && view.constructor.name) || '';
            if (/Preview|Playback|Replay|Record|GuanZhan/i.test(name)) { return null; }
            return view;
        }
        function currentView() {
            var active = guides();
            for (var i = 0; i < active.length; i++) {
                var view = viewFor(active[i]);
                if (view) { return view; }
            }
            return null;
        }
        function practiceAllowed(view, guide) {
            if (!view || viewFor(guide) !== view || !root.BaseDef || !view.rule ||
                typeof view.setShootBallData !== 'function' || !root.PoolMath) { return false; }
            // PoolMath is shared by the game. Never leave a practice override in
            // force while another staged game/preview is sharing that runtime.
            var activeGuides = guides();
            for (var i = 0; i < activeGuides.length; i++) {
                var candidate = activeGuides[i];
                var other = candidate && (candidate._gameView || (candidate.visualCue && candidate.visualCue._gameView));
                if (other && other !== view && other.stage && other.visible !== false) { return false; }
            }
            var type = root.BaseDef.gameType;
            return (typeof root.PoolLianXiView === 'function' && view.constructor === root.PoolLianXiView &&
                type === '8ballpractice' && typeof root.Rules8BallDanRenLianXi === 'function' &&
                view.rule.constructor === root.Rules8BallDanRenLianXi) ||
                (typeof root.SnkLianXiGameView === 'function' && view.constructor === root.SnkLianXiGameView &&
                type === 'snookerpractice' && typeof root.RulesSnkLianXi === 'function' &&
                view.rule.constructor === root.RulesSnkLianXi);
        }
        function canRestoreMath(record) {
            var active = guides();
            for (var i = 0; i < active.length; i++) {
                var other = viewFor(active[i]);
                if (other && other !== record.view) { return false; }
            }
            return !root.BaseDef || root.BaseDef.gameType === record.gameType;
        }
        function restoreAttributes(record) {
            if (!record.attributes) { return; }
            var saved = record.attributes;
            copy(record.view, saved.fields, FIELD_NAMES);
            if (root.PoolMath && canRestoreMath(record) && equal(root.PoolMath, saved.applied, MATH_NAMES)) {
                copy(root.PoolMath, saved.math, MATH_NAMES);
                if (root.BaseDef && root.BaseDef.CUR_CUE_SPIN === saved.appliedSpin) {
                    root.BaseDef.CUR_CUE_SPIN = saved.spin;
                }
            }
            if (record.view.powerLabel && record.view.powerLabel.text === saved.appliedLabel) {
                record.view.powerLabel.text = saved.label;
            }
            record.attributes = null;
        }
        function restoreRecord(record) {
            restoreAttributes(record);
            if (record.cue.showCue === record.showWrapper) { record.cue.showCue = record.showOriginal; }
            if (record.view.setShootBallData === record.setWrapper) { record.view.setShootBallData = record.setOriginal; }
            if (record.view.dispose === record.disposeWrapper) { record.view.dispose = record.disposeOriginal; }
            if (record.changed && record.originalResource) {
                try { record.showOriginal.call(record.cue, record.originalId, record.originalResource, record.originalVariant); }
                catch (ignored) {}
            }
            record.changed = false;
        }
        function restoreAll() {
            var pending = records.slice(); records = [];
            for (var i = 0; i < pending.length; i++) { restoreRecord(pending[i]); }
        }
        function variant() {
            if (!selected) { return null; }
            var values = resources(config(selected.cueId));
            for (var i = 0; i < values.length; i++) { if (values[i].id === selected.resId) { return values[i]; } }
            return null;
        }
        function show(record) {
            var resource = variant();
            if (!resource || !armedView || record.view !== armedView) { return; }
            try {
                record.showOriginal.call(record.cue, selected.cueId, resource.data, 0);
                record.changed = true;
            } catch (problem) {
                error = '球杆资源暂不可用，已恢复原外观。';
                restoreAttributes(record);
                try { record.showOriginal.call(record.cue, record.originalId, record.originalResource, record.originalVariant); }
                catch (ignored) {}
                record.changed = false;
                record.failed = true;
            }
        }
        function applyAttributes(record, guide) {
            if (!record.changed || !practice || !practiceAllowed(record.view, guide)) { restoreAttributes(record); return; }
            if (record.attributes) { return; }
            var data = config(selected.cueId);
            if (!data || !number(data.force) || !number(data.line) || !number(data.spin) ||
                data.force <= 0 || data.line <= 0 || data.spin <= 0) {
                error = '缺少基础属性，保留原练习属性。'; return;
            }
            var saved = {fields: snapshot(record.view, FIELD_NAMES), math: snapshot(root.PoolMath, MATH_NAMES),
                spin: root.BaseDef.CUR_CUE_SPIN, label: record.view.powerLabel && record.view.powerLabel.text};
            record.attributes = saved;
            try {
                record.setOriginal.call(record.view, data.force, data.line, data.spin, false);
                saved.applied = snapshot(root.PoolMath, MATH_NAMES);
                saved.appliedSpin = root.BaseDef.CUR_CUE_SPIN;
                saved.appliedLabel = record.view.powerLabel && record.view.powerLabel.text;
            } catch (problem) {
                copy(record.view, saved.fields, FIELD_NAMES);
                copy(root.PoolMath, saved.math, MATH_NAMES);
                root.BaseDef.CUR_CUE_SPIN = saved.spin;
                record.attributes = null;
                error = '练习属性接口不可用，已恢复。';
            }
        }
        function watch(view, cue, guide) {
            for (var i = 0; i < records.length; i++) { if (records[i].cue === cue) { return records[i]; } }
            if (typeof cue.showCue !== 'function' || !cue.cueRes) { return null; }
            var record = {view: view, cue: cue, guide: guide, gameType: root.BaseDef && root.BaseDef.gameType,
                showOriginal: cue.showCue, originalId: cue.cueId, originalResource: cue.cueRes,
                originalVariant: 0, setOriginal: view.setShootBallData, disposeOriginal: view.dispose,
                attributes: null, changed: false, failed: false};
            record.showWrapper = function (id, resource, extra) {
                record.originalId = id; record.originalResource = resource; record.originalVariant = extra;
                record.failed = false;
                var result = record.showOriginal.apply(this, arguments);
                if (!busy && selected && armedView === view && viewFor(guide) === view) { show(record); }
                return result;
            };
            cue.showCue = record.showWrapper;
            if (typeof record.setOriginal === 'function') {
                record.setWrapper = function () {
                    restoreAttributes(record);
                    var result = record.setOriginal.apply(this, arguments);
                    if (!busy && selected && armedView === view) {
                        busy = true;
                        try { applyAttributes(record, guide); } finally { busy = false; }
                    }
                    return result;
                };
                view.setShootBallData = record.setWrapper;
            }
            if (typeof record.disposeOriginal === 'function') {
                record.disposeWrapper = function () {
                    if (armedView === view) { armedView = null; practice = false; }
                    restoreRecord(record);
                    var index = records.indexOf(record);
                    if (index >= 0) { records.splice(index, 1); }
                    return record.disposeOriginal.apply(this, arguments);
                };
                view.dispose = record.disposeWrapper;
            }
            records.push(record);
            return record;
        }
        function save() {
            if (!lastAccount) { return; }
            try {
                if (selected) { root.localStorage.setItem(KEY + lastAccount, JSON.stringify(selected)); }
                else { root.localStorage.removeItem(KEY + lastAccount); }
            } catch (ignored) {}
        }
        function read() {
            selected = null;
            if (!lastAccount) { return; }
            try {
                var stored = JSON.parse(root.localStorage.getItem(KEY + lastAccount) || 'null');
                if (stored && validId(stored.cueId) && validId(stored.resId) && integer(stored.color)) {
                    selected = {cueId: stored.cueId, color: stored.color, resId: stored.resId};
                }
            } catch (ignored) {}
        }
        function status() {
            var count = 0, active = false;
            for (var i = 0; i < records.length; i++) {
                if (records[i].changed) { count++; }
                if (records[i].attributes) { active = true; }
            }
            return {cueId: selected ? selected.cueId : null, color: selected ? selected.color : null,
                resId: selected ? selected.resId : null, practiceAttributes: practice,
                practiceActive: active, visualCount: count, message: message, error: error};
        }
        function refresh() {
            if (disposed || busy) { return status(); }
            busy = true;
            try {
                var id = account();
                if (id !== lastAccount) {
                    restoreAll(); armedView = null; practice = false; lastAccount = id; read();
                    message = '账号已切换；选择仅供本账号手动应用。';
                    if (ui) {
                        ui.search.value = selected ? String(selected.cueId) : ''; ui.offset = 0;
                        ui.practice.checked = false;
                        renderList(false);
                    }
                }
                var view = currentView();
                if (armedView && view !== armedView) {
                    restoreAll(); armedView = null; practice = false;
                    message = '已退出原球桌并恢复；新球桌需重新应用。';
                    if (ui) { ui.practice.checked = false; }
                }
                if (selected && armedView) {
                    var activeGuides = guides();
                    for (var g = 0; g < activeGuides.length; g++) {
                        var guide = activeGuides[g];
                        if (viewFor(guide) !== armedView) { continue; }
                        var record = watch(armedView, guide.visualCue, guide);
                        if (!record) { error = '当前球杆资源尚未就绪。'; continue; }
                        if (!record.changed && !record.failed) { show(record); }
                        applyAttributes(record, guide);
                    }
                    var result = status();
                    if (result.visualCount) {
                        message = '外观仅本机可见' + (result.practiceActive ? ' · 练习基础属性已应用' :
                            (practice ? ' · 当前场景禁止练习属性' : ' · 保持原击球属性'));
                    }
                }
                if (ui) {
                    var info = status();
                    ui.message.textContent = info.error || info.message || '选择后点击应用；外观和练习属性仅影响本机。';
                }
            } catch (problem) {
                error = '本地球杆暂不可用，已恢复原设置。';
                restoreAll(); armedView = null; practice = false;
            } finally { busy = false; }
            return status();
        }
        function configure(options) {
            if (disposed) { return status(); }
            refresh(); error = '';
            options = options || {};
            var cueId = own(options, 'cueId') ? options.cueId : selected && selected.cueId;
            var data = config(cueId), variants = resources(data), chosen = null;
            if (!data || !variants.length) { error = '未找到球杆或可用皮肤资源。'; return status(); }
            if (own(options, 'practiceAttributes') && typeof options.practiceAttributes !== 'boolean') {
                error = '练习属性开关无效。'; return status();
            }
            for (var i = 0; i < variants.length; i++) {
                if (own(options, 'resId') ? variants[i].id === options.resId :
                    own(options, 'color') ? variants[i].color === options.color : i === 0) { chosen = variants[i]; break; }
            }
            if (!chosen) { error = '该球杆没有所选颜色或皮肤。'; return status(); }
            restoreAll();
            selected = {cueId: cueId, color: chosen.color, resId: chosen.id};
            armedView = currentView(); practice = options.practiceAttributes === true;
            if (!armedView) { practice = false; message = '已记住选择；进入球桌后点击应用。'; }
            if (ui) { ui.practice.checked = practice; }
            save(); refresh(); return status();
        }
        function reset() {
            restoreAll(); armedView = null; practice = false; selected = null; error = '';
            if (ui) { ui.practice.checked = false; }
            message = '已恢复原球杆和练习属性。'; save(); refresh(); return status();
        }

        function renderList(preserve) {
            if (!ui) { return; }
            var page = list(ui.search.value, ui.offset, 20), previous = preserve ? ui.select.value : '';
            while (ui.select.firstChild) { ui.select.removeChild(ui.select.firstChild); }
            for (var i = 0; i < page.items.length; i++) {
                var option = root.document.createElement('option');
                option.value = String(page.items[i].id); option.textContent = page.items[i].name + ' · ' + page.items[i].id;
                ui.select.appendChild(option);
            }
            if (previous) { ui.select.value = previous; }
            if (!ui.select.value && page.items.length) { ui.select.value = String(page.items[0].id); }
            ui.more.disabled = page.offset + page.items.length >= page.total;
            ui.previous.disabled = page.offset === 0;
            ui.more.textContent = page.total ? '下一页（' + (page.offset + 1) + '–' + (page.offset + page.items.length) + '/' + page.total + '）' : '等待游戏配置加载';
            renderResources();
        }
        function renderResources() {
            var values = resources(config(Number(ui.select.value)));
            while (ui.resources.firstChild) { ui.resources.removeChild(ui.resources.firstChild); }
            while (ui.color.firstChild) { ui.color.removeChild(ui.color.firstChild); }
            for (var i = 0; i < values.length; i++) {
                var option = root.document.createElement('option');
                option.value = String(values[i].id); option.textContent = values[i].name;
                ui.resources.appendChild(option);
                var color = root.document.createElement('option');
                color.value = String(values[i].color); color.textContent = '颜色 ' + values[i].color;
                ui.color.appendChild(color);
            }
            if (selected && Number(ui.select.value) === selected.cueId) {
                ui.resources.value = String(selected.resId); ui.color.value = String(selected.color);
            }
        }
        function mount() {
            var doc = root.document, panel = doc && doc.getElementById('poolguide-live-controls');
            if (!panel) { return; }
            var expand = doc.createElement('button'), section = doc.createElement('div');
            expand.id = 'poolguide-cue-expand'; expand.type = 'button'; expand.textContent = '本地球杆 ▸';
            expand.setAttribute('aria-expanded', 'false'); expand.setAttribute('aria-controls', 'poolguide-cue-options');
            expand.style.cssText = 'font:inherit;color:#e7f6f3;background:transparent;border:0;padding:8px 2px;min-height:36px;';
            section.id = 'poolguide-cue-options'; section.style.cssText = 'display:none;max-width:260px;max-height:60vh;overflow-y:auto;';
            function field(label, tag, suffix) {
                var container = doc.createElement('label'), caption = doc.createElement('span'), input = doc.createElement(tag);
                caption.textContent = label; input.id = 'poolguide-cue-' + suffix; input.setAttribute('aria-label', label);
                container.style.cssText = 'display:block;margin:6px 0;';
                input.style.cssText = 'font:inherit;color:#e7f6f3;background:#152d36;border:1px solid #9ab7bb;border-radius:4px;min-height:34px;max-width:100%;box-sizing:border-box;';
                container.appendChild(caption); container.appendChild(input); section.appendChild(container); return input;
            }
            var search = field('名称 / ID ', 'input', 'search'); search.type = 'search';
            var select = field('球杆 ', 'select', 'select');
            var color = field('颜色 ', 'select', 'color');
            var resource = field('皮肤 / 特效 ', 'select', 'resources');
            var check = field('练习属性（仅本地练习） ', 'input', 'practice'); check.type = 'checkbox';
            function button(text, suffix) {
                var element = doc.createElement('button'); element.type = 'button'; element.id = 'poolguide-cue-' + suffix;
                element.textContent = text; element.style.cssText = 'font:inherit;color:#0b1b22;background:#68e8c9;border:0;border-radius:4px;padding:8px;margin:3px;min-height:36px;';
                section.appendChild(element); return element;
            }
            var previous = button('上一页', 'previous'), more = button('下一页', 'more');
            var apply = button('应用并记住', 'apply'), restore = button('恢复原球杆', 'reset');
            var feedback = doc.createElement('div'); feedback.id = 'poolguide-cue-message';
            feedback.setAttribute('aria-live', 'polite'); feedback.style.cssText = 'font-size:11px;color:#b3cdc9;margin-top:6px;';
            section.appendChild(feedback); panel.appendChild(expand); panel.appendChild(section);
            ui = {expand: expand, section: section, search: search, select: select, color: color,
                resources: resource, practice: check, previous: previous, more: more, message: feedback, offset: 0};
            search.value = selected ? String(selected.cueId) : '';
            expand.addEventListener('click', function (event) {
                event.stopPropagation(); var opened = section.style.display === 'none';
                section.style.display = opened ? 'block' : 'none'; expand.textContent = '本地球杆 ' + (opened ? '▾' : '▸');
                expand.setAttribute('aria-expanded', String(opened)); if (opened) { renderList(true); }
            });
            search.addEventListener('input', function () { ui.offset = 0; renderList(false); });
            select.addEventListener('change', renderResources);
            color.addEventListener('change', function () {
                var values = resources(config(Number(select.value)));
                for (var i = 0; i < values.length; i++) { if (values[i].color === Number(color.value)) { resource.value = String(values[i].id); break; } }
            });
            resource.addEventListener('change', function () {
                var values = resources(config(Number(select.value)));
                for (var i = 0; i < values.length; i++) { if (values[i].id === Number(resource.value)) { color.value = String(values[i].color); break; } }
            });
            more.addEventListener('click', function (event) { event.stopPropagation(); ui.offset += 20; renderList(false); });
            previous.addEventListener('click', function (event) { event.stopPropagation(); ui.offset = Math.max(0, ui.offset - 20); renderList(false); });
            apply.addEventListener('click', function (event) {
                event.stopPropagation(); configure({cueId: Number(select.value), resId: Number(resource.value), practiceAttributes: check.checked === true}); refresh();
            });
            restore.addEventListener('click', function (event) { event.stopPropagation(); reset(); });
            renderList(false);
        }
        function dispose() {
            if (disposed) { return; }
            restoreAll(); armedView = null; practice = false; disposed = true;
            if (state.controls) {
                if (state.controls.refresh === wrappedRefresh) { state.controls.refresh = oldRefresh; }
                if (state.controls.dispose === wrappedDispose) { state.controls.dispose = oldDispose; }
            }
            if (ui) {
                if (ui.expand.parentNode) { ui.expand.parentNode.removeChild(ui.expand); }
                if (ui.section.parentNode) { ui.section.parentNode.removeChild(ui.section); }
                ui = null;
            }
            if (state.localCues === api) { state.localCues = null; }
        }
        var api = {list: list, configure: configure, reset: reset, refresh: refresh, dispose: dispose, status: status};
        state.localCues = api; read();
        if (state.controls && typeof state.controls.refresh === 'function') {
            oldRefresh = state.controls.refresh;
            wrappedRefresh = function () { var value = oldRefresh.apply(this, arguments); refresh(); return value; };
            state.controls.refresh = wrappedRefresh;
        }
        if (state.controls && typeof state.controls.dispose === 'function') {
            oldDispose = state.controls.dispose;
            wrappedDispose = function () { dispose(); return oldDispose.apply(this, arguments); };
            state.controls.dispose = wrappedDispose;
        }
        try { mount(); } catch (ignored) { message = '面板暂不可用，可稍后重开。'; }
        refresh(); return api;
    }
    root.__poolGuideLocalCues = {attach: attach};
}(window));
