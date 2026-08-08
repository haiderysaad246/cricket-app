const express = require('express');
const router = express.Router();
const pointsController = require('../controllers/points.controller');

router.get('/', pointsController.index);

module.exports = router;
