const mongoose = require("mongoose");

const sessionSchema = new mongoose.Schema({
    sessionId: { type: String, required: true, unique: true },
    role: { type: String, default: "admin" },
    createdAt: { type: Date, default: Date.now },
    lastActive: { type: Date, default: Date.now },
});

// TTL index to automatically remove abandoned sessions after 6 hours
sessionSchema.index({ lastActive: 1 }, { expireAfterSeconds: 21600 });

const Session = mongoose.model("Session", sessionSchema);
// Your database still has the old 2-hour index; this swaps it for the new one on startup
Session.syncIndexes().catch((err) => console.error("Session index sync failed:", err));

module.exports = Session;
