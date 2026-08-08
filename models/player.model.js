const mongoose = require("mongoose");
const { Schema } = mongoose;

// Batting stats block — reused identically for both Turf and TCL stats,
// since the two are tracked completely separately.
const battingStatsSchema = new Schema({
    runs: { type: Number, default: 0 },
    matches: { type: Number, default: 0 },
    innings: { type: Number, default: 0 },
    average: { type: Number, default: 0 },
    strikeRate: { type: Number, default: 0 },
    highest: { type: Number, default: 0 },
    ducks: { type: Number, default: 0 },
    ballsFaced: { type: Number, default: 0 },
    dots: { type: Number, default: 0 },
    fours: { type: Number, default: 0 },
    sixes: { type: Number, default: 0 },
}, { _id: false });

// Bowling stats block — reused identically for both Turf and TCL stats.
const bowlingStatsSchema = new Schema({
    wickets: { type: Number, default: 0 },
    innings: { type: Number, default: 0 },
    overs: { type: Number, default: 0 },
    ballsBowled: { type: Number, default: 0 },
    runsConceded: { type: Number, default: 0 },
    dots: { type: Number, default: 0 },
    dotBallPercentage: { type: Number, default: 0 },
    noBallRuns: { type: Number, default: 0 },
    wideRuns: { type: Number, default: 0 },
    average: { type: Number, default: 0 },
    economyRate: { type: Number, default: 0 },
    strikeRate: { type: Number, default: 0 },
    maidens: { type: Number, default: 0 },
}, { _id: false });

// A full stat block (batting + bowling) for one context — Turf (normal
// weekend matches) or TCL (the tournament). Kept as two completely
// separate blocks since a player's turf form and tournament form differ.
const statBlockSchema = new Schema({
    batting: { type: battingStatsSchema, default: () => ({}) },
    bowling: { type: bowlingStatsSchema, default: () => ({}) },
}, { _id: false });

const playerSchema = new Schema({
    name: {
        type: String,
        required: true
    },
    role: {
        type: String,
        required: true,
        enum: ["Batsmen", "Bowler", "All Rounder"]
    },
    handed: {
        type: String,
        required: true,
        enum: ["Right Handed", "Left Handed"]
    },
    image: {
        type: String,
        default: "/images/placeholder-player.svg"
    },
    image2: {
        type: String,
        default: "/images/placeholder-player.svg"
    },
    // Normal weekend turf stats
    turfStats: { type: statBlockSchema, default: () => ({}) },
    // Turf Cricket League (tournament) stats — tracked separately from turf stats
    tclStats: { type: statBlockSchema, default: () => ({}) },
    // How many single matches this player was crowned MVP of (top of that
    // match's MVP points table).
    matchMvpCount: { type: Number, default: 0 },
    // How many whole turf sessions this player was crowned MVP of (highest
    // combined MVP points across every match in that turf).
    turfMvpCount: { type: Number, default: 0 },
});

// Model name kept as "players" (unchanged) so it maps to the same
// existing MongoDB collection as before.
module.exports = mongoose.model("players", playerSchema);
