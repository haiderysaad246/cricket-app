const mongoose = require("mongoose");
const { Schema } = mongoose;

const battingRowSchema = new Schema({
    id: { type: Schema.Types.ObjectId, ref: "players" },
    name: String,
    image: String,
    isCaptain: { type: Boolean, default: false },
    runs: { type: Number, default: 0 },
    balls: { type: Number, default: 0 },
    dots: { type: Number, default: 0 },
    fours: { type: Number, default: 0 },
    sixes: { type: Number, default: 0 },
    status: { type: String, enum: ["yet_to_bat", "batting", "out", "retired"], default: "yet_to_bat" },
    dismissalText: { type: String, default: null },
    battingOrder: { type: Number, default: null },
}, { _id: false });

const bowlingRowSchema = new Schema({
    id: { type: Schema.Types.ObjectId, ref: "players" },
    name: String,
    image: String,
    isCaptain: { type: Boolean, default: false },
    balls: { type: Number, default: 0 },
    dots: { type: Number, default: 0 },
    maidens: { type: Number, default: 0 },
    runs: { type: Number, default: 0 },
    wickets: { type: Number, default: 0 },
    wicketStreak: { type: Number, default: 0 },
    hatTrick: { type: Boolean, default: false },
}, { _id: false });

const teamStateSchema = new Schema({
    name: { type: String, required: true, trim: true },
    captainId: { type: Schema.Types.ObjectId, ref: "players", default: null },
    captainName: { type: String, default: null },
    captainImage: { type: String, default: null },
    batting: [battingRowSchema],
    bowling: [bowlingRowSchema],
    strikerId: { type: Schema.Types.ObjectId, ref: "players", default: null },
    nonStrikerId: { type: Schema.Types.ObjectId, ref: "players", default: null },
    currentBowlerId: { type: Schema.Types.ObjectId, ref: "players", default: null },
    keeperId: { type: Schema.Types.ObjectId, ref: "players", default: null },
    keeperName: { type: String, default: null },
    legalBalls: { type: Number, default: 0 },
    currentOverBalls: { type: [String], default: [] },
    currentOverRuns: { type: Number, default: 0 },
    overStarted: { type: Boolean, default: false },
    totalRuns: { type: Number, default: 0 },
    wickets: { type: Number, default: 0 },
    extraWides: { type: Number, default: 0 },
    extraNoBalls: { type: Number, default: 0 },
    endedEarly: { type: Boolean, default: false },
    // Set once this team's batting+bowling has been folded into player
    // profiles (right after their innings finishes). Prevents endTurf's
    // fallback sweep from double-counting the same innings.
    statsAggregated: { type: Boolean, default: false },
}, { _id: false });

const matchSchema = new Schema({
    overs: { type: Number, required: true, min: 1 },
    battingFirst: { type: String, enum: ["team1", "team2"], required: true },
    currentInnings: { type: String, enum: ["team1", "team2"], default: "team1" },
    team1: { type: teamStateSchema, required: true },
    team2: { type: teamStateSchema, required: true },
    status: { type: String, enum: ["live", "completed"], default: "live" },
    result: { type: String, default: null },
    winnerKey: { type: String, enum: ["team1", "team2", null], default: null },
    turfId: { type: Schema.Types.ObjectId, ref: "turfs", default: null },
    tournamentId: { type: Schema.Types.ObjectId, ref: "tournaments", default: null },
    team1TeamId: { type: Schema.Types.ObjectId, ref: "teams", default: null },
    team2TeamId: { type: Schema.Types.ObjectId, ref: "teams", default: null },
    lastBallSnapshots: { type: [Schema.Types.Mixed], default: [] },
    // Set once Match MVP has been awarded for this match, so it's never
    // double-awarded if match completion gets touched by more than one
    // save (e.g. a ball that ends the match, then a later route call).
    mvpAwarded: { type: Boolean, default: false },
    // Distinguishes tournament match stages: "fixture" (round-robin),
    // "semifinal" (auto-created when all fixtures finish), "final"
    // (auto-created when both semifinals finish), "superover" (auto-created
    // when a TCL match of any stage ties). Turf matches are always
    // "fixture" by default.
    stage: { type: String, enum: ["fixture", "semifinal", "final", "superover"], default: "fixture" },
    // Super Over linkage. isSuperOver marks this match itself as a Super
    // Over (overs=1, 2-wicket cap enforced in the scoring engine).
    // superOverParentId points a Super Over match back at the tied match
    // that spawned it. superOverMatchId points a tied match forward at
    // its Super Over (set once, so it's never created twice — and a
    // Super Over that itself ties can chain to another one the same way).
    isSuperOver: { type: Boolean, default: false },
    superOverParentId: { type: Schema.Types.ObjectId, ref: "matches", default: null },
    superOverMatchId: { type: Schema.Types.ObjectId, ref: "matches", default: null },
}, { timestamps: true });

module.exports = mongoose.model("matches", matchSchema);