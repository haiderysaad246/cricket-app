const Team = require("../models/team.model");
const { deleteImageFile } = require("../utils/fileHelper");

const PLAYER_FIELDS = "name image role handed";

function toPlayerIdArray(raw) {
    if (!raw) return [];
    return Array.isArray(raw) ? raw : [raw];
}

async function findRosterConflicts(playerIds, excludeTeamId) {
    if (!playerIds.length) return [];
    return Team.find({
        ...(excludeTeamId ? { _id: { $ne: excludeTeamId } } : {}),
        players: { $in: playerIds },
    }).populate("players", "name");
}

function playersOnTeams(teams, playerIds) {
    const requestedIds = new Set(playerIds.map(String));
    return teams.flatMap((team) => team.players
        .filter((player) => typeof player === "object" && player !== null)
        .filter((player) => requestedIds.has(String(player._id)))
        .map((player) => ({ id: String(player._id), name: player.name, team: team.name })));
}

async function saveWithPlayerTransfers(teams, transferIds, saveTarget) {
    const transfers = new Set(transferIds);
    const changes = [];

    for (const team of teams) {
        const previousPlayers = team.players.map((player) => String(player._id || player));
        const nextPlayers = previousPlayers.filter((playerId) => !transfers.has(playerId));
        if (nextPlayers.length === previousPlayers.length) continue;
        if (!nextPlayers.length) {
            return { error: `Cannot transfer the last player from ${team.name}. Add another player to that team first.` };
        }

        changes.push({
            team,
            players: team.players,
            captain: team.captain,
            nextPlayers,
            nextCaptain: transfers.has(String(team.captain?._id || team.captain))
                ? nextPlayers[0]
                : team.captain?._id || team.captain,
        });
    }

    try {
        for (const change of changes) {
            change.team.players = change.nextPlayers;
            change.team.captain = change.nextCaptain;
            await change.team.save();
        }
        return { result: await saveTarget() };
    } catch (err) {
        for (const change of changes.reverse()) {
            try {
                change.team.players = change.players;
                change.team.captain = change.captain;
                await change.team.save();
            } catch (rollbackError) {
                console.error("team_player_transfer_rollback_failed", {
                    teamId: String(change.team._id),
                    message: rollbackError.message,
                });
            }
        }
        throw err;
    }
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
        const transferIds = [...new Set(toPlayerIdArray(req.body.transferPlayerIds).map(String))];
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
        if (transferIds.some((playerId) => !players.includes(playerId))) {
            if (logoFile) deleteImageFile(logoFile.filename);
            return res.status(400).json({ error: "Invalid player transfer selection." });
        }
        const conflictingTeams = await findRosterConflicts(players, null);
        const conflictingPlayers = playersOnTeams(conflictingTeams, players);
        const conflictingIds = new Set(conflictingPlayers.map((player) => player.id));
        if (conflictingPlayers.some((player) => !transferIds.includes(player.id)) ||
            transferIds.some((playerId) => !conflictingIds.has(playerId))) {
            if (logoFile) deleteImageFile(logoFile.filename);
            const names = conflictingPlayers
                .filter((player) => !transferIds.includes(player.id))
                .map((player) => player.name);
            return res.status(400).json({
                error: names.length ? `Already on another team: ${names.join(", ")}` : "Invalid player transfer selection.",
            });
        }

        const logo = logoFile ? logoFile.path : "/images/placeholder-player.svg";
        const saved = await saveWithPlayerTransfers(conflictingTeams, transferIds, async () => {
            const team = await Team.create({ name, logo, players, captain });
            await team.populate([{ path: "players", select: PLAYER_FIELDS }, { path: "captain", select: PLAYER_FIELDS }]);
            return team;
        });
        if (saved.error) {
            if (logoFile) deleteImageFile(logoFile.filename);
            return res.status(400).json({ error: saved.error });
        }
        res.status(201).json(saved.result);
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
        const transferIds = [...new Set(toPlayerIdArray(req.body.transferPlayerIds).map(String))];

        if (!name) return res.status(400).json({ error: "Team name is required." });
        if (players.length === 0) return res.status(400).json({ error: "Please add at least one player to the team." });
        if (!captain || !players.includes(captain)) {
            return res.status(400).json({ error: "Please select a captain from the team's players." });
        }
        if (transferIds.some((playerId) => !players.includes(playerId))) {
            return res.status(400).json({ error: "Invalid player transfer selection." });
        }
        const conflictingTeams = await findRosterConflicts(players, id);
        const conflictingPlayers = playersOnTeams(conflictingTeams, players);
        const conflictingIds = new Set(conflictingPlayers.map((player) => player.id));
        if (conflictingPlayers.some((player) => !transferIds.includes(player.id)) ||
            transferIds.some((playerId) => !conflictingIds.has(playerId))) {
            const names = conflictingPlayers
                .filter((player) => !transferIds.includes(player.id))
                .map((player) => player.name);
            return res.status(400).json({
                error: names.length ? `Already on another team: ${names.join(", ")}` : "Invalid player transfer selection.",
            });
        }

        const updateData = { name, players, captain };

        let newLogo = null;
        if (req.files?.logo) {
            newLogo = req.files.logo[0].path;
            updateData.logo = newLogo;
        }

        const saved = await saveWithPlayerTransfers(conflictingTeams, transferIds, async () =>
            Team.findByIdAndUpdate(id, updateData, { returnDocument: "after", runValidators: true })
                .populate("players", PLAYER_FIELDS)
                .populate("captain", PLAYER_FIELDS));
        if (saved.error) return res.status(400).json({ error: saved.error });
        const updated = saved.result;

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