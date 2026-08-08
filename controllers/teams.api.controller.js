const Team = require("../models/team.model");
const { deleteImageFile } = require("../utils/fileHelper");

const PLAYER_FIELDS = "name image role handed";

function toPlayerIdArray(raw) {
    if (!raw) return [];
    return Array.isArray(raw) ? raw : [raw];
}

// A player can only be on one team at a time. excludeTeamId lets an
// edit ignore the team's own existing roster when checking.
async function findAlreadyRosteredPlayers(playerIds, excludeTeamId) {
    const clashingTeams = await Team.find({
        ...(excludeTeamId ? { _id: { $ne: excludeTeamId } } : {}),
        players: { $in: playerIds },
    }).populate("players", "name");
    const taken = new Set();
    clashingTeams.forEach((t) => {
        t.players.forEach((p) => {
            if (playerIds.includes(String(p._id))) taken.add(p.name);
        });
    });
    return [...taken];
}

// GET /api/teams
exports.list = async (req, res) => {
    try {
        const teams = await Team.find({})
            .populate("players", PLAYER_FIELDS)
            .populate("captain", PLAYER_FIELDS);
        res.json(teams);
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Failed to load teams." });
    }
};

// GET /api/teams/:id
exports.get = async (req, res) => {
    try {
        const team = await Team.findById(req.params.id)
            .populate("players", PLAYER_FIELDS)
            .populate("captain", PLAYER_FIELDS);
        if (!team) return res.status(404).json({ error: "Team not found" });
        res.json(team);
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Failed to load team." });
    }
};

// POST /api/teams (admin only, enforced in routes)
exports.create = async (req, res) => {
    const logoFile = req.files?.logo?.[0];
    try {
        const name = (req.body.name || "").trim();
        const captain = req.body.captain;
        const players = toPlayerIdArray(req.body.players);
        if (!name) {
            if (logoFile) deleteImageFile(logoFile.filename);
            return res.status(400).json({ error: "Team name is required." });
        }
        if (players.length === 0) {
            if (logoFile) deleteImageFile(logoFile.filename);
            return res.status(400).json({ error: "Please add at least one player to the team." });
        }
        if (!captain || !players.includes(captain)) {
            if (logoFile) deleteImageFile(logoFile.filename);
            return res.status(400).json({ error: "Please select a captain from the team's players." });
        }
        const alreadyRostered = await findAlreadyRosteredPlayers(players, null);
        if (alreadyRostered.length) {
            if (logoFile) deleteImageFile(logoFile.filename);
            return res.status(400).json({ error: `Already on another team: ${alreadyRostered.join(", ")}` });
        }

        const logo = logoFile ? logoFile.path : "/images/placeholder-player.svg";
        const team = await Team.create({ name, logo, players, captain });
        await team.populate([{ path: "players", select: PLAYER_FIELDS }, { path: "captain", select: PLAYER_FIELDS }]);
        res.status(201).json(team);
    } catch (err) {
        console.log(err);
        if (logoFile) deleteImageFile(logoFile.filename);
        res.status(400).json({ error: "Something went wrong while adding the team. Please check all fields and try again." });
    }
};

// POST /api/teams/:id/edit (admin only, enforced in routes)
exports.update = async (req, res) => {
    try {
        const { id } = req.params;
        const existingTeam = await Team.findById(id);
        if (!existingTeam) return res.status(404).json({ error: "Team not found" });

        const name = (req.body.name || "").trim();
        const captain = req.body.captain;
        const players = toPlayerIdArray(req.body.players);

        if (!name) return res.status(400).json({ error: "Team name is required." });
        if (players.length === 0) return res.status(400).json({ error: "Please add at least one player to the team." });
        if (!captain || !players.includes(captain)) {
            return res.status(400).json({ error: "Please select a captain from the team's players." });
        }
        const alreadyRostered = await findAlreadyRosteredPlayers(players, id);
        if (alreadyRostered.length) {
            return res.status(400).json({ error: `Already on another team: ${alreadyRostered.join(", ")}` });
        }

        const updateData = { name, players, captain };

        let newLogo = null;
        if (req.files?.logo) {
            newLogo = req.files.logo[0].path;
            updateData.logo = newLogo;
        }

        const updated = await Team.findByIdAndUpdate(id, updateData, { new: true, runValidators: true })
            .populate("players", PLAYER_FIELDS)
            .populate("captain", PLAYER_FIELDS);

        if (newLogo && existingTeam.logo && existingTeam.logo !== "/images/placeholder-player.svg") {
            deleteImageFile(existingTeam.logo);
        }

        res.json(updated);
    } catch (err) {
        console.log(err);
        res.status(400).json({ error: "Something went wrong while saving changes. Please check all fields and try again." });
    }
};

// POST /api/teams/:id/delete (admin only, enforced in routes)
exports.destroy = async (req, res) => {
    try {
        const team = await Team.findById(req.params.id);
        if (team) {
            deleteImageFile(team.logo);
            await Team.findByIdAndDelete(req.params.id);
        }
        res.json({ ok: true });
    } catch (err) {
        console.log(err);
        res.status(400).json({ error: "Delete failed" });
    }
};