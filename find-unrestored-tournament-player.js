require("dotenv").config();
const mongoose = require("mongoose");

const tournamentId = process.argv[2];

async function run() {
    if (!tournamentId) throw new Error("Tournament ID is required.");
    await mongoose.connect(process.env.MONGO_URL || "mongodb://127.0.0.1:27017/cricket");

    try {
        const db = mongoose.connection;
        const matches = await db.collection("matches").find({
            tournamentId: new mongoose.Types.ObjectId(tournamentId),
            status: "completed",
        }).toArray();
        const ids = [...new Set(matches.flatMap((match) =>
            ["team1", "team2"].flatMap((teamKey) =>
                [...(match[teamKey].batting || []), ...(match[teamKey].bowling || [])]
                    .map((row) => row.id)
                    .filter(Boolean)
                    .map(String)
            )
        ))];
        const objectIds = ids.map((id) => new mongoose.Types.ObjectId(id));
        const players = await db.collection("players").find({
            _id: { $in: objectIds },
        }).toArray();

        const unrestored = players.filter((player) => {
            const batting = player.turfStats?.batting || {};
            const bowling = player.turfStats?.bowling || {};
            return ![
                batting.runs, batting.matches, batting.innings, batting.ballsFaced,
                batting.dots, batting.fours, batting.sixes, batting.highest,
                bowling.wickets, bowling.innings, bowling.overs, bowling.ballsBowled,
                bowling.runsConceded, bowling.dots, bowling.noBalls, bowling.wideRuns,
            ].some((value) => Number(value || 0) !== 0);
        });

        console.log(`Tournament participants: ${players.length}`);
        console.log(`Players with no restored batting/bowling totals: ${unrestored.length}`);
        unrestored.forEach((player) => console.log(`${player._id}\t${player.name}`));
    } finally {
        await mongoose.disconnect();
    }
}

run().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
