const express = require("express");
const router = express.Router();

const mobileController = require("../controllers/mobile.controller");
const turfController = require("../controllers/turf.controller");
const tclController = require("../controllers/tcl.controller");
const { requireAdmin } = require("../middlewares/auth.middleware");

router.post("/login", mobileController.login);
router.get("/matches", requireAdmin, mobileController.listLiveMatches);
router.get("/catalog", requireAdmin, mobileController.getOfflineCatalog);
router.post("/matches/turf", requireAdmin, turfController.startLive);
router.post("/tournaments/:id/matches", requireAdmin, tclController.createMatch);
router.get("/matches/:id", requireAdmin, mobileController.getLiveMatch);
router.post("/matches/:id/setup", requireAdmin, turfController.setupInnings);
router.post("/matches/:id/ball", requireAdmin, turfController.recordBall);
router.post("/matches/:id/end", requireAdmin, turfController.endMatch);

module.exports = router;
