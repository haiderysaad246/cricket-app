const mongoose = require("mongoose");
const { Schema } = mongoose;

// A TCL team — separate from a normal turf's ad-hoc team1/team2 split.
// Teams are persistent squads with a logo and a fixed roster, reused
// across the tournament rather than picked fresh per match.
const teamSchema = new Schema({
    name: { type: String, required: true, trim: true },
    logo: { type: String, required: true },
    players: [{ type: Schema.Types.ObjectId, ref: "players" }],
    captain: { type: Schema.Types.ObjectId, ref: "players", required: true },
}, { timestamps: true });

module.exports = mongoose.model("teams", teamSchema);