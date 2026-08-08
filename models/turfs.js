const mongoose = require("mongoose");
const { Schema } = mongoose;

// A Turf session groups matches played back-to-back (e.g. a 3-hour
// slot where you might play 10+ matches). Overs and team names are
// locked in for every match inside it — only which players show up
// changes per match. Everything about the matches themselves is
// temporary: once "End Turf" is hit, player stats get folded into
// their profiles and the matches are deleted. The Turf doc itself is
// kept (marked "ended") purely so turf numbering ("Turf 1", "Turf 2"...)
// keeps incrementing instead of reusing old numbers.
const turfSchema = new Schema({
    name: { type: String, required: true, trim: true },
    date: { type: String, trim: true, default: null },
    timing: { type: String, trim: true, default: null },
    overs: { type: Number, min: 1, default: null },
    battingFirst: { type: String, enum: ["team1", "team2"], default: "team1" },
    team1Name: { type: String, trim: true, default: "Team 1" },
    team2Name: { type: String, trim: true, default: "Team 2" },
    team1PlayerIds: [{ type: Schema.Types.ObjectId, ref: "players" }],
    team2PlayerIds: [{ type: Schema.Types.ObjectId, ref: "players" }],
    team1CaptainId: { type: Schema.Types.ObjectId, ref: "players", default: null },
    team2CaptainId: { type: Schema.Types.ObjectId, ref: "players", default: null },
    status: { type: String, enum: ["active", "ended"], default: "active" },
}, { timestamps: true });

module.exports = mongoose.model("turfs", turfSchema);