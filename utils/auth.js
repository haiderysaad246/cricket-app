const crypto = require("crypto");
const Session = require("../models/session.model");

const SECRET = process.env.ADMIN_SECRET || "cricket-club-dev-secret";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";
const COOKIE_NAME = "cricket_role";
const SESSION_TIMEOUT_MS = (parseInt(process.env.SESSION_TIMEOUT_MINUTES, 10) || 360) * 60 * 1000; // 6 hours

const MAX_AGE_MS = SESSION_TIMEOUT_MS;

function sign(value) {
    const sig = crypto.createHmac("sha256", SECRET).update(value).digest("hex");
    return `${value}.${sig}`;
}

function verify(signed) {
    if (!signed) return null;
    const idx = signed.lastIndexOf(".");
    if (idx === -1) return null;
    const value = signed.slice(0, idx);
    const sig = signed.slice(idx + 1);
    const expected = crypto.createHmac("sha256", SECRET).update(value).digest("hex");
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return value;
}

function parseCookies(req) {
    const header = req.headers.cookie;
    const out = {};
    if (!header) return out;
    header.split(";").forEach((pair) => {
        const idx = pair.indexOf("=");
        if (idx === -1) return;
        out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
    });
    return out;
}

// The session lives ONLY in MongoDB. It used to be cached in this process's
// memory, which breaks as soon as more than one server process/instance runs:
// a logout handled by instance A cleared A's cache, but instance B kept its
// stale copy and kept rejecting other logins with "only one admin at a time".
// The collection holds at most one document, so reading it per request is cheap.

async function getActiveSession() {
    try {
        const doc = await Session.findOne({}).lean();
        if (!doc) return null;
        if (Date.now() - new Date(doc.lastActive).getTime() > SESSION_TIMEOUT_MS) {
            await Session.deleteOne({ _id: doc._id });
            return null;
        }
        return doc;
    } catch (err) {
        console.error("Error reading session from DB:", err);
        return null;
    }
}

async function createSession(role = "admin") {
    const sessionId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(24).toString("hex");
    try {
        await Session.deleteMany({});
        await Session.create({
            sessionId,
            role,
            createdAt: new Date(),
            lastActive: new Date(),
        });
        return sessionId;
    } catch (err) {
        console.error("Error creating session in DB:", err);
        throw err;
    }
}

// Only removes the session that matches, so a stale cookie can't log out
// whoever is currently signed in.
async function destroySession(sessionId) {
    try {
        await Session.deleteOne({ sessionId });
    } catch (err) {
        console.error("Error destroying session in DB:", err);
    }
}

// Refresh lastActive at most once a minute. `activeSession` is the document
// the caller already read, so no extra query is needed to decide.
function touchSession(activeSession) {
    if (!activeSession) return;
    const now = Date.now();
    if (now - new Date(activeSession.lastActive).getTime() < 60 * 1000) return;
    Session.updateOne({ sessionId: activeSession.sessionId }, { lastActive: new Date(now) }).catch((err) => {
        console.error("Error touching session:", err);
    });
}

module.exports = {
    sign,
    verify,
    parseCookies,
    ADMIN_PASSWORD,
    COOKIE_NAME,
    MAX_AGE_MS,
    SESSION_TIMEOUT_MS,
    getActiveSession,
    createSession,
    destroySession,
    touchSession,
};