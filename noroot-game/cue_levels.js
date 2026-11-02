/* Reconstruct the client's configured level/star/quality endpoint without
 * modifying its inventory, configuration records, or server equipment.
 * Formula: FreeCueView.initDataInId / award panel, main script lines 69/109.
 * Limits: CueUpDetailView.showLevel/showQuality, main script line 143.
 */
(function (root) {
    'use strict';
    var ATTRIBUTES = ['force', 'line', 'spin', 'time'];

    function finite(value) { return typeof value === 'number' && isFinite(value); }
    function integer(value) { return finite(value) && Math.floor(value) === value; }
    function identifier(value) { return integer(value) && value > 0 && value <= 2147483647; }
    function tableName(name) { return root.cn && root.cn[name] !== undefined ? root.cn[name] : name; }
    function item(name, id) {
        try {
            return root.cf && typeof root.cf.getItem === 'function' ? root.cf.getItem(tableName(name), id) || null : null;
        } catch (ignored) { return null; }
    }
    function rows(name, group) {
        try {
            var values = null;
            if (root.cf && typeof root.cf.getItemByCondition === 'function') {
                values = root.cf.getItemByCondition(tableName(name), 'group', group, true);
            } else if (root.cf && typeof root.cf.getConfigArr_new === 'function') {
                values = root.cf.getConfigArr_new(tableName(name));
            }
            if (!Array.isArray(values)) { return null; }
            var result = [];
            for (var i = 0; i < values.length; i++) {
                if (values[i] && Number(values[i].group) === Number(group)) { result.push(values[i]); }
            }
            return result;
        } catch (ignored) { return null; }
    }
    function cueName(cue) {
        try {
            if (root.LG && typeof root.LG.getInfo === 'function') {
                var translated = root.LG.getInfo(cue.name);
                if (translated) { return String(translated); }
            }
            var language = item('LanguageInfo', cue.name);
            if (language && language.cn) { return String(language.cn); }
        } catch (ignored) {}
        return cue.name === undefined ? '球杆 ' + cue.id : String(cue.name);
    }
    function sameAttributes(left, right, suffix) {
        for (var i = 0; i < ATTRIBUTES.length; i++) {
            var key = ATTRIBUTES[i] + suffix;
            if (left[key] !== right[key]) { return false; }
        }
        return true;
    }
    function endpoint(values, field, color, suffix) {
        var chosen = null;
        for (var i = 0; i < values.length; i++) {
            var value = values[i];
            if (color !== null && Number(value.color) !== color) { continue; }
            if (!integer(value[field]) || value[field] < (field === 'level' ? 1 : 0)) { return null; }
            if (!chosen || value[field] > chosen[field]) { chosen = value; }
        }
        if (!chosen) { return null; }
        for (var n = 0; n < values.length; n++) {
            var candidate = values[n];
            if ((color === null || Number(candidate.color) === color) && candidate[field] === chosen[field]) {
                // Some shipped UR groups have duplicate level=1 rows with
                // identical additions. Different values at one rank are unsafe.
                if (!sameAttributes(candidate, chosen, suffix)) { return null; }
                if (Number(candidate.id) < Number(chosen.id)) { chosen = candidate; }
            }
        }
        return chosen;
    }
    function hasParticles(resource) {
        if (!resource || !resource.particle || String(resource.particle) === '0') { return false; }
        try {
            var data = typeof resource.particle === 'string' ? JSON.parse(resource.particle) : resource.particle;
            if (!data || !Array.isArray(data.arr)) { return false; }
            for (var i = 0; i < data.arr.length; i++) {
                if (data.arr[i] && Array.isArray(data.arr[i].res) && data.arr[i].res.length > 0) { return true; }
            }
            return false;
        } catch (ignored) { return false; }
    }
    function drawable(resource) {
        return !!(resource && ((resource.pic && String(resource.pic) !== '0') ||
            (resource.mc && String(resource.mc) !== '0') || hasParticles(resource)));
    }
    function visual(cue, color) {
        if (!Array.isArray(cue.fxbag) || !cue.fxbag.length) { return null; }
        var first = cue.fxbag[0], selected = null;
        for (var i = 0; i < cue.fxbag.length; i++) {
            var pair = cue.fxbag[i];
            if (Array.isArray(pair) && Number(pair[0]) === color) { selected = pair; break; }
        }
        // Match GameUtils.getCueResByColor: use this exact cue's first
        // resource when it has no separate skin for the endpoint color.
        var fallback = selected === null;
        selected = selected || first;
        if (!Array.isArray(selected) || !identifier(Number(selected[1]))) { return null; }
        var resource = item('cue_res', Number(selected[1]));
        if (!drawable(resource)) { return null; }
        return {resId: Number(selected[1]), resourceColor: Number(selected[0]),
            resourceFallback: fallback, hasParticle: hasParticles(resource)};
    }
    function unlockedBuffs(cue, color, star) {
        var result = [];
        if (!Array.isArray(cue.buff)) { return result; }
        for (var i = 0; i < cue.buff.length; i++) {
            var pair = cue.buff[i];
            if (!Array.isArray(pair) || !Array.isArray(pair[0]) || !Array.isArray(pair[1])) { continue; }
            if (star + 10 * color >= Number(pair[0][0]) + 10 * Number(pair[0][1])) {
                var existing = null;
                for (var n = 0; n < result.length; n++) { if (result[n].id === pair[1][0]) { existing = result[n]; break; } }
                if (existing) { existing.value = Math.max(existing.value, pair[1][1]); }
                else { result.push({id: pair[1][0], value: pair[1][1]}); }
            }
        }
        return result;
    }
    function profile(cueId) {
        var result = {cueId: cueId, name: '', supported: false, maxed: false, reason: '',
            dimensions: {level: false, star: false, quality: false, nativeVisual: false,
                legacyTalent: false, serverBonuses: false}};
        function fail(reason) { result.reason = reason; return result; }
        if (!identifier(cueId)) { return fail('球杆 ID 无效。'); }
        var cue = item('ArtifactInfo', cueId);
        if (!cue && root.CueConfigModel && root.CueConfigModel.instance) {
            try { cue = root.CueConfigModel.instance.getCueConfigData(cueId); } catch (ignored) {}
        }
        if (!cue || !identifier(Number(cue.group)) || !integer(cue.color) || cue.color < 0) {
            return fail('球杆配置尚未就绪。');
        }
        result.name = cueName(cue); result.group = Number(cue.group);
        for (var a = 0; a < ATTRIBUTES.length; a++) {
            if (!finite(cue[ATTRIBUTES[a]]) || cue[ATTRIBUTES[a]] <= 0) { return fail('球杆基础属性不完整。'); }
        }
        var levels = rows('cue_levelinfo', cue.group), stars = rows('ArtifactStar', cue.group);
        var quality = rows('ballArmQuality', cue.group);
        if (!levels || !levels.length || !stars || !stars.length || !quality) {
            return fail('缺少等级、星级或突破配置，保留原击球属性。');
        }
        var color = cue.color, visited = 0;
        while (visited++ < 64) {
            var transition = null;
            for (var q = 0; q < quality.length; q++) {
                if (Number(quality[q].color) === color) {
                    if (transition && transition.condition !== quality[q].condition) {
                        return fail('突破配置存在冲突，保留原击球属性。');
                    }
                    transition = quality[q];
                }
            }
            if (!transition) { break; }
            if (transition.condition !== undefined && (!finite(transition.condition) || transition.condition < 0)) {
                return fail('突破条件格式未受支持，保留原击球属性。');
            }
            var currentStar = endpoint(stars, 'star', color, '_rate');
            var nextStar = endpoint(stars, 'star', color + 1, '_rate');
            if (!currentStar || !nextStar) { return fail('突破后的星级配置不完整。'); }
            if (finite(transition.condition) && transition.condition > currentStar.star) {
                return fail('突破需求超过本品质最高星级，配置不一致。');
            }
            color++;
        }
        if (visited > 64) { return fail('突破配置超出已验证范围。'); }
        var star = endpoint(stars, 'star', color, '_rate');
        var level = endpoint(levels, 'level', null, '_up');
        if (!star || !level || !identifier(Number(star.id)) || !identifier(Number(level.id))) {
            return fail('最高等级或最高星级无法确定。');
        }
        // Current shipped level conditions are [requiredStar, requiredColor].
        // At a full endpoint their requirements must be met; an unknown shape
        // remains unsupported instead of silently taking a later group's rank.
        if (level.condition && level.condition !== 0) {
            if (!Array.isArray(level.condition) || level.condition.length !== 2 ||
                !finite(level.condition[0]) || !finite(level.condition[1]) ||
                star.star < level.condition[0] || color < level.condition[1]) {
                return fail('最高等级条件无法由当前球杆达到。');
            }
        }
        var appearance = visual(cue, color);
        if (!appearance) { return fail('最高品质的本杆皮肤资源不可用。'); }
        var computed = {};
        for (var n = 0; n < ATTRIBUTES.length; n++) {
            var key = ATTRIBUTES[n], rate = star[key + '_rate'], addition = level[key + '_up'];
            if (!finite(rate) || rate < 0 || !finite(addition) || addition < 0) {
                return fail('最高等级属性加成不完整。');
            }
            computed[key] = Math.floor(cue[key] * (100 + rate) / 100) + addition;
            if (!finite(computed[key]) || computed[key] <= 0) { return fail('最高等级属性无效。'); }
        }
        for (var p = 0; p < ATTRIBUTES.length; p++) { result[ATTRIBUTES[p]] = computed[ATTRIBUTES[p]]; }
        result.color = color; result.level = level.level; result.levelId = Number(level.id);
        result.levelShow = finite(level.level_show) ? level.level_show : level.level;
        result.star = star.star; result.starId = Number(star.id);
        result.resId = appearance.resId; result.resourceColor = appearance.resourceColor;
        result.resourceFallback = appearance.resourceFallback; result.hasParticle = appearance.hasParticle;
        result.buffs = unlockedBuffs(cue, color, star.star);
        result.dimensions.level = true; result.dimensions.star = true; result.dimensions.quality = true;
        result.dimensions.nativeVisual = true; result.supported = true; result.maxed = true;
        result.reason = '按等级、星级和最高突破配置计算；不含服务器活动或旧天赋加成。';
        if (result.resourceFallback) { result.reason += '本杆没有独立最高品质皮肤，沿用原生资源回退。'; }
        return result;
    }
    root.__poolGuideCueLevels = {profile: profile, hasVisual: drawable};
}(window));
