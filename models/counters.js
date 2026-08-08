const mongoose = require("mongoose");
const { Schema } = mongoose;

// One doc per named counter. Used so "Turf N" numbering keeps
// incrementing even though Turf docs themselves get deleted once a
// turf ends (see endTurf) — the number lives here instead.
const counterSchema = new Schema({
    key: { type: String, required: true, unique: true },
    value: { type: Number, default: 0 },
});

module.exports = mongoose.model("counters", counterSchema);