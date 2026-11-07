const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const match = {
    status: 'completed',
    team1: {
        batting: [
            { id: 'batter-1', name: 'Top Batter', runs: 87, balls: 40, fours: 8, sixes: 3, status: 'out' },
            { id: 'batter-2', name: 'Second Batter', runs: 20, balls: 15, status: 'out' },
        ],
        bowling: [
            { id: 'bowler-1', name: 'Economical Bowler', runs: 2, balls: 6, wickets: 0 },
            { id: 'bowler-2', name: 'Expensive Bowler', runs: 15, balls: 6, wickets: 0 },
        ],
    },
    team2: {
        batting: [],
        bowling: [],
    },
    ballEvents: [
        { innings: 'team1', bowler: 'Expensive Bowler', payload: { type: 'wide' } },
        { innings: 'team1', bowler: 'Expensive Bowler', payload: { type: 'out', isWide: true } },
        { innings: 'team1', bowler: 'Expensive Bowler', payload: { type: 'noball' } },
    ],
};

const tabs = ['highestscore', 'leastconceded', 'extras'];
const dom = new JSDOM(`<body>
    <div id="turfStatTabs">${tabs.map((stat) => `<button class="turf-stat-tab" data-stat="${stat}"></button>`).join('')}</div>
    <div id="turfMatchesPanel"></div><div id="turfStatsPanel"></div><div id="turfStatsContent"></div>
    <a id="backToMatchesBtn"></a>
    </body>`, { runScripts: 'outside-only' });
const { window } = dom;
window.TURF_MATCHES = [match];
window.eval(fs.readFileSync(path.join(root, 'public/js/turf-stats.js'), 'utf8'));

function firstStatRow(stat) {
    window.document.querySelector(`.turf-stat-tab[data-stat="${stat}"]`).click();
    return [...window.document.querySelectorAll('#turfStatsContent tbody tr:first-child td')]
        .map((cell) => cell.textContent.trim());
}

try {
    const highest = firstStatRow('highestscore');
    assert.strictEqual(highest[1], '87');
    assert.strictEqual(highest[2], '40');

    const least = firstStatRow('leastconceded');
    assert.strictEqual(least[1], '2');
    assert.strictEqual(least[2], '6');
    assert.ok(least[0].includes('Economical Bowler'), JSON.stringify(least));

    const extras = firstStatRow('extras');
    assert.ok(extras[0].includes('Expensive Bowler'), JSON.stringify(extras));
    assert.strictEqual(extras[1], '3');
    assert.strictEqual(extras[2], '2');
    assert.strictEqual(extras[3], '1');

    for (const template of ['views/tcl/session.ejs']) {
        const content = fs.readFileSync(path.join(root, template), 'utf8');
        for (const stat of tabs) {
            assert.ok(content.includes(`data-stat="${stat}"`), `${template} should include ${stat} tab`);
        }
    }

    console.log('Session leaderboard tests passed.');
} finally {
    window.close();
}
