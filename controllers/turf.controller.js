const Player = require("../models/player.model");
const Match = require("../models/matches");
const Turf = require("../models/turfs");
const Counter = require("../models/counters");
const { computeMVP } = require("../utils/mvp");
const Team = require("../models/team.model");
const Tournament = require("../models/tcl.model");
const { maybeCreatePlayoffMatches, maybeCreateSuperOver } = require("./tcl.controller");
// Wraps maybeCreatePlayoffMatches/maybeCreateSuperOver so a failure never
// breaks the match flow — both are nice-to-haves, not blockers for scoring.
// Super Over check runs first since a freshly-created Super Over match
// must NOT be mistaken for a completed fixture by the playoff logic.
async function tryCreatePlayoffs(match) {
    if (!match) return;
    try { await propagateSuperOverResult(match); } catch (e) { console.log("super_over_propagate_failed", e); }
    try { await maybeCreateSuperOver(match); } catch (e) { console.log("super_over_create_failed", e); }
    if (!match.tournamentId) return;
    try { await maybeCreatePlayoffMatches(match.tournamentId); } catch (e) { console.log("playoff_create_failed", e); }
}
// After a Super Over (or a chain of them) finishes with a decisive result,
// push that result back up to every tied ancestor match so the fixture
// cards and the points table reflect the real winner. The tied parent's own
// scorecard stays "Match Tied" (its scores are still level), but its
// result/winnerKey now record who the Super Over crowned.
async function propagateSuperOverResult(match) {
    if (!match || !match.isSuperOver || !match.superOverParentId) return;
    if (match.status !== "completed" || match.result === "Match Tied") return;
    const result = match.result;
    const winnerKey = match.winnerKey;
    let parentId = match.superOverParentId;
    while (parentId) {
        const parent = await Match.findById(parentId);
        if (!parent) break;
        // Only overwrite an ancestor that's still showing a tie; if it
        // already has a decided result, leave it untouched.
        if (parent.result === "Match Tied") {
            parent.result = result;
            parent.winnerKey = winnerKey;
            await parent.save();
        }
        parentId = parent.superOverParentId;
    }
}
// Existing EJS pages use res.redirect on success/error; the React
// frontend calls the same endpoints expecting JSON. One function picks
// the right response so none of the business logic below is duplicated.
function respond(req, res, { json, redirect, status = 200 }) {
    if (req.headers.accept?.includes("application/json")) {
        return res.status(json?.error ? (status === 200 ? 400 : status) : status).json(json ?? { ok: true });
    }
    return res.redirect(redirect);
}
exports.index = async (req, res) => {
    const wantsJson = req.headers.accept?.includes("application/json");
    try {
        const [allPlayers, turfs] = await Promise.all([
            Player.find({}),
            Turf.find({ status: "active" }).sort({ createdAt: -1 }),
        ]);
        if (wantsJson) return res.json({ allPlayers, turfs });
        res.render("turfs/index.ejs", { allPlayers, turfs });
    } catch (err) {
        console.log(err);
        if (wantsJson) return res.status(500).json({ error: "load_failed" });
        res.render("turfs/index.ejs", { allPlayers: [], turfs: [] });
    }
};
// Creates an empty turf folder -- just name/date/timing. Team roster,
// overs, and toss are picked later, the first time a match is added
// inside it (see startLive isFirstMatch branch below).
exports.createTurf = async (req, res) => {
    try {
        const name = (req.body.name || "").trim();
        if (!name) {
            return respond(req, res, { json: { error: "name_required" }, redirect: "/turfs?error=name_required" });
        }
        const turf = await Turf.create({
            name,
            date: (req.body.date || "").trim() || null,
            timing: (req.body.timing || "").trim() || null,
        });
        respond(req, res, { json: { ok: true, turfId: turf._id }, redirect: "/turfs/session/" + turf._id });
    } catch (err) {
        console.log(err);
        respond(req, res, { json: { error: "create_turf_failed" }, redirect: "/turfs?error=create_turf_failed" });
    }
};
exports.startLive = async (req, res) => {
    try {
        const turfId = req.body.turfId;
        if (!turfId) {
            return respond(req, res, { json: { error: "turf_required" }, redirect: "/turfs?error=turf_required" });
        }
        const turf = await Turf.findOne({ _id: turfId, status: "active" });
        if (!turf) return respond(req, res, { json: { error: "turf_not_found" }, redirect: "/turfs?error=turf_not_found" });
        // A turf can now stay "active" with several matches inside it, so
        // the live-match guard is scoped per turf instead of globally.
        const existingLive = await Match.findOne({ status: "live", turfId: turf._id });
        if (existingLive) {
            return respond(req, res, { json: { ok: true, matchId: existingLive._id }, redirect: "/turfs/live/" + existingLive._id });
        }
        // First match ever played in this turf: overs/team names/toss/roster
        // all come from the form and get locked onto the turf. Every match
        // after that reuses whatever's already on the turf -- no re-picking.
        const isFirstMatch = !turf.overs;
        if (isFirstMatch) {
            const overs = Number(req.body.overs);
            if (!Number.isFinite(overs) || overs < 1) {
                return respond(req, res, { json: { error: "invalid_overs" }, redirect: "/turfs/session/" + turf._id + "?error=invalid_overs" });
            }
            turf.overs = overs;
            turf.battingFirst = req.body.battingFirst === "team2" ? "team2" : "team1";
            turf.team1Name = (req.body.team1Name || "Team 1").trim();
            turf.team2Name = (req.body.team2Name || "Team 2").trim();
        }
        // First match in the turf uses the toss picked on the setup form.
        // Every match after that has no toss -- whoever won the previous
        // match bats first. A tied previous match falls back to the turf's
        // original toss result.
        let battingFirst = turf.battingFirst;
        if (!isFirstMatch) {
            const prevMatch = await Match.findOne({ turfId: turf._id }).sort({ createdAt: -1 });
            if (prevMatch && prevMatch.winnerKey) {
                battingFirst = prevMatch.winnerKey;
            }
        }
        let team1PlayerIds, team2PlayerIds, team1Captain, team2Captain;
        if (isFirstMatch) {
            team1PlayerIds = req.body.team1Players || [];
            team2PlayerIds = req.body.team2Players || [];
            if (!Array.isArray(team1PlayerIds)) team1PlayerIds = [team1PlayerIds];
            if (!Array.isArray(team2PlayerIds)) team2PlayerIds = [team2PlayerIds];
            team1Captain = req.body.team1Captain || null;
            team2Captain = req.body.team2Captain || null;
            turf.team1PlayerIds = team1PlayerIds;
            turf.team2PlayerIds = team2PlayerIds;
            turf.team1CaptainId = team1Captain;
            turf.team2CaptainId = team2Captain;
            await turf.save();
        } else {
            team1PlayerIds = turf.team1PlayerIds;
            team2PlayerIds = turf.team2PlayerIds;
            team1Captain = turf.team1CaptainId;
            team2Captain = turf.team2CaptainId;
        }
        if (!team1PlayerIds.length || !team2PlayerIds.length) {
            return respond(req, res, { json: { error: "players_required" }, redirect: "/turfs/session/" + turf._id + "?error=players_required" });
        }
        const [team1PlayerDocs, team2PlayerDocs] = await Promise.all([
            Player.find({ _id: { $in: team1PlayerIds } }),
            Player.find({ _id: { $in: team2PlayerIds } }),
        ]);
        const toBattingRow = (p, captainId) => ({
            id: p._id,
            name: p.name,
            image: p.image,
            isCaptain: captainId ? String(p._id) === String(captainId) : false,
            runs: 0,
            balls: 0,
            dots: 0,
            fours: 0,
            sixes: 0,
        });
        const toBowlingRow = (p, captainId) => ({
            id: p._id,
            name: p.name,
            image: p.image,
            isCaptain: captainId ? String(p._id) === String(captainId) : false,
            overs: 0,
            dots: 0,
            maidens: 0,
            runs: 0,
            wickets: 0,
        });
        const findCaptainDoc = (docs, captainId) => captainId ? docs.find((p) => String(p._id) === String(captainId)) : null;
        const team1CaptainDoc = findCaptainDoc(team1PlayerDocs, team1Captain);
        const team2CaptainDoc = findCaptainDoc(team2PlayerDocs, team2Captain);
        const match = {
            overs: turf.overs,
            turfId: turf._id,
            battingFirst,
            currentInnings: battingFirst,
            team1: {
                name: turf.team1Name,
                captainId: team1Captain || null,
                captainName: team1CaptainDoc ? team1CaptainDoc.name : null,
                captainImage: team1CaptainDoc ? (team1CaptainDoc.image2 || team1CaptainDoc.image) : null,
                batting: team1PlayerDocs.map((p) => toBattingRow(p, team1Captain)),
                bowling: team2PlayerDocs.map((p) => toBowlingRow(p, team2Captain)),
            },
            team2: {
                name: turf.team2Name,
                captainId: team2Captain || null,
                captainName: team2CaptainDoc ? team2CaptainDoc.name : null,
                captainImage: team2CaptainDoc ? (team2CaptainDoc.image2 || team2CaptainDoc.image) : null,
                batting: team2PlayerDocs.map((p) => toBattingRow(p, team2Captain)),
                bowling: team1PlayerDocs.map((p) => toBowlingRow(p, team1Captain)),
            },
        };
        const savedMatch = await Match.create(match);
        respond(req, res, { json: { ok: true, matchId: savedMatch._id }, redirect: "/turfs/live/" + savedMatch._id });
    } catch (err) {
        console.log(err);
        respond(req, res, { json: { error: "create_failed" }, redirect: "/turfs?error=create_failed" });
    }
};
// Builds the ordered "Match -> SupOv-1 -> SupOv-2 -> ..." chain used by
// the switcher dropdown on the live page. Walks superOverParentId back
// to the root tied match, then superOverMatchId forward through every
// linked Super Over. Returns null when this match was never tied (no
// chain at all), so the dropdown stays hidden for ordinary matches.
async function buildMatchChain(match) {
    if (!match.superOverParentId && !match.superOverMatchId) return null;
    let rootId = match._id;
    let cursor = match.superOverParentId;
    while (cursor) {
        const parent = await Match.findById(cursor).select("_id superOverParentId").lean();
        if (!parent) break;
        rootId = parent._id;
        cursor = parent.superOverParentId;
    }
    const chain = [];
    let nextId = rootId;
    while (nextId) {
        const m = await Match.findById(nextId).select("_id superOverMatchId status").lean();
        if (!m) break;
        chain.push(m);
        nextId = m.superOverMatchId || null;
    }
    if (chain.length < 2) return null;
    return chain.map((m, i) => ({
        id: String(m._id),
        label: i === 0 ? "Match" : `SupOv-${i}`,
        isCurrent: String(m._id) === String(match._id),
        status: m.status,
    }));
}
exports.showLive = async (req, res) => {
    const wantsJson = req.headers.accept?.includes("application/json");
    try {
        const match = await Match.findById(req.params.id)
            .populate("team1TeamId", "logo")
            .populate("team2TeamId", "logo");
        if (!match) {
            return respond(req, res, { json: { error: "match_not_found" }, redirect: "/turfs?error=match_not_found" });
        }
        const chain = await buildMatchChain(match);
        // Auto-follow to whichever leg is currently in progress — e.g.
        // reopening the original (now tied) match's card jumps straight to
        // the live Super Over instead of showing the tied scorecard. Never
        // leaves /turfs/live/*. The dropdown's own links add ?leg=1 to skip
        // this, so picking an older/tied leg from it actually stays there.
        if (chain && chain.length > 1 && !req.query.leg) {
            const latest = chain[chain.length - 1];
            if (latest.id !== String(match._id) && latest.status === "live") {
                return res.redirect("/turfs/live/" + latest.id);
            }
        }
        if (wantsJson) return res.json({ match, chain });
        res.render("turfs/live.ejs", { match, chain });
    } catch (err) {
        console.log(err);
        respond(req, res, { json: { error: "match_not_found" }, redirect: "/turfs?error=match_not_found" });
    }
};
// Dedicated full-page scoring view — kept separate from showLive so the
// score summary + input pad get the whole viewport instead of competing
// with the scorecard tables for space inside a small modal.
exports.showScorePad = async (req, res) => {
    const wantsJson = req.headers.accept?.includes("application/json");
    try {
        const match = await Match.findOne({ _id: req.params.id, status: "live" })
            .populate("team1TeamId", "logo")
            .populate("team2TeamId", "logo");
        if (!match) {
            // Match may have just auto-completed (maybeDeclareResult flips
            // status to "completed" during scoring). Look it up without
            // the status filter so we can redirect to the right session
            // page instead of dumping the user on /turfs.
            const completed = await Match.findById(req.params.id).lean();
            const redirectUrl = completed && completed.tournamentId
                ? "/tcl/session/" + completed.tournamentId
                : (completed && completed.turfId ? "/turfs/session/" + completed.turfId : "/turfs");
            return respond(req, res, { json: { error: "match_not_found" }, redirect: redirectUrl });
        }
        const team = match[match.currentInnings];
        const isFullySetUp = !!(team.strikerId && team.nonStrikerId && team.currentBowlerId && team.keeperId);
        if (!isFullySetUp) {
            // Players haven't been picked for this innings yet — bounce
            // back to the match page where that setup modal lives.
            return respond(req, res, { json: { error: "innings_not_set_up", matchId: match._id }, redirect: "/turfs/live/" + match._id });
        }
        if (wantsJson) return res.json({ match });
        res.render("turfs/score.ejs", { match });
    } catch (err) {
        console.log(err);
        respond(req, res, { json: { error: "match_not_found" }, redirect: "/turfs/live/" + req.params.id });
    }
};
exports.endMatch = async (req, res) => {
    try {
        // Fetch the match regardless of current status so we can still
        // redirect to the right place even if it already auto-completed
        // (maybeDeclareResult flips status to "completed" during scoring).
        // The status === "live" guard below keeps stats from being
        // double-counted if the match already completed.
const match = await Match.findById(req.params.id);
        if (match && match.status === "live") {
            // Fold any innings that finished but hasn't been aggregated yet,
            // then save whatever stats exist for the current (in-progress)
            // innings too — so ending a half-played match still records the
            // players' current batting/bowling numbers.
            await aggregatePendingInningsStats(match);
            await aggregateTeamStats(match, "team1");
            await aggregateTeamStats(match, "team2");
            match.status = "completed";
            // An early/abandoned end with no decided result is simply marked
            // as no result — no winner is crowned.
            if (!match.result) {
                match.result = "No Result";
                match.winnerKey = null;
            }
            await awardMatchMVP(match);
            await match.save();
        }
        const redirectUrl = match && match.tournamentId
            ? "/tcl/session/" + match.tournamentId
            : (match && match.turfId ? "/turfs/session/" + match.turfId : "/turfs");
        await tryCreatePlayoffs(match);
        respond(req, res, { json: { ok: true }, redirect: redirectUrl });
    } catch (err) {
        console.log(err);
        respond(req, res, { json: { error: "end_match_failed" }, redirect: "/turfs" });
    }
};
exports.cancelMatch = async (req, res) => {
    try {
        const match = await Match.findByIdAndDelete(req.params.id);
        const redirectUrl = match && match.turfId
    ? "/turfs/session/" + match.turfId
    : (match && match.tournamentId ? "/tcl/session/" + match.tournamentId : "/turfs");
        respond(req, res, { json: { ok: true, turfId: match?.turfId || null }, redirect: redirectUrl });
    } catch (err) {
        console.log(err);
        respond(req, res, { json: { error: "cancel_failed" }, redirect: "/turfs" });
    }
};
exports.updateLive = async (req, res) => {
    try {
        const match = await Match.findOne({ _id: req.params.id, status: "live" });
        if (!match) {
            return res.status(404).json({ error: "match_not_found_or_completed" });
        }
        Object.assign(match, req.body);
        await match.save();
        res.json({ ok: true, match });
    } catch (err) {
        console.log(err);
        res.status(400).json({ error: "update_failed" });
    }
};
function findRow(list, id) {
    return list.find((p) => String(p.id) === String(id));
}
// Stamps a batsman's real entry order (1st in, 2nd in, ...) the moment they
// actually start batting, instead of relying on their position in the
// squad array (which comes from an unordered $in query and doesn't
// reflect who actually opened or came in at #7).
function stampBattingOrder(row, team) {
    if (!row || row.battingOrder != null) return;
    const used = team.batting.map((r) => r.battingOrder).filter((n) => n != null);
    row.battingOrder = used.length > 0 ? Math.max(...used) + 1 : 1;
}
function isInningsComplete(match, innings) {
    const team = match[innings];
    const oversDone = team.legalBalls >= match.overs * 6;
    // Standard Super Over rule: innings ends after 2 wickets, not a full
    // all-out — regardless of how many players are in the squad.
    const wicketCap = match.isSuperOver ? 2 : team.batting.length - 1;
    const allOut = team.wickets >= wicketCap;
    return oversDone || allOut || team.endedEarly;
}
function autoSwitchInnings(match) {
    // Only auto-advance out of the FIRST innings. Once the second innings
    // wraps up, leave currentInnings as-is — the user ends the match manually.
    if (match.currentInnings === match.battingFirst && isInningsComplete(match, match.currentInnings)) {
        match.currentInnings = match.currentInnings === "team1" ? "team2" : "team1";
    }
}
// Declares the result as soon as the chase is decided — either the target
// is reached (match ends immediately, doesn't wait for overs/all-out) or
// the second innings ends level or short. Runs after every ball; a no-op
// once match.result is already set, or before the second innings starts.
function maybeDeclareResult(match) {
    if (match.result) return;
    const firstKey = match.battingFirst;
    const secondKey = firstKey === "team1" ? "team2" : "team1";
    if (match.currentInnings !== secondKey) return;
    const first = match[firstKey];
    const second = match[secondKey];
    const target = first.totalRuns + 1;
    const chased = second.totalRuns >= target;
    const oversDone = second.legalBalls >= match.overs * 6;
    const allOut = second.wickets >= (match.isSuperOver ? 2 : second.batting.length - 1);
    if (!chased && !oversDone && !allOut) return;
    if (second.totalRuns > first.totalRuns) {
        const wicketsLeft = match.isSuperOver ? (2 - second.wickets) : (second.batting.length - 1 - second.wickets);
        match.result = `${second.name} won by ${wicketsLeft} wicket${wicketsLeft === 1 ? "" : "s"}`;
        match.winnerKey = secondKey;
    } else if (first.totalRuns > second.totalRuns) {
        const runMargin = first.totalRuns - second.totalRuns;
        match.result = `${first.name} won by ${runMargin} run${runMargin === 1 ? "" : "s"}`;
        match.winnerKey = firstKey;
    } else {
        match.result = "Match Tied";
        match.winnerKey = null;
    }
    // Result decided — take it off /turfs' "live" listing and stop
    // accepting further balls (recordBall/undo/etc. all require status "live").
    match.status = "completed";
}
// Folds ONE team's batting+bowling from this match into each player's
// stat blocks, the moment that team's innings finishes — instead of
// waiting for the whole match/turf to end. Guarded by statsAggregated so
// calling it repeatedly (e.g. once per ball) after the innings is already
// done is a harmless no-op.
//
// Stat routing per the product rules:
//   - turfStats is the OVERALL record (every match, turf AND tcl combined),
//     so it always receives this innings' stats.
//   - tclStats is the TCL-only record, so it only receives stats when the
//     match is a tournament fixture (match.tournamentId is set).
async function aggregateTeamStats(match, teamKey) {
    const team = match[teamKey];
    if (!team || team.statsAggregated) return;
    const keys = match.tournamentId ? ["turfStats", "tclStats"] : ["turfStats"];
    for (const statsKey of keys) {
        await applyTeamStats(match, team, statsKey);
    }
    team.statsAggregated = true;
}

// Applies one team's batting+bowling rows from a match into the given
// stat block (either "turfStats" or "tclStats") on every affected player.
async function applyTeamStats(match, team, statsKey) {
    for (const row of team.batting) {
        if (row.status === "yet_to_bat") continue;
        const player = await Player.findById(row.id);
        if (!player) continue;
        const b = player[statsKey].batting;
        const prevTimesOut = b.average > 0 ? Math.round(b.runs / b.average) : 0;
        const timesOut = row.status === "out" ? 1 : 0;
        const newTimesOut = prevTimesOut + timesOut;
        b.matches += 1;
        b.innings += 1;
        b.runs += row.runs;
        b.ballsFaced += row.balls;
        b.dots += row.dots || 0;
        b.fours += row.fours;
        b.sixes += row.sixes;
        if (timesOut && row.runs === 0) b.ducks += 1;
        b.highest = Math.max(b.highest, row.runs);
        b.strikeRate = b.ballsFaced > 0 ? Number(((b.runs / b.ballsFaced) * 100).toFixed(2)) : 0;
        b.average = newTimesOut > 0 ? Number((b.runs / newTimesOut).toFixed(2)) : b.runs;
        // Deeply-nested sub-subdocuments sometimes aren't diffed by Mongoose
        // when mutated in place, so mark the whole stat block changed to make
        // sure the save writes it.
        player.markModified(statsKey);
        await player.save();
    }
    for (const row of team.bowling) {
        if (!row.balls && !row.runs && !row.wickets) continue;
        const player = await Player.findById(row.id);
        if (!player) continue;
        const bw = player[statsKey].bowling;
        bw.innings += 1;
        bw.wickets += row.wickets || 0;
        bw.ballsBowled += row.balls || 0;
        bw.dots += row.dots || 0;
        bw.runsConceded += row.runs || 0;
        bw.maidens += row.maidens || 0;
        bw.hatTricks += row.hatTrick ? 1 : 0;
        bw.overs = Math.floor(bw.ballsBowled / 6);
        bw.economyRate = bw.ballsBowled > 0 ? Number((bw.runsConceded / (bw.ballsBowled / 6)).toFixed(2)) : 0;
        bw.average = bw.wickets > 0 ? Number((bw.runsConceded / bw.wickets).toFixed(2)) : 0;
        bw.strikeRate = bw.wickets > 0 ? Number((bw.ballsBowled / bw.wickets).toFixed(2)) : 0;
        bw.dotBallPercentage = bw.ballsBowled > 0 ? Number(((bw.dots / bw.ballsBowled) * 100).toFixed(2)) : 0;
        player.markModified(statsKey);
        await player.save();
    }
}
// Checks both teams and aggregates whichever one's innings has finished
// but hasn't been folded in yet. Call after any mutation that could have
// just completed an innings.
async function aggregatePendingInningsStats(match) {
    for (const key of ["team1", "team2"]) {
        if (isInningsComplete(match, key)) {
            await aggregateTeamStats(match, key);
        }
    }
}
// Crowns this match's MVP (top of its points table) the moment the match
// is completed — regardless of which route flipped it to "completed".
// Guarded by match.mvpAwarded so it only ever fires once per match.
async function awardMatchMVP(match) {
    if (match.status !== "completed" || match.mvpAwarded) return;
    const ranked = computeMVP(match);
    if (ranked.length) {
        await Player.findByIdAndUpdate(ranked[0].id, { $inc: { matchMvpCount: 1 } });
    }
    match.mvpAwarded = true;
}
exports.setupInnings = async (req, res) => {
    try {
        const match = await Match.findOne({ _id: req.params.id, status: "live" });
        if (!match) return res.status(404).json({ error: "match_not_found" });
        const { innings, strikerId, nonStrikerId, bowlerId, keeperId } = req.body;
        const team = match[innings];
        if (!team) return res.status(400).json({ error: "invalid_innings" });
        if (strikerId) {
            team.strikerId = strikerId;
            const row = findRow(team.batting, strikerId);
            if (row && row.status === "yet_to_bat") { row.status = "batting"; stampBattingOrder(row, team); }
        }
        if (nonStrikerId) {
            team.nonStrikerId = nonStrikerId;
            const row = findRow(team.batting, nonStrikerId);
            if (row && row.status === "yet_to_bat") { row.status = "batting"; stampBattingOrder(row, team); }
        }
        if (bowlerId) {
            team.currentBowlerId = bowlerId;
            if (team.legalBalls % 6 === 0 && !isInningsComplete(match, innings)) {
                team.currentOverBalls = [];
            }
        }
        if (keeperId) {
            team.keeperId = keeperId;
            const kRow = findRow(team.bowling, keeperId);
            team.keeperName = kRow ? kRow.name : null;
        }
        match.currentInnings = innings;
        await match.save();
        res.json({ ok: true, match });
    } catch (err) {
        console.log(err);
        res.status(400).json({ error: "setup_failed" });
    }
};
exports.switchInnings = async (req, res) => {
    try {
        const match = await Match.findOne({ _id: req.params.id, status: "live" });
        if (!match) return res.status(404).json({ error: "match_not_found" });
        match.currentInnings = match.currentInnings === "team1" ? "team2" : "team1";
        await match.save();
        res.json({ ok: true, match });
    } catch (err) {
        console.log(err);
        res.status(400).json({ error: "switch_failed" });
    }
};
exports.undoLastBall = async (req, res) => {
    try {
        const match = await Match.findOne({ _id: req.params.id, status: "live" });
        if (!match) return res.status(404).json({ error: "match_not_found" });
        const stack = match.lastBallSnapshots || [];
        if (!stack.length) return res.status(400).json({ error: "nothing_to_undo" });
        const snap = stack.pop();
        match[snap.innings] = snap.team;
        match.currentInnings = snap.currentInnings;
        match.markModified(snap.innings);
        match.markModified("lastBallSnapshots");
        await match.save();
        res.json({ ok: true, match });
    } catch (err) {
        console.log(err);
        res.status(400).json({ error: "undo_failed" });
    }
};
// Manually closes out the current innings on the current score — used
// when there aren't enough substitute batsmen left to keep going (e.g.
// an uneven 6-a-side vs 8-a-side match where the smaller team runs out
// of batsmen before their wickets/overs are technically used up).
exports.endInnings = async (req, res) => {
    try {
        const match = await Match.findOne({ _id: req.params.id, status: "live" });
        if (!match) return res.status(404).json({ error: "match_not_found" });
        const { innings } = req.body;
        const team = match[innings];
        if (!team) return res.status(400).json({ error: "invalid_innings" });
        team.endedEarly = true;
        autoSwitchInnings(match);
        maybeDeclareResult(match);
        await aggregatePendingInningsStats(match);
        await awardMatchMVP(match);
        await match.save();
        await tryCreatePlayoffs(match);
        res.json({ ok: true, match });
    } catch (err) {
        console.log(err);
        res.status(400).json({ error: "end_innings_failed" });
    }
};
exports.recordBall = async (req, res) => {
    try {
        const match = await Match.findOne({ _id: req.params.id, status: "live" });
        if (!match) return res.status(404).json({ error: "match_not_found" });
        const { innings, type } = req.body;
        const team = match[innings];
        if (!team) return res.status(400).json({ error: "invalid_innings" });
        if (!team.overStarted) {
            team.currentOverBalls = [];
            team.currentOverRuns = 0;
            team.overStarted = true;
        }
        // Snapshot for undo — captured before any mutation below, so
        // /undo can restore exactly this pre-ball state. Keeps only the
        // last 3 balls, so up to 3 undos in a row are possible.
        if (!match.lastBallSnapshots) match.lastBallSnapshots = [];
        match.lastBallSnapshots.push({
            innings,
            currentInnings: match.currentInnings,
            team: JSON.parse(JSON.stringify(team)),
        });
        if (match.lastBallSnapshots.length > 3) match.lastBallSnapshots.shift();
        match.markModified("lastBallSnapshots");
        // Retire is a standalone action: 1 wicket, no ball/run impact at all.
        if (type === "retire") {
            const outPlayerId = req.body.outPlayerId;
            const newBatsmanId = req.body.newBatsmanId;
            const outRow = findRow(team.batting, outPlayerId);
            if (outRow) {
                outRow.status = "retired";
                outRow.dismissalText = "Retired Out";
            }
            team.wickets += 1;
            if (String(team.strikerId) === String(outPlayerId)) team.strikerId = newBatsmanId;
            else team.nonStrikerId = newBatsmanId;
            const newRow = findRow(team.batting, newBatsmanId);
            if (newRow && newRow.status === "yet_to_bat") { newRow.status = "batting"; stampBattingOrder(newRow, team); }
            autoSwitchInnings(match);
            maybeDeclareResult(match);
            await match.save();
            await tryCreatePlayoffs(match);
            return res.json({ ok: true, match });
        }
        const striker = findRow(team.batting, team.strikerId);
        const nonStriker = findRow(team.batting, team.nonStrikerId);
        const bowler = findRow(team.bowling, team.currentBowlerId);
        if (!striker || !nonStriker || !bowler) {
            return res.status(400).json({ error: "players_not_set" });
        }
        const rotateStrike = () => {
            const s = team.strikerId;
            team.strikerId = team.nonStrikerId;
            team.nonStrikerId = s;
        };
        let isLegalBall = false;
        let bowlerCreditedWicket = false;
        // Normal legal deliveries: dot/1/2/3/4/6, plus our turf-only
        // "1 run, no rotation" rule for balls that go out through the open nets.
const runValues = { dot: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, one_nr: 1 };
        if (type in runValues) {
            const runs = runValues[type];
            isLegalBall = true;
            striker.runs += runs;
            striker.balls += 1;
            if (runs === 0) { striker.dots += 1; bowler.dots += 1; }
            if (type === "four") striker.fours += 1;
            if (type === "six") striker.sixes += 1;
            team.totalRuns += runs;
            team.legalBalls += 1;
            bowler.balls += 1;
            bowler.runs += runs;
            team.currentOverBalls.push(String(runs));
            team.currentOverRuns += runs;
            if (type !== "one_nr" && runs % 2 === 1) rotateStrike();
        } else if (type === "runs_extra") {
            // Free-form running total for anything above the standard
            // 0/1/2/3/4/6 buttons (5, 7, 8... from overthrows etc.).
const runs = Math.max(0, Number(req.body.runs || 0));
            isLegalBall = true;
            striker.runs += runs;
            striker.balls += 1;
            if (runs === 0) { striker.dots += 1; bowler.dots += 1; }
            team.totalRuns += runs;
            team.legalBalls += 1;
            bowler.balls += 1;
            bowler.runs += runs;
            team.currentOverBalls.push(String(runs));
            team.currentOverRuns += runs;
if (runs % 2 === 1) rotateStrike();
        } else if (type === "wide") {
            // Wide is not a legal ball; +1 penalty plus any runs run.
            const wideRuns = Math.max(0, Number(req.body.wideRuns || 0)) || 0;
            const total = 1 + wideRuns;
            team.totalRuns += total;
            team.extraWides += total;
            bowler.runs += total;
            team.currentOverBalls.push(wideRuns > 0 ? `wd+${wideRuns}` : "wd");
            team.currentOverRuns += total;
            if (wideRuns % 2 === 1) rotateStrike();
        } else if (type === "noball") {
            // No ball is not a legal delivery either; +1 penalty run, plus
            // whatever the batsman scored off it (running runs or a boundary).
            // No free-hit mechanic in turf rules.
            const nbRuns = Math.max(0, Number(req.body.noballRuns || 0)) || 0;
            const isBoundary = req.body.noballBoundary === "four" || req.body.noballBoundary === "six";
            const total = 1 + nbRuns;
            team.totalRuns += total;
            team.extraNoBalls += 1;
            bowler.runs += total;
            striker.balls += 1;
            team.currentOverBalls.push(nbRuns > 0 ? `nb+${nbRuns}` : "nb");
            team.currentOverRuns += total;
            if (nbRuns > 0) {
                striker.runs += nbRuns;
                if (isBoundary && req.body.noballBoundary === "four") striker.fours += 1;
                if (isBoundary && req.body.noballBoundary === "six") striker.sixes += 1;
            }
            if (!isBoundary && nbRuns % 2 === 1) rotateStrike();
        } else if (type === "out") {
            const { outType, newBatsmanId } = req.body;
            team.wickets += 1;
            if (outType === "runout") {
                // Runs completed before the run-out still count, and strike
                // rotation follows the odd/even completed-runs rule as normal.
                const runoutRuns = Math.max(0, Number(req.body.runoutRuns || 0)) || 0;
                const outPlayerId = req.body.outPlayerId;
                const fielderRow = req.body.fielderId ? findRow(team.bowling, req.body.fielderId) : null;
                const isNoBallRunout = !!req.body.isNoBall;
                if (isNoBallRunout) {
                    // No ball + run out: not a legal delivery — +1 penalty
                    // run on top of any runs completed before the wicket,
                    // and it doesn't count toward the over.
                    const total = 1 + runoutRuns;
                     team.totalRuns += total;
                     team.extraNoBalls += 1;
                     bowler.runs += total;
                     striker.runs += runoutRuns;
                     striker.balls += 1;
                     team.currentOverBalls.push(runoutRuns > 0 ? `nb+${runoutRuns}W` : "nb+W");
                     team.currentOverRuns += total;
} else {
                    isLegalBall = true;
                    striker.runs += runoutRuns;
                    striker.balls += 1;
                    team.totalRuns += runoutRuns;
                    team.legalBalls += 1;
                    bowler.balls += 1;
                    bowler.runs += runoutRuns;
                    team.currentOverBalls.push(runoutRuns > 0 ? `${runoutRuns}W` : "W");
                    team.currentOverRuns += runoutRuns;
                }
                if (runoutRuns % 2 === 1) rotateStrike();
                const outRow = findRow(team.batting, outPlayerId);
                if (outRow) {
                    outRow.status = "out";
                    outRow.dismissalText = fielderRow ? `Run Out (${fielderRow.name})` : "Run Out";
                }
                if (String(team.strikerId) === String(outPlayerId)) team.strikerId = newBatsmanId;
                else team.nonStrikerId = newBatsmanId;
            } else {
                // Catch/bowled/hit-wicket/stumping/obstructing: 0 runs, no
                // strike rotation. A stumping off a wide is the one
                // exception — like any other wide it isn't a legal ball and
                // costs a penalty run, it just also happens to be a wicket.
                // Obstructing is the only type here that can be given
                // against either batter, so it's the only one that takes an
                // explicit outPlayerId from the client — the rest always
                // dismiss whoever's on strike.
                const isWideStumping = outType === "stumping" && !!req.body.isWide;
                if (isWideStumping) {
                    team.totalRuns += 1;
                    team.extraWides += 1;
                    bowler.runs += 1;
                    team.currentOverBalls.push("wd+W");
                    team.currentOverRuns += 1;
                } else {
                    isLegalBall = true;
                    striker.balls += 1;
                    team.legalBalls += 1;
                    bowler.balls += 1;
                    team.currentOverBalls.push("W");
                }
                if (outType !== "obstructing") { bowler.wickets += 1; bowlerCreditedWicket = true; }
                let dismissalText = "";
                if (outType === "catch") {
                    const fielderRow = req.body.fielderId ? findRow(team.bowling, req.body.fielderId) : null;
                    dismissalText = fielderRow ? `c ${fielderRow.name} b ${bowler.name}` : `Caught b ${bowler.name}`;
                } else if (outType === "bowled") dismissalText = `Bowled b ${bowler.name}`;
                else if (outType === "hitwicket") dismissalText = `Hit Wicket b ${bowler.name}`;
                else if (outType === "stumping") dismissalText = isWideStumping ? `St. ${team.keeperName || "Keeper"} b ${bowler.name} (Wide)` : `St. ${team.keeperName || "Keeper"} b ${bowler.name}`;
                else if (outType === "obstructing") dismissalText = "Obstructing the Field";
                const outPlayerId = req.body.outPlayerId || team.strikerId;
                const dismissedRow = findRow(team.batting, outPlayerId);
                if (dismissedRow) {
                    dismissedRow.status = "out";
                    dismissedRow.dismissalText = dismissalText;
                }
                if (String(team.strikerId) === String(outPlayerId)) team.strikerId = newBatsmanId;
                else team.nonStrikerId = newBatsmanId;
            }
            const newRow = findRow(team.batting, newBatsmanId);
            if (newRow && newRow.status === "yet_to_bat") { newRow.status = "batting"; stampBattingOrder(newRow, team); }
        } else {
            return res.status(400).json({ error: "invalid_ball_type" });
        }
        if (isLegalBall) {
            if (bowlerCreditedWicket) {
                bowler.wicketStreak = (bowler.wicketStreak || 0) + 1;
                if (bowler.wicketStreak >= 3) bowler.hatTrick = true;
            } else {
                bowler.wicketStreak = 0;
            }
        }
        if (isLegalBall && team.legalBalls % 6 === 0) {
            if (team.currentOverRuns === 0) {
                bowler.maidens += 1;
            }
            team.overStarted = false;
            rotateStrike();
        }
        autoSwitchInnings(match);
        maybeDeclareResult(match);
        await aggregatePendingInningsStats(match);
        await awardMatchMVP(match);
        await match.save();
        await tryCreatePlayoffs(match);
        res.json({ ok: true, match });
    } catch (err) {
        console.log(err);
        res.status(400).json({ error: "ball_failed" });
    }
};
// Rolls every match played in this turf into each player's turfStats,
// then wipes the (temporary) match documents. Averages/rates are
// recomputed from the accumulated raw totals rather than stored
// incrementally, EXCEPT batting average — the schema doesn't keep a raw
// "times out" counter, so it's reconstructed from the existing average
// (prevTimesOut = round(prevRuns / prevAverage)). This is an
// approximation carried over turf-to-turf; fine for casual stats, but
// flagging it since it can drift slightly over many sessions.
async function aggregateTurfStats(turfId) {
    const matches = await Match.find({ turfId });
    const acc = new Map();
    const getAcc = (id) => {
        const key = String(id);
        if (!acc.has(key)) {
acc.set(key, {
                battedMatches: 0, battingInnings: 0, runs: 0, ballsFaced: 0, dots: 0,
                fours: 0, sixes: 0, ducks: 0, highest: 0, timesOut: 0,
                bowlingInnings: 0, wickets: 0, ballsBowled: 0, bowlingDots: 0, runsConceded: 0, maidens: 0, hatTricks: 0,
            });
        }
        return acc.get(key);
    };
    matches.forEach((match) => {
        ["team1", "team2"].forEach((key) => {
            const team = match[key];
            if (team.statsAggregated) return; // already folded in per-innings
            (team.batting || []).forEach((row) => {
                if (row.status === "yet_to_bat") return;
                const a = getAcc(row.id);
                a.battedMatches += 1;
                a.battingInnings += 1;
                a.runs += row.runs;
                a.ballsFaced += row.balls;
                a.dots += row.dots || 0;
                a.fours += row.fours;
                a.sixes += row.sixes;
                if (row.status === "out") {
                    a.timesOut += 1;
                    if (row.runs === 0) a.ducks += 1;
                }
                if (row.runs > a.highest) a.highest = row.runs;
            });
            (team.bowling || []).forEach((row) => {
                if (!row.balls && !row.runs && !row.wickets) return;
                const a = getAcc(row.id);
                a.bowlingInnings += 1;
                a.wickets += row.wickets;
                a.ballsBowled += row.balls;
                a.bowlingDots += row.dots || 0;
                a.runsConceded += row.runs;
                a.maidens += row.maidens || 0;
                a.hatTricks += row.hatTrick ? 1 : 0;
            });
        });
    });
    for (const [playerId, a] of acc.entries()) {
        const player = await Player.findById(playerId);
        if (!player) continue;
        const b = player.turfStats.batting;
        const prevTimesOut = b.average > 0 ? Math.round(b.runs / b.average) : 0;
        const newTimesOut = prevTimesOut + a.timesOut;
        b.matches += a.battedMatches;
        b.innings += a.battingInnings;
        b.runs += a.runs;
        b.ballsFaced += a.ballsFaced;
        b.dots += a.dots;
        b.fours += a.fours;
        b.sixes += a.sixes;
        b.ducks += a.ducks;
        b.highest = Math.max(b.highest, a.highest);
        b.strikeRate = b.ballsFaced > 0 ? Number(((b.runs / b.ballsFaced) * 100).toFixed(2)) : 0;
        b.average = newTimesOut > 0 ? Number((b.runs / newTimesOut).toFixed(2)) : b.runs;
        const bw = player.turfStats.bowling;
        bw.innings += a.bowlingInnings;
        bw.wickets += a.wickets;
        bw.ballsBowled += a.ballsBowled;
        bw.dots += a.bowlingDots;
        bw.runsConceded += a.runsConceded;
        bw.maidens += a.maidens || 0;
        bw.hatTricks += a.hatTricks || 0;
        bw.overs = Math.floor(bw.ballsBowled / 6);
        bw.economyRate = bw.ballsBowled > 0 ? Number((bw.runsConceded / (bw.ballsBowled / 6)).toFixed(2)) : 0;
        bw.average = bw.wickets > 0 ? Number((bw.runsConceded / bw.wickets).toFixed(2)) : 0;
        bw.strikeRate = bw.wickets > 0 ? Number((bw.ballsBowled / bw.wickets).toFixed(2)) : 0;
        bw.dotBallPercentage = bw.ballsBowled > 0 ? Number(((bw.dots / bw.ballsBowled) * 100).toFixed(2)) : 0;
        await player.save();
    }
    // Turf MVP: sum this turf's match-level MVP points per player and
    // crown whoever has the highest combined total (+1 to turfMvpCount).
    const mvpTotals = new Map();
    matches.forEach((match) => {
        computeMVP(match).forEach((p) => {
            mvpTotals.set(p.id, (mvpTotals.get(p.id) || 0) + p.totalPts);
        });
    });
    let turfMvpId = null;
    let turfMvpPts = -Infinity;
    for (const [id, pts] of mvpTotals.entries()) {
        if (pts > turfMvpPts) { turfMvpPts = pts; turfMvpId = id; }
    }
    if (turfMvpId) {
        await Player.findByIdAndUpdate(turfMvpId, { $inc: { turfMvpCount: 1 } });
    }
}
exports.showTurfSession = async (req, res) => {
    const wantsJson = req.headers.accept?.includes("application/json");
    try {
        const turf = await Turf.findOne({ _id: req.params.id, status: "active" });
        if (!turf) return respond(req, res, { json: { error: "turf_not_found" }, redirect: "/turfs?error=turf_not_found" });
        const [allPlayers, matches] = await Promise.all([
            Player.find({}),
            Match.find({ turfId: turf._id }).sort({ createdAt: 1 }),
        ]);
        const liveMatch = matches.find((m) => m.status === "live") || null;
        if (wantsJson) return res.json({ turf, allPlayers, matches, liveMatch });
        res.render("turfs/session.ejs", { turf, allPlayers, matches, liveMatch });
    } catch (err) {
        console.log(err);
        respond(req, res, { json: { error: "session_failed" }, redirect: "/turfs?error=session_failed" });
    }
};
exports.endTurf = async (req, res) => {
    try {
        const turf = await Turf.findOne({ _id: req.params.id, status: "active" });
        if (!turf) return respond(req, res, { json: { error: "turf_not_found" }, redirect: "/turfs?error=turf_not_found" });
        const stillLive = await Match.findOne({ turfId: turf._id, status: "live" });
        if (stillLive) {
            return respond(req, res, { json: { error: "match_in_progress" }, redirect: "/turfs/session/" + turf._id + "?error=match_in_progress" });
        }
        await aggregateTurfStats(turf._id);
        await Match.deleteMany({ turfId: turf._id });
        await Turf.findByIdAndDelete(turf._id);
        respond(req, res, { json: { ok: true }, redirect: "/turfs" });
    } catch (err) {
        console.log(err);
        respond(req, res, { json: { error: "end_turf_failed" }, redirect: "/turfs" });
    }
};
exports.updateTurfSettings = async (req, res) => {
    try {
        const turf = await Turf.findOne({ _id: req.params.id, status: "active" });
        if (!turf) return respond(req, res, { json: { error: "turf_not_found" }, redirect: "/turfs?error=turf_not_found" });
        let team1PlayerIds = req.body.team1Players || [];
        let team2PlayerIds = req.body.team2Players || [];
        if (!Array.isArray(team1PlayerIds)) team1PlayerIds = [team1PlayerIds];
        if (!Array.isArray(team2PlayerIds)) team2PlayerIds = [team2PlayerIds];
        if (!team1PlayerIds.length || !team2PlayerIds.length) {
            return respond(req, res, { json: { error: "players_required" }, redirect: "/turfs/session/" + turf._id + "?error=players_required" });
        }
        const overs = Number(req.body.overs);
        if (!Number.isFinite(overs) || overs < 1) {
            return respond(req, res, { json: { error: "invalid_overs" }, redirect: "/turfs/session/" + turf._id + "?error=invalid_overs" });
        }
        turf.overs = overs;
        turf.team1Name = (req.body.team1Name || turf.team1Name).trim();
        turf.team2Name = (req.body.team2Name || turf.team2Name).trim();
        turf.team1PlayerIds = team1PlayerIds;
        turf.team2PlayerIds = team2PlayerIds;
        turf.team1CaptainId = req.body.team1Captain || null;
        turf.team2CaptainId = req.body.team2Captain || null;
        await turf.save();
        respond(req, res, { json: { ok: true, turf }, redirect: "/turfs/session/" + turf._id });
    } catch (err) {
        console.log(err);
        respond(req, res, { json: { error: "settings_failed" }, redirect: "/turfs?error=settings_failed" });
    }
};