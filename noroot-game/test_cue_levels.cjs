'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {tablesFixture, expected} = require('./qa/cue-level-config.fixture.cjs');
const actualSourcePath = process.env.POOL_GAME_SOURCE || path.resolve(__dirname, '../../guide-extender/.cache/device-original-main.js');
const actualConfigPath = process.env.POOL_GAME_CONFIG || path.resolve(__dirname,
    '../../guide-extender/noroot-game/.work/decoded/assets/www/resource/config/config1.json');

function fixture(tables = tablesFixture()) {
    const s = {console, Math, JSON, isFinite,
        cn: Object.fromEntries(Object.keys(tables).map(name => [name, name])),
        cf: {
            getItem: (table, id) => (tables[table] || []).find(row => String(row.id) === String(id)),
            getItemByCondition: (table, key, value) => key ? (tables[table] || []).filter(row => row[key] === value) : tables[table] || [],
            getItemByConditions: (table, keys, values) => (tables[table] || []).filter(row => keys.every((key, index) => row[key] === values[index])),
            getConfigArr_new: table => tables[table] || []
        },
        CueConfigModel: {instance: {getCueConfigData: id => (tables.ArtifactInfo || []).find(row => row.id === id)}},
        LG: {getInfo: value => String(value)}
    };
    s.window = s; vm.createContext(s);
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'cue_levels.js'), 'utf8'), s);
    return {s, tables, profile: id => s.__poolGuideCueLevels.profile(id)};
}

test('max profile follows terminal color/star/level and actual floor-then-cumulative-level formula', () => {
    const f = fixture(); const profile = f.profile(91001);
    assert.equal(profile.maxed, true); assert.equal(profile.supported, true);
    for (const [key, value] of Object.entries(expected)) assert.equal(profile[key], value, key);
});

test('the inspected FreeCueView arithmetic agrees with the independent hand calculation',
    {skip: !fs.existsSync(actualSourcePath)}, () => {
        const source = fs.readFileSync(actualSourcePath, 'utf8');
        const start = source.indexOf('h=Math.floor(i.force*(100+l.force_rate)/100)+r.force_up');
        assert.ok(start >= 0, 'real FreeCueView property arithmetic is missing');
        const end = source.indexOf(';this.forcev1', start);
        assert.ok(end > start && end - start < 350);
        const expression = source.slice(start, end);
        assert.match(expression, /^h=Math\.floor\(i\.force\*\(100\+l\.force_rate\)\/100\)\+r\.force_up,c=Math\.floor\(i\.spin\*\(100\+l\.spin_rate\)\/100\)\+r\.spin_up,u=Math\.floor\(i\.line\*\(100\+l\.line_rate\)\/100\)\+r\.line_up,d=Math\.floor\(i\.time\*\(100\+l\.time_rate\)\/100\)\+r\.time_up$/);
        const tables = tablesFixture();
        const actual = vm.runInNewContext(expression + '; [h,u,c,d]', {
            Math, i: tables.ArtifactInfo[0], r: tables.cue_levelinfo.find(row => row.id === 7701),
            l: tables.ArtifactStar.find(row => row.id === 7702)
        });
        assert.deepEqual(Array.from(actual), [expected.force, expected.line, expected.spin, expected.time]);
    });

test('actual packaged Athena configuration resolves to its real terminal attributes',
    {skip: !fs.existsSync(actualConfigPath)}, () => {
        const config = JSON.parse(fs.readFileSync(actualConfigPath, 'utf8'));
        const tables = Object.fromEntries(['ArtifactInfo', 'ArtifactStar', 'cue_levelinfo', 'ballArmQuality', 'cue_res']
            .map(name => [name, Object.values(config[name])]));
        const profile = fixture(tables).profile(90613);
        assert.equal(profile.maxed, true); assert.equal(profile.supported, true);
        for (const [key, value] of Object.entries({force: 1263, line: 1321, spin: 1332, time: 208,
            color: 14, star: 0, level: 1, resId: 901117})) assert.equal(profile[key], value, key);
    });

test('a missing high-quality skin falls back only to this cue first resource while preserving max attributes', () => {
    const tables = tablesFixture(); tables.ArtifactInfo[0].fxbag = [[1, 7001]];
    const profile = fixture(tables).profile(91001);
    assert.equal(profile.maxed, true); assert.equal(profile.color, 3); assert.equal(profile.resId, 7001);
    assert.equal(profile.resourceColor, 1); assert.equal(profile.resourceFallback, true);
    assert.equal(profile.force, expected.force); assert.equal(profile.line, expected.line);
    assert.equal(profile.spin, expected.spin); assert.equal(profile.time, expected.time);
});

test('max profile evaluation leaves frozen configuration and account bag data unchanged', () => {
    function freeze(value) { if (value && typeof value === 'object') { Object.freeze(value); for (const item of Object.values(value)) freeze(item); } return value; }
    const tables = freeze(tablesFixture()); const before = JSON.stringify(tables); const f = fixture(tables);
    const bag = freeze({91001: {id: 91001, levelId: 7900, lv: 1, color: 1, star: 0, durable: 5}});
    f.s.BagModel = {instance: {bagCueData: bag, getBagCue: id => bag[id]}};
    assert.equal(f.profile(91001).maxed, true); assert.equal(f.profile(91001).force, expected.force);
    assert.equal(JSON.stringify(tables), before); assert.equal(bag[91001].levelId, 7900);
    assert.equal(bag[91001].color, 1); assert.equal(bag[91001].star, 0);
});

test('identical duplicate terminal ranks are supported but conflicting additions are rejected', () => {
    const tables = tablesFixture(); const terminal = tables.cue_levelinfo.find(row => row.id === 7701);
    tables.cue_levelinfo.push({...terminal, id: 7703});
    assert.equal(fixture(tables).profile(91001).maxed, true);
    tables.cue_levelinfo.push({...terminal, id: 7704, force_up: terminal.force_up + 1});
    const conflict = fixture(tables).profile(91001);
    assert.equal(conflict.maxed, false); assert.ok(conflict.reason);
});

test('missing star or level configuration cannot claim a full-level profile', () => {
    for (const missing of ['ArtifactStar', 'cue_levelinfo']) {
        const tables = tablesFixture(); tables[missing] = [];
        const profile = fixture(tables).profile(91001);
        assert.equal(profile.maxed, false, missing); assert.equal(profile.supported, false, missing);
        assert.ok(profile.reason, missing);
    }
});

test('invalid or nonfinite max data cannot reach physics as a full-level profile', () => {
    for (const mutate of [
        tables => { tables.ArtifactStar.find(row => row.id === 7702).force_rate = Infinity; },
        tables => { tables.cue_levelinfo.find(row => row.id === 7701).line_up = NaN; },
        tables => { tables.ArtifactInfo[0].spin = -1; }
    ]) {
        const tables = tablesFixture(); mutate(tables); const profile = fixture(tables).profile(91001);
        assert.equal(profile.maxed, false); assert.ok(profile.reason);
    }
});

test('unknown ids and an absent config API fail explicitly without using visual gauge maxima', () => {
    const f = fixture(); const unknown = f.profile(999999);
    assert.equal(unknown.maxed, false); assert.equal(unknown.supported, false); assert.ok(unknown.reason);
    f.s.cf = undefined; f.s.CueConfigModel = undefined;
    const unavailable = f.profile(91001);
    assert.equal(unavailable.maxed, false); assert.equal(unavailable.supported, false);
});
