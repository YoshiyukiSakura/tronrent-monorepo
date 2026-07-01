"use strict";

const express = require("express");
const providerJobService = require("../services/providerJobService");
const { sendHttpError } = require("../utils/httpErrors");
const { readAdminActor } = require("../utils/manualResolution");

const router = express.Router();

router.get("/review", async (req, res) => {
  try {
    providerJobService.assertProviderJobRouteEnabled(req);
    const result = await providerJobService.listProviderReviewItems({
      staleProvisioningMinutes: req.query.staleProvisioningMinutes,
      limit: req.query.limit,
    });

    res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    sendHttpError(res, error);
  }
});

router.post("/process", async (req, res) => {
  try {
    providerJobService.assertProviderJobRouteEnabled(req);

    if (Array.isArray(req.body.orderIds)) {
      const results = await providerJobService.processOrders(req.body.orderIds);
      return res.status(200).json({
        success: true,
        count: results.length,
        data: results,
      });
    }

    const jobs = await providerJobService.processPendingPaidOrders({
      limit: req.body.limit,
    });

    res.status(200).json({
      success: true,
      count: jobs.length,
      data: jobs,
    });
  } catch (error) {
    sendHttpError(res, error);
  }
});

router.post("/:orderId/resolve", async (req, res) => {
  try {
    providerJobService.assertProviderJobRouteEnabled(req);
    const job = await providerJobService.resolveProviderReview({
      orderId: req.params.orderId,
      resolution: req.body.resolution,
      note: req.body.note,
      upstreamOrderId: req.body.upstreamOrderId,
      resolvedBy: readAdminActor(req),
    });

    res.status(200).json({
      success: true,
      data: job,
    });
  } catch (error) {
    sendHttpError(res, error);
  }
});

module.exports = router;
