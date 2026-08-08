const express = require("express");
const router = express.Router();

const teamsApi = require("../controllers/teams.api.controller");
const handleTeamLogoUpload = require("../middlewares/team-upload.middleware");
const { requireAdmin } = require("../middlewares/auth.middleware");

router.get("/", teamsApi.list);
router.get("/:id", teamsApi.get);
router.post("/", requireAdmin, handleTeamLogoUpload, teamsApi.create);
router.post("/:id/edit", requireAdmin, handleTeamLogoUpload, teamsApi.update);
router.post("/:id/delete", requireAdmin, teamsApi.destroy);

module.exports = router;