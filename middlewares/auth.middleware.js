const { verify, parseCookies, COOKIE_NAME, getActiveSession, touchSession } = require("../utils/auth");

// Runs on every request — makes req.isAdmin / res.locals.isAdmin available everywhere (views included)
async function attachRole(req, res, next) {
    try {
        const cookies = parseCookies(req);
        const sessionId = verify(cookies[COOKIE_NAME]);
        if (!sessionId) {
            req.isAdmin = false;
            res.locals.isAdmin = false;
            return next();
        }

        const activeSession = await getActiveSession();
        if (activeSession && activeSession.sessionId === sessionId) {
            req.isAdmin = true;
            res.locals.isAdmin = true;
            req.sessionId = sessionId;
            touchSession(sessionId);
        } else {
            req.isAdmin = false;
            res.locals.isAdmin = false;
        }
    } catch (err) {
        console.error("attachRole error:", err);
        req.isAdmin = false;
        res.locals.isAdmin = false;
    }
    next();
}

// Blocks a route to non-admins. JSON for API/fetch calls, redirect for page loads.
function requireAdmin(req, res, next) {
    if (req.isAdmin) return next();
    const wantsJson = req.headers.accept?.includes("application/json");
    if (req.method === "GET" && !wantsJson) return res.redirect("/players?error=admin_only");
    return res.status(403).json({ error: "Admin access required" });
}

module.exports = { attachRole, requireAdmin };

