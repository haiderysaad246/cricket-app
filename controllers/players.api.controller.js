const Player = require("../models/player.model");
const { deleteImageFile } = require("../utils/fileHelper");

// GET /api/players
exports.list = async (req, res) => {
    try {
        const players = await Player.find({});
        res.json(players);
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Failed to load players." });
    }
};

// GET /api/players/:id
exports.get = async (req, res) => {
    try {
        const player = await Player.findById(req.params.id);
        if (!player) return res.status(404).json({ error: "Player not found" });
        res.json(player);
    } catch (err) {
        console.log(err);
        res.status(500).json({ error: "Failed to load player." });
    }
};

// POST /api/players (admin only, enforced in routes)
exports.create = async (req, res) => {
    try {
        const { name, role, handed } = req.body;

        const image = req.files?.image ? req.files.image[0].path : "/images/placeholder-player.svg";
        const image2 = req.files?.image2 ? req.files.image2[0].path : "/images/placeholder-player.svg";

        const player = await Player.create({ name, role, handed, image, image2 });
        res.status(201).json(player);
    } catch (err) {
        console.log(err);
        if (req.files?.image) deleteImageFile(req.files.image[0].filename);
        if (req.files?.image2) deleteImageFile(req.files.image2[0].filename);
        res.status(400).json({ error: err.message || "Something went wrong while adding the player. Please check all fields and try again." });
    }
};

// POST /api/players/:id/edit (open to anyone, per role rules)
exports.update = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, role, handed } = req.body;

        const existingPlayer = await Player.findById(id);
        if (!existingPlayer) return res.status(404).json({ error: "Player not found" });

        const updateData = { name, role, handed };
        const newImage = req.files?.image ? req.files.image[0].path : null;
        const newImage2 = req.files?.image2 ? req.files.image2[0].path : null;

        const updated = await Player.findByIdAndUpdate(id, { ...updateData, ...(newImage && { image: newImage }), ...(newImage2 && { image2: newImage2 }) }, { new: true, runValidators: true });

        if (newImage && existingPlayer.image && existingPlayer.image !== "/images/placeholder-player.svg") {
            deleteImageFile(existingPlayer.image);
        }
        if (newImage2 && existingPlayer.image2 && existingPlayer.image2 !== "/images/placeholder-player.svg") {
            deleteImageFile(existingPlayer.image2);
        }

        res.json(updated);
    } catch (err) {
        console.log(err);
        res.status(400).json({ error: err.message || "Something went wrong while saving changes. Please check all fields and try again." });
    }
};

// POST /api/players/:id/delete (admin only, enforced in routes)
exports.destroy = async (req, res) => {
    try {
        const { id } = req.params;
        const player = await Player.findById(id);

        if (player) {
            deleteImageFile(player.image);
            deleteImageFile(player.image2);
            await Player.findByIdAndDelete(id);
        }
        res.json({ ok: true });
    } catch (err) {
        console.log(err);
        res.status(400).json({ error: "Delete failed" });
    }
};