// Scenario tests for the "change bowler" (over bowled by 2+ bowlers) and "wrong bowler" features.
// Runs the REAL controllers + ballRules on an in-memory fake DB (see fake-server.js).
//   node scorer-tests/bowler-change-tests.js
const { ROOT, path, fs, JSDOM, db, clone, ctrl, pad, AID, BID, newMatch, call, M, api } = require('./fake-server');
const { computeMVP } = require('./fake-server');

const FIELDS = ['balls', 'runs', 'wickets', 'dots', 'maidens', 'overs', 'noBalls', 'wideRuns'];
const bow = (id, n, innings = 'team1') => M(id)[innings].bowling.find((r) => r.id === pad(innings === 'team1' ? 'b' : 'a', n));
const pick = (row, keys) => Object.fromEntries(keys.map((k) => [k, row[k]]));
const strikerN = (id) => Number(M(id).team1.strikerId.slice(1));
async function wicket(a, id, outType = 'bowled') {                       // striker is out, lowest-numbered unused batter walks in
    const t = M(id).team1; const next = t.batting.find((r) => r.status === 'yet_to_bat');
    const r = await a.out(outType, strikerN(id), Number(next.id.slice(1)));
    if (r.code !== 200) throw new Error('wicket rejected ' + JSON.stringify(r.body));
}
const bowlerSums = (id) => { const t = M(id).team1; return t.bowling.reduce((s, r) => ({ balls: s.balls + r.balls, runs: s.runs + r.runs, wickets: s.wickets + r.wickets }), { balls: 0, runs: 0, wickets: 0 }); };

const results = [];
async function test(name, fn) {
    db.matches.clear(); db.players.clear(); db.turfs.clear();
    const fails = [];
    const t = {
        eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) fails.push(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); },
        ok(c, m) { if (!c) fails.push(m); },
        bowler(id, n, exp, innings) { const r = bow(id, n, innings); t.eq(pick(r, Object.keys(exp)), exp, `bowler B${n}`); },
        // every ball of the innings must be credited to exactly one bowler
        sums(id, label = '') { const m = M(id).team1, s = bowlerSums(id); t.eq([s.balls, s.runs], [m.legalBalls, m.totalRuns], 'bowler sums == team (balls, runs) ' + label); },
    };
    try { await fn(t); } catch (e) { fails.push('EXCEPTION: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); }
    results.push({ name, fails });
}
const start = async (overs = 10) => { const id = newMatch(overs); const a = api(id); await a.open(1, 2, 1); return { id, a }; };

(async () => {
    // ============================================================ A. BOWLER CHANGE (over split between bowlers)
    await test('A1 over split 2 + 4: first bowler keeps his 2 balls, second bowler gets his 4 balls, nobody is credited an over/maiden', async (t) => {
        const { id, a } = await start();
        await a.ball('four'); await a.ball('one');                       // B1: 2 balls, 5 runs
        const r = await a.setup({ bowlerId: BID(2) });                   // mid-over change
        t.eq(r.code, 200, 'change accepted');
        for (const b of ['dot', 'six', 'dot', 'dot']) await a.ball(b);   // B2: 4 balls, 6 runs
        t.bowler(id, 1, { balls: 2, runs: 5, dots: 0, wickets: 0, overs: 0, maidens: 0 });
        t.bowler(id, 2, { balls: 4, runs: 6, dots: 3, wickets: 0, overs: 0, maidens: 0 });
        t.sums(id); t.eq(M(id).team1.legalBalls, 6, 'over complete');
        t.eq(M(id).ballEvents.filter((e) => e.kind === 'bowler_change').length, 1, 'one "bowler changed" commentary line');
        t.eq(M(id).ballEvents.filter((e) => e.payload).map((e) => e.bowler), ['B1', 'B1', 'B2', 'B2', 'B2', 'B2'], 'commentary credits each ball to the right bowler');
    });

    await test('A2 split over of all dots is NOT a maiden for anybody; next full dot over by one bowler IS a maiden + 1 over', async (t) => {
        const { id, a } = await start();
        for (let i = 0; i < 3; i++) await a.ball('dot');
        await a.setup({ bowlerId: BID(2) });
        for (let i = 0; i < 3; i++) await a.ball('dot');
        t.bowler(id, 1, { balls: 3, maidens: 0, overs: 0 }); t.bowler(id, 2, { balls: 3, maidens: 0, overs: 0 });
        await a.setup({ bowlerId: BID(3) });                             // next over
        for (let i = 0; i < 6; i++) await a.ball('dot');
        t.bowler(id, 3, { balls: 6, runs: 0, maidens: 1, overs: 1, dots: 6 });
        t.bowler(id, 1, { balls: 3, maidens: 0, overs: 0 });
    });

    await test('A3 each bowler takes his own wicket in a split over; dismissal text names the right bowler', async (t) => {
        const { id, a } = await start();
        await wicket(a, id); await a.ball('dot');                        // B1: 1 wkt
        await a.setup({ bowlerId: BID(2) });
        await wicket(a, id, 'bowled'); for (let i = 0; i < 3; i++) await a.ball('dot');   // B2: 1 wkt
        t.bowler(id, 1, { balls: 2, wickets: 1 }); t.bowler(id, 2, { balls: 4, wickets: 1 });
        const bat = M(id).team1.batting;
        t.eq([bat[0].dismissalText, bat[2].dismissalText], ['Bowled b B1', 'Bowled b B2'], 'dismissal texts');
        t.eq(M(id).team1.wickets, 2, 'team wickets'); t.ok(!bow(id, 1).hatTrick && !bow(id, 2).hatTrick, 'no hat-trick');
    });

    await test('A4 wide + no-ball + boundary spread across a split over: extras are charged to whoever bowled them', async (t) => {
        const { id, a } = await start();
        await a.ball('wide');                                            // B1 +1 (wide)
        await a.ball('four');                                            // B1 +4, 1 legal ball
        await a.setup({ bowlerId: BID(2) });
        await a.ball('noball', { noballRuns: 0 });                       // B2 +1 (no-ball)
        await a.ball('noball', { noballRuns: 4, noballBoundary: 'four' });  // B2 +5
        for (let i = 0; i < 5; i++) await a.ball('dot');
        t.bowler(id, 1, { balls: 1, runs: 5, wideRuns: 1, noBalls: 0 });
        t.bowler(id, 2, { balls: 5, runs: 6, noBalls: 2 });
        t.eq(M(id).team1.legalBalls, 6, 'legal balls'); t.sums(id);
        t.eq(M(id).team1.totalRuns, 11, 'team total');
    });

    await test('A5 change back to the first bowler in the same over (B1,B2,B1): B1 accumulates 4 balls, B2 2', async (t) => {
        const { id, a } = await start();
        await a.ball('one'); await a.ball('dot');                        // B1 2 balls 1 run
        await a.setup({ bowlerId: BID(2) }); await a.ball('four'); await a.ball('dot');
        await a.setup({ bowlerId: BID(1) }); await a.ball('six'); await a.ball('two');
        t.bowler(id, 1, { balls: 4, runs: 9, overs: 0 }); t.bowler(id, 2, { balls: 2, runs: 4, overs: 0 }); t.sums(id);
    });

    await test('A6 change taken at the START of an over (no ball bowled yet) is a normal over: new bowler gets the over + maiden', async (t) => {
        const { id, a } = await start();
        for (let i = 0; i < 6; i++) await a.ball('dot');
        await a.setup({ bowlerId: BID(2) });
        for (let i = 0; i < 6; i++) await a.ball('dot');
        t.bowler(id, 1, { balls: 6, maidens: 1, overs: 1 }); t.bowler(id, 2, { balls: 6, maidens: 1, overs: 1 });
        t.eq(M(id).ballEvents.filter((e) => e.kind === 'bowler_change').length, 0, 'no "changed mid-over" commentary');
    });

    await test('A7 UNDO through a split: undo restores each ball to the bowler who bowled it; REDO puts it back exactly', async (t) => {
        const { id, a } = await start();
        await a.ball('four'); await a.ball('one');
        await a.setup({ bowlerId: BID(2) });
        await a.ball('dot'); await a.ball('six');
        const rows = () => clone(M(id).team1.bowling.slice(0, 3).map((r) => pick(r, FIELDS)));
        const full = rows();
        await a.undo();                                                  // six off B2
        t.bowler(id, 2, { balls: 1, runs: 0 }); t.bowler(id, 1, { balls: 2, runs: 5 });
        await a.undo();                                                  // dot off B2
        t.bowler(id, 2, { balls: 0, runs: 0 });
        await a.undo();                                                  // "one" off B1 -> B1 is the bowler again
        t.bowler(id, 1, { balls: 1, runs: 4 }); t.eq(M(id).team1.currentBowlerId, BID(1), 'B1 is current bowler again after undoing past the change');
        t.sums(id, '(after 3 undos)');
        await a.redo(); await a.redo(); await a.redo();
        t.eq(rows(), full, 'after 3 redos all bowler rows are identical to before');
        t.eq(M(id).team1.currentBowlerId, BID(2), 'B2 is current bowler again');
    });

    await test('A8 undo a WICKET taken by the second bowler: his wicket and the dismissal text are removed, first bowler untouched', async (t) => {
        const { id, a } = await start();
        await a.ball('dot'); await a.setup({ bowlerId: BID(2) });
        await wicket(a, id);
        t.bowler(id, 2, { wickets: 1, balls: 1 });
        await a.undo();
        t.bowler(id, 2, { wickets: 0, balls: 0 }); t.bowler(id, 1, { wickets: 0, balls: 1 });
        t.eq(M(id).team1.batting[0].dismissalText, null, 'dismissal cleared'); t.eq(M(id).team1.wickets, 0, 'wickets');
    });

    // ============================================================ B. WRONG BOWLER
    await test('B1 wrong bowler after 3 balls (4, wicket, dot): ALL figures move to the correct bowler; wrong bowler returns to zero', async (t) => {
        const { id, a } = await start();
        await a.ball('four'); await wicket(a, id); await a.ball('dot');
        const r = await a.setup({ bowlerId: BID(2), wrongBowler: true });
        t.eq(r.code, 200, 'fix accepted ' + JSON.stringify(r.body));
        t.bowler(id, 2, { balls: 3, runs: 4, wickets: 1, dots: 1, overs: 0, maidens: 0 });
        t.bowler(id, 1, { balls: 0, runs: 0, wickets: 0, dots: 0 });
        t.eq(M(id).team1.currentBowlerId, BID(2), 'B2 is now the bowler');
        t.eq(M(id).team1.batting[0].dismissalText, 'Bowled b B2', 'dismissal text now names B2');
        t.eq([...new Set(M(id).ballEvents.filter((e) => e.payload).map((e) => e.bowler))], ['B2'], 'commentary rewritten to B2');
        t.ok(!M(id).ballEvents.some((e) => /B1/.test(e.sentence || '')), 'no commentary line still mentions B1');
        t.eq(M(id).ballEvents.filter((e) => e.kind === 'bowler_change').length, 0, 'wrong-bowler fix is not logged as a "bowler changed" event');
        for (let i = 0; i < 3; i++) await a.ball('dot');                    // B2 finishes the over
        t.bowler(id, 2, { balls: 6, runs: 4, overs: 1, maidens: 0, wickets: 1 }); t.bowler(id, 1, { balls: 0, overs: 0, maidens: 0 }); t.sums(id);
    });

    await test('B2 wrong bowler only moves THIS over: wrong bowler keeps his earlier over, correct bowler adds to his earlier over', async (t) => {
        const { id, a } = await start();
        for (const b of ['one', 'dot', 'dot', 'dot', 'two', 'dot']) await a.ball(b);     // over 1 by B1 (3 runs)
        await a.setup({ bowlerId: BID(2) });
        for (const b of ['four', 'dot', 'dot', 'dot', 'dot', 'one']) await a.ball(b);    // over 2 by B2 (5 runs)
        await a.setup({ bowlerId: BID(1), repeatBowler: true });
        await a.ball('six'); await a.ball('dot');                                        // over 3 by B1 (wrong, should be B2)
        const r = await a.setup({ bowlerId: BID(2), wrongBowler: true });
        t.eq(r.code, 200, 'fix accepted');
        t.bowler(id, 1, { balls: 6, runs: 3, overs: 1, maidens: 0 });                    // over 1 untouched
        t.bowler(id, 2, { balls: 8, runs: 11, overs: 1 });                               // over 2 + two balls of over 3
        t.sums(id);
    });

    await test('B3 constraint: once the over is finished "wrong bowler" is refused; after UNDO of last ball it works', async (t) => {
        const { id, a } = await start();
        for (let i = 0; i < 6; i++) await a.ball('dot');
        const before = db.matches.get(id);
        const r = await a.setup({ bowlerId: BID(2), wrongBowler: true });
        t.eq(r.code, 400, 'refused after the over ended'); t.eq(db.matches.get(id), before, 'nothing changed');
        await a.undo();
        const r2 = await a.setup({ bowlerId: BID(2), wrongBowler: true });
        t.eq(r2.code, 200, 'allowed again after undoing one ball');
        t.bowler(id, 2, { balls: 5, runs: 0, dots: 5 }); t.bowler(id, 1, { balls: 0 });
        await a.ball('dot');
        t.bowler(id, 2, { balls: 6, maidens: 1, overs: 1 }); t.bowler(id, 1, { balls: 0, maidens: 0, overs: 0 });
    });

    await test('B4 wrong bowler when only extras were bowled so far (wide, no-ball): extras move too', async (t) => {
        const { id, a } = await start();
        await a.ball('wide'); await a.ball('noball', { noballRuns: 2 });
        const r = await a.setup({ bowlerId: BID(2), wrongBowler: true });
        t.eq(r.code, 200, 'fix accepted');
        t.bowler(id, 2, { balls: 0, runs: 4, wideRuns: 1, noBalls: 1 }); t.bowler(id, 1, { balls: 0, runs: 0, wideRuns: 0, noBalls: 0 }); t.sums(id);
    });

    await test('B5 hat-trick (3 wickets in 3 balls) moves with the fix: wrong bowler loses it, correct bowler gets it', async (t) => {
        const { id, a } = await start();
        for (let i = 0; i < 3; i++) await wicket(a, id);
        t.ok(bow(id, 1).hatTrick, 'B1 had the hat-trick before the fix');
        await a.setup({ bowlerId: BID(2), wrongBowler: true });
        t.ok(bow(id, 2).hatTrick && !bow(id, 1).hatTrick, 'hat-trick now with B2 only');
        t.bowler(id, 2, { wickets: 3, balls: 3 }); t.bowler(id, 1, { wickets: 0, balls: 0 });
        t.eq(M(id).team1.batting.filter((r) => r.status === 'out').map((r) => r.dismissalText), ['Bowled b B2', 'Bowled b B2', 'Bowled b B2'], 'texts');
    });

    await test('B6 wrong bowler inside a split over: only the CURRENT spell moves, earlier spell of the same over is untouched', async (t) => {
        const { id, a } = await start();
        await a.ball('four'); await a.ball('dot');                       // B1 2 balls
        await a.setup({ bowlerId: BID(2) });
        await a.ball('six'); await a.ball('dot');                         // B2 2 balls (should have been B3)
        const r = await a.setup({ bowlerId: BID(3), wrongBowler: true });
        t.eq(r.code, 200, 'fix accepted ' + JSON.stringify(r.body));
        t.bowler(id, 1, { balls: 2, runs: 4 }); t.bowler(id, 2, { balls: 0, runs: 0 }); t.bowler(id, 3, { balls: 2, runs: 6 });
        await a.ball('dot'); await a.ball('dot');
        t.sums(id); t.bowler(id, 3, { balls: 4 });
    });

    await test('B7 wrong bowler, then UNDO/REDO: figures follow the correct bowler at every step', async (t) => {
        const { id, a } = await start();
        await a.ball('four'); await a.ball('six'); await a.ball('dot');
        await a.setup({ bowlerId: BID(2), wrongBowler: true });
        await a.undo();                                                  // undo the dot
        t.bowler(id, 2, { balls: 2, runs: 10, dots: 0 }); t.bowler(id, 1, { balls: 0, runs: 0 });
        await a.undo();                                                  // undo the six
        t.bowler(id, 2, { balls: 1, runs: 4 }); t.bowler(id, 1, { balls: 0, runs: 0 });
        await a.redo(); await a.redo();
        t.bowler(id, 2, { balls: 3, runs: 10, dots: 1 }); t.bowler(id, 1, { balls: 0, runs: 0, dots: 0 });
        t.sums(id);
    });

    await test('B8 after a wrong-bowler fix the Redo history is cleared', async (t) => {
        const { id, a } = await start();
        await a.ball('four'); await a.ball('six'); await a.undo();
        await a.setup({ bowlerId: BID(2), wrongBowler: true });
        const r = await a.redo(); t.eq(r.code, 400, 'redo refused');
        t.bowler(id, 2, { balls: 1, runs: 4 }); t.bowler(id, 1, { balls: 0, runs: 0 });
    });

    await test('B9 wrong bowler with the SAME bowler, or before any ball, is refused cleanly', async (t) => {
        const { id, a } = await start();
        const r0 = await a.setup({ bowlerId: BID(2), wrongBowler: true });
        t.ok(r0.code === 400, 'refused before the over started');
        await a.ball('dot');
        const before = db.matches.get(id);
        const r1 = await a.setup({ bowlerId: BID(1), wrongBowler: true });
        t.eq(r1.code, 400, 'same bowler refused'); t.eq(db.matches.get(id), before, 'no change');
    });

    await test('B10 wrong bowler in a run-out / no-ball-out / stumping over: balls, runs and wickets all go to the correct bowler', async (t) => {
        const { id, a } = await start();
        await a.ball('one');
        const r = await a.out('runout', 2, 3, { runoutRuns: 1, fielderId: BID(5) });  // run out: ball+runs for bowler, no wicket
        t.eq(r.code, 200, 'run out accepted');
        await wicket(a, id, 'catch');
        await a.setup({ bowlerId: BID(2), wrongBowler: true });
        t.bowler(id, 2, { balls: 3, runs: 2, wickets: 1 }); t.bowler(id, 1, { balls: 0, runs: 0, wickets: 0 }); t.sums(id);
    });

    // ============================================================ C. FULL MATCH -> career stats (independent oracle)
    await test('C1 FULL 2-over MATCH with a split over AND a wrong-bowler fix: career bowling stats == independent ball-by-ball ledger', async (t) => {
        const id = newMatch(2); const a = api(id); await a.open(1, 2, 1);
        const ledger = {};                                   // bowler name -> { balls, runs, wickets, dots }
        const L = (n) => (ledger[n] = ledger[n] || { balls: 0, runs: 0, wickets: 0, dots: 0 });
        const add = (n, runs, { wkt = false } = {}) => { const l = L(n); l.balls++; l.runs += runs; if (wkt) l.wickets++; if (runs === 0 && !wkt) l.dots++; };
        // over 1: B1 x2 then B2 x4 (split)
        await a.ball('four'); add('B1', 4); await a.ball('one'); add('B1', 1);
        await a.setup({ bowlerId: BID(2) });
        await a.ball('dot'); add('B2', 0); await wicket(a, id); add('B2', 0, { wkt: true }); await a.ball('six'); add('B2', 6); await a.ball('dot'); add('B2', 0);
        // over 2: B3 starts, bowls 3 balls (WRONG bowler, should be B4), fix, B4 finishes
        await a.setup({ bowlerId: BID(3) });
        await a.ball('two'); await a.ball('dot'); await a.ball('four');
        await a.setup({ bowlerId: BID(4), wrongBowler: true });
        add('B4', 2); add('B4', 0); add('B4', 4);
        await a.ball('dot'); add('B4', 0); await wicket(a, id); add('B4', 0, { wkt: true }); await a.ball('one'); add('B4', 1);
        const total1 = M(id).team1.totalRuns;
        t.eq(M(id).currentInnings, 'team2', 'innings 1 over: ' + total1 + ' runs');
        // chase: team 2 hits sixes until it wins
        const b = api(id, 'team2'); await b.open(1, 2, 9);
        for (let i = 0; i < 6 && M(id).status === 'live'; i++) await b.ball('six');
        t.eq(M(id).status, 'completed', 'match completed: ' + M(id).result);
        const career = (n) => db.players.get(pad('b', n)).turfStats.bowling;
        for (const [name, exp] of Object.entries(ledger)) {
            const c = career(Number(name.slice(1)));
            t.eq({ balls: c.ballsBowled, runs: c.runsConceded, wickets: c.wickets, dots: c.dots, innings: c.innings }, { balls: exp.balls, runs: exp.runs, wickets: exp.wickets, dots: exp.dots, innings: 1 }, `career ${name}`);
        }
        t.eq([career(3).ballsBowled, career(3).innings, career(3).wickets, career(3).runsConceded], [0, 0, 0, 0], 'B3 (wrong bowler) has NOTHING in his profile');
        t.eq([career(1).economyRate, career(4).economyRate], [Number((5 / (2 / 6)).toFixed(2)), Number((7 / (6 / 6)).toFixed(2))], 'economy rates derived from the split figures');
        // Most Wickets leaderboard via the real turf-stats.js
        const w = new JSDOM(`<body><div id="turfStatTabs"><button class="turf-stat-tab" data-stat="wickets"></button></div><div id="turfMatchesPanel"></div><div id="turfStatsPanel"></div><div id="turfStatsContent"></div></body>`, { runScripts: 'outside-only' }).window;
        w.TURF_MATCHES = [clone(M(id))];
        w.eval(fs.readFileSync(path.join(ROOT, 'public/js/mvp.js'), 'utf8')); w.eval(fs.readFileSync(path.join(ROOT, 'public/js/turf-stats.js'), 'utf8'));
        w.document.querySelector('.turf-stat-tab').click();
        const board = [...w.document.querySelectorAll('#turfStatsContent tbody tr')].map((tr) => [tr.querySelector('.scorecard-player-name').textContent, tr.querySelector('td:last-child').textContent]);
        t.eq(board.sort((x, y) => x[0].localeCompare(y[0])), [['B2', '1'], ['B4', '1']], 'Most Wickets: B2 and B4 only');
        // MVP: wicket points go to B2/B4, nothing to B1/B3
        const mvp = Object.fromEntries(computeMVP(M(id)).map((p) => [p.name, p.bowlingPts]));
        t.ok(mvp.B2 > 0 && mvp.B4 > 0 && !mvp.B1 && !mvp.B3, 'MVP bowling points: ' + JSON.stringify({ B1: mvp.B1, B2: mvp.B2, B3: mvp.B3, B4: mvp.B4 }));
        // turf end: no double counting
        db.turfs.set('T1', { _id: 'T1', status: 'active' });
        await call(ctrl.endTurf, 'T1', {});
        t.eq([career(2).wickets, career(2).ballsBowled, career(4).ballsBowled], [1, 4, 6], 'career unchanged after End Turf');
    });

    let failed = 0;
    for (const r of results) { const ok = !r.fails.length; if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.name}`); r.fails.forEach((f) => console.log('        - ' + f)); }
    console.log(`\n${results.length - failed}/${results.length} scenarios passed`);
    process.exit(failed ? 1 : 0);
})();