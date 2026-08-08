const express = require("express");
const router = express.Router();

const turfController = require("../controllers/turf.controller");
const { requireAdmin } = require("../middlewares/auth.middleware");

router.get("/", turfController.index);
router.post("/create", requireAdmin, turfController.createTurf);
router.post("/", requireAdmin, turfController.startLive);
router.get("/session/:id", turfController.showTurfSession);
router.post("/session/:id/end", requireAdmin, turfController.endTurf);
router.post("/session/:id/settings", requireAdmin, turfController.updateTurfSettings);
router.get("/live/:id", turfController.showLive);
router.get("/live/:id/score", requireAdmin, turfController.showScorePad);
router.post("/live/:id/end", requireAdmin, turfController.endMatch);
router.post("/live/:id/cancel", requireAdmin, turfController.cancelMatch);
router.patch("/live/:id", requireAdmin, turfController.updateLive);
router.post("/live/:id/setup", requireAdmin, turfController.setupInnings);
router.post("/live/:id/switch-innings", requireAdmin, turfController.switchInnings);
router.post("/live/:id/undo", requireAdmin, turfController.undoLastBall);
router.post("/live/:id/ball", requireAdmin, turfController.recordBall);
router.post("/live/:id/end-innings", requireAdmin, turfController.endInnings);


module.exports = router;