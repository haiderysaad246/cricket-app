const { boot } = require('./ui-harness');
const { db, newMatch, M, api, BID, mkRes, ctrl } = require('./fake-server');

const zeroBatting = { runs: 0, matches: 0, innings: 0, average: 0, strikeRate: 0, highest: 0, highestBalls: 0, ducks: 0, ballsFaced: 0, dots: 0, fours: 0, sixes: 0 };
const zeroBowling = { wickets: 0, innings: 0, overs: 0, ballsBowled: 0, runsConceded: 0, dots: 0, dotBallPercentage: 0, noBalls: 0, wideRuns: 0, average: 0, economyRate: 0, strikeRate: 0, maidens: 0, hatTricks: 0 };
const reservePlayer = { _id: 'c01', name: 'CPlayer1', image: '', turfStats: { batting: { ...zeroBatting }, bowling: { ...zeroBowling } } };
const reserve = { id: reservePlayer._id, name: reservePlayer.name, image: reservePlayer.image };
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const invoke = async (handler, id, body) => {
    const response = mkRes();
    await handler({ params: { id }, body, headers: { accept: 'application/json' } }, response);
    return response;
};

async function substituteBatterIsAddedToThisMatchOnly() {
    db.players.set(reservePlayer._id, reservePlayer);
    const id = newMatch();
    const match = M(id);
    match.tournamentId = 'TCL1';
    db.matches.set(id, JSON.stringify(match));
    const ui = await boot(id, [reserve]);
    const click = (element) => element.dispatchEvent(new ui.window.MouseEvent('click', { bubbles: true }));
    try {
        click(ui.doc.querySelector('[data-role="striker"]'));
        assert(ui.doc.querySelector('[data-picker-add-substitute]') === ui.doc.querySelector('#cardPickerGrid .ig-picker-page:last-child').lastElementChild, 'substitute action is not the final batter picker item');
        click(ui.doc.querySelector('[data-picker-add-substitute]'));
        ui.pick(reserve.name);
        await ui.settle();
        const match = ui.screen();
        assert(match.team1.batting.some((player) => player.id === reserve.id), 'substitute not added to batting side');
        assert(match.team2.bowling.some((player) => player.id === reserve.id), 'substitute not added to corresponding fielding rows');
        assert(!match.team2.batting.some((player) => player.id === reserve.id), 'substitute was added to the wrong batting side');
        assert(ui.doc.querySelector('#spStriker .picked-player-chip').textContent.includes(reserve.name), 'substitute was not selected in the form');
        click(ui.doc.querySelector('[data-role="nonStriker"]'));
        assert(ui.doc.querySelector('[data-picker-add-substitute]'), 'non-striker picker has no substitute action');
        ui.pick('A1');
        click(ui.doc.querySelector('[data-role="bowler"]'));
        assert(ui.doc.querySelector('[data-picker-add-substitute]'), 'bowler picker has no substitute action');
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
    const match = M(id);
    match.tournamentId = 'TCL1';
    db.matches.set(id, JSON.stringify(match));
    const initialized = await api(id).open(1, 2, 1);
    assert(initialized.code === 200, 'could not initialize substitute fielder test');
    const ui = await boot(id, [reserve]);
    const click = (element) => element.dispatchEvent(new ui.window.MouseEvent('click', { bubbles: true }));
    try {
        ui.padData('parent', 'out');
        ui.padData('action', 'regularrunout');
        click(ui.doc.querySelector('[data-picker-add-substitute]'));
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

async function changeBowlerPickerOffersTclSubstitutes() {
    db.players.set(reservePlayer._id, reservePlayer);
    const id = newMatch();
    const match = M(id);
    match.tournamentId = 'TCL1';
    db.matches.set(id, JSON.stringify(match));
    const initialized = await api(id).open(1, 2, 1);
    assert(initialized.code === 200, 'could not initialize change-bowler substitute test');
    const ui = await boot(id, [reserve]);
    const click = (element) => element.dispatchEvent(new ui.window.MouseEvent('click', { bubbles: true }));
    try {
        click(ui.doc.querySelector('#liveScoreSummaryWrapper .live-bowler-col .live-player-line'));
        assert(ui.doc.querySelector('[data-picker-add-substitute]'), 'change-bowler picker has no substitute tile');
        click(ui.doc.querySelector('[data-picker-add-substitute]'));
        ui.pick(reserve.name);
        await ui.settle();
        assert(ui.screen().team1.currentBowlerId === reserve.id, 'substitute was not selected as the new bowler');
        assert(ui.screen().team1.bowling.some((player) => player.id === reserve.id), 'substitute bowling row was not added');
        assert(!ui.errors.length, 'unexpected page errors: ' + ui.errors.join('; '));
    } finally {
        ui.close();
    }
}

async function completedOverBowlersRequireExplicitRepeatSelection() {
    const id = newMatch();
    const match = M(id);
    match.tournamentId = 'TCL1';
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
        assert(ui.doc.querySelector('[data-picker-add-substitute]') === ui.doc.querySelector('#cardPickerGrid .ig-picker-page:last-child').lastElementChild, 'substitute action is not at the end of the bowler picker');
        click(ui.doc.querySelector('[data-picker-add-substitute]'));
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
    apiMatchState.tournamentId = 'TCL1';
    apiMatchState.team1.bowling.find((player) => player.id === BID(1)).balls = 6;
    db.matches.set(apiMatch, JSON.stringify(apiMatchState));
    const rejected = await api(apiMatch).setup({ bowlerId: BID(1) });
    assert(rejected.code === 400, 'server allowed a completed-over bowler without explicit repeat');
    const accepted = await api(apiMatch).setup({ bowlerId: BID(1), repeatBowler: true });
    assert(accepted.code === 200, 'server rejected the explicit repeat-bowler choice');
}

async function turfPickerHasNoSubstituteAndEndpointRejectsIt() {
    const id = newMatch();
    db.players.set(reservePlayer._id, reservePlayer);
    const ui = await boot(id, [reserve]);
    const click = (element) => element.dispatchEvent(new ui.window.MouseEvent('click', { bubbles: true }));
    try {
        click(ui.doc.querySelector('[data-role="striker"]'));
        assert(!ui.doc.querySelector('[data-picker-add-substitute]'), 'Turf batter picker shows the substitute tile');
    } finally {
        ui.close();
    }

    const response = mkRes();
    await ctrl.addSubstitute({ params: { id }, body: { playerId: reserve.id, side: 'batting' } }, response);
    assert(response.code === 404, 'Turf match accepted a substitute player');
    assert(!M(id).team1.batting.some((player) => player.id === reserve.id), 'Turf roster changed after rejected substitute request');
}

async function substituteStatsAreSavedToActualProfiles() {
    const batter = { ...reservePlayer, _id: 'c11', name: 'Substitute Batter', turfStats: { batting: { ...zeroBatting }, bowling: { ...zeroBowling } } };
    const bowler = { ...reservePlayer, _id: 'c12', name: 'Substitute Bowler', turfStats: { batting: { ...zeroBatting }, bowling: { ...zeroBowling } } };
    const secondInningsBatter = { ...reservePlayer, _id: 'c13', name: 'Second Innings Substitute', turfStats: { batting: { ...zeroBatting }, bowling: { ...zeroBowling } } };
    const lateBatter = { ...reservePlayer, _id: 'a01', name: 'Late Batter', turfStats: { batting: { ...zeroBatting }, bowling: { ...zeroBowling } } };
    db.players.set(batter._id, batter);
    db.players.set(bowler._id, bowler);
    db.players.set(secondInningsBatter._id, secondInningsBatter);
    db.players.set(lateBatter._id, lateBatter);

    const id = newMatch(1);
    const match = M(id);
    match.tournamentId = 'TCL1';
    db.matches.set(id, JSON.stringify(match));

    const addBatter = await invoke(ctrl.addSubstitute, id, { playerId: batter._id, side: 'batting' });
    assert(addBatter.code === 200, 'could not add substitute batter');
    const addBowler = await invoke(ctrl.addSubstitute, id, { playerId: bowler._id, side: 'bowling' });
    assert(addBowler.code === 200, 'could not add substitute bowler');
    const duplicate = await invoke(ctrl.addSubstitute, id, { playerId: batter._id, side: 'batting' });
    assert(duplicate.code === 409, 'endpoint allowed the same substitute to be added twice');
    const storedMatch = M(id);
    storedMatch.tournamentId = null;
    db.matches.set(id, JSON.stringify(storedMatch));
    assert(M(id).team1.batting.some((row) => row.id === batter._id), 'batter was not placed in the batting roster');
    assert(M(id).team1.bowling.some((row) => row.id === bowler._id), 'bowler was not placed in the bowling roster');
    assert(!M(id).team2.batting.some((row) => row.id === batter._id), 'batter was added to the wrong side');
    assert(!M(id).team2.bowling.some((row) => row.id === bowler._id), 'bowler was added to the wrong side');

    const setupFirst = await invoke(ctrl.setupInnings, id, {
        innings: 'team1', strikerId: batter._id, nonStrikerId: 'a02', bowlerId: bowler._id,
    });
    assert(setupFirst.code === 200, 'could not select substitutes in the first innings');
    await api(id).ball('four');
    for (let i = 0; i < 5; i++) await api(id).ball('dot');

    assert(M(id).currentInnings === 'team2', 'first innings completion did not advance to the second innings');
    const secondInningsState = M(id);
    secondInningsState.tournamentId = 'TCL1';
    db.matches.set(id, JSON.stringify(secondInningsState));
    const addSecondInningsBatter = await invoke(ctrl.addSubstitute, id, { playerId: secondInningsBatter._id, side: 'batting' });
    assert(addSecondInningsBatter.code === 200, `could not add substitute batter in the second innings: ${addSecondInningsBatter.code} ${JSON.stringify(addSecondInningsBatter.body)}`);
    const withoutTournamentTrigger = M(id);
    withoutTournamentTrigger.tournamentId = null;
    db.matches.set(id, JSON.stringify(withoutTournamentTrigger));
    assert(M(id).team2.batting.some((row) => row.id === secondInningsBatter._id), 'second-innings batter was not added to the current batting side');
    assert(M(id).team1.bowling.some((row) => row.id === secondInningsBatter._id), 'second-innings batter fielding row was not added to the opposite side');
    const setupSecond = await invoke(ctrl.setupInnings, id, {
        innings: 'team2', strikerId: secondInningsBatter._id, nonStrikerId: 'b02', bowlerId: 'a02',
    });
    assert(setupSecond.code === 200, 'could not set up the second innings');
    await api(id, 'team2').ball('six');

    const completed = M(id);
    assert(completed.status === 'completed', 'test match did not complete');
    const batterProfile = db.players.get(batter._id).turfStats.batting;
    assert(batterProfile.runs === 4 && batterProfile.ballsFaced === 6, `substitute batting stats were not saved to the substitute profile: ${JSON.stringify(batterProfile)}`);
    const bowlerProfile = db.players.get(bowler._id).turfStats.bowling;
    assert(bowlerProfile.runsConceded === 4 && bowlerProfile.ballsBowled === 6, `substitute bowling stats were not saved to the substitute profile: ${JSON.stringify(bowlerProfile)}`);
    const secondBatterProfile = db.players.get(secondInningsBatter._id).turfStats.batting;
    assert(secondBatterProfile.runs === 6 && secondBatterProfile.ballsFaced === 1, 'second-innings substitute stats were not saved to the substitute profile');
    assert(db.players.get(lateBatter._id).turfStats.batting.runs === 0, 'late player incorrectly received substitute batting stats');
    assert(!M(id).team1.statsAggregated || completed.team1.statsAggregated, 'first innings stats were not marked aggregated');
}

(async () => {
    await substituteBatterIsAddedToThisMatchOnly();
    await substituteStatsAreSavedToActualProfiles();
    await substituteFielderCanBeSelectedForRunOut();
    await changeBowlerPickerOffersTclSubstitutes();
    await completedOverBowlersRequireExplicitRepeatSelection();
    await turfPickerHasNoSubstituteAndEndpointRejectsIt();
    console.log('PASS  match-only substitute roster and profile selection');
    console.log('PASS  substitute batting and bowling stats persist to the actual profiles');
    console.log('PASS  substitute fielder selection for run-outs');
    console.log('PASS  change-bowler picker includes TCL substitutes');
    console.log('PASS  one-over bowler picker and explicit repeat selection');
    console.log('PASS  Turf has no substitute option');
})().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
