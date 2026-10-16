const Match = require("../models/matches");
const Player = require("../models/player.model");
const Team = require("../models/team.model");
const Turf = require("../models/turfs");
const Tournament = require("../models/tcl.model");
const { ADMIN_PASSWORD, createSession, getActiveSession, parseCookies, COOKIE_NAME, verify, sign } = require("../utils/auth");

exports.login = async (req, res) => {
    try {
        if (req.body.password !== ADMIN_PASSWORD) {
            return res.status(401).json({ error: "Incorrect password" });
        }

        const activeSession = await getActiveSession();
        const authorization = req.headers.authorization || "";
        const bearer = authorization.match(/^Bearer\s+(.+)$/i);
        const currentSessionId = verify(bearer ? bearer[1] : parseCookies(req)[COOKIE_NAME]);
        const idleMs = activeSession ? Date.now() - new Date(activeSession.lastActive).getTime() : Infinity;
        if (activeSession && activeSession.sessionId !== currentSessionId && idleMs < 10 * 60 * 1000) {
            return res.status(403).json({
                error: "Another user is currently logged in. Only one user can log in at a time. The logged-in user must log out first.",
            });
        }

        const sessionId = await createSession("admin");
        return res.json({ ok: true, token: sign(sessionId) });
    } catch (err) {
        console.error("Mobile login error:", err);
        return res.status(500).json({ error: "Login failed due to a server error" });
    }
};

exports.listLiveMatches = async (req, res) => {
    try {
        const matches = await Match.find({ status: "live" })
            .select("_id team1.name team2.name currentInnings overs updatedAt")
            .sort({ updatedAt: -1 })
            .lean();
        return res.json({ matches });
    } catch (err) {
        console.error("mobile_match_list_failed:", err);
        return res.status(500).json({ error: "Could not load live matches." });
    }
};

exports.getLiveMatch = async (req, res) => {
    try {
        const match = await Match.findOne({ _id: req.params.id, status: "live" }).lean();
        if (!match) return res.status(404).json({ error: "match_not_found" });
        match.lastBallSnapshotCount = (match.lastBallSnapshots || []).length;
        match.redoBallSnapshotCount = (match.redoBallSnapshots || []).length;
        delete match.lastBallSnapshots;
        delete match.redoBallSnapshots;
        return res.json({ match });
    } catch (err) {
        console.error("mobile_match_download_failed:", err);
        return res.status(400).json({ error: "Could not download this match." });
    }
};

exports.getOfflineCatalog = async (req, res) => {
    try {
        const [players, teams, turfs, tournaments, matches] = await Promise.all([
            Player.find({}).lean(),
            Team.find({})
                .populate("players", "name image image2 role handed")
                .populate("captain", "name image image2 role handed")
                .lean(),
            Turf.find({}).lean(),
            Tournament.find({}).lean(),
            Match.find({}).lean(),
        ]);
        return res.json({
            downloadedAt: new Date().toISOString(),
            players,
            teams,
            turfs,
            tournaments,
            matches: matches.map((match) => ({
                ...match,
                lastBallSnapshotCount: (match.lastBallSnapshots || []).length,
                redoBallSnapshotCount: (match.redoBallSnapshots || []).length,
                lastBallSnapshots: undefined,
                redoBallSnapshots: undefined,
            })),
        });
    } catch (err) {
        console.error("mobile_offline_catalog_failed:", err);
        return res.status(500).json({ error: "Could not download app data." });
    }
};
