const express = require("express");
const router = express.Router();

const playerController = require("../controllers/player.controller");
const handlePlayerUpload = require("../middlewares/upload.middleware");
const { requireAdmin } = require("../middlewares/auth.middleware");

router.get("/", playerController.index);
router.get("/new", requireAdmin, playerController.newForm);
router.post("/", requireAdmin, handlePlayerUpload, playerController.create);
router.get("/:id/profile", playerController.profile);
router.get("/:id/edit", playerController.editForm); // anyone can edit a profile (name, image, etc.)
router.post("/:id/edit", handlePlayerUpload, playerController.update);
router.post("/:id/delete", requireAdmin, playerController.destroy);

module.exports = router;