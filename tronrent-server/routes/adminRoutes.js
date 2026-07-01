"use strict";

const express = require("express");
const automationBacklogService = require("../services/automationBacklogService");
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

router.get("/automation/backlog", async (req, res) => {
  try {
    automationBacklogService.assertAutomationBacklogRouteEnabled(req);
    const data = await automationBacklogService.buildAutomationBacklogSnapshot({
      staleMinutes: req.query.staleMinutes,
    });
    res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    sendHttpError(res, error);
  }
});

module.exports = router;
