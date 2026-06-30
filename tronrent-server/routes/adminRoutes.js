"use strict";

const express = require("express");
const readinessService = require("../services/readinessService");
const { sendHttpError } = require("../utils/httpErrors");

const router = express.Router();

router.get("/readiness", (req, res) => {
  try {
    readinessService.assertReadinessRouteEnabled(req);
    res.status(200).json({
      success: true,
      data: readinessService.buildReadinessReport(),
    });
  } catch (error) {
    sendHttpError(res, error);
  }
});

module.exports = router;
