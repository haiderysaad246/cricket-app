const Match = require("../models/matches");
const Team = require("../models/team.model");

// Helper: convert legalBalls (integer) to overs as decimal (balls/6)
const oversFromBalls = (balls) => {
    if (!balls || balls <= 0) return 0;
    return balls / 6;
};

exports.index = async (req, res) => {
    try {
        const tournamentId = req.query.tournament || null;

        // Super Over matches are a separate Match doc (reusing the scoring
        // engine) and must never count toward points/NRR — the tied match
        // that spawned them already counted itself as a tie.
        const matchFilter = { status: 'completed', stage: { $ne: 'superover' } };
        if (tournamentId) matchFilter.tournamentId = tournamentId;

        const matches = await Match.find(matchFilter)
            .populate('team1TeamId', 'name logo')
            .populate('team2TeamId', 'name logo')
            .lean();

        // Load existing teams so we always prefer saved team docs
        const allTeams = await Team.find({}).lean();
        const teamsByName = new Map(allTeams.map(t => [t.name, t]));
        const teamsById = new Map(allTeams.map(t => [String(t._id), t]));

        // Build a map of team stats keyed by teamId (use team document id if available, else team name fallback)
        const stats = new Map();

        const ensureTeam = (id, name, logo) => {
            const key = id ? String(id) : name;
            if (!stats.has(key)) stats.set(key, {
                id: id || null,
                name: name || 'Unknown',
                logo: logo || null,
                played: 0,
                wins: 0,
                losses: 0,
                ties: 0,
                runsFor: 0,
                ballsFaced: 0,
                runsAgainst: 0,
                ballsBowled: 0,
            });
            // if logo provided later, update
            const obj = stats.get(key);
            if (logo) obj.logo = logo;
            return obj;
        };

        // Pre-populate stats map with all registered teams so newly created
        // teams appear in the Points table immediately (played=0 etc).
        allTeams.forEach((t) => {
            ensureTeam(String(t._id), t.name, t.logo);
        });

        for (const m of matches) {
            const t1Key = m.team1TeamId ? String(m.team1TeamId._id) : (m.team1.name || 'Team1');
            const t2Key = m.team2TeamId ? String(m.team2TeamId._id) : (m.team2.name || 'Team2');

            // Prefer the saved Team document. Use populated team1TeamId/team2TeamId
            // when present; otherwise try to match by team name to an existing Team.
            let team1Doc = m.team1TeamId && m.team1TeamId._id ? m.team1TeamId : null;
            let team2Doc = m.team2TeamId && m.team2TeamId._id ? m.team2TeamId : null;
            if (!team1Doc) team1Doc = teamsByName.get(m.team1.name) || null;
            if (!team2Doc) team2Doc = teamsByName.get(m.team2.name) || null;

            // Exclude matches where either side is not a registered Team
            if (!team1Doc || !team2Doc) continue;

            const team1Name = team1Doc ? (team1Doc.name || m.team1.name) : m.team1.name;
            const team2Name = team2Doc ? (team2Doc.name || m.team2.name) : m.team2.name;
            const team1Logo = team1Doc ? (team1Doc.logo || null) : null;
            const team2Logo = team2Doc ? (team2Doc.logo || null) : null;

            const t1KeyFinal = team1Doc && team1Doc._id ? String(team1Doc._id) : t1Key;
            const t2KeyFinal = team2Doc && team2Doc._id ? String(team2Doc._id) : t2Key;

            const team1 = ensureTeam(t1KeyFinal, team1Name, team1Logo);
            const team2 = ensureTeam(t2KeyFinal, team2Name, team2Logo);

            // Update played
            team1.played += 1;
            team2.played += 1;

            // Result
            if (m.winnerKey === 'team1') {
                team1.wins += 1; team2.losses += 1;
            } else if (m.winnerKey === 'team2') {
                team2.wins += 1; team1.losses += 1;
            } else {
                // tie/no-result
                team1.ties += 1; team2.ties += 1;
            }

            // Runs and balls
            const t1Runs = m.team1.totalRuns || 0;
            const t2Runs = m.team2.totalRuns || 0;

            // If innings ended early (all out or manual), use full scheduled overs for overs faced
            const allOut = (team) => (team.wickets || 0) >= ((team.batting?.length || 0) - 1);
            const t1Balls = (m.team1.endedEarly || allOut(m.team1)) ? (m.overs * 6) : (m.team1.legalBalls || 0);
            const t2Balls = (m.team2.endedEarly || allOut(m.team2)) ? (m.overs * 6) : (m.team2.legalBalls || 0);

            team1.runsFor += t1Runs;
            team1.ballsFaced += t1Balls;
            team1.runsAgainst += t2Runs;
            team1.ballsBowled += t2Balls;

            team2.runsFor += t2Runs;
            team2.ballsFaced += t2Balls;
            team2.runsAgainst += t1Runs;
            team2.ballsBowled += t1Balls;
        }

        // Convert map to array and compute points and NRR
        const table = Array.from(stats.values()).map((t) => {
            const points = (t.wins * 2) + (t.ties * 1);
            const oversFaced = t.ballsFaced / 6;
            const oversBowled = t.ballsBowled / 6;
            const nrr = ((oversFaced > 0 ? t.runsFor / oversFaced : 0) - (oversBowled > 0 ? t.runsAgainst / oversBowled : 0));
            return {
                ...t,
                points,
                netRuns: t.runsFor - t.runsAgainst,
                nrr: Number.isFinite(nrr) ? Number(nrr.toFixed(3)) : 0,
            };
        });

        // Sort: points desc, nrr desc, wins desc
        table.sort((a, b) => {
            if (b.points !== a.points) return b.points - a.points;
            if (b.nrr !== a.nrr) return b.nrr - a.nrr;
            return b.wins - a.wins;
        });

        res.render('points/index.ejs', { table, tournamentId });
    } catch (err) {
        console.log(err);
        res.redirect('/tcl?error=points_failed');
    }
};
