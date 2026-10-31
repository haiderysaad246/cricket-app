const path = require('path');
const fs = require('fs');
const ejs = require('ejs');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = process.env.CRICKET_ROOT || '/home/claude/p/cricket2/cricket2';
const BallRules = require(path.join(ROOT, 'public/js/ballRules.js')).applyBall;
const hex = (prefix, n) => prefix + String(n).padStart(24 - prefix.length, '0');

function makeTeam(name, battingPrefix, bowlingPrefix, withPlayers) {
    const batting = [], bowling = [];
    for (let i = 1; i <= 11; i++) {
        batting.push({ id: hex(battingPrefix, i), name: `${name[0]}Bat${i}`, image: '', runs: 0, balls: 0, dots: 0, fours: 0, sixes: 0,
            status: withPlayers && i <= 2 ? 'batting' : 'yet_to_bat', dismissalText: null, battingOrder: withPlayers && i <= 2 ? i : null });
        bowling.push({ id: hex(bowlingPrefix, i), name: `${name[0]}Bowl${i}`, image: '', balls: 0, noBalls: 0, wideRuns: 0, dots: 0, overs: 0,
            maidens: 0, runs: 0, wickets: 0, wicketStreak: 0, hatTrick: false });
    }
    return { name, captainId: null, batting, bowling,
        strikerId: withPlayers ? batting[0].id : null, nonStrikerId: withPlayers ? batting[1].id : null,
        currentBowlerId: null, currentOverBowlerId: null, keeperId: null, legalBalls: 0, currentOverBalls: [], currentOverRuns: 0,
        overStarted: false, overBowlerBase: null, overSplit: false, totalRuns: 0, wickets: 0, wicketLimit: null,
        extraWides: 0, extraNoBalls: 0, endedEarly: false, statsAggregated: false };
}

// Team A bats (A-bat1..11 are the batters), Team B bowls (B-bowl1..11 are the fielders)
function makeMatch() {
    const team1 = makeTeam('A', 'a', 'b', true);   // batting team: batters a..., its own bowling list is unused
    const team2 = makeTeam('B', 'c', 'd', false);
    // Fielders live in the batting team's `bowling` list on this page (team.bowling = fielding side)
    team1.bowling = team2.bowling.map((r) => ({ ...r }));
    team1.currentBowlerId = team1.bowling[0].id;
    return { _id: 'M1', overs: 10, battingFirst: 'team1', currentInnings: 'team1', team1, team2, status: 'live', result: null,
        winnerKey: null, lastBallSnapshots: [], redoBallSnapshots: [], processedBallActionIds: [], ballEvents: [], isSuperOver: false };
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function boot() {
    const match = makeMatch();
    let html = await ejs.renderFile(path.join(ROOT, 'views/turfs/score.ejs'), { match, isAdmin: true, user: { role: 'admin' } }, { root: path.join(ROOT, 'views') });
    // inline the real project scripts (in the same order the page loads them)
    const inline = (src) => '<script>' + fs.readFileSync(path.join(ROOT, 'public/js', src), 'utf8').replace(/<\/script>/g, '<\\/script>') + '</script>';
    html = html.replace(/<script src="https?:[^"]*"><\/script>/g, '').replace(/<script src="\/js\/(auth|pwa)\.js"><\/script>/g, '');
    html = html.replace('<script src="/js/ballRules.js"></script>', inline('ballRules.js'));
    html = html.replace('<script src="/js/scoreStorage.js"></script>', '');
    html = html.replace('<script src="/js/score.js"></script>', '<script>window.ScoreStorage={load:async()=>null,save:async()=>{}};</script>' + inline('score.js'));

    const server = { match: JSON.parse(JSON.stringify(match)), saved: [], rejected: [] };
    const errors = [];
    const vc = new VirtualConsole();
    vc.on('jsdomError', (e) => errors.push(String(e.message || e)));
    vc.on('error', (e) => errors.push(String(e)));
    const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'http://localhost/turfs/live/M1/score', pretendToBeVisual: true,
        virtualConsole: vc,
        beforeParse(window) {
            window.alert = (m) => errors.push('ALERT: ' + m);
            window.fetch = async (url, opts) => {
                const body = JSON.parse(opts.body);
                if (/\/setup$/.test(url)) {
                    const t = server.match[server.match.currentInnings];
                    if (body.bowlerId) { t.currentBowlerId = body.bowlerId; t.currentOverBalls = []; t.currentOverRuns = 0; t.overStarted = false; }
                    return { ok: true, status: 200, json: async () => ({ ok: true, match: JSON.parse(JSON.stringify(server.match)) }) };
                }
                if (!/\/balls$/.test(url)) throw new Error('unexpected fetch ' + url);
                const applied = [];
                for (const b of body.balls) {
                    const r = BallRules(server.match, server.match.currentInnings, JSON.parse(JSON.stringify(b)));
                    if (!r.ok) { server.rejected.push({ b, r }); continue; }
                    const { clientActionId, ...rest } = b;
                    server.saved.push(rest);
                    applied.push(clientActionId);
                }
                return { ok: true, status: 200, json: async () => ({ ok: true, appliedActionIds: applied, match: JSON.parse(JSON.stringify(server.match)) }) };
            };
        } });
    await sleep(50);
    const { window } = dom;
    const doc = window.document;
    const ui = {
        window, doc, server, errors, match,
        click(el) { el.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); },
        pad(pred) {
            const btn = [...doc.querySelectorAll('#scorePadGrid .score-pad-btn')].find(pred);
            if (!btn) throw new Error('pad button not found; level=' + doc.getElementById('scorePadHeader').textContent + ' buttons=' + [...doc.querySelectorAll('#scorePadGrid .score-pad-btn')].map((b) => b.textContent.trim()).join('|'));
            ui.click(btn);
        },
        padData(k, v) { ui.pad((b) => (v === undefined ? b.dataset[k] !== undefined : b.dataset[k] === String(v))); },
        pick(name) {
            const open = doc.getElementById('cardPickerOverlay').style.display === 'flex';
            if (!open) throw new Error('picker not open (expected to pick ' + name + ')');
            const item = [...doc.querySelectorAll('.ig-picker-item')].find((i) => i.querySelector('.ig-picker-name').textContent === name);
            if (!item) throw new Error(`"${name}" not offered. Offered: ` + [...doc.querySelectorAll('.ig-picker-name')].map((n) => n.textContent).join(','));
            ui.click(item);
            ui.click(doc.getElementById('confirmCardPicker'));
        },
        offered() { return [...doc.querySelectorAll('.ig-picker-name')].map((n) => n.textContent); },
        pickerTitle() { return doc.getElementById('cardPickerTitle').textContent; },
        pickerOpen() { return doc.getElementById('cardPickerOverlay').style.display === 'flex'; },
        card() { const c = doc.getElementById('pendingRunoutCard'); return c.hidden ? null : c.textContent.replace(/\s+/g, ' ').trim(); },
        check() { const b = doc.querySelector('[data-confirm-runout],[data-confirm-pending]'); if (!b) throw new Error('no check button'); ui.click(b); },
        discard() { const b = doc.querySelector('[data-cancel-runout],[data-cancel-pending]'); if (!b) throw new Error('no discard button'); ui.click(b); },
        back() { ui.click(doc.getElementById('scorePadBackBar')); },
        close() { ui.click(doc.getElementById('cardPickerCloseBtn')); },
        async settle() { await sleep(450); },
        header() { return doc.getElementById('scorePadHeader').textContent; },
        clientTeam() { return window.MATCH[window.MATCH.currentInnings]; },
    };
    // high-level scorer actions (exactly the taps a scorer makes)
    ui.runs = (type) => { ui.padData('action', 'morerun'); ui.padData('run', type); };       // 1,2,3 (Running) -> dot/one/two/three
    ui.four = () => ui.padData('run', 'four');
    ui.wide = () => ui.padData('parent', 'wide');
    ui.openOut = () => ui.padData('parent', 'out');
    ui.openNoBall = () => ui.padData('parent', 'noball');
    ui.stageRunout = (fielder, outBatter, runs, newBat) => {
        ui.openOut(); ui.padData('action', 'regularrunout');
        ui.pick(fielder); ui.pick(outBatter); ui.padData('runoutruns', runs); ui.pick(newBat);
    };
    ui.stageCatch = (fielder, newBat) => { ui.openOut(); ui.padData('dismissal', 'catch'); ui.pick(fielder); ui.pick(newBat); };
    ui.stageNoBall = (opt) => { ui.openNoBall(); ui.padData('nb', opt); };
    return ui;
}

// Oracle: what the scorer INTENDED, applied with the same shared rules on a fresh match
function oracle(intended) {
    const m = makeMatch();
    for (const b of intended) {
        const r = BallRules(m, m.currentInnings, JSON.parse(JSON.stringify(b)));
        if (!r.ok) throw new Error('oracle rejected ' + JSON.stringify(b) + ' ' + JSON.stringify(r));
    }
    return m;
}
const proj = (m) => { const t = m[m.currentInnings]; return JSON.stringify({ r: t.totalRuns, w: t.wickets, lb: t.legalBalls, s: t.strikerId, ns: t.nonStrikerId,
    ov: t.currentOverBalls, bat: t.batting.map((p) => [p.id, p.runs, p.balls, p.status]), bowl: t.bowling.map((p) => [p.id, p.balls, p.runs, p.wickets]) }); };

module.exports = { boot, oracle, proj, hex, makeMatch, sleep };