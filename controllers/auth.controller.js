const {
    sign,
    verify,
    parseCookies,
    ADMIN_PASSWORD,
    COOKIE_NAME,
    MAX_AGE_MS,
    getActiveSession,
    createSession,
    destroySession,
} = require("../utils/auth");

exports.status = (req, res) => {
    res.json({ isAdmin: !!req.isAdmin });
};

exports.login = async (req, res) => {
    try {
        const { password } = req.body;
        if (password !== ADMIN_PASSWORD) {
            return res.status(401).json({ error: "Incorrect password" });
        }

        const activeSession = await getActiveSession();
        const cookies = parseCookies(req);
        const currentSessionId = verify(cookies[COOKIE_NAME]);

        // Block only if the other session was active in the last 10 minutes, so a
        // lost cookie or closed browser can't lock everyone out for 2 hours
        const idleMs = activeSession ? Date.now() - new Date(activeSession.lastActive).getTime() : Infinity;
        if (activeSession && activeSession.sessionId !== currentSessionId && idleMs < 10 * 60 * 1000) {
            return res.status(403).json({
                error: "Another user is currently logged in. Only one user can log in at a time. The logged-in user must log out first.",
            });
        }

        const sessionId = await createSession("admin");
        res.cookie(COOKIE_NAME, sign(sessionId), {
            httpOnly: true,
            sameSite: "lax",
            maxAge: 30 * 24 * 60 * 60 * 1000, // the server-side idle timeout decides when you're logged out
        });
        res.json({ ok: true });
    } catch (err) {
        console.error("Login error:", err);
        res.status(500).json({ error: "Login failed due to a server error" });
    }
};

exports.logout = async (req, res) => {
    try {
        const cookies = parseCookies(req);
        const sessionId = verify(cookies[COOKIE_NAME]);
        if (sessionId) {
            await destroySession(sessionId);
        }
    } catch (err) {
        console.error("Logout error:", err);
    }
    res.clearCookie(COOKIE_NAME);
    res.json({ ok: true });
};

