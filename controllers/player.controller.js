const Player = require("../models/player.model");
const { deleteImageFile } = require("../utils/fileHelper");

const BATTING_FIELDS = ["runs", "matches", "innings", "average", "strikeRate", "highest", "ducks", "ballsFaced", "dots", "fours", "sixes"];
const BOWLING_FIELDS = ["wickets", "innings", "overs", "ballsBowled", "runsConceded", "dots", "dotBallPercentage", "noBallRuns", "wideRuns", "average", "economyRate", "strikeRate"];

// Turns a raw { batting: {...}, bowling: {...} } chunk of req.body into a
// clean stat block, coercing every value to a number (defaulting to 0).
function parseStatBlock(rawBlock = {}) {
    const toNum = (v) => {
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : 0;
    };

    const batting = {};
    BATTING_FIELDS.forEach((f) => { batting[f] = toNum(rawBlock.batting && rawBlock.batting[f]); });

    const bowling = {};
    BOWLING_FIELDS.forEach((f) => { bowling[f] = toNum(rawBlock.bowling && rawBlock.bowling[f]); });

    return { batting, bowling };
}

// GET /players
exports.index = async (req, res) => {
    const allplayer = await Player.find({});
    res.render("players/index.ejs", { allplayer });
};

// GET /players/new
exports.newForm = (req, res) => {
    res.render("players/new.ejs", { error: null, formData: {} });
};

// POST /players
exports.create = async (req, res) => {
    try {
        const { name, role, handed } = req.body;

        // Images are optional — fall back to the placeholder when not uploaded.
        const image = req.files?.image ? req.files.image[0].path : "/images/placeholder-player.svg";
        const image2 = req.files?.image2 ? req.files.image2[0].path : "/images/placeholder-player.svg";

        await Player.create({ name, role, handed, image, image2 });
        res.redirect("/players");
    } catch (err) {
        console.log(err);
        res.status(400).render("players/new.ejs", {
            error: "Something went wrong while adding the player. Please check all fields and try again.",
            formData: req.body
        });
    }
};

// GET /players/:id/profile
exports.profile = async (req, res) => {
    const player = await Player.findById(req.params.id);
    if (!player) return res.redirect("/players");
    res.render("players/profile.ejs", { player });
};

// GET /players/:id/edit
exports.editForm = async (req, res) => {
    const player = await Player.findById(req.params.id);
    res.render("players/edit.ejs", { player, error: null });
};



// POST /players/:id/edit
exports.update = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, role, handed } = req.body;

        const existingPlayer = await Player.findById(id);
        const updateData = { name, role, handed };

        const newImage = req.files?.image ? req.files.image[0].path : null;
        const newImage2 = req.files?.image2 ? req.files.image2[0].path : null;
        if (newImage) updateData.image = newImage;
        if (newImage2) updateData.image2 = newImage2;

        await Player.findByIdAndUpdate(id, updateData, { runValidators: true });

        if (newImage && existingPlayer.image && existingPlayer.image !== "/images/placeholder-player.svg") {
            deleteImageFile(existingPlayer.image);
        }
        if (newImage2 && existingPlayer.image2 && existingPlayer.image2 !== "/images/placeholder-player.svg") {
            deleteImageFile(existingPlayer.image2);
        }

        res.redirect("/players");
    } catch (err) {
        console.log(err);
        const player = await Player.findById(req.params.id);
        res.status(400).render("players/edit.ejs", {
            player,
            error: "Something went wrong while saving changes. Please check all fields and try again."
        });
    }
};




// POST /players/:id/delete
exports.destroy = async (req, res) => {
    try {
        const { id } = req.params;
        const player = await Player.findById(id);

        if (player) {
            deleteImageFile(player.image);
            deleteImageFile(player.image2);
        }

        await Player.findByIdAndDelete(id);
        res.redirect("/players");
    } catch (err) {
        console.log(err);
        res.redirect("/players?error=delete_failed");
    }
};