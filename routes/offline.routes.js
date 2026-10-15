const express = require("express");
const router = express.Router();
const offlineController = require("../controllers/offline.controller");
const { requireAdmin } = require("../middlewares/auth.middleware");

router.get("/snapshot", requireAdmin, offlineController.snapshot);

module.exports = router;
