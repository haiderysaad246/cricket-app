const crypto = require("crypto");

const SECRET = process.env.ADMIN_SECRET || "cricket-club-dev-secret";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";
const COOKIE_NAME = "cricket_role";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

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

module.exports = { sign, verify, parseCookies, ADMIN_PASSWORD, COOKIE_NAME, MAX_AGE_MS };
