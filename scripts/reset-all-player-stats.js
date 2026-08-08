/**
 * One-off maintenance script: reset every player's Turf and TCL stats
 * (batting + bowling) back to 0.
 *
 * Usage (from project root):
 *   node scripts/reset-all-player-stats.js
 *
 * It connects using the same MONGO_URL env var (falls back to the local
 * MongoDB used by config/db.js), resets all stat fields on every player
 * document, then disconnects.
 */
const mongoose = require("mongoose");

const MONGO_URL = process.env.MONGO_URL || "mongodb://127.0.0.1:27017/cricket";

const zeroBatting = {
    runs: 0,
    matches: 0,
    innings: 0,
    average: 0,
    strikeRate: 0,
    highest: 0,
    ducks: 0,
    ballsFaced: 0,
    dots: 0,
    fours: 0,
    sixes: 0,
};

const zeroBowling = {
    wickets: 0,
    innings: 0,
    overs: 0,
    ballsBowled: 0,
    runsConceded: 0,
    dots: 0,
    dotBallPercentage: 0,
    noBallRuns: 0,
    wideRuns: 0,
    average: 0,
    economyRate: 0,
    strikeRate: 0,
    maidens: 0,
};

async function main() {
    await mongoose.connect(MONGO_URL);
    console.log("Connected to", MONGO_URL);

    const Player = mongoose.connection.collection("players");

    const result = await Player.updateMany(
        {},
        {
            $set: {
                "turfStats.batting": zeroBatting,
                "turfStats.bowling": zeroBowling,
                "tclStats.batting": zeroBatting,
                "tclStats.bowling": zeroBowling,
                // Keep identity/profile fields intact; only wipe the stats.
            },
            $unset: {
                matchMvpCount: "",
                turfMvpCount: "",
            },
        }
    );

    console.log(`Matched ${result.matchedCount} player(s), modified ${result.modifiedCount}.`);

    await mongoose.disconnect();
    console.log("Done. All player stats reset to 0.");
}

main().catch((err) => {
    console.error("Reset failed:", err);
    process.exit(1);
});
