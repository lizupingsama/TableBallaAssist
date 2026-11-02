'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const moduleSource = () => fs.readFileSync(path.join(__dirname, 'local_cues.js'), 'utf8');
const gameMethods = fs.readFileSync(path.join(__dirname, 'qa/local-cues-game.fixture.js'), 'utf8');
const sharedCueSnapshot = fs.readFileSync(path.join(__dirname, 'qa/shared-cue-turn.fixture.js'), 'utf8');
const actualSourcePath = process.env.POOL_GAME_SOURCE || path.resolve(__dirname, '../../guide-extender/.cache/device-original-main.js');
const actualSource = fs.existsSync(actualSourcePath) ? fs.readFileSync(actualSourcePath, 'utf8') : null;
function actualClass(name) {
    const start = actualSource.indexOf(`var ${name}=function`);
    const end = actualSource.indexOf(`__reflect(${name}.prototype`, start);
    assert.ok(start >= 0 && end > start, `${name} class not found in inspected script`);
    return actualSource.slice(start, end) + `__reflect(${name}.prototype,"${name}");`;
}
function actualMethod(className, methodName) {
    const start = actualSource.indexOf(`var ${className}=function`);
    const end = actualSource.indexOf(`__reflect(${className}.prototype`, start);
    const classSource = actualSource.slice(start, end);
    const prefix = `t.prototype.${methodName}=`;
    const methodStart = classSource.indexOf(prefix) + prefix.length;
    assert.ok(methodStart >= prefix.length, `${className}.${methodName} not found`);
    const bodyStart = classSource.indexOf('{', methodStart); let depth = 1, methodEnd = bodyStart + 1;
    for (; depth && methodEnd < classSource.length; methodEnd++) {
        if (classSource[methodEnd] === '{') depth++;
        else if (classSource[methodEnd] === '}') depth--;
    }
    return classSource.slice(methodStart, methodEnd);
}
const sharedMethodNames = [['PoolOneVOneMain', 'changeTurn'], ['PoolCanvas', 'getVisualCue'],
    ['GameViewBase', 'getLocalPos'], ['GameViewBase', 'getCurUser'], ['GameViewBase', 'isMainPlayerOperation']];
const sharedCueMethods = actualSource ? '(function(){var t=PoolOneVOneMain;\n' + sharedMethodNames
    .map(([className, methodName]) => `${className}.prototype.${methodName}=${actualMethod(className, methodName)};`).join('\n') + '\n}());' : sharedCueSnapshot;

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
        {id: 90001, group: 1, name: '已拥有基础杆', force: 420, line: 280, spin: 560, time: 20, color: 1, fxbag: [[1, 501]]},
        {id: 90002, group: 2, name: '未拥有试验杆', force: 980, line: 840, spin: 1260, time: 20, color: 13, fxbag: [[13, 502], [14, 503]]},
        {id: 90003, group: 3, name: '缺失资源杆', force: 700, line: 560, spin: 420, time: 20, color: 2, fxbag: [[2, 599]]},
        {id: 90613, group: 4, name: 50001, force: 1120, line: 980, spin: 1400, time: 20, color: 14, fxbag: [[14, 504]]}
    ];
    const resources = {
        501: {id: 501, color: 1, name: '基础外观', pic: 'owned_png', force: 420, line: 280, spin: 560},
        502: {id: 502, color: 13, name: '试验外观', pic: 'unowned_png', particle: 'testParticle', force: 980, line: 840, spin: 1260},
        503: {id: 503, color: 14, name: '试验变色', mc: 'testCueMc', force: 1120, line: 980, spin: 1400},
        504: {id: 504, color: 14, name: '雅典娜外观', pic: '', mc: '0',
            particle: '{"cueId":90613,"arr":[{"res":["athena_cue_png"]}]}', force: 1120, line: 980, spin: 1400}
    };
    const network = [];
    const tables = {
        ArtifactStar: configs.flatMap(config => config.fxbag.map(([color], index) => ({
            id: config.group * 100 + index, group: config.group, color, star: 2,
            force_rate: 0, line_rate: 0, spin_rate: 0, time_rate: 0
        }))),
        cue_levelinfo: configs.map(config => ({id: config.group * 1000, group: config.group, level: 9,
            level_show: 9, force_up: 0, line_up: 0, spin_up: 0, time_up: 0})),
        ballArmQuality: [{id: 200, group: 2, color: 13}],
        Consts: [{id: 'star_levelplus', Value: 1}]
    };
    function rows(table) { return table === 'ArtifactInfo' ? configs : table === 'cue_res' ? Object.values(resources) : tables[table] || []; }
    function forbidden(name) { return function () { network.push(name); throw Error('Unexpected network action: ' + name); }; }
    const mainUser = Object.freeze({id: 42, tableidx: 1, pkScore: 0, usingCubeId: 90001, cueForce: 420, cueTipLine: 280, cueSpin: 560,
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
        cn: {ArtifactInfo: 'ArtifactInfo', cue_res: 'cue_res', ArtifactStar: 'ArtifactStar',
            cue_levelinfo: 'cue_levelinfo', ballArmQuality: 'ballArmQuality', Consts: 'Consts'},
        cf: {getItem: (table, id) => rows(table).find(item => String(item.id) === String(id)),
            getItemByCondition: (table, key, value) => key ? rows(table).filter(item => item[key] === value) : rows(table),
            getItemByConditions: (table, keys, values) => rows(table).filter(item => keys.every((key, index) => item[key] === values[index])),
            getConfigArr_new: table => rows(table)},
        CueConfigModel: {instance: {getCueConfigData: id => configs.find(cue => cue.id === Number(id))}},
        LG: {getInfo: value => value === 50001 ? '战争女神·雅典娜' : String(value)},
        GameViewBase: function GameViewBase() {},
        PoolCanvas: function PoolCanvas() {},
        WindowBase: function WindowBase() {}, OnePlayerRules: function OnePlayerRules() {},
        SecureNumber: {CreateSecureNumber: value => value},
        __extends(derived, base) { derived.prototype = Object.create(base.prototype); derived.prototype.constructor = derived; },
        __reflect(prototype, name) { prototype.__class__ = name; },
        Rules8BallDanRenLianXi: function Rules8BallDanRenLianXi() {},
        RulesSnkLianXi: function RulesSnkLianXi() {},
        Rules8Ball: function Rules8Ball() {}
    };
    s.window = s;
    s.GameUtils = {getUserLineSkin() { return null; }, getCueResByColor(id, color) {
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
        for (const name of ['GameViewBase', 'PoolLianXiView', 'SnkLianXiGameView', 'Rules8BallDanRenLianXi', 'RulesSnkLianXi', 'PoolOneVOneMain']) {
            vm.runInContext(actualClass(name), s);
        }
    } else vm.runInContext(gameMethods, s);
    vm.runInContext(sharedCueMethods, s);
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
        Object.assign(view, {stage, $stage: stage, parent: stage, visible: true,
            _isDanJi: kind === 'PoolLianXiView' || kind === 'SnkLianXiGameView', _chairUsers: [],
            _cueForce: 300, _cueTipLine: 200, _cueSpin: 400, _cueShowSpin: 560,
            _daojupowerBet: 1, _daojuaimBet: 1, _daojurotateBet: 1,
            _crossView: {update() {}},
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
        view.poolCanvas = {visualCue: cue, rules: rule, _gameView: view,
            getVisualCue: s.PoolCanvas.prototype.getVisualCue,
            englishControl: {englishX: .2, englishY: .1, reset() { this.englishX = this.englishY = 0; }}, crossView: {updateData() {}}};
        if (kind === 'PoolOneVOneMain') setupNetwork({view, cue, guide, rule});
        currentGuides = [guide]; stage.$children = [view];
        return {view, cue, guide, rule};
    }
    function setupNetwork(current) {
        const {view, cue, rule} = current;
        const user = (id, chair, config, color, star) => ({id, tableidx: chair, isBot: false,
            usingCubeId: config.id, cueConfig: config, curCueColor: color, cueStar: star,
            cueForce: config.force, cueTipLine: config.line, cueSpin: config.spin});
        const self = user(42, 1, configs[0], 1, 2), opponent = user(84, 2, configs[1], 13, 1);
        view._chairUsers = [null, self, opponent]; view._roomUsers = {42: self, 84: opponent};
        view._localIndexUserArr = [self, opponent]; view._myChairId = 1; view._curChairId = 1;
        view._localPosDic = {1: 0, 2: 1}; view._isAddGame = true;
        view.players = [{id: 42, isBot: false}, {id: 84, isBot: false}];
        view._angleView = {enabledView() {}, disabledView() {}};
        view._powerView = {enabledView() {}, disabledView() {}};
        view._headViewArr = [{startDrawBorderBar() {}}, {startDrawBorderBar() {}}];
        view.m_cAimEventQueue = {reset() {}};
        for (const method of ['stopTimer', 'setTimer', 'hideCenterGameTip', 'removeOfflineTip', 'hideCushionGroup',
            'hideCushionTips', 'rotationCueToTargetBall', 'clearBoderProgress', 'hideCrossView', 'showTotalTime', 'assigendGroupAni']) {
            view[method] = function () {};
        }
        view.cleanDaoJuData = function () { this._daojupowerBet = this._daojuaimBet = this._daojurotateBet = 1; };
        Object.assign(rule, {isTuiQiu: false, playerInTurnIndex: 0, playerInTurn: self,
            takeCueBall() {}, respotCueBall() {}, getPlayerBllGroupByIndex() { return 0; }, isInBreak() { return false; },
            setTurnOwner(index) { this.playerInTurnIndex = index; this.playerInTurn = view._chairUsers[index + 1]; }});
        Object.assign(rule.table, {animator: {animating: false}, cueBall: {movable: false}});
        view.poolCanvas.visualBallManager = {createBallTailEffect() {}, removeBallTailEffectByIndex() {}};
        view.poolCanvas._otherPlayerCue = {cueId: 90002, cueRes: resources[502], _gameView: view, visible: true};
        current.self = self; current.opponent = opponent;
        current.changeTurn = chair => view.changeTurn(10, chair);
        assert.equal(view.poolCanvas.getVisualCue(1, true), cue);
        assert.equal(view.poolCanvas.getVisualCue(2, true), cue);
        return current;
    }
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'cue_levels.js'), 'utf8'), s);
    vm.runInContext(moduleSource(), s);
    const api = s.__poolGuideLocalCues.attach(state);
    return {s, state, api, scene, saved, configs, resources, tables, network, intervals, calls,
        networkScene() { const current = scene('PoolOneVOneMain'); return setupNetwork(current); },
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

test('shared-cue turn fixtures match the actual native update ordering', {skip: !actualSource}, () => {
    for (const [className, methodName] of sharedMethodNames) {
        assert.ok(sharedCueSnapshot.includes(actualMethod(className, methodName)), `${className}.${methodName} changed`);
    }
    const change = actualMethod('PoolOneVOneMain', 'changeTurn');
    assert.ok(change.indexOf('this._curChairId=i') < change.indexOf('this.poolCanvas.visualCue.setCueData'));
    assert.ok(change.indexOf('this.poolCanvas.visualCue.setCueData') < change.indexOf('this.poolCanvas.rules.setTurnOwner'));
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

test('Athena is the first choice and remains searchable by name and id', () => {
    const f = fixture();
    assert.equal(f.api.list('', 0, 20).items[0].id, 90613);
    assert.equal(f.get('poolguide-cue-select').value, '90613');
    assert.equal(f.api.list('雅典娜', 0, 20).items[0].id, 90613);
    assert.equal(f.api.list('90613', 0, 20).items[0].id, 90613);
});

test('particle-only Athena resources remain selectable and usable in local practice', () => {
    const f = fixture(); const {cue} = f.scene();
    const status = f.api.configure({cueId: 90613});
    assert.equal(status.practiceActive, true); assert.equal(status.maxProfile.maxed, true);
    assert.equal(status.maxProfile.hasParticle, true); assert.equal(cue.cueRes.id, 504);
    assert.equal(f.api.list('90613', 0, 20).items[0].resources[0].id, 504);
});

test('attach is idempotent, mounts one panel, and reuses the existing scheduler', () => {
    const f = fixture();
    assert.equal(f.s.__poolGuideLocalCues.attach(f.state), f.api);
    assert.ok(f.get('poolguide-cue-options')); assert.ok(f.get('poolguide-cue-apply'));
    assert.equal(f.intervals.size, 0);
    f.refresh(); assert.equal(f.calls.refresh, 1);
});

test('the practice switch is absent and applying a choice uses practice attributes by default', () => {
    const f = fixture(); f.scene();
    f.get('poolguide-cue-search').value = '90002'; f.get('poolguide-cue-search').fire('input');
    assert.equal(f.get('poolguide-cue-select').value, '90002');
    assert.equal(f.get('poolguide-cue-practice'), null);
    f.refresh(); f.refresh();
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

test('unowned appearance and effect resources display in a network scene without changing its stats', () => {
    const f = fixture(); const {view, cue} = f.scene('PoolOneVOneMain'); const before = globalStats(f.s);
    const status = f.api.configure({cueId: 90002, color: 14, resId: 503});
    assert.ok(!status.error); assert.equal(cue.cueId, 90002); assert.equal(cue.cueRes.id, 503);
    assert.deepEqual(globalStats(f.s), before); assert.deepEqual(viewStats(view), [300, 200, 400, 560]);
    assert.equal(f.s.MainUser.instance.usingCubeId, 90001); assert.deepEqual(f.network, []);
});

test('the same native visualCue displays only our override across self-opponent-self turns', () => {
    const f = fixture(); const current = f.networkScene();
    const shared = current.cue;
    assert.equal(current.view.poolCanvas.getVisualCue(1, true), shared);
    assert.equal(current.view.poolCanvas.getVisualCue(2, true), shared);
    assert.equal(f.api.configure({cueId: 90613}).visualCount, 1); assert.equal(shared.cueId, 90613);
    current.changeTurn(2);
    assert.equal(shared.cueId, current.opponent.usingCubeId, 'opponent must retain native cue immediately during changeTurn');
    assert.equal(shared.cueRes.id, 502);
    const opponentStats = globalStats(f.s); f.refresh(); f.refresh();
    assert.equal(shared.cueId, current.opponent.usingCubeId); assert.deepEqual(globalStats(f.s), opponentStats);
    current.changeTurn(1);
    assert.equal(current.cue, shared); assert.equal(shared.cueId, 90613, 'our selected appearance resumes without another apply');
    f.refresh(); assert.equal(shared.cueId, 90613); assert.equal(f.api.status().practiceActive, false);
    assert.equal(f.s.MainUser.instance.usingCubeId, 90001); assert.deepEqual(f.network, []);
});

test('applying during the opponent turn leaves its cue and stats alone until our turn begins', () => {
    const f = fixture(); const current = f.networkScene(); current.changeTurn(2);
    const before = globalStats(f.s), beforeView = viewStats(current.view);
    const status = f.api.configure({cueId: 90613});
    assert.equal(current.cue.cueId, current.opponent.usingCubeId); assert.equal(current.cue.cueRes.id, 502);
    assert.equal(status.practiceActive, false); assert.equal(status.visualCount, 0);
    f.refresh(); assert.deepEqual(globalStats(f.s), before); assert.deepEqual(viewStats(current.view), beforeView);
    assert.equal(current.cue.cueId, current.opponent.usingCubeId);
    current.changeTurn(1); assert.equal(current.cue.cueId, 90613); assert.deepEqual(f.network, []);
});

test('opponent equipment updates and reset preserve the latest opponent resource rather than our old cue', () => {
    const f = fixture(); const current = f.networkScene(); f.api.configure({cueId: 90613});
    current.changeTurn(2);
    current.opponent.curCueColor = 14; current.opponent.cueStar = 5;
    current.opponent.cueForce = 840; current.opponent.cueTipLine = 560; current.opponent.cueSpin = 700;
    current.changeTurn(2); assert.equal(current.cue.cueRes.id, 503);
    const before = globalStats(f.s), fields = viewStats(current.view);
    f.api.reset();
    assert.equal(current.cue.cueId, 90002); assert.equal(current.cue.cueRes.id, 503); assert.equal(current.cue._cueStar, 5);
    assert.deepEqual(globalStats(f.s), before); assert.deepEqual(viewStats(current.view), fields);
});

test('players using the same cue id are distinguished by player identity', () => {
    const f = fixture(); const current = f.networkScene();
    Object.assign(current.opponent, {usingCubeId: 90001, cueConfig: f.configs[0], curCueColor: 1,
        cueForce: 420, cueTipLine: 280, cueSpin: 560});
    f.api.configure({cueId: 90613}); assert.equal(current.cue.cueId, 90613);
    current.changeTurn(2); assert.equal(current.cue.cueId, 90001);
    f.refresh(); assert.equal(current.cue.cueId, 90001);
    current.changeTurn(1); assert.equal(current.cue.cueId, 90613);
});

test('unknown chairs and missing player ids fail closed despite the native default-true operation helper', () => {
    const mutations = [
        current => { current.view._curChairId = undefined; },
        current => { current.view._curChairId = 0; },
        current => { current.view._curChairId = 3; },
        current => { current.view._isAddGame = false; },
        current => { current.view._chairUsers = []; },
        current => { current.view._chairUsers = []; current.view._isDanJi = true; },
        current => { current.self.id = undefined; },
        current => { current.self.id = null; },
        current => { current.self.id = ''; },
        current => { current.self.id = 0; },
        (current, f) => { f.s.MainUser.instance = null; },
        (current, f) => { f.s.MainUser = undefined; },
        (current, f) => { f.s.MainUser.instance = {...f.s.MainUser.instance, id: undefined}; },
        (current, f) => { f.s.MainUser.instance = {...f.s.MainUser.instance, id: ''}; }
    ];
    for (const mutate of mutations) {
        const f = fixture(); const current = f.networkScene(); mutate(current, f);
        const before = globalStats(f.s), fields = viewStats(current.view);
        if (!current.view._chairUsers[current.view._curChairId]) assert.equal(current.view.isMainPlayerOperation(), true);
        f.api.configure({cueId: 90613}); f.refresh();
        assert.equal(current.cue.cueId, 90001, mutate.toString()); assert.equal(f.api.status().visualCount, 0);
        assert.deepEqual(globalStats(f.s), before); assert.deepEqual(viewStats(current.view), fields);
    }
});

test('numeric and string forms of the known same player id still identify our turn', () => {
    const f = fixture(); const current = f.networkScene(); current.self.id = '42';
    f.api.configure({cueId: 90613}); assert.equal(current.cue.cueId, 90613);
    current.changeTurn(2); assert.equal(current.cue.cueId, 90002);
});

test('spectator and replay flags on a normal room view never alter the shared cue', () => {
    for (const name of ['_isGuanZhan', 'isGuanZhan', 'isPlayback', '_isPlayback', '_playback']) {
        const f = fixture(); const current = f.networkScene(); current.view[name] = true;
        const before = globalStats(f.s); f.api.configure({cueId: 90613}); f.refresh();
        assert.equal(current.cue.cueId, 90001, name); assert.deepEqual(globalStats(f.s), before);
    }
});

test('native push-out cue routing never applies the local override to either participant', () => {
    for (const chair of [1, 2]) {
        const f = fixture(); const current = f.networkScene(); current.view._curChairId = chair;
        current.rule.isTuiQiu = true;
        assert.equal(current.view.poolCanvas.getVisualCue(1, true), current.cue);
        assert.equal(current.view.poolCanvas.getVisualCue(1, false), null);
        assert.equal(current.view.poolCanvas.getVisualCue(2, true), current.view.poolCanvas._otherPlayerCue);
        const before = globalStats(f.s); f.api.configure({cueId: 90613}); f.refresh();
        assert.equal(current.cue.cueId, 90001); assert.equal(current.view.poolCanvas._otherPlayerCue.cueId, 90002);
        assert.deepEqual(globalStats(f.s), before); assert.equal(f.api.status().practiceActive, false);
    }
});

test('entering native push-out pauses our appearance and leaving it resumes only our known turn', () => {
    const f = fixture(); const current = f.networkScene();
    f.api.configure({cueId: 90613}); assert.equal(current.cue.cueId, 90613);
    current.rule.isTuiQiu = true; f.refresh(); assert.equal(current.cue.cueId, 90001);
    current.rule.isTuiQiu = false; f.refresh(); assert.equal(current.cue.cueId, 90613);
    current.changeTurn(2); assert.equal(current.cue.cueId, 90002);
    current.rule.isTuiQiu = true; f.refresh(); assert.equal(current.cue.cueId, 90002);
    current.rule.isTuiQiu = false; f.refresh(); assert.equal(current.cue.cueId, 90002);
});

for (const kind of ['PoolLianXiView', 'SnkLianXiGameView']) test(`real game cue conversion is used in ${kind}`, () => {
    const f = fixture(); const {view, cue} = f.scene(kind); const original = globalStats(f.s);
    const status = f.api.configure({cueId: 90002, color: 13, resId: 502});
    assert.ok(!status.error); assert.equal(status.practiceActive, true); assert.equal(cue.cueId, 90002);
    close(viewStats(view), [700, 600, 900, 1260]);
    close(globalStats(f.s), [700, .6, .9, 1260]);
    f.api.reset(); assert.equal(cue.cueId, 90001); assert.equal(cue.cueRes.id, 501);
    assert.deepEqual(viewStats(view), [300, 200, 400, 560]); assert.deepEqual(globalStats(f.s), original);
    assert.deepEqual(f.network, []);
});

test('legacy practiceAttributes values cannot disable automatic practice attributes', () => {
    for (const legacy of [false, true, 'false', undefined]) {
        const f = fixture(); f.scene();
        const status = f.api.configure({cueId: 90002, color: 13, practiceAttributes: legacy});
        assert.ok(!status.error); assert.equal(status.practiceActive, true, `legacy value ${legacy}`);
    }
});

test('the default selection uses the maximum profile resource and star without changing config or bag data', () => {
    const f = fixture(); const {cue} = f.scene();
    const original = JSON.stringify({configs: f.configs, tables: f.tables, resources: f.resources});
    const originalBag = f.s.MainUser.instance.equipBagCue;
    const status = f.api.configure({cueId: 90002});
    assert.equal(status.practiceActive, true); assert.equal(status.maxProfile.maxed, true);
    assert.equal(status.maxProfile.color, 14); assert.equal(status.maxProfile.star, 2);
    assert.equal(status.maxProfile.level, 9); assert.equal(cue.cueRes.id, 503);
    f.refresh(); f.api.reset();
    assert.equal(JSON.stringify({configs: f.configs, tables: f.tables, resources: f.resources}), original);
    assert.equal(f.s.MainUser.instance.equipBagCue, originalBag); assert.equal(originalBag.star, 2);
    assert.equal(f.s.BagModel.instance.getBagCue(90002), undefined); assert.deepEqual(f.network, []);
});

test('missing max-level configuration still permits appearance but never pretends practice stats are maxed', () => {
    const f = fixture(); const {cue, view} = f.scene(); const before = globalStats(f.s);
    f.tables.cue_levelinfo = [];
    const status = f.api.configure({cueId: 90002, resId: 502});
    assert.equal(cue.cueId, 90002); assert.equal(status.practiceActive, false);
    assert.equal(status.maxProfile.maxed, false); assert.ok(status.maxProfile.reason);
    assert.deepEqual(globalStats(f.s), before); assert.deepEqual(viewStats(view), [300, 200, 400, 560]);
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
    assert.equal(next.get('poolguide-cue-practice'), null);
});

test('an existing pg3 account selection is retained under the original storage key', () => {
    const saved = new Map([['poolguide-local-cue-v1:42', JSON.stringify({cueId: 90002, color: 13, resId: 502})]]);
    const f = fixture(saved); const {cue} = f.scene(); f.refresh();
    assert.equal(f.api.status().cueId, 90002); assert.equal(cue.cueId, 90001);
    assert.equal(f.get('poolguide-cue-select').value, '90002');
    const status = f.api.configure({cueId: 90002});
    assert.equal(status.practiceActive, true);
    assert.equal(JSON.parse(saved.get('poolguide-local-cue-v1:42')).cueId, 90002);
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
    f.resources[599] = {id: 599, pic: '0', mc: '0', particle: '0'};
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
