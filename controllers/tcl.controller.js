const Team = require("../models/team.model");
const Match = require("../models/matches");
const Tournament = require("../models/tcl.model");
const Player = require("../models/player.model");

// ---- Points table computation (shared with points.controller.js) ----
// Ranks teams by points (2 per win, 1 per tie), then NRR, then wins.
// Returns an array of { id, name, logo, points, nrr, wins, ... } sorted
// best-to-worst. Used to decide which teams qualify for semifinals.
async function computePointsTable(tournamentId) {
    // Super Over matches are their own Match doc (for reusing the scoring
    // engine) but must never count as a played fixture for points/NRR —
    // the tied parent match already counted itself as a tie.
    const matches = await Match.find({ tournamentId, status: "completed", stage: { $ne: "superover" } })
        .populate("team1TeamId", "name logo")
        .populate("team2TeamId", "name logo")
        .lean();

    const allTeams = await Team.find({}).lean();
    const teamsByName = new Map(allTeams.map((t) => [t.name, t]));

    const stats = new Map();
    const ensureTeam = (id, name, logo) => {
        const key = id ? String(id) : name;
        if (!stats.has(key)) stats.set(key, {
            id: id || null, name: name || "Unknown", logo: logo || null,
            played: 0, wins: 0, losses: 0, ties: 0,
            runsFor: 0, ballsFaced: 0, runsAgainst: 0, ballsBowled: 0,
        });
        if (logo) stats.get(key).logo = logo;
        return stats.get(key);
    };

    allTeams.forEach((t) => ensureTeam(String(t._id), t.name, t.logo));

    for (const m of matches) {
        let team1Doc = m.team1TeamId && m.team1TeamId._id ? m.team1TeamId : null;
        let team2Doc = m.team2TeamId && m.team2TeamId._id ? m.team2TeamId : null;
        if (!team1Doc) team1Doc = teamsByName.get(m.team1.name) || null;
        if (!team2Doc) team2Doc = teamsByName.get(m.team2.name) || null;
        if (!team1Doc || !team2Doc) continue;

        const t1Key = String(team1Doc._id);
        const t2Key = String(team2Doc._id);
        const team1 = ensureTeam(t1Key, team1Doc.name, team1Doc.logo);
        const team2 = ensureTeam(t2Key, team2Doc.name, team2Doc.logo);

        team1.played += 1;
        team2.played += 1;

        if (m.winnerKey === "team1") { team1.wins += 1; team2.losses += 1; }
        else if (m.winnerKey === "team2") { team2.wins += 1; team1.losses += 1; }
        else { team1.ties += 1; team2.ties += 1; }

        const t1Runs = m.team1.totalRuns || 0;
        const t2Runs = m.team2.totalRuns || 0;
        const allOut = (team) => (team.wickets || 0) >= ((team.batting?.length || 0) - 1);
        const t1Balls = (m.team1.endedEarly || allOut(m.team1)) ? (m.overs * 6) : (m.team1.legalBalls || 0);
        const t2Balls = (m.team2.endedEarly || allOut(m.team2)) ? (m.overs * 6) : (m.team2.legalBalls || 0);

        team1.runsFor += t1Runs; team1.ballsFaced += t1Balls;
        team1.runsAgainst += t2Runs; team1.ballsBowled += t2Balls;
        team2.runsFor += t2Runs; team2.ballsFaced += t2Balls;
        team2.runsAgainst += t1Runs; team2.ballsBowled += t1Balls;
    }

    const table = Array.from(stats.values()).map((t) => {
        const points = (t.wins * 2) + (t.ties * 1);
        const oversFaced = t.ballsFaced / 6;
        const oversBowled = t.ballsBowled / 6;
        const nrr = ((oversFaced > 0 ? t.runsFor / oversFaced : 0) - (oversBowled > 0 ? t.runsAgainst / oversBowled : 0));
        return { ...t, points, nrr: Number.isFinite(nrr) ? Number(nrr.toFixed(3)) : 0 };
    });

    table.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.nrr !== a.nrr) return b.nrr - a.nrr;
        return b.wins - a.wins;
    });

    return table;
}

// ---- Playoff auto-creation ----
// Called after any TCL match completes. When all fixtures are done it
// creates 2 semifinal matches (1st vs 4th, 2nd vs 3rd from the points
// table). When both semifinals are done it creates 1 final match with
// the two winners. Each stage only fires once — existing matches of that
// stage prevent re-creation.
const toBattingRow = (p, captainId) => ({
    id: p._id, name: p.name, image: p.image,
    isCaptain: captainId ? String(p._id) === String(captainId) : false,
    runs: 0, balls: 0, fours: 0, sixes: 0,
});
const toBowlingRow = (p, captainId) => ({
    id: p._id, name: p.name, image: p.image,
    isCaptain: captainId ? String(p._id) === String(captainId) : false,
    overs: 0, maidens: 0, runs: 0, wickets: 0,
});

async function createPlayoffMatch(tournamentId, team1Id, team2Id, overs, stage, extra = {}) {
    const [team1, team2] = await Promise.all([
        Team.findById(team1Id).populate("players").populate("captain"),
        Team.findById(team2Id).populate("players").populate("captain"),
    ]);
    if (!team1 || !team2) return null;

    const battingFirstKey = extra.battingFirst === "team2" ? "team2" : "team1";
    return Match.create({
        overs,
        battingFirst: battingFirstKey,
        currentInnings: battingFirstKey,
        tournamentId,
        team1TeamId: team1._id,
        team2TeamId: team2._id,
        stage,
        isSuperOver: !!extra.isSuperOver,
        superOverParentId: extra.superOverParentId || null,
        team1: {
            name: team1.name,
            captainId: team1.captain?._id || null,
            captainName: team1.captain?.name || null,
            captainImage: team1.captain?.image || null,
            batting: team1.players.map((p) => toBattingRow(p, team1.captain?._id)),
            bowling: team2.players.map((p) => toBowlingRow(p, team2.captain?._id)),
        },
        team2: {
            name: team2.name,
            captainId: team2.captain?._id || null,
            captainName: team2.captain?.name || null,
            captainImage: team2.captain?.image || null,
            batting: team2.players.map((p) => toBattingRow(p, team2.captain?._id)),
            bowling: team1.players.map((p) => toBowlingRow(p, team1.captain?._id)),
        },
    });
}

// ---- Playoff format config ----
// Defines how the semifinal stage is shaped based on how many teams
// qualified (played >= 1 match) in the league stage. To change the
// rules later, just edit this table — nothing else needs to change.
//   "none"        -> not enough teams, no playoff stage created
//   "topper_bye"  -> #1 gets a bye straight to the final; #2 vs #3 play
//                    a single semifinal for the 2nd final spot
//   "top4_bracket"-> standard bracket: #1 vs #4 and #2 vs #3 (2 semifinals),
//                    winners meet in the final
const PLAYOFF_FORMAT_RULES = [
    { minTeams: 6, maxTeams: Infinity, type: "top4_bracket" },
    { minTeams: 4, maxTeams: 5, type: "topper_bye" },
    { minTeams: 0, maxTeams: 3, type: "none" },
];

function getPlayoffFormat(qualifiedCount) {
    const rule = PLAYOFF_FORMAT_RULES.find((r) => qualifiedCount >= r.minTeams && qualifiedCount <= r.maxTeams);
    return rule ? rule.type : "none";
}

// ---- Super Over ----
// A tied TCL match (any stage) auto-spawns a linked Super Over: another
// Match doc, overs=1, 2-wicket cap, same two teams/squads, batting order
// reversed (team that batted second in the tied match bats first). It
// reuses team1/team2TeamId with the SAME team1/team2 mapping as the
// parent, so a Super Over's winnerKey is directly comparable to its
// parent's. If the Super Over itself ties, it chains to another Super
// Over the same way — real Super Overs repeat until decided.
// Turf-only matches (no tournamentId) never get one; they just stay tied.
async function maybeCreateSuperOver(match) {
    if (!match || !match.tournamentId) return;
    if (match.status !== "completed" || match.result !== "Match Tied") return;
    if (match.superOverMatchId) return;
    const secondBattingKey = match.battingFirst === "team1" ? "team2" : "team1";
    const created = await createPlayoffMatch(
        match.tournamentId, match.team1TeamId, match.team2TeamId, 1, "superover",
        { battingFirst: secondBattingKey, isSuperOver: true, superOverParentId: match._id }
    );
    if (created) {
        match.superOverMatchId = created._id;
        await match.save();
    }
}
exports.maybeCreateSuperOver = maybeCreateSuperOver;

// Resolves who actually won a match for playoff-progression purposes:
// its own winnerKey if decided outright, otherwise its Super Over's
// winner (recursing through a chain of tied Super Overs). Returns null
// while a tie is still awaiting its Super Over result.
async function resolveWinner(match) {
    if (!match) return null;
    if (match.winnerKey) return match.winnerKey;
    if (match.result === "Match Tied" && match.superOverMatchId) {
        const so = await Match.findById(match.superOverMatchId).lean();
        return resolveWinner(so);
    }
    return null;
}

exports.maybeCreatePlayoffMatches = async (tournamentId) => {
    if (!tournamentId) return;
    const tournament = await Tournament.findOne({ _id: tournamentId, status: "active" });
    if (!tournament) return;

    const allMatches = await Match.find({ tournamentId }).lean();

    // ---- Semifinals: create when all fixtures are completed ----
    const fixtures = allMatches.filter((m) => m.stage === "fixture");
    const existingSemis = allMatches.filter((m) => m.stage === "semifinal");
    const existingFinal = allMatches.filter((m) => m.stage === "final");

    if (fixtures.length > 0 && fixtures.every((m) => m.status === "completed") && existingSemis.length === 0 && existingFinal.length === 0) {
        const table = await computePointsTable(tournamentId);
        const qualified = table.filter((t) => t.played > 0);
        const overs = fixtures[0].overs;
        const format = getPlayoffFormat(qualified.length);

        if (format === "topper_bye") {
            // #1 gets a bye to the final. #2 vs #3 play the only semifinal.
            await createPlayoffMatch(tournamentId, qualified[1].id, qualified[2].id, overs, "semifinal");
        } else if (format === "top4_bracket") {
            await createPlayoffMatch(tournamentId, qualified[0].id, qualified[3].id, overs, "semifinal");
            await createPlayoffMatch(tournamentId, qualified[1].id, qualified[2].id, overs, "semifinal");
        }
        // format === "none": not enough qualified teams, no playoff stage.
        return;
    }

    // ---- Final: create when all semifinals are completed AND decided ----
    // "Decided" accounts for a tied semifinal still waiting on its Super
    // Over — the final must not be created until that's resolved.
    const semis = allMatches.filter((m) => m.stage === "semifinal");
    if (semis.length === 0 || existingFinal.length > 0 || !semis.every((m) => m.status === "completed")) return;
    const semiWinners = await Promise.all(semis.map((m) => resolveWinner(m)));
    if (!semiWinners.every(Boolean)) return;

    const overs = semis[0].overs;

    const table = await computePointsTable(tournamentId);
    const qualified = table.filter((t) => t.played > 0);
    const format = getPlayoffFormat(qualified.length);

    if (format === "topper_bye") {
        const topper = qualified[0];
        const semiWinnerTeamId = semiWinners[0] === "team1" ? semis[0].team1TeamId : semis[0].team2TeamId;
        if (topper && semiWinnerTeamId) {
            await createPlayoffMatch(tournamentId, topper.id, semiWinnerTeamId, overs, "final");
        }
        return;
    }

    if (format === "top4_bracket") {
        const winnerTeamIds = semis.map((m, i) => semiWinners[i] === "team1" ? m.team1TeamId : m.team2TeamId);
        if (winnerTeamIds[0] && winnerTeamIds[1]) {
            await createPlayoffMatch(tournamentId, winnerTeamIds[0], winnerTeamIds[1], overs, "final");
        }
    }
};

exports.index = async (req, res) => {
    try {
        const tournaments = await Tournament.find({ status: "active" }).sort({ createdAt: -1 });
        res.render("tcl/index.ejs", { tournaments });
    } catch (err) {
        console.log(err);
        res.render("tcl/index.ejs", { tournaments: [] });
    }
};

// Creates an empty tournament folder — just name/date/timing. Fixtures
// (team vs team) get added afterwards from the session page.
exports.createTournament = async (req, res) => {
    try {
        const name = (req.body.name || "").trim();
        if (!name) return res.redirect("/tcl?error=name_required");
        const totalFixturesRaw = (req.body.totalFixtures || '').toString().trim();
        const totalFixturesNum = totalFixturesRaw ? Number(totalFixturesRaw) : null;
        const tournament = await Tournament.create({
            name,
            date: (req.body.date || "").trim() || null,
            timing: (req.body.timing || "").trim() || null,
            totalFixtures: Number.isFinite(totalFixturesNum) && totalFixturesNum > 0 ? totalFixturesNum : null,
        });
        res.redirect("/tcl/session/" + tournament._id);
    } catch (err) {
        console.log(err);
        res.redirect("/tcl?error=create_failed");
    }
};

// Ranks a match for the session-page ordering below:
//   0 = in progress (started but not yet completed) — shown first
//   1 = upcoming (not started yet)                  — shown in the middle
//   2 = completed                                    — shown last
// Within each rank matches keep their original fixture order (createdAt).
// Net effect: whichever match is currently live always floats to the top,
// finished matches sink to the bottom, and once every match is completed
// the whole list naturally settles back into the original 1,2,3... order.
const matchRank = (m) => {
    if (m.status === "completed") return 2;
    const started = !!(m.team1.strikerId || m.team2.strikerId || m.team1.legalBalls || m.team2.legalBalls);
    return started ? 0 : 1;
};

exports.showSession = async (req, res) => {
    try {
        const tournament = await Tournament.findOne({ _id: req.params.id, status: "active" });
        if (!tournament) return res.redirect("/tcl?error=not_found");
        const [teams, matches] = await Promise.all([
            Team.find({}).populate("captain", "name image"),
            // Super Over matches are only ever reached via the dropdown on
            // their parent's live card — they never get their own card here.
            Match.find({ tournamentId: tournament._id, stage: { $ne: "superover" } })
                .populate("team1TeamId", "logo")
                .populate("team2TeamId", "logo")
                .sort({ createdAt: 1 }),
        ]);

        matches.sort((a, b) => {
            const ra = matchRank(a);
            const rb = matchRank(b);
            if (ra !== rb) return ra - rb;
            return new Date(a.createdAt) - new Date(b.createdAt);
        });

        res.render("tcl/session.ejs", { tournament, teams, matches });
    } catch (err) {
        console.log(err);
        res.redirect("/tcl?error=session_failed");
    }
};

// Adds a fixture inside a tournament. Unlike Turf matches, the full
// squad from each picked Team is loaded straight in — there's no
// per-match player-picking step. The match is created immediately
// (status "live", 0/0) so it shows on the session page as an
// "Upcoming" card; it only actually becomes "In Progress" once the
// admin opens it and hits Start (see /turfs/live/:id).
exports.createMatch = async (req, res) => {
    const tournamentId = req.params.id;
    try {
        const tournament = await Tournament.findOne({ _id: tournamentId, status: "active" });
        if (!tournament) return res.redirect("/tcl?error=not_found");

        // Enforce fixed number of fixtures when `totalFixtures` is set.
        // Only counts fixture-stage matches — auto-created semifinal/final
        // matches don't count against the fixture limit.
        if (Number.isFinite(tournament.totalFixtures) && tournament.totalFixtures !== null) {
            const existingCount = await Match.countDocuments({ tournamentId: tournament._id, stage: "fixture" });
            if (existingCount >= tournament.totalFixtures) {
                return res.redirect("/tcl/session/" + tournamentId + "?error=fixtures_full");
            }
        }

        const { team1Id, team2Id, overs, battingFirst } = req.body;
        if (!team1Id || !team2Id || team1Id === team2Id) {
            return res.redirect("/tcl/session/" + tournamentId + "?error=teams_required");
        }
        const oversNum = Number(overs);
        if (!Number.isFinite(oversNum) || oversNum < 1) {
            return res.redirect("/tcl/session/" + tournamentId + "?error=invalid_overs");
        }

        const [team1, team2] = await Promise.all([
            Team.findById(team1Id).populate("players").populate("captain"),
            Team.findById(team2Id).populate("players").populate("captain"),
        ]);
        if (!team1 || !team2) {
            return res.redirect("/tcl/session/" + tournamentId + "?error=teams_required");
        }

        const battingFirstKey = battingFirst === "team2" ? "team2" : "team1";
        await Match.create({
            overs: oversNum,
            battingFirst: battingFirstKey,
            currentInnings: battingFirstKey,
            tournamentId: tournament._id,
            team1TeamId: team1._id,
            team2TeamId: team2._id,
            team1: {
                name: team1.name,
                captainId: team1.captain?._id || null,
                captainName: team1.captain?.name || null,
                captainImage: team1.captain?.image || null,
                batting: team1.players.map((p) => toBattingRow(p, team1.captain?._id)),
                bowling: team2.players.map((p) => toBowlingRow(p, team2.captain?._id)),
            },
            team2: {
                name: team2.name,
                captainId: team2.captain?._id || null,
                captainName: team2.captain?.name || null,
                captainImage: team2.captain?.image || null,
                batting: team2.players.map((p) => toBattingRow(p, team2.captain?._id)),
                bowling: team1.players.map((p) => toBowlingRow(p, team1.captain?._id)),
            },
        });
        res.redirect("/tcl/session/" + tournamentId);
    } catch (err) {
        console.log(err);
        res.redirect("/tcl/session/" + tournamentId + "?error=create_match_failed");
    }
};

// Permanently removes a tournament and every match scheduled inside it.
// Teams and players are untouched — only the tournament "folder" and its
// fixtures go away.
exports.deleteTournament = async (req, res) => {
    try {
        const tournament = await Tournament.findById(req.params.id);
        if (!tournament) return res.redirect("/tcl?error=not_found");

        // Unlike a Turf, a fresh TCL match is created with status "live"
        // the moment it's scheduled (see createMatch above) — it only
        // really becomes "in progress" once the admin hits Start. So the
        // block here has to check for actual bat/ball activity, not just
        // status === "live", or every tournament with an unplayed fixture
        // would be un-deletable.
        const liveMatches = await Match.find({ tournamentId: tournament._id, status: "live" });
        const inProgress = liveMatches.some(
            (m) => m.team1.strikerId || m.team2.strikerId || m.team1.legalBalls || m.team2.legalBalls
        );
        if (inProgress) {
            return res.redirect("/tcl/session/" + tournament._id + "?error=match_in_progress");
        }

        await Match.deleteMany({ tournamentId: tournament._id });
        await Tournament.findByIdAndDelete(tournament._id);
        res.redirect("/tcl");
    } catch (err) {
        console.log(err);
        res.redirect("/tcl/session/" + req.params.id + "?error=delete_failed");
    }
};
