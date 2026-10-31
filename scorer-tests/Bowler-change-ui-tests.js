// Browser-level tests for "change bowler" / "wrong bowler": the REAL scoring page in jsdom, REAL controllers, fake DB.
//   node scorer-tests/bowler-change-ui-tests.js
const { db, newMatch, M, api, BID } = require('./fake-server');
const { boot } = require('./ui-harness');

const results = [];
async function test(name, fn) {
    db.matches.clear(); db.players.clear(); db.turfs.clear();
    const fails = []; let ui;
    const t = {
        eq(a, b, m) { if (JSON.stringify(a) !== JSON.stringify(b)) fails.push(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); },
        ok(c, m) { if (!c) fails.push(m); },
    };
    try { await fn(t, (id) => boot(id).then((u) => (ui = u))); } catch (e) { fails.push('EXCEPTION: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); }
    if (ui) { const bad = ui.errors.filter((e) => !/Not implemented: navigation/.test(e)); if (bad.length) fails.push('page errors/alerts: ' + bad.join(' ; ')); ui.close(); }
    results.push({ name, fails });
}
const bowl = (m, innings = 'team1') => ({ cur: String(m[innings].currentBowlerId), total: m[innings].totalRuns, legal: m[innings].legalBalls,
    rows: m[innings].bowling.map((r) => [r.name, r.balls, r.runs, r.wickets, r.dots, r.maidens, r.overs]).filter((r) => r.slice(1).some((x) => x)) });
const synced = (t, ui, id, label) => t.eq(bowl(ui.screen()), bowl(JSON.parse(db.matches.get(id))), `screen vs database (${label})`);
const row = (ui, n) => bowl(ui.screen()).rows.find((r) => r[0] === n);
const start = async () => { const id = newMatch(); await api(id).open(1, 2, 1); return id; };

(async () => {
    await test('UB1 tap 4,1 -> "Bowler change" to B2 -> B2 bowls 4 more -> next-over prompt -> B3 bowls a maiden', async (t, bootUi) => {
        const id = await start(); const ui = await bootUi(id);
        await ui.run('four'); await ui.run('one');
        t.eq(await ui.changeBowler('change', 'B2'), 'ok', 'dialog + picker flow');
        synced(t, ui, id, 'after change');
        for (const r of ['dot', 'six', 'dot', 'dot']) await ui.run(r);
        synced(t, ui, id, 'after 4 balls by B2');
        t.eq(row(ui, 'B1').slice(1, 3), [2, 5], 'B1 2 balls 5 runs'); t.eq(row(ui, 'B2').slice(1, 3), [4, 6], 'B2 4 balls 6 runs');
        t.ok(ui.pickerOpen() && /Next Over/.test(ui.pickerTitle()), 'next-over bowler prompt appeared');
        ui.pick('B3'); await ui.settle();
        for (let i = 0; i < 6; i++) await ui.run('dot');
        synced(t, ui, id, 'maiden by B3');
        t.eq(row(ui, 'B3').slice(1), [6, 0, 0, 6, 1, 1], 'B3 6 balls, maiden, 1 over');
        t.eq([row(ui, 'B1')[5], row(ui, 'B1')[6], row(ui, 'B2')[5], row(ui, 'B2')[6]], [0, 0, 0, 0], 'split over gave no maiden/over to B1/B2');
    });

    await test('UB2 "Wrong bowler" after 4,6,dot -> pick B2: browser and DB both show everything on B2, B1 is zero', async (t, bootUi) => {
        const id = await start(); const ui = await bootUi(id);
        await ui.run('four'); await ui.run('six'); await ui.run('dot');
        t.eq(await ui.changeBowler('wrong', 'B2'), 'ok', 'wrong-bowler flow');
        synced(t, ui, id, 'after fix');
        t.eq(row(ui, 'B2').slice(1, 5), [3, 10, 0, 1], 'B2 3 balls 10 runs 1 dot'); t.ok(!row(ui, 'B1'), 'B1 has no figures');
        await ui.run('dot'); await ui.run('dot'); await ui.run('dot');
        synced(t, ui, id, 'over completed by B2'); t.eq(row(ui, 'B2').slice(1), [6, 10, 0, 4, 0, 1], 'B2 over complete');
    });

    await test('UB3 wrong bowler then UNDO x2 / REDO x2 in the browser: browser == server each step, wrong bowler stays empty', async (t, bootUi) => {
        const id = await start(); const ui = await bootUi(id);
        await ui.run('four'); await ui.run('six'); await ui.run('dot');
        await ui.changeBowler('wrong', 'B2');
        await ui.undo(); synced(t, ui, id, 'undo 1'); t.eq(row(ui, 'B2').slice(1, 3), [2, 10], 'B2 2 balls 10 runs');
        await ui.undo(); synced(t, ui, id, 'undo 2'); t.eq(row(ui, 'B2').slice(1, 3), [1, 4], 'B2 1 ball 4 runs');
        t.ok(!row(ui, 'B1'), 'B1 still empty');
        await ui.redo(); synced(t, ui, id, 'redo 1'); await ui.redo(); synced(t, ui, id, 'redo 2');
        t.eq(row(ui, 'B2').slice(1, 3), [3, 10], 'B2 3 balls 10 runs'); t.ok(!row(ui, 'B1'), 'B1 empty');
    });

    await test('UB4 split over then UNDO x3 / REDO x3 in the browser (back through the bowler change)', async (t, bootUi) => {
        const id = await start(); const ui = await bootUi(id);
        await ui.run('four'); await ui.run('one'); await ui.changeBowler('change', 'B2'); await ui.run('dot'); await ui.run('six');
        const full = bowl(ui.screen());
        await ui.undo(); synced(t, ui, id, 'undo 1'); await ui.undo(); synced(t, ui, id, 'undo 2'); await ui.undo(); synced(t, ui, id, 'undo 3');
        t.eq(row(ui, 'B1').slice(1, 3), [1, 4], 'B1 back to 1 ball, 4 runs'); t.ok(!row(ui, 'B2'), 'B2 has nothing');
        await ui.redo(); await ui.redo(); await ui.redo(); synced(t, ui, id, 'redo 3');
        t.eq(bowl(ui.screen()), full, 'identical to before the undos');
    });

    await test('UB5 after the over ends there is no "wrong bowler" option; the over-end prompt picks the next bowler', async (t, bootUi) => {
        const id = await start(); const ui = await bootUi(id);
        for (let i = 0; i < 6; i++) await ui.run('dot');
        t.ok(ui.pickerOpen() && /Next Over/.test(ui.pickerTitle()), 'prompt');
        ui.pick('B2'); await ui.settle();
        t.ok(!ui.dialogShown(), 'no change-type dialog');
        synced(t, ui, id, 'after prompt'); t.eq(row(ui, 'B1').slice(1), [6, 0, 0, 6, 1, 1], 'B1 maiden over');
    });

    let failed = 0;
    for (const r of results) { const ok = !r.fails.length; if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.name}`); r.fails.forEach((f) => console.log('        - ' + f)); }
    console.log(`\n${results.length - failed}/${results.length} browser scenarios passed`);
    process.exit(failed ? 1 : 0);
})();