const mongoose = require("mongoose");
const { Schema } = mongoose;

// A TCL tournament — like a Turf folder, but its fixtures are scheduled
// ahead of time between persistent Teams (not ad-hoc squads picked per
// match), and nothing gets deleted when it ends.
const tournamentSchema = new Schema({
    name: { type: String, required: true, trim: true },
    date: { type: String, trim: true, default: null },
    timing: { type: String, trim: true, default: null },
    // Optional: maximum number of fixtures that can be scheduled inside
    // this tournament. When set, admins cannot add more matches than
    // this number (fixtures are fixed).
    totalFixtures: { type: Number, default: null },
    status: { type: String, enum: ["active", "ended"], default: "active" },
}, { timestamps: true });

module.exports = mongoose.model("tournaments", tournamentSchema);