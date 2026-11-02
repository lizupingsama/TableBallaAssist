'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const moduleSource = () => fs.readFileSync(path.join(__dirname, 'local_cues.js'), 'utf8');
const gameMethods = fs.readFileSync(path.join(__dirname, 'qa/local-cues-game.fixture.js'), 'utf8');
const actualSourcePath = process.env.POOL_GAME_SOURCE || path.resolve(__dirname, '../../guide-extender/.cache/device-original-main.js');
const actualSource = fs.existsSync(actualSourcePath) ? fs.readFileSync(actualSourcePath, 'utf8') : null;
function actualClass(name) {
    const start = actualSource.indexOf(`var ${name}=function`);
    const end = actualSource.indexOf(`__reflect(${name}.prototype`, start);
    assert.ok(start >= 0 && end > start, `${name} class not found in inspected script`);
    return actualSource.slice(start, end) + `__reflect(${name}.prototype,"${name}");`;
}

class Element {
    constructor(tag) {
        this.tagName = tag; this.style = {}; this.children = []; this.events = {};
        this.attributes = {}; this.value = ''; this.checked = false; this.textContent = '';
    }
    appendChild(node) { node.parentNode = this; this.children.push(node); if (this.tagName === 'select' && this.children.length === 1) this._selectMissing = false; return node; }
    removeChild(node) { this.children = this.children.filter(item => item !== node); node.parentNode = null; if (this.tagName === 'select' && node.value === this._value) { this._value = undefined; this._selectMissing = false; } return node; }
    setAttribute(key, value) { this.attributes[key] = String(value); }
    getAttribute(key) { return this.attributes[key] ?? null; }
    addEventListener(type, listener) { (this.events[type] ||= []).push(listener); }
    removeEventListener(type, listener) { this.events[type] = (this.events[type] || []).filter(item => item !== listener); }
    fire(type = 'click') { for (const listener of this.events[type] || []) listener({target: this, stopPropagation() {}}); }
    get firstChild() { return this.children[0] || null; }
    get options() { return this.children.filter(child => child.tagName === 'option'); }
    get value() {
        if (this.tagName !== 'select') return this._value ?? '';
        if (this.children.some(child => child.value === this._value)) return this._value;
        return this._selectMissing ? '' : this.options[0]?.value ?? '';
    }
    set value(value) {
        value = String(value);
        if (this.tagName !== 'select') { this._value = value; return; }
        this._value = this.children.some(child => child.value === value) ? value : undefined;
        this._selectMissing = this._value === undefined;
    }
    set innerHTML(value) { if (value === '') { for (const child of this.children) child.parentNode = null; this.children = []; } }
    get innerHTML() { return ''; }
}

function fixture(saved = new Map()) {
    const body = new Element('body');
    const panel = new Element('div'); panel.id = 'poolguide-live-controls'; body.appendChild(panel);
    function find(node, id) { if (node.id === id) return node; for (const child of node.children) { const found = find(child, id); if (found) return found; } return null; }
    const configs = [
        {id: 90001, name: '已拥有基础杆', force: 420, line: 280, spin: 560, color: 1, fxbag: [[1, 501]]},
        {id: 90002, name: '未拥有试验杆', force: 980, line: 840, spin: 1260, color: 13, fxbag: [[13, 502], [14, 503]]},
        {id: 90003, name: '缺失资源杆', force: 700, line: 560, spin: 420, color: 2, fxbag: [[2, 599]]}
    ];
    const resources = {
        501: {id: 501, color: 1, name: '基础外观', pic: 'owned_png', force: 420, line: 280, spin: 560},
        502: {id: 502, color: 13, name: '试验外观', pic: 'unowned_png', particle: 'testParticle', force: 980, line: 840, spin: 1260},
        503: {id: 503, color: 14, name: '试验变色', mc: 'testCueMc', force: 1120, line: 980, spin: 1400}
    };
    const network = [];
    function forbidden(name) { return function () { network.push(name); throw Error('Unexpected network action: ' + name); }; }
    const mainUser = Object.freeze({id: 42, usingCubeId: 90001, cueForce: 420, cueTipLine: 280, cueSpin: 560,
        cueConfig: configs[0], getCueColor() { return 1; }, equipBagCue: Object.freeze({id: 90001, color: 1, star: 2})});
    const stage = {$children: []};
    const intervals = new Map(); let timerId = 0;
    const s = {
        console, Math, Date, isFinite, JSON,
        document: {body, createElement: tag => new Element(tag), createTextNode: text => ({textContent: text}), getElementById: id => find(body, id)},
        localStorage: {getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key)},
        setInterval(callback) { intervals.set(++timerId, callback); return timerId; }, clearInterval(id) { intervals.delete(id); },
        setTimeout() { throw Error('Local cue module must reuse existing refresh scheduling'); }, clearTimeout() {},
        MainUser: {instance: mainUser}, BagModel: {instance: {getBagCue: id => id === 90001 ? mainUser.equipBagCue : undefined}},
        MessageHelper: {sendChangeCub: forbidden('equip')}, SocketManager: {instance: {send: forbidden('socket')}},
        FightSocketManager: {instance: {send: forbidden('fight')}},
        BaseDef: {gameType: '8ballpractice', CUR_CUE_SPIN: 560},
        GameType: {BALL_8_Practice: '8ballpractice', SNK_Practice: 'snookerpractice', BALL_8: '8ball1v1'},
        PoolMath: {CUE_PROPERTIES_MAX_POWER: 300, CUE_PROPERTIES_ACCURACY: .2, CUE_PROPERTIES_SPIN: .4},
        egret: {MainContext: {instance: {stage}}, Event: {REMOVED_FROM_STAGE: 'removedFromStage'},
            is: (object, name) => object && (object.__class__ === name || object.__gameClass === name)},
        cn: {ArtifactInfo: 'ArtifactInfo', cue_res: 'cue_res'},
        cf: {getItem: (table, id) => table === 'ArtifactInfo' ? configs.find(cue => cue.id === Number(id)) : resources[id],
            getItemByCondition: table => table === 'ArtifactInfo' ? configs : Object.values(resources)},
        CueConfigModel: {instance: {getCueConfigData: id => configs.find(cue => cue.id === Number(id))}},
        LG: {getInfo: value => String(value)},
        GameViewBase: function GameViewBase() {},
        WindowBase: function WindowBase() {}, OnePlayerRules: function OnePlayerRules() {},
        SecureNumber: {CreateSecureNumber: value => value},
        __extends(derived, base) { derived.prototype = Object.create(base.prototype); derived.prototype.constructor = derived; },
        __reflect(prototype, name) { prototype.__class__ = name; },
        Rules8BallDanRenLianXi: function Rules8BallDanRenLianXi() {},
        RulesSnkLianXi: function RulesSnkLianXi() {},
        Rules8Ball: function Rules8Ball() {}
    };
    s.window = s;
    s.GameUtils = {getCueResByColor(id, color) {
        const config = configs.find(cue => cue.id === Number(id));
        const row = config?.fxbag.find(item => item[0] === Number(color));
        return resources[row?.[1]];
    }};
    for (const name of ['PoolLianXiView', 'SnkLianXiGameView', 'PoolOneVOneMain', 'CuePreviewGameView', 'PlaybackView']) {
        s[name] = {[name]: function () {}}[name];
        s[name].prototype = Object.create(s.GameViewBase.prototype);
        s[name].prototype.constructor = s[name];
        s[name].prototype.__class__ = name;
    }
    vm.createContext(s);
    if (actualSource) {
        // Evaluate only selected class definitions. None of their constructors or game startup code runs.
        for (const name of ['GameViewBase', 'PoolLianXiView', 'SnkLianXiGameView', 'Rules8BallDanRenLianXi', 'RulesSnkLianXi']) {
            vm.runInContext(actualClass(name), s);
        }
    } else vm.runInContext(gameMethods, s);
    s.GameViewBase.prototype.cleanDaoJuData = function () { throw Error('Do not clear live power-up state'); };
    s.GameViewBase.prototype.saveLevelDaoJuData = function () {};
    let currentGuides = [];
    const calls = {refresh: 0, dispose: 0};
    const state = {
        findGuides: () => currentGuides,
        controls: {refresh() { calls.refresh++; }, dispose() { calls.dispose++; }},
        configureBanks() {}, settings: {}, records: []
    };
    s.__poolGuideExtender = state;
    function scene(kind = 'PoolLianXiView', mode) {
        if (mode !== undefined) s.BaseDef.gameType = mode;
        else if (kind === 'PoolLianXiView') s.BaseDef.gameType = '8ballpractice';
        else if (kind === 'SnkLianXiGameView') s.BaseDef.gameType = 'snookerpractice';
        else s.BaseDef.gameType = '8ball1v1';
        const view = Object.create(s[kind].prototype);
        Object.assign(view, {stage, $stage: stage, parent: stage, visible: true, _isDanJi: true,
            _cueForce: 300, _cueTipLine: 200, _cueSpin: 400, _cueShowSpin: 560,
            _daojupowerBet: 1, _daojuaimBet: 1, _daojurotateBet: 1,
            _crossView: {update() {}}, isMainPlayerOperation() { return true; },
            dispose() { this.parent = null; this.stage = null; this.$stage = null; }, listeners: {},
            addEventListener(type, listener, context) { this.listeners[type] = () => listener.call(context); },
            removeEventListener(type) { delete this.listeners[type]; }});
        const rule = Object.create((kind === 'PoolLianXiView' ? s.Rules8BallDanRenLianXi : kind === 'SnkLianXiGameView' ? s.RulesSnkLianXi : s.Rules8Ball).prototype);
        rule.table = {m_cBalls: [], isMoving: () => false}; view.rule = rule;
        const guide = {_gameView: view, _isGuanZhan: false, updateGuide() { this.updates = (this.updates || 0) + 1; }};
        const cue = {_gameView: view, _cueId: 90001, _cueRes: resources[501], _cueStar: 2,
            _curCueColor: 1, visible: true, power: 0, visualGuide: guide, calls: [],
            get cueId() { return this._cueId; }, get cueRes() { return this._cueRes; },
            setCueData(config, color, star) { const res = s.GameUtils.getCueResByColor(config.id, color); if (!res) throw Error('missing cue resource'); this.showCue(config.id, res, star); },
            setCueResId(id, resId, star) { if (!resources[resId]) throw Error('missing cue resource'); this.showCue(id, resources[resId], star); },
            showCue(id, res, star) { if (this.failRes === res.id) throw Error('resource failed to load'); this._cueId = Number(id); this._cueRes = res; this._cueStar = star; this.calls.push({id, resId: res.id, star}); }};
        guide.visualCue = cue;
        view.poolCanvas = {visualCue: cue, rules: rule, englishControl: {englishX: .2, englishY: .1}, crossView: {updateData() {}}};
        currentGuides = [guide]; stage.$children = [view];
        return {view, cue, guide, rule};
    }
    vm.runInContext(moduleSource(), s);
    const api = s.__poolGuideLocalCues.attach(state);
    return {s, state, api, scene, saved, configs, resources, network, intervals, calls,
        setGuides(guides) { currentGuides = guides; },
        refresh() { state.controls.refresh(); }, get: id => find(body, id)};
}

function globalStats(s) { return [s.PoolMath.CUE_PROPERTIES_MAX_POWER, s.PoolMath.CUE_PROPERTIES_ACCURACY, s.PoolMath.CUE_PROPERTIES_SPIN, s.BaseDef.CUR_CUE_SPIN]; }
function viewStats(view) { return [view._cueForce, view._cueTipLine, view._cueSpin, view._cueShowSpin]; }
function close(actual, expected) {
    assert.equal(actual.length, expected.length);
    for (let index = 0; index < actual.length; index++) {
        assert.ok(Math.abs(actual[index] - expected[index]) < 1e-10, `index ${index}: ${actual[index]} differs from ${expected[index]}`);
    }
}

test('inspected source matches the gameplay method fixture and both practice scene identities',
    {skip: !fs.existsSync(actualSourcePath)}, () => {
        const source = fs.readFileSync(actualSourcePath, 'utf8');
        for (const name of ['setShootBallData', 'updateShootBallData']) {
            const prefix = `t.prototype.${name}=function`;
            const start = source.indexOf(prefix);
            assert.ok(start >= 0, name);
            const bodyStart = source.indexOf('{', start); let depth = 1, end = bodyStart + 1;
            for (; depth && end < source.length; end++) {
                if (source[end] === '{') depth++;
                else if (source[end] === '}') depth--;
            }
            assert.ok(gameMethods.includes(source.slice(start, end)), `${name}: source differs from stored real-method fixture`);
        }
        assert.ok(source.includes('t.cueDataRate=1.4'));
        for (const [name, type, rule] of [
            ['PoolLianXiView', 'BALL_8_Practice', 'Rules8BallDanRenLianXi'],
            ['SnkLianXiGameView', 'SNK_Practice', 'RulesSnkLianXi']
        ]) {
            const start = source.indexOf(`var ${name}=function`);
            const end = source.indexOf(`__reflect(${name}.prototype`, start);
            assert.ok(start >= 0 && end > start);
            const scene = source.slice(start, end);
            assert.ok(scene.includes(`BaseDef.gameType=GameType.${type}`));
            assert.ok(scene.includes(`new ${rule}`));
        }
    });

test('unowned cues and variants are searchable without adding them to the account bag', () => {
    const f = fixture();
    const list = f.api.list('90002', 0, 20);
    assert.equal(list.total, 1); assert.equal(list.items[0].id, 90002);
    assert.equal(f.api.list('试验', 0, 20).items[0].id, 90002);
    assert.equal(list.items[0].resources.length, 2);
    assert.equal(f.s.BagModel.instance.getBagCue(90002), undefined);
    assert.deepEqual(f.network, []);
});

test('attach is idempotent, mounts one panel, and reuses the existing scheduler', () => {
    const f = fixture();
    assert.equal(f.s.__poolGuideLocalCues.attach(f.state), f.api);
    assert.ok(f.get('poolguide-cue-options')); assert.ok(f.get('poolguide-cue-apply'));
    assert.equal(f.intervals.size, 0);
    f.refresh(); assert.equal(f.calls.refresh, 1);
});

test('a practice checkbox draft survives periodic refresh before pressing apply', () => {
    const f = fixture(); f.scene();
    f.get('poolguide-cue-search').value = '90002'; f.get('poolguide-cue-search').fire('input');
    assert.equal(f.get('poolguide-cue-select').value, '90002');
    f.get('poolguide-cue-practice').checked = true;
    f.refresh(); f.refresh();
    assert.equal(f.get('poolguide-cue-practice').checked, true);
    f.get('poolguide-cue-apply').fire();
    assert.equal(f.api.status().practiceActive, true);
});

test('the cue list is paged and can return to the previous page without creating all options', () => {
    const f = fixture();
    for (let index = 0; index < 45; index++) {
        f.configs.push({id: 91000 + index, name: '分页测试 ' + index, force: 420, line: 280, spin: 560, color: 1, fxbag: [[1, 501]]});
    }
    f.get('poolguide-cue-search').value = ''; f.get('poolguide-cue-search').fire('input');
    const select = f.get('poolguide-cue-select'); const first = select.value;
    assert.equal(select.options.length, 20); assert.equal(f.get('poolguide-cue-previous').disabled, true);
    f.get('poolguide-cue-more').fire(); assert.equal(select.options.length, 20); assert.notEqual(select.value, first);
    assert.equal(f.get('poolguide-cue-previous').disabled, false);
    f.get('poolguide-cue-previous').fire(); assert.equal(select.value, first); assert.equal(select.options.length, 20);
});

test('unowned appearance and effect resources display without equipping or changing stats', () => {
    const f = fixture(); const {view, cue} = f.scene(); const before = globalStats(f.s);
    const status = f.api.configure({cueId: 90002, color: 14, resId: 503, practiceAttributes: false});
    assert.ok(!status.error); assert.equal(cue.cueId, 90002); assert.equal(cue.cueRes.id, 503);
    assert.deepEqual(globalStats(f.s), before); assert.deepEqual(viewStats(view), [300, 200, 400, 560]);
    assert.equal(f.s.MainUser.instance.usingCubeId, 90001); assert.deepEqual(f.network, []);
});

for (const kind of ['PoolLianXiView', 'SnkLianXiGameView']) test(`real game cue conversion is used in ${kind}`, () => {
    const f = fixture(); const {view, cue} = f.scene(kind); const original = globalStats(f.s);
    const status = f.api.configure({cueId: 90002, color: 13, resId: 502, practiceAttributes: true});
    assert.ok(!status.error); assert.equal(status.practiceActive, true); assert.equal(cue.cueId, 90002);
    close(viewStats(view), [700, 600, 900, 1260]);
    close(globalStats(f.s), [700, .6, .9, 1260]);
    f.api.reset(); assert.equal(cue.cueId, 90001); assert.equal(cue.cueRes.id, 501);
    assert.deepEqual(viewStats(view), [300, 200, 400, 560]); assert.deepEqual(globalStats(f.s), original);
    assert.deepEqual(f.network, []);
});

test('network, preview, replay, mismatched rule, and stale mode never receive practice stats', () => {
    const cases = [
        {kind: 'PoolOneVOneMain'}, {kind: 'CuePreviewGameView'}, {kind: 'PlaybackView'},
        {kind: 'PoolLianXiView', mode: '8ball1v1'},
        {kind: 'PoolOneVOneMain', mode: '8ballpractice'},
        {kind: 'PoolLianXiView', mutate: f => { f.current.rule = new f.s.Rules8Ball(); f.current.view.rule = f.current.rule; f.current.view.poolCanvas.rules = f.current.rule; }},
        {kind: 'PoolLianXiView', mutate: f => { f.current.guide._isGuanZhan = true; }},
        {kind: 'PoolLianXiView', mutate: f => { f.current.view.stage = null; f.current.view.$stage = null; f.current.view.parent = null; }}
    ];
    for (const item of cases) {
        const f = fixture(); f.current = f.scene(item.kind, item.mode); item.mutate?.(f);
        const before = globalStats(f.s), local = viewStats(f.current.view);
        const status = f.api.configure({cueId: 90002, color: 13, practiceAttributes: true});
        assert.equal(status.practiceActive, false, JSON.stringify(item));
        assert.deepEqual(globalStats(f.s), before, JSON.stringify(item));
        assert.deepEqual(viewStats(f.current.view), local, JSON.stringify(item));
        assert.deepEqual(f.network, []);
    }
});

test('opponent and spectator cues remain untouched', () => {
    const f = fixture(); const current = f.scene('PoolOneVOneMain');
    current.view.isMainPlayerOperation = () => false; current.guide._isGuanZhan = true;
    f.api.configure({cueId: 90002, color: 13, practiceAttributes: true}); f.refresh();
    assert.equal(current.cue.cueId, 90001); assert.deepEqual(f.network, []);
});

test('a staged preview sharing the practice runtime blocks and revokes shared physics overrides', () => {
    for (const alreadyApplied of [false, true]) {
        const f = fixture(); const practice = f.scene(); const before = globalStats(f.s);
        if (alreadyApplied) {
            assert.equal(f.api.configure({cueId: 90002, color: 13, practiceAttributes: true}).practiceActive, true);
        }
        const preview = f.scene('CuePreviewGameView');
        f.s.BaseDef.gameType = '8ballpractice';
        f.s.egret.MainContext.instance.stage.$children = [practice.view, preview.view];
        f.setGuides([practice.guide, preview.guide]);
        const status = alreadyApplied ? (f.refresh(), f.api.status()) :
            f.api.configure({cueId: 90002, color: 13, practiceAttributes: true});
        assert.equal(status.practiceActive, false, `alreadyApplied=${alreadyApplied}`);
        assert.deepEqual(globalStats(f.s), before);
        assert.deepEqual(viewStats(practice.view), [300, 200, 400, 560]);
        assert.deepEqual(viewStats(preview.view), [300, 200, 400, 560]);
        assert.equal(preview.cue.cueId, 90001);
        assert.deepEqual(f.network, []);
    }
});

test('leaving practice restores its view without overwriting next scene global physics', () => {
    const f = fixture(); const previous = f.scene();
    f.api.configure({cueId: 90002, color: 13, practiceAttributes: true});
    previous.view.stage = null; previous.view.$stage = null; previous.view.parent = null;
    f.scene('PoolOneVOneMain');
    Object.assign(f.s.PoolMath, {CUE_PROPERTIES_MAX_POWER: 777, CUE_PROPERTIES_ACCURACY: .77, CUE_PROPERTIES_SPIN: .66});
    f.s.BaseDef.CUR_CUE_SPIN = 888;
    f.refresh();
    assert.deepEqual(globalStats(f.s), [777, .77, .66, 888]);
    assert.deepEqual(viewStats(previous.view), [300, 200, 400, 560]);
    assert.equal(f.api.status().practiceActive, false);
});

test('selection is remembered per account, but never auto-applies after a new document or scene', () => {
    const saved = new Map(); const f = fixture(saved); f.scene();
    f.api.configure({cueId: 90002, color: 14, resId: 503, practiceAttributes: true});
    assert.ok(saved.size > 0);
    const next = fixture(saved); const current = next.scene(); next.refresh();
    assert.equal(current.cue.cueId, 90001); assert.equal(next.api.status().practiceActive, false);
    assert.deepEqual(globalStats(next.s), [300, .2, .4, 560]);
    assert.equal(next.get('poolguide-cue-select').value, '90002');
    assert.equal(next.get('poolguide-cue-resources').value, '503');
    assert.equal(next.get('poolguide-cue-color').value, '14');
    assert.equal(next.get('poolguide-cue-practice').checked, false);
});

test('changing the account revokes the active local appearance and practice stats', () => {
    const f = fixture(); const {cue, view} = f.scene();
    f.api.configure({cueId: 90002, color: 13, practiceAttributes: true});
    f.s.MainUser.instance = Object.freeze({...f.s.MainUser.instance, id: 43});
    f.refresh();
    assert.equal(cue.cueId, 90001); assert.equal(f.api.status().practiceActive, false);
    assert.deepEqual(viewStats(view), [300, 200, 400, 560]);
    assert.deepEqual(globalStats(f.s), [300, .2, .4, 560]);
    assert.deepEqual(f.network, []);
});

test('reset preserves newer legitimate cue and property updates received while override is active', () => {
    const f = fixture(); const {cue, view} = f.scene();
    f.api.configure({cueId: 90002, color: 13, practiceAttributes: true});
    view.setShootBallData(560, 420, 700, false);
    cue.showCue(90001, f.resources[501], 5);
    f.refresh();
    f.api.reset();
    close(viewStats(view), [400, 300, 500, 700]);
    close(globalStats(f.s), [400, .3, .5, 700]);
    assert.equal(cue.cueId, 90001); assert.equal(cue.cueRes.id, 501); assert.equal(cue._cueStar, 5);
});

test('choosing a practice cue never changes the pulled power or English control input', () => {
    const f = fixture(); const {cue, view} = f.scene();
    cue.power = 222; view.poolCanvas.englishControl.englishX = -.3; view.poolCanvas.englishControl.englishY = .7;
    f.api.configure({cueId: 90002, color: 13, practiceAttributes: true});
    assert.equal(cue.power, 222);
    assert.equal(view.poolCanvas.englishControl.englishX, -.3); assert.equal(view.poolCanvas.englishControl.englishY, .7);
    f.api.reset(); assert.equal(cue.power, 222);
    assert.equal(view.poolCanvas.englishControl.englishX, -.3); assert.equal(view.poolCanvas.englishControl.englishY, .7);
});

test('invalid ids, nonfinite attributes and missing resources preserve game state', () => {
    const f = fixture(); const {cue, view} = f.scene(); const before = globalStats(f.s);
    f.resources[599] = {id: 599, pic: '0', mc: '0'};
    assert.equal(f.api.list('90003', 0, 20).items[0].resources.length, 0,
        'string zero placeholders are not drawable cue resources');
    for (const selection of [{cueId: -1}, {cueId: 999999}, {cueId: 90003, color: 2, resId: 599}, {cueId: 90002, resId: 501}]) {
        assert.doesNotThrow(() => f.api.configure({...selection, practiceAttributes: true}));
        assert.equal(cue.cueId, 90001); assert.deepEqual(globalStats(f.s), before);
        assert.deepEqual(viewStats(view), [300, 200, 400, 560]);
    }
    assert.deepEqual(f.network, []);
});

test('resource exceptions roll back appearance and never leave practice physics active', () => {
    const f = fixture(); const {cue, view} = f.scene(); const before = globalStats(f.s); cue.failRes = 502;
    assert.doesNotThrow(() => f.api.configure({cueId: 90002, color: 13, resId: 502, practiceAttributes: true}));
    assert.equal(cue.cueId, 90001); assert.deepEqual(globalStats(f.s), before);
    assert.deepEqual(viewStats(view), [300, 200, 400, 560]);
    assert.ok(f.api.status().error);
});

test('nonfinite base properties never reach the game physics setter', () => {
    const f = fixture(); const {view} = f.scene(); const before = globalStats(f.s);
    f.configs[1].force = Infinity;
    const status = f.api.configure({cueId: 90002, color: 13, practiceAttributes: true});
    assert.equal(status.practiceActive, false); assert.ok(status.error);
    assert.deepEqual(globalStats(f.s), before); assert.deepEqual(viewStats(view), [300, 200, 400, 560]);
});

test('the scene dispose hook immediately restores appearance and practice physics', () => {
    const f = fixture(); const {cue, view} = f.scene();
    f.api.configure({cueId: 90002, color: 13, practiceAttributes: true});
    view.dispose();
    assert.equal(cue.cueId, 90001); assert.deepEqual(globalStats(f.s), [300, .2, .4, 560]);
    assert.deepEqual(viewStats(view), [300, 200, 400, 560]); assert.equal(f.api.status().practiceActive, false);
});

test('dispose restores current appearance and stats and releases its panel and wrappers', () => {
    const f = fixture(); const {cue, view} = f.scene();
    f.api.configure({cueId: 90002, color: 13, practiceAttributes: true});
    f.api.dispose();
    assert.equal(cue.cueId, 90001); assert.deepEqual(viewStats(view), [300, 200, 400, 560]);
    assert.deepEqual(globalStats(f.s), [300, .2, .4, 560]);
    assert.equal(f.get('poolguide-cue-options'), null); assert.equal(f.get('poolguide-cue-expand'), null);
    assert.equal(f.intervals.size, 0); f.refresh(); assert.equal(f.calls.refresh, 1);
});

module.exports = {fixture};
