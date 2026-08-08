const express = require("express");
const router = express.Router();

const playersApi = require("../controllers/players.api.controller");
const handlePlayerUpload = require("../middlewares/upload.middleware");
const { requireAdmin } = require("../middlewares/auth.middleware");

router.get("/", playersApi.list);
router.get("/:id", playersApi.get);
router.post("/", requireAdmin, handlePlayerUpload, playersApi.create);
router.post("/:id/edit", handlePlayerUpload, playersApi.update); // anyone can edit a profile
router.post("/:id/delete", requireAdmin, playersApi.destroy);

module.exports = router;
