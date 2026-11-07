// Shared in-memory fake of the Mongoose models + the REAL controllers.
// (used by batter-change-tests.js and batter-change-ui-tests.js)
// Runs the REAL server code (controllers/turf.controller.js, public/js/ballRules.js,
// utils/mvp.js) against an in-memory fake of the Mongoose models, then renders the
// REAL public/js/turf-stats.js leaderboards (Most Sixes / Most Fours / Most Runs / MVP)
// in jsdom. No MongoDB needed.
//
//   CRICKET_ROOT=/path/to/cricket2 node batter-change-tests.js
const path = require('path');
const ROOT = process.env.CRICKET_ROOT || path.resolve(__dirname, '..');
const fs = require('fs');
const { JSDOM } = require('jsdom');

// ---------------------------------------------------------------- fake DB
const db = { matches: new Map(), players: new Map(), turfs: new Map() };
const clone = (o) => JSON.parse(JSON.stringify(o));
function setPath(obj, dotted, fn) {
    const parts = dotted.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]];
    cur[parts[parts.length - 1]] = fn(cur[parts[parts.length - 1]]);
}
function applyUpdate(doc, update) {
    for (const [k, v] of Object.entries(update.$inc || {})) setPath(doc, k, (x) => (x || 0) + v);
    for (const [k, v] of Object.entries(update.$set || {})) setPath(doc, k, () => v);
}
const zeroBat = () => ({ runs: 0, matches: 0, innings: 0, average: 0, strikeRate: 0, highest: 0, highestBalls: 0, ducks: 0, ballsFaced: 0, dots: 0, fours: 0, sixes: 0 });
const zeroBowl = () => ({ wickets: 0, innings: 0, overs: 0, ballsBowled: 0, runsConceded: 0, dots: 0, dotBallPercentage: 0, noBalls: 0, wideRuns: 0, average: 0, economyRate: 0, strikeRate: 0, maidens: 0, hatTricks: 0 });
function newPlayer(id, name) {
    db.players.set(id, { _id: id, name, image: '', matchMvpCount: 0, turfMvpCount: 0, turfStats: { batting: zeroBat(), bowling: zeroBowl() } });
}
const withToObject = (p) => {
    const c = clone(p);
    Object.defineProperty(c.turfStats, 'toObject', { value: () => clone(c.turfStats), enumerable: false });
    return c;
};
const PlayerStub = {
    findByIdAndUpdate(id, update) {
        let p;
        const run = () => { if (!p) { const d = db.players.get(String(id)); if (d) applyUpdate(d, update); p = d ? clone(d) : null; } return Promise.resolve(p); };
        return { then: (a, b) => run().then(a, b), lean: () => run() };
    },
    async updateOne(filter, update) {
        const d = db.players.get(String(filter._id));
        if (!d) return;
        if (filter.matchMvpCount && filter.matchMvpCount.$gt !== undefined && !(d.matchMvpCount > filter.matchMvpCount.$gt)) return;
        applyUpdate(d, update);
    },
    async find(q) {
        const ids = q && q._id && q._id.$in ? q._id.$in.map(String) : [...db.players.keys()];
        return ids.filter((i) => db.players.has(i)).map((i) => withToObject(db.players.get(i)));
    },
    async findById(id) { const d = db.players.get(String(id)); return d ? Object.assign(withToObject(d), { async save() { /* unused */ } }) : null; },
    async bulkWrite(ops) { for (const op of ops) applyUpdate(db.players.get(String(op.updateOne.filter._id)), op.updateOne.update); },
};
class MatchDoc {
    constructor(json) { Object.assign(this, clone(json)); }
    markModified() {}
    toObject() { return clone(this); }
    async save() { db.matches.set(String(this._id), JSON.stringify(this)); }
}
const hydrate = (s) => new MatchDoc(JSON.parse(s));
const matchesOf = (q) => [...db.matches.values()].map(hydrate).filter((m) => Object.entries(q || {}).every(([k, v]) => v === undefined || (v && typeof v === 'object' ? true : String(m[k]) === String(v))));
const MatchStub = {
    async findOne(q) { return matchesOf(q)[0] || null; },
    async findById(id) { return matchesOf({ _id: id })[0] || null; },
    async find(q) { return matchesOf(q); },
    async deleteMany(q) { for (const m of matchesOf(q)) db.matches.delete(String(m._id)); },
};
const TurfStub = {
    async findOne(q) { const t = db.turfs.get(String(q._id)); return t || null; },
    async findByIdAndDelete(id) { db.turfs.delete(String(id)); },
};
const TeamStub = {
    async find() {
        return [{
            _id: 'reserve-team',
            players: [...db.players.keys()]
                .filter((id) => String(id).startsWith('c'))
                .map((id) => ({ _id: id })),
        }];
    },
};
function stub(rel, exp) {
    const f = require.resolve(path.join(ROOT, rel));
    require.cache[f] = { id: f, filename: f, loaded: true, exports: exp, children: [], paths: [] };
}
stub('models/matches.js', MatchStub);
stub('models/player.model.js', PlayerStub);
stub('models/turfs.js', TurfStub);
['models/counters.js', 'models/tcl.model.js', 'models/session.model.js'].forEach((m) => stub(m, {}));
stub('models/team.model.js', TeamStub);
const ctrl = require(path.join(ROOT, 'controllers/turf.controller.js'));
const { computeMVP } = require(path.join(ROOT, 'utils/mvp.js'));

// ---------------------------------------------------------------- helpers
const pad = (prefix, n) => prefix + String(n).padStart(2, '0');
const AID = (n) => pad('a', n), BID = (n) => pad('b', n);
let matchSeq = 0;
function makeRow(prefix, n, nm) { return { id: pad(prefix, n), name: nm + n, image: '', isCaptain: false, runs: 0, balls: 0, dots: 0, fours: 0, sixes: 0, status: 'yet_to_bat', dismissalText: null, battingOrder: null }; }
function makeBowl(prefix, n, nm) { return { id: pad(prefix, n), name: nm + n, image: '', isCaptain: false, balls: 0, noBalls: 0, wideRuns: 0, dots: 0, overs: 0, maidens: 0, runs: 0, wickets: 0, wicketStreak: 0, hatTrick: false }; }
function teamState(name, bat, bowl) {
    return { name, captainId: null, captainName: null, captainImage: null, batting: bat, bowling: bowl, strikerId: null, nonStrikerId: null, currentBowlerId: null, currentOverBowlerId: null, keeperId: null,
        keeperName: null, legalBalls: 0, currentOverBalls: [], currentOverRuns: 0, overStarted: false, overBowlerBase: null, overSplit: false, totalRuns: 0, wickets: 0, wicketLimit: null,
        extraWides: 0, extraNoBalls: 0, endedEarly: false, statsAggregated: false };
}
function newMatch(overs = 10, turfId = 'T1') {
    const id = 'M' + (++matchSeq);
    for (let i = 1; i <= 11; i++) { if (!db.players.has(AID(i))) newPlayer(AID(i), 'A' + i); if (!db.players.has(BID(i))) newPlayer(BID(i), 'B' + i); }
    const range = [...Array(11).keys()].map((i) => i + 1);
    const doc = {
        _id: id, overs, battingFirst: 'team1', currentInnings: 'team1', status: 'live', result: null, winnerKey: null, turfId, mvpAwarded: false, isSuperOver: false,
        lastBallSnapshots: [], redoBallSnapshots: [], processedBallActionIds: [], ballEvents: [],
        team1: teamState('Alpha', range.map((i) => makeRow('a', i, 'A')), range.map((i) => makeBowl('b', i, 'B'))),
        team2: teamState('Beta', range.map((i) => makeRow('b', i, 'B')), range.map((i) => makeBowl('a', i, 'A'))),
    };
    db.matches.set(id, JSON.stringify(doc));
    return id;
}
function mkRes() { const r = { code: 200, body: null, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; }, redirect() { return r; } }; return r; }
async function call(fn, id, body = {}) {
    const res = mkRes();
    await fn({ params: { id }, body, headers: { accept: 'application/json' } }, res);
    return res;
}
const M = (id) => JSON.parse(db.matches.get(id));
const row = (id, innings, n, prefix) => M(id)[innings].batting.find((r) => r.id === pad(prefix || (innings === 'team1' ? 'a' : 'b'), n));
const api = (id, innings = 'team1') => ({
    setup: (b) => call(ctrl.setupInnings, id, { innings, ...b }),
    ball: async (type, extra = {}) => { const r = await call(ctrl.recordBall, id, { innings, type, ...extra }); if (r.code !== 200) throw new Error(`ball ${type} rejected: ${JSON.stringify(r.body)}`); return r; },
    out: (outType, outN, newN, extra = {}, pfx) => call(ctrl.recordBall, id, { innings, type: 'out', outType, outPlayerId: pad(pfx || (innings === 'team1' ? 'a' : 'b'), outN), newBatsmanId: pad(pfx || (innings === 'team1' ? 'a' : 'b'), newN), ...extra }),
    undo: () => call(ctrl.undoLastBall, id),
    redo: () => call(ctrl.redoLastBall, id),
    open: (s, n, bowler = 1) => { const p = innings === 'team1' ? ['a', 'b'] : ['b', 'a']; return call(ctrl.setupInnings, id, { innings, strikerId: pad(p[0], s), nonStrikerId: pad(p[0], n), bowlerId: pad(p[1], bowler) }); },
});


module.exports = { ROOT, path, fs, JSDOM, db, clone, ctrl, computeMVP, pad, AID, BID, newMatch, mkRes, call, M, row, api, matchesOf, hydrate };