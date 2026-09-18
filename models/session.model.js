const mongoose = require("mongoose");

const sessionSchema = new mongoose.Schema({
    sessionId: { type: String, required: true, unique: true },
    role: { type: String, default: "admin" },
    createdAt: { type: Date, default: Date.now },
    lastActive: { type: Date, default: Date.now },
});

// TTL index to automatically remove abandoned sessions after 2 hours
sessionSchema.index({ lastActive: 1 }, { expireAfterSeconds: 7200 });

module.exports = mongoose.model("Session", sessionSchema);
