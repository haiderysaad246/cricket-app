require("dotenv").config();
const mongoose = require("mongoose");
const Player = require("./models/player.model");

const MONGO_URL = process.env.MONGO_URL || "mongodb://127.0.0.1:27017/cricket";

const zeroStatBlock = {
    batting: {
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
    },
    bowling: {
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
    },
};

async function run() {
    await mongoose.connect(MONGO_URL);
    console.log("Connected to:", MONGO_URL);

    const result = await Player.updateMany(
        {},
        {
            $set: {
                turfStats: zeroStatBlock,
                tclStats: zeroStatBlock,
                matchMvpCount: 0,
                turfMvpCount: 0,
            },
        }
    );

    console.log(`Reset stats for ${result.modifiedCount} player(s).`);
    await mongoose.disconnect();
}

run().catch((err) => {
    console.error("Failed to reset player stats:", err);
    process.exit(1);
});