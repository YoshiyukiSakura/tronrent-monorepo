"use strict";

const express = require("express");
const depositWatcherService = require("../services/depositWatcherService");
const { sendHttpError } = require("../utils/httpErrors");

const router = express.Router();

router.post("/scan", async (req, res) => {
  try {
    depositWatcherService.assertDepositScanRouteEnabled(req);
    const result = await depositWatcherService.scanConfiguredTreasury({
      limit: req.body.limit,
      minTimestamp: req.body.minTimestamp,
      maxPages: req.body.maxPages,
      processProviderJobs: req.body.processProviderJobs === true,
      processExchangePayouts: req.body.processExchangePayouts === true,
    });

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    sendHttpError(res, error);
  }
});

router.get("/", async (req, res) => {
  try {
    depositWatcherService.assertDepositScanRouteEnabled(req);
    const limit = Number.parseInt(req.query.limit || "50", 10);
    const deposits = await depositWatcherService.listDeposits({
      limit: Number.isFinite(limit) ? limit : 50,
      status: req.query.status,
    });

    res.status(200).json({
      success: true,
      count: deposits.length,
      data: deposits,
    });
  } catch (error) {
    sendHttpError(res, error);
  }
});

module.exports = router;
