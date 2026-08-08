const { verify, parseCookies, COOKIE_NAME } = require("../utils/auth");

// Runs on every request — makes req.isAdmin / res.locals.isAdmin available everywhere (views included)
function attachRole(req, res, next) {
    const cookies = parseCookies(req);
    const role = verify(cookies[COOKIE_NAME]);
    req.isAdmin = role === "admin";
    res.locals.isAdmin = req.isAdmin;
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
