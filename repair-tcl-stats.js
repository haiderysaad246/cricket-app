require("dotenv").config();
const mongoose = require("mongoose");
const Match = require("./models/matches");
const { aggregateTeamStats } = require("./controllers/turf.controller");

const APPLY = process.argv.includes("--apply");

(async () => {
    await mongoose.connect(process.env.MONGO_URL || "mongodb://127.0.0.1:27017/cricket");
    const matches = await Match.find({ tournamentId: { $ne: null }, status: "completed" });
    let count = 0;
    for (const m of matches) {
        for (const key of ["team1", "team2"]) {
            if (m[key].statsAggregated) continue;
            count++;
            console.log(`${APPLY ? "Counting" : "Would count"}: ${m.team1.name} vs ${m.team2.name} — ${m[key].name}'s innings (${m.result})`);
            if (APPLY) await aggregateTeamStats(m, key);
        }
        if (APPLY) await m.save();
    }
    console.log(`${count} innings ${APPLY ? "added to player profiles" : "found (dry run — run again with --apply to save)"}`);
    await mongoose.disconnect();
})();