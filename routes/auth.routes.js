const express = require("express");
const router = express.Router();
const authController = require("../controllers/auth.controller");

router.get("/status", authController.status);
router.post("/login", authController.login);
router.post("/logout", authController.logout);

module.exports = router;
