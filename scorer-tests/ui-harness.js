// Shared browser harness: boots the REAL score page in jsdom, wired to the REAL controllers on the fake DB.
const { ROOT, path, fs, JSDOM, db, clone, ctrl, pad, AID, BID, newMatch, mkRes, M, api } = require('./fake-server');
const ejs = require('ejs');
const { VirtualConsole } = require('jsdom');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(id, substitutePlayers = []) {
    const match = M(id);
    let html = await ejs.renderFile(path.join(ROOT, 'views/turfs/score.ejs'), { match, substitutePlayers, isAdmin: true, user: { role: 'admin' } }, { root: path.join(ROOT, 'views') });
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
                const handlers = { setup: ctrl.setupInnings, substitute: ctrl.addSubstitute, balls: ctrl.recordBalls, ball: ctrl.recordBall, undo: ctrl.undoLastBall, redo: ctrl.redoLastBall, 'end-innings': ctrl.endInnings, 'wicket-limit': ctrl.setWicketLimit };
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
        // tap the bowler on the live card; if the over is running the app asks "Bowler change" vs "Wrong bowler"
        async changeBowler(kind, name) {
            click(doc.querySelector('#liveScoreSummaryWrapper .live-bowler-col .live-player-line'));
            const dlg = [...doc.querySelectorAll('[data-choice]')];
            if (dlg.length) {
                const b = dlg.find((x) => x.dataset.choice === kind);
                if (b.disabled) return 'disabled';
                click(b); await sleep(30);
            }
            ui.pick(name); await ui.settle(); return 'ok';
        },
        dialogShown() { return !!doc.querySelector('[data-choice]'); },
        pickerOpen() { return doc.getElementById('cardPickerOverlay').style.display === 'flex'; },
        pickerTitle() { return doc.getElementById('cardPickerTitle').textContent; },
        close() { window.close(); },
    };
    return ui;
}

module.exports = { boot, sleep };