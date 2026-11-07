require("dotenv").config();
const mongoose = require("mongoose");
const Match = require("./models/matches");
const Tournament = require("./models/tcl.model");
const Player = require("./models/player.model");
const { aggregateTeamStats } = require("./controllers/turf.controller");
const { computeMVP, computeSessionMVP } = require("./utils/mvp");

const MONGO_URL = process.env.MONGO_URL || "mongodb://127.0.0.1:27017/cricket";
const tournamentId = process.argv[2] || process.env.TOURNAMENT_ID;
const APPLY = process.argv.includes("--apply");

function participantIds(match) {
    return [...new Set(["team1", "team2"].flatMap((teamKey) =>
        [...(match[teamKey].batting || []), ...(match[teamKey].bowling || [])]
            .map((row) => row.id)
            .filter(Boolean)
            .map(String)
    ))];
}

async function run() {
    if (!tournamentId) {
        throw new Error("Provide a tournament ID: node apply-match-stats.js <tournament-id> [--apply]");
    }
    await mongoose.connect(MONGO_URL);

    try {
        console.log(`MongoDB URI host(s): ${mongoose.connection.host}`);
        console.log(`MongoDB database: ${mongoose.connection.name}`);
        const tournament = await Tournament.findById(tournamentId);
        if (!tournament) throw new Error(`Tournament not found: ${tournamentId}`);

        const matches = await Match.find({
            tournamentId: tournament._id,
            status: "completed",
        }).sort({ createdAt: 1, _id: 1 });

        if (!matches.length) {
            throw new Error(`No completed matches found in tournament: ${tournamentId}`);
        }

        console.log(`${APPLY ? "Applying" : "Checking"} tournament ${tournament._id}: ${tournament.name}`);
        console.log(`Completed matches: ${matches.length}`);

        for (const match of matches) {
            const matchKey = String(match._id);
            const ids = participantIds(match);
            const players = ids.length ? await Player.find({ _id: { $in: ids } }) : [];
            const playersById = new Map(players.map((player) => [String(player._id), player]));
            const needsStats = ids.some((id) => !playersById.get(id)?.statsAppliedMatchIds?.includes(matchKey));
            const matchMvp = computeMVP(match)[0] || null;
            const matchMvpPlayer = matchMvp ? playersById.get(String(matchMvp.id)) : null;
            const needsMatchMvp = Boolean(matchMvpPlayer && !matchMvpPlayer.mvpAppliedMatchIds?.includes(matchKey));

            console.log(`- Match ${matchKey}: ${match.team1.name} vs ${match.team2.name}`);
            console.log(`  career stats: ${needsStats ? "needed" : "already applied"}; match MVP: ${
                matchMvp ? `${matchMvp.name}${needsMatchMvp ? " needed" : " already applied"}` : "none"
            }`);

            if (!APPLY) continue;

            if (needsStats) {
                for (const teamKey of ["team1", "team2"]) {
                    match[teamKey].statsAggregated = false;
                    await aggregateTeamStats(match, teamKey);
                }
            }

            for (const id of ids) {
                await Player.updateOne(
                    { _id: id, statsAppliedMatchIds: { $ne: matchKey } },
                    { $addToSet: { statsAppliedMatchIds: matchKey } }
                );
            }

            if (matchMvp && matchMvpPlayer && needsMatchMvp) {
                await Player.updateOne(
                    { _id: matchMvp.id, mvpAppliedMatchIds: { $ne: matchKey } },
                    { $inc: { matchMvpCount: 1 }, $addToSet: { mvpAppliedMatchIds: matchKey } }
                );
            }

            await match.save();
        }

        if (!APPLY) {
            console.log("Dry run only. Re-run with --apply to save these updates.");
            return;
        }

        const tournamentParticipantIds = [...new Set(matches.flatMap(participantIds))];
        const tournamentPlayers = tournamentParticipantIds.length
            ? await Player.find({ _id: { $in: tournamentParticipantIds } }).lean()
            : [];
        const tournamentPlayersById = new Map(
            tournamentPlayers.map((player) => [String(player._id), player])
        );
        const allTournamentMatchesApplied = matches.every((match) =>
            participantIds(match).every((id) =>
                tournamentPlayersById.get(id)?.statsAppliedMatchIds?.includes(String(match._id))
            )
        );

        if (allTournamentMatchesApplied && tournament.turfMvpAwarded) {
            const tournamentWinner = computeSessionMVP(matches.map((match) => match.toObject()))[0];
            if (tournamentWinner) {
                const tournamentKey = String(tournament._id);
                const winner = await Player.findById(tournamentWinner.id);
                if (winner && !winner.tournamentMvpAppliedIds?.includes(tournamentKey)) {
                    await Player.updateOne(
                        { _id: winner._id },
                        {
                            $inc: { turfMvpCount: 1 },
                            $addToSet: { tournamentMvpAppliedIds: tournamentKey },
                        }
                    );
                    console.log(`Tournament MVP awarded to ${winner.name}.`);
                }
            }
        }

        console.log("Tournament stats recovery complete.");

        const restoredPlayers = await Player.find({
            _id: { $in: [...new Set(matches.flatMap(participantIds))] },
        }).lean();
        const playersWithStats = restoredPlayers.filter((player) =>
            Number(player.turfStats?.batting?.runs || 0) !== 0
            || Number(player.turfStats?.bowling?.ballsBowled || 0) !== 0
        ).length;
        console.log(`Players with restored batting/bowling totals: ${playersWithStats}/${restoredPlayers.length}`);
    } finally {
        await mongoose.disconnect();
    }
}

run().catch((error) => {
    console.error("Failed to apply tournament stats:", error.message);
    process.exitCode = 1;
});
