const express = require("express");
const router = express.Router();

const mobileController = require("../controllers/mobile.controller");
const turfController = require("../controllers/turf.controller");
const { requireAdmin } = require("../middlewares/auth.middleware");

router.post("/login", mobileController.login);
router.get("/matches", requireAdmin, mobileController.listLiveMatches);
router.get("/matches/:id", requireAdmin, mobileController.getLiveMatch);
router.post("/matches/:id/setup", requireAdmin, turfController.setupInnings);
router.post("/matches/:id/ball", requireAdmin, turfController.recordBall);

module.exports = router;
