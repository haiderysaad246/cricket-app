const { sign, ADMIN_PASSWORD, COOKIE_NAME, MAX_AGE_MS } = require("../utils/auth");

exports.status = (req, res) => {
    res.json({ isAdmin: !!req.isAdmin });
};

exports.login = (req, res) => {
    const { password } = req.body;
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: "Incorrect password" });
    }
    res.cookie(COOKIE_NAME, sign("admin"), {
        httpOnly: true,
        sameSite: "lax",
        maxAge: MAX_AGE_MS,
    });
    res.json({ ok: true });
};

exports.logout = (req, res) => {
    res.clearCookie(COOKIE_NAME);
    res.json({ ok: true });
};
