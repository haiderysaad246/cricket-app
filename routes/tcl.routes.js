const express = require("express");
const router = express.Router();

const tclController = require("../controllers/tcl.controller");
const { requireAdmin } = require("../middlewares/auth.middleware");

router.get("/", tclController.index);
router.post("/create", requireAdmin, tclController.createTournament);
router.get("/session/:id", tclController.showSession);
router.post("/session/:id/match", requireAdmin, tclController.createMatch);
router.post("/session/:id/delete", requireAdmin, tclController.deleteTournament);

module.exports = router;