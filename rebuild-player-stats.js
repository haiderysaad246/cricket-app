require("dotenv").config();
const mongoose = require("mongoose");
const Match = require("./models/matches");
const Player = require("./models/player.model");
const { computeMVP, computeSessionMVP } = require("./utils/mvp");

const MONGO_URL = process.env.MONGO_URL || "mongodb://127.0.0.1:27017/cricket";
const APPLY = process.argv.includes("--apply");

function createStats() {
    return {
        batting: {
            runs: 0,
            matches: 0,
            innings: 0,
            average: 0,
            strikeRate: 0,
            highest: 0,
            highestBalls: 0,
            ducks: 0,
            ballsFaced: 0,
            dots: 0,
            fours: 0,
            sixes: 0,
            timesOut: 0,
        },
        bowling: {
            wickets: 0,
            innings: 0,
            overs: 0,
            ballsBowled: 0,
            runsConceded: 0,
            dots: 0,
            dotBallPercentage: 0,
            noBalls: 0,
            wideRuns: 0,
            average: 0,
            economyRate: 0,
            strikeRate: 0,
            maidens: 0,
            hatTricks: 0,
        },
    };
}

function getPlayerStats(statsByPlayer, id) {
    const playerId = String(id);
    if (!statsByPlayer.has(playerId)) statsByPlayer.set(playerId, createStats());
    return statsByPlayer.get(playerId);
}

function addMatchStats(match, statsByPlayer, matchMvpCounts) {
    for (const teamKey of ["team1", "team2"]) {
        const team = match[teamKey];
        if (!team) continue;

        for (const row of team.batting || []) {
            if (!row.id || row.status === "yet_to_bat") continue;
            const batting = getPlayerStats(statsByPlayer, row.id).batting;
            const runs = row.runs || 0;
            const balls = row.balls || 0;

            batting.matches += 1;
            batting.innings += 1;
            batting.runs += runs;
            batting.ballsFaced += balls;
            batting.dots += row.dots || 0;
            batting.fours += row.fours || 0;
            batting.sixes += row.sixes || 0;
            if (row.status === "out") {
                batting.timesOut += 1;
                if (runs === 0) batting.ducks += 1;
            }
            if (runs > batting.highest
                || (runs > 0 && runs === batting.highest
                    && (!batting.highestBalls || balls < batting.highestBalls))) {
                batting.highest = runs;
                batting.highestBalls = balls;
            }
        }

        for (const row of team.bowling || []) {
            if (!row.id || (!row.balls && !row.runs && !row.wickets)) continue;
            const bowling = getPlayerStats(statsByPlayer, row.id).bowling;
            bowling.innings += 1;
            bowling.wickets += row.wickets || 0;
            bowling.ballsBowled += row.balls || 0;
            bowling.dots += row.dots || 0;
            bowling.noBalls += row.noBalls || 0;
            bowling.wideRuns += row.wideRuns || 0;
            bowling.runsConceded += row.runs || 0;
            bowling.maidens += row.maidens || 0;
            bowling.hatTricks += row.hatTrick ? 1 : 0;
            bowling.overs += row.overs || 0;
        }
    }

    const ranked = computeMVP(match);
    if (ranked.length) {
        const mvpId = String(ranked[0].id);
        matchMvpCounts.set(mvpId, (matchMvpCounts.get(mvpId) || 0) + 1);
    }
}

function finishStats(statsByPlayer) {
    for (const stats of statsByPlayer.values()) {
        const batting = stats.batting;
        batting.strikeRate = batting.ballsFaced > 0
            ? Number(((batting.runs / batting.ballsFaced) * 100).toFixed(2))
            : 0;
        batting.average = batting.timesOut > 0
            ? Number((batting.runs / batting.timesOut).toFixed(2))
            : batting.runs;
        delete batting.timesOut;

        const bowling = stats.bowling;
        bowling.economyRate = bowling.ballsBowled > 0
            ? Number((bowling.runsConceded / (bowling.ballsBowled / 6)).toFixed(2))
            : 0;
        bowling.average = bowling.wickets > 0
            ? Number((bowling.runsConceded / bowling.wickets).toFixed(2))
            : 0;
        bowling.strikeRate = bowling.wickets > 0
            ? Number((bowling.ballsBowled / bowling.wickets).toFixed(2))
            : 0;
        bowling.dotBallPercentage = bowling.ballsBowled > 0
            ? Number(((bowling.dots / bowling.ballsBowled) * 100).toFixed(2))
            : 0;
    }
}

async function run() {
    await mongoose.connect(MONGO_URL);
    try {
        const [matches, players] = await Promise.all([
            Match.find({ status: "completed" }).lean(),
            Player.find({}, "_id").lean(),
        ]);
        const statsByPlayer = new Map();
        const matchMvpCounts = new Map();
        const sessions = new Map();

        for (const match of matches) {
            addMatchStats(match, statsByPlayer, matchMvpCounts);

            const sessionId = match.tournamentId
                ? `tournament:${match.tournamentId}`
                : match.turfId ? `turf:${match.turfId}` : null;
            if (sessionId) {
                if (!sessions.has(sessionId)) sessions.set(sessionId, []);
                sessions.get(sessionId).push(match);
            }
        }

        finishStats(statsByPlayer);
        const turfMvpCounts = new Map();
        for (const sessionMatches of sessions.values()) {
            const winner = computeSessionMVP(sessionMatches)[0];
            if (winner) {
                const playerId = String(winner.id);
                turfMvpCounts.set(playerId, (turfMvpCounts.get(playerId) || 0) + 1);
            }
        }

        const operations = players.map(({ _id }) => {
            const playerId = String(_id);
            return {
                updateOne: {
                    filter: { _id },
                    update: {
                        $set: {
                            turfStats: statsByPlayer.get(playerId) || createStats(),
                            matchMvpCount: matchMvpCounts.get(playerId) || 0,
                            turfMvpCount: turfMvpCounts.get(playerId) || 0,
                        },
                    },
                },
            };
        });

        console.log(`Completed match records found: ${matches.length}`);
        console.log(`Player profiles to rebuild: ${players.length}`);
        console.log(`Turf/TCL sessions with retained completed matches: ${sessions.size}`);
        if (APPLY && operations.length) {
            const result = await Player.bulkWrite(operations);
            console.log(`Updated ${result.modifiedCount} player profile(s).`);
        } else {
            console.log("Dry run only; no player profiles were changed.");
            console.log("Run with --apply to save the rebuilt stats.");
        }
        console.log("Only completed match records still present in the database are included.");
    } finally {
        await mongoose.disconnect();
    }
}

run().catch((err) => {
    console.error("Failed to rebuild player stats:", err);
    process.exitCode = 1;
});
