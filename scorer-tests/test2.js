const { boot, oracle, proj, hex, sleep } = require('./harness');
const A = (i) => hex('a', i), F = (i) => hex('d', i);
const idOf = (name) => name.startsWith('ABat') ? A(+name.slice(4)) : F(+name.slice(5));
const norm = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v)) ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort()) : v);
const eq = (a, b, m) => { if (norm(a) !== norm(b)) throw new Error(`${m}\n     expected: ${norm(b)}\n     actual:   ${norm(a)}`); };
const truthy = (v, m) => { if (!v) throw new Error(m); };
const simple = (type) => ({ innings: 'team1', type });
const ro = (f, out, runs, nb, isNoBall = false) => ({ innings: 'team1', type: 'out', outType: 'runout', outPlayerId: A(out), fielderId: F(f), newBatsmanId: A(nb), runoutRuns: runs, isNoBall });
const nbBody = (runs, b = null) => ({ innings: 'team1', type: 'noball', noballRuns: runs, noballBoundary: b });
const catchB = (outId, f, nb) => ({ innings: 'team1', type: 'out', outType: 'catch', outPlayerId: outId, fielderId: F(f), newBatsmanId: A(nb) });
const projNB = (m) => { const o = JSON.parse(proj(m)); delete o.bowl; delete o.ov; return JSON.stringify(o); };
const results = [];
async function test(name, fn) {
    let ui; try { ui = await boot(); await fn(ui);
        const bad = ui.errors.filter((e) => !/Not implemented: navigation/.test(e)); if (bad.length) throw new Error('page errors: ' + bad.join(' ; '));
        results.push([name, true]); } catch (e) { results.push([name, false, e.message]); }
    if (ui) ui.window.close();
}
async function verify(ui, intended) {
    await ui.settle();
    eq(ui.server.saved, intended, 'server received wrong inputs / order');
    eq(proj(ui.server.match), proj(oracle(intended)), 'server score differs from intended');
    eq(proj(ui.window.MATCH), proj(oracle(intended)), 'scorer screen differs from intended');
    truthy(!ui.server.rejected.length, 'server rejected: ' + norm(ui.server.rejected));
}
const pickBowler = (ui, name) => { truthy(/Next Over/.test(ui.pickerTitle()), 'expected bowler prompt, got: ' + ui.pickerTitle()); ui.pick(name); };

(async () => {
await test('F2  5 dots + run out (6th ball) pending, then 4 -> run out and four saved in order, state correct', async (ui) => {
    for (let i = 0; i < 5; i++) ui.runs('dot');
    ui.stageRunout('BBowl2', 'ABat1', 0, 'ABat3'); ui.four(); await ui.settle();
    eq(ui.server.saved, [...Array(5).fill(simple('dot')), ro(2, 1, 0, 3), simple('four')], 'saved list');
    eq(projNB(ui.server.match), projNB(oracle(ui.server.saved)), 'server state'); eq(projNB(ui.window.MATCH), projNB(ui.server.match), 'screen state');
});
await test('F2b over ended by the pending run out, next input is "4" -> new-over bowler prompt should appear', async (ui) => {
    for (let i = 0; i < 5; i++) ui.runs('dot');
    ui.stageRunout('BBowl2', 'ABat1', 0, 'ABat3'); ui.four(); await ui.settle();
    truthy(ui.pickerOpen() && /Next Over/.test(ui.pickerTitle()), 'bowler prompt did not appear after the over finished');
});
await test('F3  over-ending catch pending, then no ball staged -> catch saved, bowler prompt, no ball still pending, Check saves it', async (ui) => {
    for (let i = 0; i < 5; i++) ui.runs('dot');
    ui.stageCatch('BBowl3', 'ABat3'); ui.stageNoBall('two'); await ui.settle();
    eq(ui.server.saved, [...Array(5).fill(simple('dot')), catchB(A(1), 3, 3)], 'only catch should be saved');
    pickBowler(ui, 'BBowl6'); await ui.settle();
    truthy(/Pending/.test(ui.card()), 'no ball must still be pending after bowler selected: ' + ui.card());
    ui.check(); await ui.settle(); const exp = [...Array(5).fill(simple('dot')), catchB(A(1), 3, 3), nbBody(2)];
    eq(ui.server.saved, exp, 'saved list'); eq(projNB(ui.server.match), projNB(oracle(exp)), 'server state'); eq(projNB(ui.window.MATCH), projNB(ui.server.match), 'screen state');
});
await test('G1  run out pending, then Stumped completed -> [run out, stumping by correct striker]', async (ui) => {
    ui.stageRunout('BBowl2', 'ABat1', 1, 'ABat3');
    const st = oracle([ro(2, 1, 1, 3)]).team1.strikerId;
    ui.openOut(); ui.padData('action', 'stumpedmore'); ui.pad((b) => b.dataset.dismissal === 'stumping' && !b.dataset.wideStump);
    ui.pick('BBowl4'); ui.pick('ABat4'); await ui.settle();
    eq(ui.server.saved, [ro(2, 1, 1, 3)], 'only run out saved at this point'); ui.check();
    await verify(ui, [ro(2, 1, 1, 3), { innings: 'team1', type: 'out', outType: 'stumping', outPlayerId: st, fielderId: F(4), newBatsmanId: A(4), isWide: false }]);
});
await test('G2  run out pending, then Obstructing completed -> [run out, obstructing by correct striker]', async (ui) => {
    ui.stageRunout('BBowl2', 'ABat1', 1, 'ABat3');
    const st = oracle([ro(2, 1, 1, 3)]).team1.strikerId;
    ui.openOut(); ui.padData('dismissal', 'obstructing'); ui.pick('ABat4');
    await verify(ui, [ro(2, 1, 1, 3), { innings: 'team1', type: 'out', outType: 'obstructing', outPlayerId: st, newBatsmanId: A(4) }]);
});
await test('G3  no-ball run out pending, then Wide -> [no-ball run out, wide]', async (ui) => {
    ui.openNoBall(); ui.padData('action', 'nbrunout'); ui.pick('BBowl2'); ui.pick('ABat2'); ui.padData('runoutruns', 1);
    if (ui.pickerOpen()) ui.pick('ABat3');
    await ui.settle(); eq(ui.server.saved, [], 'saved before next input'); truthy(ui.card(), 'should be pending');
    ui.wide(); await ui.settle();
    const got = ui.server.saved; truthy(got.length === 2 && got[0].outType === 'runout' && got[0].isNoBall === true && got[0].outPlayerId === A(2) && got[1].type === 'wide', 'unexpected: ' + norm(got));
    eq(proj(ui.window.MATCH), proj(ui.server.match), 'scorer screen differs from server');
});

// ---------- Randomised sequences vs. a model of the intended behaviour ----------
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
async function fuzz(seed) {
    const r = rng(seed), pick = (arr) => arr[Math.floor(r() * arr.length)];
    const ui = await boot(); const committed = []; let pending = null; let wickets = 0; const log = [];
    const commit = () => { if (pending) { committed.push(pending); pending = null; } };
    const stateNow = () => oracle(committed);
    try {
        const steps = 5 + Math.floor(r() * 7);
        for (let i = 0; i < steps; i++) {
            const choices = ['four', 'wide', 'run', 'menu', 'menu', 'runout', 'catch', 'noball', 'check', 'discard'];
            let c = pick(choices);
            if ((c === 'runout' || c === 'catch') && wickets >= 5) c = 'four';
            if ((c === 'check' || c === 'discard') && !pending) c = 'menu';
            log.push(c);
            if (c === 'four') { commit(); committed.push(simple('four')); ui.four(); }
            else if (c === 'wide') { commit(); committed.push(simple('wide')); ui.wide(); }
            else if (c === 'run') { const t = pick(['dot', 'one', 'two', 'three']); commit(); committed.push(simple(t)); ui.runs(t); }
            else if (c === 'menu') { const m = pick(['out', 'noball', 'run']); if (m === 'out') ui.openOut(); else if (m === 'noball') ui.openNoBall(); else ui.padData('action', 'morerun'); ui.back(); }
            else if (c === 'noball') { const o = pick(['dot', 'one', 'two', 'three', 'four']); commit(); 
                pending = nbBody(o === 'dot' ? 0 : o === 'one' ? 1 : o === 'two' ? 2 : o === 'three' ? 3 : 4, o === 'four' ? 'four' : null); ui.stageNoBall(o); }
            else if (c === 'runout') {
                const f = 1 + Math.floor(r() * 11); ui.openOut(); ui.padData('action', 'regularrunout'); ui.pick('BBowl' + f);
                const outName = pick(ui.offered()); ui.pick(outName); const runs = Math.floor(r() * 4); ui.padData('runoutruns', runs);
                const nbName = pick(ui.offered()); ui.pick(nbName); commit();
                pending = ro(f, +outName.slice(4), runs, +nbName.slice(4)); wickets++;
            }
            else if (c === 'catch') {
                const f = 1 + Math.floor(r() * 11); ui.openOut(); ui.padData('dismissal', 'catch'); ui.pick('BBowl' + f);
                const nbName = pick(ui.offered()); ui.pick(nbName); commit();
                pending = catchB(stateNow().team1.strikerId, f, +nbName.slice(4)); wickets++;
            }
            else if (c === 'check') { ui.check(); commit(); }
            else if (c === 'discard') { ui.discard(); pending = null; wickets = Math.max(0, wickets); }
            { const t0 = Date.now(); while (ui.server.saved.length < committed.length && Date.now() - t0 < 3000) await sleep(20); await sleep(260); }
            if (ui.pickerOpen() && /Next Over/.test(ui.pickerTitle())) { ui.pick('BBowl' + (2 + (i % 9))); await sleep(30); }
            eq(ui.server.saved, committed, `after step ${i + 1} (${c}) saved list is wrong [steps: ${log.join(',')}]`);
        }
        if (pending) { ui.check(); commit(); }
        { const t0 = Date.now(); while (ui.server.saved.length < committed.length && Date.now() - t0 < 3000) await sleep(20); await sleep(400); }
        eq(ui.server.saved, committed, `final saved list wrong [steps: ${log.join(',')}]`);
        eq(projNB(ui.server.match), projNB(oracle(committed)), `server state wrong [steps: ${log.join(',')}]`);
        eq(projNB(ui.window.MATCH), projNB(oracle(committed)), `scorer screen wrong [steps: ${log.join(',')}]`);
        const bad = ui.errors.filter((e) => !/Not implemented: navigation/.test(e)); if (bad.length) throw new Error('page errors: ' + bad.join(' ; '));
        return null;
    } catch (e) { return e.message; } finally { ui.window.close(); }
}
const N = +(process.env.FUZZ || 40); let fz = 0, fzFail = [];
for (let b = 0; b < N; b += 6) { const batch = []; for (let k = b; k < Math.min(N, b + 6); k++) batch.push(fuzz(1000 + k).then((m) => { fz++; if (m) fzFail.push([1000 + k, m]); })); await Promise.all(batch); }
results.push([`H   random sequences (${N} runs, 5-11 steps each) match scorer intent`, fzFail.length === 0, fzFail.slice(0, 3).map(([s, m]) => `seed ${s}: ${m}`).join('\n   ')]);

let fail = 0; results.forEach(([n, ok, msg]) => { if (!ok) fail++; console.log((ok ? 'PASS  ' : 'FAIL  ') + n + (ok ? '' : '\n     -> ' + msg)); });
console.log(`\n${results.length - fail}/${results.length} passed` + (fzFail.length ? `  (fuzz failures: ${fzFail.length}/${N})` : ''));
process.exit(fail ? 1 : 0);
})();