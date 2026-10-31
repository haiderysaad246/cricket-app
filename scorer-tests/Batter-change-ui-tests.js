// Browser-level tests: the REAL scoring page (views/turfs/score.ejs + public/js/score.js + ballRules.js)
// runs in jsdom, every network call goes to the REAL server controllers on an in-memory DB.
// A scorer's taps are simulated exactly: pad buttons, tap on batters -> "Change batters" popup, Undo, Redo.
//   node scorer-tests/batter-change-ui-tests.js
const { ROOT, path, fs, JSDOM, db, clone, ctrl, pad, AID, BID, newMatch, mkRes, M, api } = require('./fake-server');
const ejs = require('ejs');
const { VirtualConsole } = require('jsdom');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(id) {
    const match = M(id);
    let html = await ejs.renderFile(path.join(ROOT, 'views/turfs/score.ejs'), { match, isAdmin: true, user: { role: 'admin' } }, { root: path.join(ROOT, 'views') });
    const inline = (src) => '<script>' + fs.readFileSync(path.join(ROOT, 'public/js', src), 'utf8').replace(/<\/script>/g, '<\\/script>') + '</script>';
    html = html.replace(/<script src="https?:[^"]*"><\/script>/g, '').replace(/<script src="\/js\/(auth|pwa)\.js"><\/script>/g, '');
    html = html.replace('<script src="/js/ballRules.js"></script>', inline('ballRules.js'));
    html = html.replace('<script src="/js/scoreStorage.js"></script>', '');
    html = html.replace('<script src="/js/score.js"></script>', '<script>window.ScoreStorage={load:async()=>null,save:async()=>{}};</script>' + inline('score.js'));
    const errors = [], confirms = [], requests = [];
    const vc = new VirtualConsole();
    vc.on('jsdomError', (e) => errors.push(String(e.message || e)));
    vc.on('error', (e) => errors.push(String(e)));
    let confirmAnswer = true;
    const dom = new JSDOM(html, {
        runScripts: 'dangerously', url: `http://localhost/turfs/live/${id}/score`, pretendToBeVisual: true, virtualConsole: vc,
        beforeParse(window) {
            window.alert = (m) => errors.push('ALERT: ' + m);
            window.confirm = (m) => { confirms.push(m); return confirmAnswer; };
            window.fetch = async (url, opts) => {
                const m = String(url).match(/\/turfs\/live\/([^/]+)\/([a-z-]+)$/);
                const handlers = { setup: ctrl.setupInnings, balls: ctrl.recordBalls, ball: ctrl.recordBall, undo: ctrl.undoLastBall, redo: ctrl.redoLastBall, 'end-innings': ctrl.endInnings, 'wicket-limit': ctrl.setWicketLimit };
                if (!m || !handlers[m[2]]) return { ok: false, status: 404, json: async () => ({ ok: false, error: 'unexpected ' + url }) };
                const body = JSON.parse(opts.body);
                requests.push({ kind: m[2], body });
                const res = mkRes();
                await handlers[m[2]]({ params: { id: m[1] }, body, headers: { accept: 'application/json' } }, res);
                const payload = JSON.parse(JSON.stringify(res.body));
                return { ok: res.code < 400, status: res.code, json: async () => payload };
            };
        },
    });
    await sleep(60);
    const { window } = dom, doc = window.document;
    const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    const ui = {
        window, doc, errors, confirms, requests,
        setConfirm(v) { confirmAnswer = v; },
        padBtn(pred) { const b = [...doc.querySelectorAll('#scorePadGrid .score-pad-btn')].find(pred); if (!b) throw new Error('pad button not found: ' + [...doc.querySelectorAll('#scorePadGrid .score-pad-btn')].map((x) => x.textContent.trim()).join('|')); click(b); },
        padData(k, v) { ui.padBtn((b) => (v === undefined ? b.dataset[k] !== undefined : b.dataset[k] === String(v))); },
        async run(type) { if (type === 'four' || type === 'six') ui.padData('run', type); else { ui.padData('action', 'morerun'); ui.padData('run', type); } await ui.settle(); },
        pick(name) {
            const item = [...doc.querySelectorAll('.ig-picker-item')].find((i) => i.querySelector('.ig-picker-name').textContent === name);
            if (!item) throw new Error(`"${name}" not offered. Offered: ` + [...doc.querySelectorAll('.ig-picker-name')].map((n) => n.textContent).join(','));
            click(item); click(doc.getElementById('confirmCardPicker'));
        },
        offered() { return [...doc.querySelectorAll('.ig-picker-name')].map((n) => n.textContent); },
        async bowled(newBat) { ui.padData('parent', 'out'); ui.padData('dismissal', 'bowled'); ui.pick(newBat); await ui.settle(); },
        async undo() { click(doc.getElementById('scorePadUndoBtn')); await ui.settle(); },
        async redo() { click(doc.getElementById('scorePadRedoBtn')); await ui.settle(); },
        undoVisible() { return doc.getElementById('scorePadUndoBtn').style.display !== 'none'; },
        redoVisible() { return doc.getElementById('scorePadRedoBtn').style.display !== 'none'; },
        // Scorer taps the batters on the live score card -> popup, picks new striker/non-striker, presses save
        async changeBatters({ striker, nonStriker }) {
            click(doc.querySelector('#liveScoreSummaryWrapper .live-batters-col'));
            if (doc.getElementById('scoreSetupOverlay').style.display !== 'flex') throw new Error('Change-batters popup did not open');
            if (striker) { click(doc.querySelector('.role-pick-btn[data-role="striker"]')); ui.pick(striker); }
            if (nonStriker) { click(doc.querySelector('.role-pick-btn[data-role="nonStriker"]')); ui.pick(nonStriker); }
            doc.getElementById('scoreSetupForm').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
            await ui.settle();
        },
        popupAvailable() { click(doc.querySelector('#liveScoreSummaryWrapper .live-batters-col')); const open = doc.getElementById('scoreSetupOverlay').style.display === 'flex'; if (open) click(doc.getElementById('cancelScoreSetup')); return open; },
        async settle() { await sleep(450); },
        screen() { return window.MATCH; },
        // the numbers shown in the on-screen batter table
        shownBatters() {
            return [...doc.querySelectorAll('#liveScoreSummaryWrapper .live-batters-col tr, #liveScoreSummaryWrapper .live-batter-row')].map((r) => r.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
        },
        close() { window.close(); },
    };
    return ui;
}

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
const compact = (m, innings = 'team1') => {
    const tm = m[innings];
    return { total: tm.totalRuns, wkts: tm.wickets, striker: String(tm.strikerId), non: String(tm.nonStrikerId),
        rows: tm.batting.map((r) => [r.name, r.runs, r.balls, r.fours, r.sixes, r.status, r.battingOrder]).filter((r) => r[5] !== 'yet_to_bat' || r[1] || r[2]) };
};
// The browser's own copy of the match must equal what the server stored
function synced(t, ui, id, label, innings = 'team1') { t.eq(compact(ui.screen(), innings), compact(JSON.parse(db.matches.get(id)), innings), `screen vs database (${label})`); }

(async () => {
    await test('U1 tap 4, 6 -> change striker A1->A4 in the popup -> screen and DB both show A4 10(2), A1 gone', async (t, bootUi) => {
        const id = newMatch(); await api(id).open(1, 2);
        const ui = await bootUi(id);
        await ui.run('four'); await ui.run('six');
        await ui.changeBatters({ striker: 'A4' });
        t.eq(ui.confirms, ['Move 10 (2) from A1 to A4?'], 'confirmation text shown to scorer');
        synced(t, ui, id, 'after change');
        const s = compact(ui.screen());
        t.eq(s.rows, [['A2', 0, 0, 0, 0, 'batting', 2], ['A4', 10, 2, 1, 1, 'batting', 1]], 'rows on screen');
        t.eq(s.total, 10, 'total');
        await ui.run('four');
        synced(t, ui, id, 'after 4 more'); t.eq(compact(ui.screen()).rows.find((r) => r[0] === 'A4').slice(1, 5), [14, 3, 2, 1], 'A4 14(3) 2x4 1x6');
    });

    await test('U2 scorer DECLINES the "Move runs?" confirmation -> nothing is sent, nothing changes', async (t, bootUi) => {
        const id = newMatch(); await api(id).open(1, 2);
        const ui = await bootUi(id);
        await ui.run('four'); ui.setConfirm(false);
        const before = db.matches.get(id), reqs = ui.requests.length;
        await ui.changeBatters({ striker: 'A4' });
        t.eq(ui.requests.length, reqs, 'no extra server request'); t.eq(db.matches.get(id), before, 'DB untouched');
    });

    await test('U3 change after scoring, then UNDO x2 and REDO x2 in the browser: browser == server at every step', async (t, bootUi) => {
        const id = newMatch(); await api(id).open(1, 2);
        const ui = await bootUi(id);
        await ui.run('four'); await ui.run('six');
        await ui.changeBatters({ striker: 'A4' });
        await ui.undo();  synced(t, ui, id, 'undo 1');
        t.eq(compact(ui.screen()).rows.find((r) => r[0] === 'A4').slice(1, 5), [4, 1, 1, 0], 'A4 after undo 1');
        t.ok(!compact(ui.screen()).rows.some((r) => r[0] === 'A1'), 'A1 not shown after undo 1');
        await ui.undo();  synced(t, ui, id, 'undo 2');
        t.eq(compact(ui.screen()).total, 0, 'total 0');
        t.ok(!compact(ui.screen()).rows.some((r) => r[0] === 'A1'), 'A1 not shown after undo 2');
        await ui.redo();  synced(t, ui, id, 'redo 1');
        await ui.redo();  synced(t, ui, id, 'redo 2');
        t.eq(compact(ui.screen()).rows.find((r) => r[0] === 'A4').slice(1, 5), [10, 2, 1, 1], 'A4 after redo x2');
        t.ok(!ui.redoVisible(), 'redo button hidden when nothing left');
    });

    await test('U4 after a change the Redo button disappears (redo history is cleared by the server)', async (t, bootUi) => {
        const id = newMatch(); await api(id).open(1, 2);
        const ui = await bootUi(id);
        await ui.run('four'); await ui.run('six'); await ui.undo();
        t.ok(ui.redoVisible(), 'redo available after undo');
        await ui.changeBatters({ striker: 'A4' });
        t.ok(!ui.redoVisible(), 'redo hidden after change');
        synced(t, ui, id, 'after change');
    });

    await test('U5 wicket for the REPLACEMENT batter in the browser: out batter keeps the moved runs', async (t, bootUi) => {
        const id = newMatch(); await api(id).open(1, 2);
        const ui = await bootUi(id);
        await ui.run('four'); await ui.run('six');
        await ui.changeBatters({ striker: 'A4' });
        await ui.bowled('A5');
        synced(t, ui, id, 'after wicket');
        const r = compact(ui.screen()).rows;
        t.eq(r.find((x) => x[0] === 'A4').slice(1, 6), [10, 3, 1, 1, 'out'], 'A4 out 10(3)');
        t.ok(!r.some((x) => x[0] === 'A1'), 'A1 not in scorecard');
        await ui.undo(); synced(t, ui, id, 'undo wicket');
        t.eq(compact(ui.screen()).rows.find((x) => x[0] === 'A4').slice(5, 6), ['batting'], 'A4 batting again');
        await ui.redo(); synced(t, ui, id, 'redo wicket');
    });

    await test('U6 change BOTH batters in one go (both had scored) then undo/redo', async (t, bootUi) => {
        const id = newMatch(); await api(id).open(1, 2);
        const ui = await bootUi(id);
        await ui.run('four'); await ui.run('one'); await ui.run('two');          // A1 5(2), A2 2(1)
        await ui.changeBatters({ striker: 'A6', nonStriker: 'A7' });
        synced(t, ui, id, 'after change');
        const r = compact(ui.screen()).rows;
        t.eq(r.map((x) => x.slice(0, 5)), [['A6', 2, 1, 0, 0], ['A7', 5, 2, 1, 0]], 'A6 2(1), A7 5(2)');
        await ui.undo(); synced(t, ui, id, 'undo'); await ui.undo(); synced(t, ui, id, 'undo 2'); await ui.redo(); synced(t, ui, id, 'redo');
    });

    await test('U7 change 4 times in a row on the same slot, scoring in between (A1->A3->A4->A5->A6)', async (t, bootUi) => {
        const id = newMatch(); await api(id).open(1, 2);
        const ui = await bootUi(id);
        let who = 'A1', cur = 0;
        for (const next of ['A3', 'A4', 'A5', 'A6']) {
            await ui.run('four'); cur += 4;
            await ui.changeBatters({ striker: next }); who = next;
            synced(t, ui, id, 'after change to ' + next);
        }
        const rows = compact(ui.screen()).rows;
        t.eq(rows.find((x) => x[0] === 'A6').slice(1, 5), [16, 4, 4, 0], 'A6 carries all 16 runs / 4 fours');
        t.eq(rows.filter((x) => x[1] > 0).map((x) => x[0]), ['A6'], 'nobody else has runs');
        t.eq(compact(ui.screen()).total, 16, 'total');
    });

    await test('U8 popup stays available only while batters are still "batting" (not after a wicket removes the striker)', async (t, bootUi) => {
        const id = newMatch(); await api(id).open(1, 2);
        const ui = await bootUi(id);
        await ui.run('four'); await ui.bowled('A3');
        t.ok(ui.popupAvailable(), 'popup opens (A2 and A3 are batting)');
        const before = db.matches.get(id);
        await ui.changeBatters({ striker: 'A9' });                // replace the new batter A3 -> A9
        synced(t, ui, id, 'after replacing the new batter');
        t.eq(compact(ui.screen()).rows.find((x) => x[0] === 'A1').slice(1, 6), [4, 2, 1, 0, 'out'], 'A1 stays out 4(2) (4 then bowled)');
        t.ok(db.matches.get(id) !== before, 'DB changed');
    });

    let failed = 0;
    for (const r of results) { const ok = !r.fails.length; if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${r.name}`); r.fails.forEach((f) => console.log('        - ' + f)); }
    console.log(`\n${results.length - failed}/${results.length} browser scenarios passed`);
    process.exit(failed ? 1 : 0);
})();