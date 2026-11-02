'use strict';

// Deliberately small, independently computed config example. The table shapes
// follow the inspected game's FreeCueView/GetAwardView/BagModel methods.
// Correct endpoint: color 3, star 2, level 9. Each level's *_up is cumulative.
function tablesFixture() {
    const tables = {
        ArtifactInfo: [{id: 91001, group: 7, name: '公式测试杆', force: 101, line: 203, spin: 307,
            time: 11, color: 1, stars: [0, 5], lvmax: 25, fxbag: [[1, 7001], [2, 7002], [3, 7003]]}],
        ArtifactStar: [
            {id: 999999, group: 7, color: 3, star: 1, force_rate: 900, line_rate: 900, spin_rate: 900, time_rate: 900},
            {id: 7702, group: 7, color: 3, star: 2, force_rate: 12.5, line_rate: 25, spin_rate: 50, time_rate: 10},
            {id: 7801, group: 7, color: 2, star: 3, force_rate: 80, line_rate: 80, spin_rate: 80, time_rate: 80},
            {id: 7800, group: 7, color: 1, star: 4, force_rate: 50, line_rate: 50, spin_rate: 50, time_rate: 50},
            {id: 888888, group: 8, color: 30, star: 20, force_rate: 100, line_rate: 100, spin_rate: 100, time_rate: 100}
        ],
        cue_levelinfo: [
            {id: 999999, group: 7, level: 5, level_show: 5, force_up: 8000, line_up: 8000, spin_up: 8000, time_up: 8000},
            {id: 7701, group: 7, level: 9, level_show: 9, force_up: 17, line_up: 19, spin_up: 23, time_up: 2},
            {id: 7900, group: 7, level: 1, level_show: 1, force_up: 0, line_up: 0, spin_up: 0, time_up: 0},
            {id: 888888, group: 8, level: 99, level_show: 99, force_up: 9999, line_up: 9999, spin_up: 9999, time_up: 9999}
        ],
        ballArmQuality: [{id: 702, group: 7, color: 2}, {id: 701, group: 7, color: 1}, {id: 899, group: 8, color: 20}],
        cue_res: [
            {id: 7001, pic: 'base_cue_png', max_force: 99999, max_line: 99999, max_spin: 99999, max_time: 99999},
            {id: 7002, pic: 'middle_cue_png', max_force: 99999, max_line: 99999, max_spin: 99999, max_time: 99999},
            {id: 7003, mc: 'max_cue_mc', max_force: 99999, max_line: 99999, max_spin: 99999, max_time: 99999}
        ]
    };
    return tables;
}

// Hand calculation: floor(101*1.125)+17=130; floor(203*1.25)+19=272;
// floor(307*1.5)+23=483; floor(11*1.1)+2=14. The high-ID lower-state
// rows and misleading cue_res.max_* values must not determine this result.
const expected = Object.freeze({force: 130, line: 272, spin: 483, time: 14,
    color: 3, star: 2, starId: 7702, level: 9, levelId: 7701, resId: 7003});

module.exports = {tablesFixture, expected};
