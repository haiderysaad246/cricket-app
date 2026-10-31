const { boot, oracle, proj, hex } = require('./harness');
const A = (i) => hex('a', i);      // batters  ABat1..
const F = (i) => hex('d', i);      // fielders BBowl1.. (BBowl1 is the current bowler)
const norm = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v)) ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort()) : v);

const runoutBody = (f, out, runs, nb) => ({ innings: 'team1', type: 'out', outType: 'runout', outPlayerId: A(out), fielderId: F(f), newBatsmanId: A(nb), runoutRuns: runs, isNoBall: false });
const catchBody = (outId, f, nb) => ({ innings: 'team1', type: 'out', outType: 'catch', outPlayerId: outId, fielderId: F(f), newBatsmanId: A(nb) });
const simple = (type, extra = {}) => ({ innings: 'team1', type, ...extra });
const nbBody = (runs, boundary = null) => ({ innings: 'team1', type: 'noball', noballRuns: runs, noballBoundary: boundary });

const results = [];
async function test(name, fn) {
    let ui;
    try { ui = await boot(); await fn(ui); 
        const bad = ui.errors.filter((e) => !/Not implemented: navigation/.test(e));
        if (bad.length) throw new Error('page errors: ' + bad.join(' ; '));
        results.push([name, true]); }
    catch (e) { results.push([name, false, e.message]); }
    if (ui) ui.window.close();
}
const eq = (a, b, msg) => { if (norm(a) !== norm(b)) throw new Error(`${msg}\n     expected: ${norm(b)}\n     actual:   ${norm(a)}`); };
const truthy = (v, msg) => { if (!v) throw new Error(msg); };
// after everything is flushed: server state == oracle(intended) AND client state == server state
async function verifyState(ui, intended) {
    await ui.settle();
    eq(ui.server.saved, intended, 'server received wrong inputs / order');
    eq(proj(ui.server.match), proj(oracle(intended)), 'server score differs from what scorer intended');
    eq(proj(ui.window.MATCH), proj(oracle(intended)), 'scorer screen differs from what scorer intended');
    truthy(!ui.server.rejected.length, 'server rejected an input: ' + norm(ui.server.rejected));
}
const RO1 = runoutBody(2, 1, 1, 3);   // fielder BBowl2, ABat1 out, 1 run, new batter ABat3

(async () => {
// ---------- A. Tapping menu buttons must NOT save the pending input ----------
await test('A1  pending run out stays pending when only "Out" menu is opened', async (ui) => {
    ui.stageRunout('BBowl2', 'ABat1', 1, 'ABat3');
    truthy(/Run Out/.test(ui.card()), 'pending card not shown');
    ui.openOut(); await ui.settle();
    eq(ui.server.saved, [], 'pending run out was saved just by opening Out menu');
    eq(ui.window.MATCH.team1.totalRuns, 0, 'scorer screen already changed');
    ui.back(); truthy(/Run Out/.test(ui.card()), 'pending card lost after Back');
    await ui.settle(); eq(ui.server.saved, [], 'saved after Back');
});
await test('A2  pending run out stays pending when only "1,2,3 (Running)" menu is opened', async (ui) => {
    ui.stageRunout('BBowl2', 'ABat1', 1, 'ABat3');
    ui.padData('action', 'morerun'); await ui.settle();
    eq(ui.server.saved, [], 'saved by opening running menu');
    ui.back(); await ui.settle(); eq(ui.server.saved, [], 'saved after back'); truthy(ui.card(), 'card lost');
});
await test('A3  pending run out stays pending when only "No Ball" menu is opened', async (ui) => {
    ui.stageRunout('BBowl2', 'ABat1', 1, 'ABat3');
    ui.openNoBall(); await ui.settle();
    eq(ui.server.saved, [], 'saved by opening No Ball menu');
    ui.back(); truthy(ui.card(), 'card lost');
});
await test('A4  pending stays pending while next input is half-entered (picker open, then cancelled)', async (ui) => {
    ui.stageRunout('BBowl2', 'ABat1', 1, 'ABat3');
    ui.openOut(); ui.padData('action', 'regularrunout'); ui.pick('BBowl4');
    truthy(ui.pickerOpen(), 'second picker should be open');
    await ui.settle(); eq(ui.server.saved, [], 'saved while next input incomplete');
    ui.close(); await ui.settle();
    eq(ui.server.saved, [], 'saved after cancelling next input');
    truthy(/Run Out/.test(ui.card()), 'original pending lost after cancel');
    ui.check(); await verifyState(ui, [RO1]);
});
await test('A5  open Out menu, Back, then Check -> run out saved exactly once', async (ui) => {
    ui.stageRunout('BBowl2', 'ABat1', 1, 'ABat3');
    ui.openOut(); ui.back(); ui.check(); await verifyState(ui, [RO1]);
});

// ---------- B. Next input COMPLETED -> pending saved first, then next ----------
await test('B1  run out pending, then "4" -> [run out, four]', async (ui) => {
    ui.stageRunout('BBowl2', 'ABat1', 1, 'ABat3'); ui.four(); await verifyState(ui, [RO1, simple('four')]);
    eq(ui.card(), null, 'pending card should be empty');
});
await test('B2  run out pending, then 1/2/3 running "two" -> [run out, two]', async (ui) => {
    ui.stageRunout('BBowl2', 'ABat1', 1, 'ABat3'); ui.runs('two'); await verifyState(ui, [RO1, simple('two')]);
});
await test('B3  run out pending, then Wide -> [run out, wide]', async (ui) => {
    ui.stageRunout('BBowl2', 'ABat1', 1, 'ABat3'); ui.wide(); await verifyState(ui, [RO1, simple('wide')]);
});
await test('B4  run out pending, then 6 -> [run out, six]', async (ui) => {
    ui.stageRunout('BBowl2', 'ABat1', 1, 'ABat3'); ui.padData('run', 'six'); await verifyState(ui, [RO1, simple('six')]);
});
await test('B5  run out pending, then discard (X) then 4 -> only [four]', async (ui) => {
    ui.stageRunout('BBowl2', 'ABat1', 1, 'ABat3'); ui.discard(); await ui.settle();
    eq(ui.server.saved, [], 'discarded run out was saved'); ui.four(); await verifyState(ui, [simple('four')]);
});

// ---------- C. Next input is ANOTHER pending-type input ----------
await test('C1  run out pending, second run out completed -> run1 saved, run2 pending, then Check saves run2', async (ui) => {
    ui.stageRunout('BBowl2', 'ABat1', 1, 'ABat3');
    const afterRO1 = oracle([RO1]);
    const other = afterRO1.team1.strikerId === A(3) ? A(2) : A(3);  // some batter currently at the crease
    ui.openOut(); ui.padData('action', 'regularrunout'); ui.pick('BBowl5');
    truthy(ui.offered().length === 2, 'out-player picker should offer 2 batters, got ' + ui.offered());
    truthy(!ui.offered().includes('ABat1'), 'dismissed batter ABat1 offered again');
    ui.pick(other === A(2) ? 'ABat2' : 'ABat3');
    await ui.settle(); eq(ui.server.saved, [], 'saved before 2nd run out completed');
    ui.padData('runoutruns', 0);
    await ui.settle(); eq(ui.server.saved, [], 'saved before 2nd run out new batter chosen');
    truthy(!ui.offered().includes('ABat3'), 'ABat3 (already coming in for run out #1) offered again: ' + ui.offered());
    ui.pick('ABat4');
    await ui.settle();
    const RO2 = runoutBody(5, other === A(2) ? 2 : 3, 0, 4);
    eq(ui.server.saved, [RO1], 'after run out #2 completed, only run out #1 should be saved');
    truthy(/Run Out/.test(ui.card()), 'run out #2 should be pending');
    ui.check(); await verifyState(ui, [RO1, RO2]);
});
await test('C2  run out pending, catch completed -> run out saved, catch pending with CORRECT striker, then Check', async (ui) => {
    ui.stageRunout('BBowl2', 'ABat1', 1, 'ABat3');
    const strikerAfter = oracle([RO1]).team1.strikerId;
    ui.stageCatch('BBowl3', 'ABat4'); await ui.settle();
    eq(ui.server.saved, [RO1], 'only run out should be saved'); truthy(/Caught|Catch|Out/i.test(ui.card()), 'catch should be pending: ' + ui.card());
    ui.check(); await verifyState(ui, [RO1, catchBody(strikerAfter, 3, 4)]);
});
await test('C3  run out pending, No Ball option chosen -> run out saved, noball pending, then Wide -> all in order', async (ui) => {
    ui.stageRunout('BBowl2', 'ABat1', 1, 'ABat3');
    ui.stageNoBall('two'); await ui.settle();
    eq(ui.server.saved, [RO1], 'only run out should be saved'); truthy(/Pending/.test(ui.card()), 'no ball should be pending');
    ui.wide(); await verifyState(ui, [RO1, nbBody(2), simple('wide')]);
});
await test('C4  no ball pending, another no ball chosen from menu -> first saved, second pending (NOT treated as edit)', async (ui) => {
    ui.stageNoBall('one'); ui.stageNoBall('three'); await ui.settle();
    eq(ui.server.saved, [nbBody(1)], 'first no ball should be saved when second is completed');
    ui.check(); await verifyState(ui, [nbBody(1), nbBody(3)]);
});
await test('C5  no ball pending, menu opened but no option chosen -> nothing saved', async (ui) => {
    ui.stageNoBall('one'); ui.openNoBall(); await ui.settle();
    eq(ui.server.saved, [], 'no ball saved just by opening the menu'); ui.back(); ui.check(); await verifyState(ui, [nbBody(1)]);
});
await test('C6  three pending inputs in a row (run out, catch, no ball) then Check -> correct order & state', async (ui) => {
    ui.stageRunout('BBowl2', 'ABat1', 1, 'ABat3');
    const striker1 = oracle([RO1]).team1.strikerId;
    ui.stageCatch('BBowl3', 'ABat4');
    const C = catchBody(striker1, 3, 4);
    ui.stageNoBall('four'); await ui.settle();
    eq(ui.server.saved, [RO1, C], 'run out + catch should be saved; no ball pending');
    ui.check(); await verifyState(ui, [RO1, C, nbBody(4, 'four')]);
});

// ---------- D. Editing the pending card must not save / must not be mistaken for new ----------
await test('D1  edit pending no ball option (card) -> replaced, nothing saved, Check saves edited one', async (ui) => {
    ui.stageNoBall('one'); ui.click(ui.doc.querySelector('[data-edit-pending-noball]')); ui.padData('nb', 'four'); await ui.settle();
    eq(ui.server.saved, [], 'edit caused save'); ui.check(); await verifyState(ui, [nbBody(4, 'four')]);
});
await test('D2  edit pending run out runs (card) -> nothing saved, Check saves edited runs', async (ui) => {
    ui.stageRunout('BBowl2', 'ABat1', 1, 'ABat3');
    ui.click(ui.doc.querySelector('[data-edit-runout-runs]')); ui.padData('runoutruns', 3); await ui.settle();
    eq(ui.server.saved, [], 'edit caused save'); ui.check(); await verifyState(ui, [runoutBody(2, 1, 3, 3)]);
});
await test('D2b  one pending run out profile opens both player fields for editing', async (ui) => {
    ui.openOut(); ui.padData('action', 'regularrunout');
    const pickRunout = (section, name) => {
        const item = [...ui.doc.querySelectorAll(`[data-runout-section="${section}"] .ig-picker-item`)]
            .find((candidate) => candidate.querySelector('.ig-picker-name').textContent === name);
        if (!item) throw new Error(`run-out ${section} "${name}" not found`);
        ui.click(item);
    };
    pickRunout('out', 'ABat1'); pickRunout('fielder', 'BBowl2');
    ui.click(ui.doc.getElementById('confirmCardPicker'));
    ui.padData('runoutruns', 1); ui.pick('ABat3');
    truthy(ui.doc.querySelectorAll('[data-edit-runout-players]').length === 1, 'run out should show one combined player profile');
    truthy(ui.doc.querySelectorAll('[data-edit-runout-player]').length === 0, 'separate player profiles should not be shown');
    ui.click(ui.doc.querySelector('[data-edit-runout-players]'));
    truthy(ui.doc.querySelector('[data-runout-section="out"] .ig-picker-selected'), 'dismissed batter should be preselected');
    truthy(ui.doc.querySelector('[data-runout-section="fielder"] .ig-picker-selected'), 'fielder should be preselected');
    const outPlayer = ui.doc.querySelector('[data-runout-section="out"] [data-id="' + A(2) + '"]');
    const fielder = ui.doc.querySelector('[data-runout-section="fielder"] [data-id="' + F(3) + '"]');
    ui.click(outPlayer); ui.click(fielder); ui.click(ui.doc.getElementById('confirmCardPicker'));
    eq(ui.server.saved, [], 'editing caused save');
    ui.check(); await verifyState(ui, [runoutBody(3, 2, 1, 3)]);
});
await test('D3  edit pending run out runs, then 4 -> [run out with edited runs, four]', async (ui) => {
    ui.stageRunout('BBowl2', 'ABat1', 1, 'ABat3');
    ui.click(ui.doc.querySelector('[data-edit-runout-runs]')); ui.padData('runoutruns', 2); ui.four();
    await verifyState(ui, [runoutBody(2, 1, 2, 3), simple('four')]);
});

// ---------- E. Other dismissal types as the NEXT input ----------
await test('E1  run out pending, Retired Out completed -> [run out, retire(correct batter)]', async (ui) => {
    ui.stageRunout('BBowl2', 'ABat1', 1, 'ABat3');
    const st = oracle([RO1]).team1.strikerId;
    ui.openOut(); ui.padData('dismissal', 'retired'); ui.pick('ABat4'); await ui.settle();
    await verifyState(ui, [RO1, { innings: 'team1', type: 'retire', outPlayerId: st, newBatsmanId: A(4) }]);
});
await test('E2  run out pending, Bowled completed -> [run out, bowled]', async (ui) => {
    ui.stageRunout('BBowl2', 'ABat1', 1, 'ABat3');
    ui.openOut(); ui.padData('dismissal', 'bowled'); ui.pick('ABat4'); await ui.settle();
    await verifyState(ui, [RO1, { innings: 'team1', type: 'out', outType: 'bowled', newBatsmanId: A(4) }]);
});
await test('E3  catch pending, Wide next -> [catch, wide]', async (ui) => {
    ui.stageCatch('BBowl3', 'ABat3'); ui.wide();
    await verifyState(ui, [catchBody(A(1), 3, 3), simple('wide')]);
});

// ---------- F. Over boundary ----------
await test('F1  5 dots, run out (6th ball) pending, then Wide -> run out saved, over completes', async (ui) => {
    for (let i = 0; i < 5; i++) ui.runs('dot');
    ui.stageRunout('BBowl2', 'ABat1', 0, 'ABat3'); ui.wide();
    await verifyState(ui, [...Array(5).fill(simple('dot')), runoutBody(2, 1, 0, 3), simple('wide')]);
});

const w = Math.max(...results.map((r) => r[0].length));
let fail = 0;
results.forEach(([n, ok, msg]) => { if (!ok) fail++; console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '\n     -> ' + msg)); });
console.log(`\n${results.length - fail}/${results.length} passed`);
process.exit(fail ? 1 : 0);
})();