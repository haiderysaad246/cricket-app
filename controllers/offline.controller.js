const Match = require("../models/matches");
const Player = require("../models/player.model");
const Team = require("../models/team.model");
const Tournament = require("../models/tcl.model");
const Turf = require("../models/turfs");

exports.snapshot = async (req, res) => {
    try {
        const [players, teams, tournaments, turfs, matches] = await Promise.all([
            Player.find({}).lean(),
            Team.find({}).lean(),
            Tournament.find({}).lean(),
            Turf.find({}).lean(),
            Match.find({}).lean(),
        ]);

        res.set("Cache-Control", "no-store");
        res.json({
            downloadedAt: new Date().toISOString(),
            players,
            teams,
            tournaments,
            turfs,
            matches,
        });
    } catch (error) {
        console.error("offline_snapshot_failed", error);
        res.status(500).json({ error: "offline_snapshot_failed" });
    }
};
