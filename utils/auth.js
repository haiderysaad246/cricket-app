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

// In-memory cache for ultra-fast session validation on every request
let cachedSession = null;
let cacheInitialized = false;
let lastTouchTime = 0;

async function getActiveSession() {
    const now = Date.now();
    if (!cacheInitialized) {
        try {
            const doc = await Session.findOne({});
            cachedSession = doc ? doc.toObject() : null;
            cacheInitialized = true;
        } catch (err) {
            console.error("Error reading session from DB:", err);
            return null;
        }
    }

    if (cachedSession) {
        const lastActiveTime = new Date(cachedSession.lastActive).getTime();
        if (now - lastActiveTime > SESSION_TIMEOUT_MS) {
            await destroySession(cachedSession.sessionId);
            return null;
        }
        return cachedSession;
    }

    return null;
}

async function createSession(role = "admin") {
    const sessionId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(24).toString("hex");
    try {
        await Session.deleteMany({});
        const doc = await Session.create({
            sessionId,
            role,
            createdAt: new Date(),
            lastActive: new Date(),
        });
        cachedSession = doc.toObject();
        cacheInitialized = true;
        lastTouchTime = Date.now();
        return sessionId;
    } catch (err) {
        console.error("Error creating session in DB:", err);
        throw err;
    }
}

async function destroySession(sessionId) {
    cachedSession = null;
    cacheInitialized = true;
    try {
        await Session.deleteMany({});
    } catch (err) {
        console.error("Error destroying session in DB:", err);
    }
}

function touchSession(sessionId) {
    const now = Date.now();
    if (now - lastTouchTime > 60 * 1000) { // Throttle DB writes to once per minute
        lastTouchTime = now;
        if (cachedSession && cachedSession.sessionId === sessionId) {
            cachedSession.lastActive = new Date(now);
        }
        Session.updateOne({ sessionId }, { lastActive: new Date(now) }).catch((err) => {
            console.error("Error touching session:", err);
        });
    }
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
