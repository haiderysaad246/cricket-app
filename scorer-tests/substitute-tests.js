const { boot } = require('./ui-harness');
const { db, newMatch, M, api, BID } = require('./fake-server');

const zeroBatting = { runs: 0, matches: 0, innings: 0, average: 0, strikeRate: 0, highest: 0, highestBalls: 0, ducks: 0, ballsFaced: 0, dots: 0, fours: 0, sixes: 0 };
const zeroBowling = { wickets: 0, innings: 0, overs: 0, ballsBowled: 0, runsConceded: 0, dots: 0, dotBallPercentage: 0, noBalls: 0, wideRuns: 0, average: 0, economyRate: 0, strikeRate: 0, maidens: 0, hatTricks: 0 };
const reservePlayer = { _id: 'c01', name: 'CPlayer1', image: '', turfStats: { batting: { ...zeroBatting }, bowling: { ...zeroBowling } } };
const reserve = { id: reservePlayer._id, name: reservePlayer.name, image: reservePlayer.image };
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function substituteBatterIsAddedToThisMatchOnly() {
    db.players.set(reservePlayer._id, reservePlayer);
    const id = newMatch();
    const ui = await boot(id, [reserve]);
    const click = (element) => element.dispatchEvent(new ui.window.MouseEvent('click', { bubbles: true }));
    try {
        click(ui.doc.querySelector('[data-role="striker"]'));
        click(ui.doc.getElementById('cardPickerAddSubstitute'));
        ui.pick(reserve.name);
        await ui.settle();
        const match = ui.screen();
        assert(match.team1.batting.some((player) => player.id === reserve.id), 'substitute not added to batting side');
        assert(match.team2.bowling.some((player) => player.id === reserve.id), 'substitute not added to corresponding fielding rows');
        assert(!match.team2.batting.some((player) => player.id === reserve.id), 'substitute was added to the wrong batting side');
        assert(ui.doc.querySelector('#spStriker .picked-player-chip').textContent.includes(reserve.name), 'substitute was not selected in the form');
        click(ui.doc.querySelector('[data-role="nonStriker"]'));
        ui.pick('A1');
        click(ui.doc.querySelector('[data-role="bowler"]'));
        ui.pick('B1');
        click(ui.doc.querySelector('#scoreSetupForm [type="submit"]'));
        await ui.settle();
        await ui.run('four');
        const scoredMatch = ui.screen();
        assert(scoredMatch.team1.strikerId === reserve.id, 'substitute profile ID was not used for batting');
        assert(scoredMatch.team1.batting.find((player) => player.id === reserve.id).runs === 4, 'substitute runs did not stay on their profile row');
        assert(!ui.errors.length, 'unexpected page errors: ' + ui.errors.join('; '));
    } finally {
        ui.close();
    }
}

async function substituteFielderCanBeSelectedForRunOut() {
    const id = newMatch();
    const initialized = await api(id).open(1, 2, 1);
    assert(initialized.code === 200, 'could not initialize substitute fielder test');
    const ui = await boot(id, [reserve]);
    const click = (element) => element.dispatchEvent(new ui.window.MouseEvent('click', { bubbles: true }));
    try {
        ui.padData('parent', 'out');
        ui.padData('action', 'regularrunout');
        click(ui.doc.getElementById('cardPickerAddSubstitute'));
        ui.pick(reserve.name);
        await ui.settle();
        const chosenFielder = ui.doc.querySelector('[data-runout-section="fielder"] .ig-picker-selected');
        assert(chosenFielder && chosenFielder.dataset.id === reserve.id, 'substitute fielder was not selected in the run-out form');
        const batter = ui.doc.querySelector('[data-runout-section="out"] [data-id="a01"]');
        click(batter);
        click(ui.doc.getElementById('confirmCardPicker'));
        ui.padData('runoutruns', 1);
        ui.pick('A3');
        await ui.settle();
        assert(ui.screen().team1.bowling.some((player) => player.id === reserve.id), 'substitute fielder was not added to the fielding side');
        assert(ui.doc.getElementById('pendingRunoutCard').textContent.includes(reserve.name), 'pending run out did not retain the substitute fielder');
        assert(!ui.errors.length, 'unexpected page errors: ' + ui.errors.join('; '));
    } finally {
        ui.close();
    }
}

async function completedOverBowlersRequireExplicitRepeatSelection() {
    const id = newMatch();
    const match = M(id);
    match.team1.bowling.find((player) => player.id === BID(1)).balls = 6;
    db.matches.set(id, JSON.stringify(match));
    const ui = await boot(id);
    const click = (element) => element.dispatchEvent(new ui.window.MouseEvent('click', { bubbles: true }));
    try {
        for (const [role, player] of [['striker', 'A1'], ['nonStriker', 'A2']]) {
            click(ui.doc.querySelector(`[data-role="${role}"]`));
            ui.pick(player);
        }
        click(ui.doc.querySelector('[data-role="bowler"]'));
        assert(!ui.offered().includes('B1'), 'bowler who completed an over remained in the standard picker');
        click(ui.doc.getElementById('cardPickerAddSubstitute'));
        assert(ui.offered().includes('B1'), 'completed-over bowler was not available via substitute picker');
        ui.pick('B1');
        click(ui.doc.querySelector('#scoreSetupForm [type="submit"]'));
        await ui.settle();
        const setupRequest = ui.requests.find((request) => request.kind === 'setup');
        assert(setupRequest && setupRequest.body.repeatBowler === true, 'repeat-bowler selection was not explicitly sent');
        assert(!ui.errors.length, 'unexpected page errors: ' + ui.errors.join('; '));
    } finally {
        ui.close();
    }

    const apiMatch = newMatch();
    const apiMatchState = M(apiMatch);
    apiMatchState.team1.bowling.find((player) => player.id === BID(1)).balls = 6;
    db.matches.set(apiMatch, JSON.stringify(apiMatchState));
    const rejected = await api(apiMatch).setup({ bowlerId: BID(1) });
    assert(rejected.code === 400, 'server allowed a completed-over bowler without explicit repeat');
    const accepted = await api(apiMatch).setup({ bowlerId: BID(1), repeatBowler: true });
    assert(accepted.code === 200, 'server rejected the explicit repeat-bowler choice');
}

(async () => {
    await substituteBatterIsAddedToThisMatchOnly();
    await substituteFielderCanBeSelectedForRunOut();
    await completedOverBowlersRequireExplicitRepeatSelection();
    console.log('PASS  match-only substitute roster and profile selection');
    console.log('PASS  substitute fielder selection for run-outs');
    console.log('PASS  one-over bowler picker and explicit repeat selection');
})().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
