// Scenario tests for the "change batsmen" feature (server side + leaderboards).
//   node scorer-tests/batter-change-tests.js   (from the project root; needs jsdom + ejs, both already in package.json)
const { ROOT, path, fs, JSDOM, db, clone, ctrl, computeMVP, pad, AID, BID, newMatch, mkRes, call, M, row, api } = require('./fake-server');
let matchSeq = 0;
// ---------------------------------------------------------------- tiny test runner
const results = [];
async function test(name, fn) {
    db.matches.clear(); db.players.clear(); db.turfs.clear();
    const fails = [];
    const t = {
        eq(actual, expected, msg) { if (JSON.stringify(actual) !== JSON.stringify(expected)) fails.push(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); },
        ok(cond, msg) { if (!cond) fails.push(msg); },
        stat(id, innings, n, exp, pfx) { const r = row(id, innings, n, pfx); const got = {}; Object.keys(exp).forEach((k) => { got[k] = r[k]; }); t.eq(got, exp, `${innings} #${n} (${r.name})`); },
    };
    try { await fn(t); } catch (e) { fails.push('EXCEPTION: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); }
    results.push({ name, fails });
}
const sumBatRuns = (m, innings) => m[innings].batting.reduce((s, r) => s + r.runs, 0);

// Renders the REAL turf-stats.js for a set of completed matches and returns { tab: [[name, value], ...] }
function leaderboards(matches) {
    const dom = new JSDOM(`<body><div id="turfStatTabs"></div><div id="turfMatchesPanel"></div><div id="turfStatsPanel"></div><div id="turfStatsContent"></div><a id="backToMatchesBtn"></a>
        ${['mvp', 'runs', 'sixes', 'fours', 'wickets'].map((k) => `<button class="turf-stat-tab" data-stat="${k}"></button>`).join('')}</body>`, { runScripts: 'outside-only' });
    const w = dom.window;
    w.document.getElementById('turfStatTabs').innerHTML = ['mvp', 'runs', 'sixes', 'fours', 'wickets'].map((k) => `<button class="turf-stat-tab" data-stat="${k}"></button>`).join('');
    w.TURF_MATCHES = matches.map(clone);
    w.eval(fs.readFileSync(path.join(ROOT, 'public/js/mvp.js'), 'utf8'));
    w.eval(fs.readFileSync(path.join(ROOT, 'public/js/turf-stats.js'), 'utf8'));
    const out = {};
    for (const k of ['mvp', 'runs', 'sixes', 'fours', 'wickets']) {
        w.document.querySelector(`.turf-stat-tab[data-stat="${k}"]`).click();
        out[k] = [...w.document.querySelectorAll('#turfStatsContent tbody tr')].map((tr) => {
            const cells = [...tr.querySelectorAll('td')];
            return [tr.querySelector('.scorecard-player-name').textContent, cells[cells.length - 1].textContent];
        });
    }
    w.close();
    return out;
}
// Play a whole 1-over match: team1 faces 6 balls, team2 chases. Returns match id. The `mid` hook runs after ball #k of innings 1.
async function playOneOverMatch(mid) {
    const id = newMatch(1);
    const a = api(id, 'team1');
    await a.open(1, 2, 1);
    await a.ball('four');                 // A1 4
    await a.ball('six');                  // A1 10
    if (mid) await mid(id, a);
    return { id, a };
}

(async () => {
    // ====================================================== 1. basic replace, before / after scoring
    await test('01 replace striker BEFORE any ball: new batter gets all later runs, old one stays 0 / not counted as batted', async (t) => {
        const id = newMatch(); const a = api(id);
        await a.open(1, 2);
        const r = await a.setup({ strikerId: AID(3), nonStrikerId: AID(2) });
        t.eq(r.code, 200, 'setup status');
        await a.ball('four'); await a.ball('six');
        t.stat(id, 'team1', 3, { runs: 10, balls: 2, fours: 1, sixes: 1, status: 'batting' });
        t.stat(id, 'team1', 1, { runs: 0, balls: 0, status: 'yet_to_bat' });
        t.eq(M(id).team1.totalRuns, 10, 'team total');
    });

    await test('02 replace striker AFTER he scored (4,6): runs/balls/4s/6s move to the replacement, old batter is wiped', async (t) => {
        const id = newMatch(); const a = api(id);
        await a.open(1, 2);
        await a.ball('four'); await a.ball('six'); await a.ball('dot');
        const r = await a.setup({ strikerId: AID(4), nonStrikerId: AID(2) });
        t.eq(r.code, 200, 'setup status');
        t.stat(id, 'team1', 4, { runs: 10, balls: 3, dots: 1, fours: 1, sixes: 1, status: 'batting' });
        t.stat(id, 'team1', 1, { runs: 0, balls: 0, dots: 0, fours: 0, sixes: 0, status: 'yet_to_bat' });
        t.eq(M(id).team1.totalRuns, 10, 'team total unchanged');
        t.eq(M(id).team1.strikerId, AID(4), 'striker id');
        await a.ball('six');  // keeps scoring for the new batter
        t.stat(id, 'team1', 4, { runs: 16, balls: 4, sixes: 2 });
    });

    await test('03 replace NON-striker who already scored', async (t) => {
        const id = newMatch(); const a = api(id);
        await a.open(1, 2);
        await a.ball('four'); await a.ball('one');            // A1 5, strike -> A2
        await a.ball('six');                                   // A2 6
        const r = await a.setup({ strikerId: AID(2), nonStrikerId: AID(5) });  // replace A1 (non-striker, 5 off 2) with A5
        t.eq(r.code, 200, 'setup status');
        t.stat(id, 'team1', 5, { runs: 5, balls: 2, fours: 1, status: 'batting' });
        t.stat(id, 'team1', 1, { runs: 0, balls: 0, status: 'yet_to_bat' });
        t.stat(id, 'team1', 2, { runs: 6, balls: 1, sixes: 1 });
        t.eq(sumBatRuns(M(id), 'team1'), M(id).team1.totalRuns, 'batter runs == team total');
    });

    await test('04 replace BOTH batters at once (both had scored)', async (t) => {
        const id = newMatch(); const a = api(id);
        await a.open(1, 2);
        await a.ball('four'); await a.ball('one'); await a.ball('two');   // A1 5/2, A2 2/1 (A2 on strike)
        const r = await a.setup({ strikerId: AID(6), nonStrikerId: AID(7) });
        t.eq(r.code, 200, 'setup status ' + JSON.stringify(r.body));
        t.stat(id, 'team1', 6, { runs: 2, balls: 1, status: 'batting' });
        t.stat(id, 'team1', 7, { runs: 5, balls: 2, fours: 1, status: 'batting' });
        t.stat(id, 'team1', 1, { runs: 0, status: 'yet_to_bat' }); t.stat(id, 'team1', 2, { runs: 0, status: 'yet_to_bat' });
        t.eq(sumBatRuns(M(id), 'team1'), 7, 'batter runs == team total');
    });

    await test('05 just swapping striker <-> non-striker must not move or lose any runs', async (t) => {
        const id = newMatch(); const a = api(id);
        await a.open(1, 2);
        await a.ball('four'); await a.ball('one'); await a.ball('two');   // A1 5/2, A2 2/1
        const before = clone(M(id).team1.batting.slice(0, 2));
        const r = await a.setup({ strikerId: AID(1), nonStrikerId: AID(2) });
        t.eq(r.code, 200, 'setup status');
        t.eq(M(id).team1.batting.slice(0, 2), before, 'batting rows untouched');
        t.eq(M(id).team1.strikerId, AID(1), 'striker flipped');
    });

    // ====================================================== 2. wickets after a change
    await test('06 batter replaced after scoring, THEN gets out: his runs stay on the replacement and are kept with the dismissal', async (t) => {
        const id = newMatch(); const a = api(id);
        await a.open(1, 2);
        await a.ball('four'); await a.ball('six'); await a.ball('dot');
        await a.setup({ strikerId: AID(4), nonStrikerId: AID(2) });
        const r = await a.out('bowled', 4, 5);
        t.eq(r.code, 200, 'wicket accepted ' + JSON.stringify(r.body));
        t.stat(id, 'team1', 4, { runs: 10, balls: 4, fours: 1, sixes: 1, status: 'out', dismissalText: 'Bowled b B1' });
        t.stat(id, 'team1', 1, { runs: 0, status: 'yet_to_bat', dismissalText: null });
        t.stat(id, 'team1', 5, { status: 'batting' });
        t.eq(M(id).team1.wickets, 1, 'wickets');
    });

    await test('07 replaced batter is NOT allowed once out (cannot be re-picked) and an out batter cannot be replaced', async (t) => {
        const id = newMatch(); const a = api(id);
        await a.open(1, 2);
        await a.ball('four'); await a.out('bowled', 1, 3);
        const r1 = await a.setup({ strikerId: AID(1), nonStrikerId: AID(2) });   // bring A1 (out) back
        t.eq(r1.code, 400, 'bringing an out batter back must be rejected');
        const r2 = await a.setup({ strikerId: AID(3), nonStrikerId: AID(2) });   // no change at all
        t.eq(r2.code, 200, 'no-op setup fine');
        t.stat(id, 'team1', 1, { runs: 4, status: 'out' });
    });

    await test('08 pick a batter who is already batting/has scored as the "new" batter is rejected', async (t) => {
        const id = newMatch(); const a = api(id);
        await a.open(1, 2);
        await a.ball('four'); await a.out('bowled', 1, 3); await a.ball('two');      // A3 2/1
        await a.out('bowled', 3, 4);
        const r = await a.setup({ strikerId: AID(3), nonStrikerId: AID(2) });        // A3 is out already
        t.eq(r.code, 400, 'out batter rejected');
    });

    // ====================================================== 3. undo / redo
    await test('09 change striker after 4,6 then UNDO twice then REDO twice: stats follow the replacement every step', async (t) => {
        const id = newMatch(); const a = api(id);
        await a.open(1, 2);
        await a.ball('four'); await a.ball('six');
        await a.setup({ strikerId: AID(4), nonStrikerId: AID(2) });
        await a.undo();                                              // undo the six
        t.stat(id, 'team1', 4, { runs: 4, balls: 1, fours: 1, sixes: 0, status: 'batting' });
        t.stat(id, 'team1', 1, { runs: 0, status: 'yet_to_bat' });
        t.eq(M(id).team1.totalRuns, 4, 'total after 1 undo');
        await a.undo();                                              // undo the four
        t.stat(id, 'team1', 4, { runs: 0, balls: 0, fours: 0, status: 'batting' });
        t.stat(id, 'team1', 1, { runs: 0, status: 'yet_to_bat' });
        t.eq(M(id).team1.strikerId, AID(4), 'striker still the replacement after 2 undos');
        t.eq(M(id).team1.totalRuns, 0, 'total after 2 undos');
        await a.redo(); await a.redo();
        t.stat(id, 'team1', 4, { runs: 10, balls: 2, fours: 1, sixes: 1, status: 'batting' });
        t.stat(id, 'team1', 1, { runs: 0, status: 'yet_to_bat' });
        t.eq(M(id).team1.totalRuns, 10, 'total after redo');
    });

    await test('10 undo, THEN change batter, then try to redo: redo is cleared (no stale state resurrected)', async (t) => {
        const id = newMatch(); const a = api(id);
        await a.open(1, 2);
        await a.ball('four'); await a.ball('six');
        await a.undo();                                              // A1 4/1, redo available
        await a.setup({ strikerId: AID(5), nonStrikerId: AID(2) });
        const r = await a.redo();
        t.eq(r.code, 400, 'redo must be refused after a setup change');
        t.stat(id, 'team1', 5, { runs: 4, fours: 1, sixes: 0 });
        t.stat(id, 'team1', 1, { runs: 0, status: 'yet_to_bat' });
    });

    await test('11 change A1->A4, then score, then change A4->A6 (double change), then undo through both', async (t) => {
        const id = newMatch(); const a = api(id);
        await a.open(1, 2);
        await a.ball('four');
        await a.setup({ strikerId: AID(4), nonStrikerId: AID(2) });
        await a.ball('six');
        await a.setup({ strikerId: AID(6), nonStrikerId: AID(2) });
        t.stat(id, 'team1', 6, { runs: 10, balls: 2, fours: 1, sixes: 1 });
        t.stat(id, 'team1', 4, { runs: 0, status: 'yet_to_bat' }); t.stat(id, 'team1', 1, { runs: 0, status: 'yet_to_bat' });
        await a.undo();
        t.stat(id, 'team1', 6, { runs: 4, balls: 1, fours: 1, sixes: 0, status: 'batting' });
        await a.undo();
        t.stat(id, 'team1', 6, { runs: 0, balls: 0, status: 'batting' });
        t.stat(id, 'team1', 1, { runs: 0, status: 'yet_to_bat' }); t.stat(id, 'team1', 4, { runs: 0, status: 'yet_to_bat' });
        t.eq(M(id).team1.totalRuns, 0, 'total');
    });

    await test('12 wicket, new batter scores, replace new batter, then UNDO the wicket ball itself', async (t) => {
        const id = newMatch(); const a = api(id);
        await a.open(1, 2);
        await a.ball('four');                       // A1 4
        await a.out('bowled', 1, 3);                // A1 out, A3 in (on strike)
        await a.ball('four'); await a.ball('six');  // A3 10/2
        await a.setup({ strikerId: AID(8), nonStrikerId: AID(2) });   // A3 -> A8
        t.stat(id, 'team1', 8, { runs: 10, balls: 2 });
        await a.undo(); await a.undo();             // undo six, four  (A8 0/0)
        t.stat(id, 'team1', 8, { runs: 0, balls: 0, status: 'batting' });
        await a.undo();                             // undo the wicket (3 snapshots kept)
        t.stat(id, 'team1', 1, { runs: 4, status: 'batting', dismissalText: null });
        t.eq(M(id).team1.wickets, 0, 'wickets back to 0');
        t.eq(M(id).team1.strikerId, AID(1), 'A1 back on strike');
        t.ok(['yet_to_bat'].includes(row(id, 'team1', 8).status) && ['yet_to_bat'].includes(row(id, 'team1', 3).status), 'A3 and A8 are both yet_to_bat after undoing the wicket (got A3=' + row(id, 'team1', 3).status + ', A8=' + row(id, 'team1', 8).status + ')');
        await a.redo(); await a.redo(); await a.redo();
        t.stat(id, 'team1', 1, { status: 'out' });
        t.stat(id, 'team1', 8, { runs: 10, balls: 2, status: 'batting' });
        t.stat(id, 'team1', 3, { runs: 0, status: 'yet_to_bat' });
    });

    await test('13 change the batter who just came in after a wicket (0/0) -> simple swap, no runs moved', async (t) => {
        const id = newMatch(); const a = api(id);
        await a.open(1, 2);
        await a.ball('four'); await a.out('bowled', 1, 3);
        const r = await a.setup({ strikerId: AID(9), nonStrikerId: AID(2) });
        t.eq(r.code, 200, 'status');
        t.stat(id, 'team1', 9, { status: 'batting', runs: 0 }); t.stat(id, 'team1', 3, { status: 'yet_to_bat' });
        t.stat(id, 'team1', 1, { runs: 4, status: 'out' });
        await a.undo();   // undo the wicket after the change
        t.stat(id, 'team1', 1, { runs: 4, status: 'batting' });
        t.stat(id, 'team1', 9, { status: 'yet_to_bat' }); t.stat(id, 'team1', 3, { status: 'yet_to_bat' });
        await a.redo();
        t.stat(id, 'team1', 1, { status: 'out' }); t.stat(id, 'team1', 9, { status: 'batting' });
    });

    // ====================================================== 4. batting-order bookkeeping (feeds MVP)
    await test('14 batting order stays 1..n with no gaps after replacing an OPENER at 0/0 (feeds MVP wicket-value multiplier)', async (t) => {
        const id = newMatch(); const a = api(id);
        await a.open(1, 2);
        await a.setup({ strikerId: AID(3), nonStrikerId: AID(2) });          // opener A1 -> A3 at 0/0
        await a.out('bowled', 2, 4); await a.ball('dot'); await a.out('bowled', 3, 5); await a.ball('dot');
        const orders = M(id).team1.batting.filter((r) => r.status !== 'yet_to_bat').map((r) => r.battingOrder).sort((x, y) => x - y);
        t.eq(orders, [1, 2, 3, 4], 'batting orders of the 4 batters who have batted');
    });

    await test('15 batting order is inherited by the replacement when the replaced batter had already scored', async (t) => {
        const id = newMatch(); const a = api(id);
        await a.open(1, 2);
        await a.ball('four');
        await a.setup({ strikerId: AID(6), nonStrikerId: AID(2) });
        t.stat(id, 'team1', 6, { battingOrder: 1 }); t.stat(id, 'team1', 1, { battingOrder: null });
    });

    // ====================================================== 5. weird / illegal requests
    await test('16 striker == non-striker is rejected and nothing changes', async (t) => {
        const id = newMatch(); const a = api(id);
        await a.open(1, 2); await a.ball('four');
        const before = db.matches.get(id);
        const r = await a.setup({ strikerId: AID(3), nonStrikerId: AID(3) });
        t.eq(r.code, 400, 'status'); t.eq(db.matches.get(id), before, 'DB untouched');
    });

    await test('17 replace striker with A3 while moving old striker to non-striker slot (A1->A3, A2->A1)', async (t) => {
        const id = newMatch(); const a = api(id);
        await a.open(1, 2); await a.ball('dot');     // nobody scored yet, A2 has 0/0
        const r = await a.setup({ strikerId: AID(3), nonStrikerId: AID(1) });
        t.ok(r.code === 200 || r.code === 400, 'must give a clean answer');
        const m = M(id).team1; const bat = m.batting.filter((x) => x.status === 'batting').map((x) => x.name).sort();
        t.ok(bat.length === 2 && [m.strikerId, m.nonStrikerId].every((i) => m.batting.find((x) => x.id === i).status === 'batting'), 'exactly the two crease batters are "batting" (got ' + bat.join(',') + ' / code ' + r.code + ')');
    });

    await test('18 second innings: replace a batter mid-chase and finish; both innings aggregated correctly', async (t) => {
        const id = newMatch(1); const a1 = api(id, 'team1'); const a2 = api(id, 'team2');
        await a1.open(1, 2);
        for (const b of ['four', 'six', 'one', 'two', 'dot', 'dot']) await a1.ball(b);    // 13 runs
        t.eq(M(id).currentInnings, 'team2', 'auto switch');
        await a2.open(1, 2, 1);
        await a2.ball('six');                                           // B1 6
        await a2.setup({ strikerId: BID(5), nonStrikerId: BID(2) });    // B1 -> B5 (moves 6 off 1)
        t.stat(id, 'team2', 5, { runs: 6, balls: 1, sixes: 1 }, 'b');
        await a2.ball('six'); await a2.ball('two');                     // 14 -> target 14 reached (13+1)
        t.eq(M(id).status, 'completed', 'match completed: ' + M(id).result);
        t.stat(id, 'team2', 5, { runs: 14, sixes: 2 }, 'b');
        t.stat(id, 'team2', 1, { runs: 0, status: 'yet_to_bat' }, 'b');
        const p = (i, pfx) => db.players.get(pad(pfx, i)).turfStats.batting;
        t.eq(p(5, 'b').runs, 14, 'B5 career runs'); t.eq(p(5, 'b').sixes, 2, 'B5 career sixes'); t.eq(p(5, 'b').innings, 1, 'B5 innings');
        t.eq(p(1, 'b').innings, 0, 'B1 (replaced before scoring anything for himself) has NO innings'); t.eq(p(1, 'b').runs, 0, 'B1 runs');
    });

    // ====================================================== 6. full match -> profiles -> turf leaderboards
    await test('19 FULL MATCH: change after scoring, finish, then profile stats + Turf leaderboards (Most Sixes/Fours/Runs/MVP) are right', async (t) => {
        const { id, a } = await playOneOverMatch();      // A1: 4, 6 so far
        await a.setup({ strikerId: AID(5), nonStrikerId: AID(2) });   // A1 (10 off 2) -> A5
        await a.ball('one');                  // A5 11 off 3, strike -> A2
        await a.ball('two'); await a.ball('dot'); await a.ball('dot');   // A2 2 off 3  => 13
        t.eq(M(id).team1.totalRuns, 13, 'team1 total');
        const a2 = api(id, 'team2');
        await a2.open(1, 2, 9);                                             // A9 bowls the chase (so A1 never bowls)
        await a2.ball('six'); await a2.ball('six'); await a2.ball('two');   // B1 14 -> wins
        const m = M(id);
        t.eq(m.status, 'completed', 'match completed: ' + m.result);
        const P = (n, pfx = 'a') => db.players.get(pad(pfx, n)).turfStats.batting;
        t.eq([P(5).runs, P(5).fours, P(5).sixes, P(5).innings, P(5).matches], [11, 1, 1, 1, 1], 'A5 career (runs,4s,6s,inns,matches)');
        t.eq([P(1).runs, P(1).fours, P(1).sixes, P(1).innings, P(1).matches], [0, 0, 0, 0, 0], 'A1 career is empty (never actually batted for himself)');
        t.eq([P(2).runs, P(2).innings], [2, 1], 'A2 career');
        t.eq([P(1, 'b').runs, P(1, 'b').sixes], [14, 2], 'B1 career');
        const lb = leaderboards([m]);
        t.eq(lb.sixes, [['B1', '2'], ['A5', '1']], 'Most Sixes leaderboard');
        t.eq(lb.fours, [['A5', '1']], 'Most Fours leaderboard');
        t.eq(lb.runs, [['B1', '14'], ['A5', '11'], ['A2', '2']], 'Most Runs leaderboard');
        t.ok(!JSON.stringify(lb).includes('"A1"'), 'A1 appears nowhere in leaderboards');
        // MVP: client (public/js/mvp.js, used by the leaderboard) vs server (utils/mvp.js, used to award) must agree
        const server = computeMVP(m).map((p) => [p.name, Number(p.totalPts.toFixed(4))]);
        const w = new JSDOM('', { runScripts: 'outside-only' }).window; w.eval(fs.readFileSync(path.join(ROOT, 'public/js/mvp.js'), 'utf8'));
        const client = w.CricketMVP.computeMVP(clone(m)).map((p) => [p.name, Number(p.totalPts.toFixed(4))]);
        t.eq(client, server, 'client MVP == server MVP');
        t.eq(server.find(([n]) => n === 'A1')[1], 0, 'A1 has 0 MVP points');
        const a5 = server.find(([n]) => n === 'A5'); t.ok(a5 && a5[1] >= 1.1, 'A5 gets the batting points for 11 runs (got ' + JSON.stringify(a5) + ')');
        // End the turf: profiles must not be double counted and Turf MVP must go to a real player
        db.turfs.set('T1', { _id: 'T1', status: 'active' });
        const r = await call(ctrl.endTurf, 'T1', {}); r.body && t.eq(r.body.ok, true, 'endTurf ok ' + JSON.stringify(r.body));
        t.eq([P(5).runs, P(5).sixes, P(5).innings], [11, 1, 1], 'A5 career not double counted after End Turf');
        t.eq([P(1, 'b').runs, P(1, 'b').sixes], [14, 2], 'B1 career not double counted after End Turf');
        const mvpOwners = [...db.players.values()].filter((p) => p.turfMvpCount > 0).map((p) => p.name);
        t.ok(mvpOwners.length === 1 && mvpOwners[0] !== 'A1', 'exactly one Turf MVP, not A1 (got ' + mvpOwners.join(',') + ')');
    });

    await test('20 change batter, finish innings 1, then UNDO/REDO inside the chase before it ends: final career numbers identical to a straight run', async (t) => {
        const straight = async () => {
            db.matches.clear(); db.players.clear();
            const { id, a } = await playOneOverMatch();
            await a.setup({ strikerId: AID(5), nonStrikerId: AID(2) });
            await a.ball('one'); await a.ball('two'); await a.ball('dot'); await a.ball('dot');
            const a2 = api(id, 'team2'); await a2.open(1, 2, 9);
            await a2.ball('six'); await a2.ball('six'); await a2.ball('two');
            return id;
        };
        const snapshot = () => [...db.players.values()].map((p) => [p.name, p.turfStats.batting.runs, p.turfStats.batting.fours, p.turfStats.batting.sixes, p.turfStats.batting.innings]).filter((x) => x[1] || x[2] || x[3] || x[4]);
        await straight(); const reference = snapshot();
        db.matches.clear(); db.players.clear();
        const { id, a } = await playOneOverMatch();
        await a.setup({ strikerId: AID(5), nonStrikerId: AID(2) });
        await a.ball('one'); await a.ball('two'); await a.ball('dot'); await a.ball('dot');
        const a2 = api(id, 'team2'); await a2.open(1, 2, 9);
        await a2.ball('six'); await a2.ball('six');
        await a2.undo(); await a2.undo(); await a2.redo();             // B1 6 -> 0 -> 6
        await a2.ball('six'); await a2.ball('two');                    // B1 6+6+2 = 14 -> wins
        t.eq(M(id).status, 'completed', 'completed: ' + M(id).result);
        t.eq(snapshot(), reference, 'career numbers equal the straight-through run');
        t.eq(M(id).team2.batting.find((r) => r.id === BID(1)).runs, 14, 'B1 14');
    });

    await test('20b undo INTO innings 1 after a batter change (innings just ended): replacement keeps correct numbers', async (t) => {
        const { id, a } = await playOneOverMatch();
        await a.setup({ strikerId: AID(5), nonStrikerId: AID(2) });
        await a.ball('one'); await a.ball('two'); await a.ball('dot'); await a.ball('dot');     // innings 1 over, 13 runs
        const u = await a.undo();                                                              // take back the last dot
        t.eq(u.code, 200, 'undo ok ' + JSON.stringify(u.body && u.body.error));
        t.eq(M(id).currentInnings, 'team1', 'back to innings 1');
        t.stat(id, 'team1', 5, { runs: 11, balls: 3 }); t.stat(id, 'team1', 2, { runs: 2, balls: 2 }); t.stat(id, 'team1', 1, { runs: 0, status: 'yet_to_bat' });
        await a.ball('four');                                                                  // re-score it as a boundary
        t.stat(id, 'team1', 2, { runs: 6, balls: 3, fours: 1 });
        t.eq(sumBatRuns(M(id), 'team1'), M(id).team1.totalRuns, 'batter runs == team total');
    });

    await test('21 once the match is completed a batter change is refused and nothing moves', async (t) => {
        const { id, a } = await playOneOverMatch();
        await a.ball('one'); await a.ball('two'); await a.ball('dot'); await a.ball('dot');
        const a2 = api(id, 'team2'); await a2.open(1, 2, 9);
        await a2.ball('six'); await a2.ball('six'); await a2.ball('two');
        t.eq(M(id).status, 'completed', 'completed');
        const before = db.matches.get(id);
        const r = await a.setup({ strikerId: AID(5), nonStrikerId: AID(2) });
        t.ok(r.code !== 200, 'change after completion must be refused (got ' + r.code + ')');
        t.eq(db.matches.get(id), before, 'DB untouched');
    });

    await test('22 sixes/fours across TWO matches in one turf where a batter was swapped in one of them', async (t) => {
        // match 1: A1 hits 6 then replaced by A5, A5 hits another 6 ; match 2: A5 hits 4
        const m1 = newMatch(1); const a = api(m1); await a.open(1, 2);
        await a.ball('six'); await a.setup({ strikerId: AID(5), nonStrikerId: AID(2) }); await a.ball('six');
        for (let i = 0; i < 4; i++) await a.ball('dot');
        const b = api(m1, 'team2'); await b.open(1, 2, 9); await b.ball('six'); await b.ball('six'); await b.ball('two');
        t.eq(M(m1).status, 'completed', 'm1 completed: ' + M(m1).result);
        const m2 = newMatch(1); const c = api(m2); await c.open(5, 2); await c.ball('four');
        for (let i = 0; i < 5; i++) await c.ball('dot');
        const d = api(m2, 'team2'); await d.open(1, 2, 9); await d.ball('six');
        t.eq(M(m2).status, 'completed', 'm2 completed: ' + M(m2).result);
        const lb = leaderboards([M(m1), M(m2)]);
        t.eq(lb.sixes.find(([n]) => n === 'A5'), ['A5', '2'], 'A5 sixes (6 moved over from A1, + own)');
        t.eq(lb.fours.find(([n]) => n === 'A5'), ['A5', '1'], 'A5 fours (match 2)');
        t.ok(!lb.sixes.concat(lb.fours, lb.runs).some(([n]) => n === 'A1'), 'A1 (replaced) not in any board');
    });

    await test('23 MVP: bowler wicket points must be the same whether or not an opener was replaced at 0/0 before the first ball', async (t) => {
        const run = async (withChange) => {
            db.matches.clear(); db.players.clear();
            const id = newMatch(); const a = api(id); await a.open(1, 2);
            if (withChange) await a.setup({ strikerId: AID(9), nonStrikerId: AID(2) });
            for (let k = 0; k < 5; k++) {
                const m = M(id).team1; const next = m.batting.find((r) => r.status === 'yet_to_bat');
                await a.out('bowled', Number(m.strikerId.slice(1)), Number(next.id.slice(1)));
            }
            return computeMVP(M(id)).find((p) => p.name === 'B1').bowlingPts;
        };
        const plain = await run(false), changed = await run(true);
        t.ok(Math.abs(plain - changed) < 1e-9, 'B1 bowling points: ' + plain.toFixed(3) + ' without a change vs ' + changed.toFixed(3) + ' after replacing an opener at 0/0 (same 5 wickets)');
    });

    // ---------------------------------------------------------------- report
    let failed = 0;
    for (const r of results) {
        const ok = r.fails.length === 0; if (!ok) failed++;
        console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.name}`);
        r.fails.forEach((f) => console.log('        - ' + f));
    }
    console.log(`\n${results.length - failed}/${results.length} scenarios passed`);
    process.exit(failed ? 1 : 0);
})();