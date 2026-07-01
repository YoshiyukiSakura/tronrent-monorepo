"use strict";

const express = require("express");
const exchangeOrderService = require("../services/exchangeOrderService");
const exchangePayoutJobService = require("../services/exchangePayoutJobService");
const exchangeQuoteService = require("../services/exchangeQuoteService");
const { createHttpError, sendHttpError } = require("../utils/httpErrors");
const { readAdminActor } = require("../utils/manualResolution");

const router = express.Router();

router.post("/quotes", async (req, res) => {
  try {
    const quote = await exchangeQuoteService.createExchangeQuote(req.body);
    res.status(201).json({
      success: true,
      data: quote,
    });
  } catch (error) {
    sendHttpError(res, error);
  }
});

router.post("/orders", async (req, res) => {
  try {
    const result = await exchangeOrderService.createExchangeOrder(req.body);
    res.status(result.idempotentReplay ? 200 : 201).json({
      success: true,
      idempotentReplay: result.idempotentReplay,
      data: result.order,
    });
  } catch (error) {
    sendHttpError(res, error);
  }
});

router.get("/orders/:id", async (req, res) => {
  try {
    const order = await exchangeOrderService.getExchangeOrderById(req.params.id);
    res.status(200).json({
      success: true,
      data: order,
    });
  } catch (error) {
    sendHttpError(res, error);
  }
});

router.get("/payout-jobs/review", async (req, res) => {
  try {
    exchangePayoutJobService.assertExchangePayoutRouteEnabled(req);
    const result = await exchangePayoutJobService.listPayoutReviewItems({
      staleProcessingMinutes: req.query.staleProcessingMinutes,
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

router.post("/payout-jobs/process", async (req, res) => {
  try {
    exchangePayoutJobService.assertExchangePayoutRouteEnabled(req);
    const body = req.body || {};
    const hasExchangeOrderIds = Object.prototype.hasOwnProperty.call(
      body,
      "exchangeOrderIds"
    );
    let results;
    if (hasExchangeOrderIds) {
      if (!Array.isArray(body.exchangeOrderIds)) {
        throw createHttpError(400, "exchangeOrderIds must be an array");
      }
      results = await exchangePayoutJobService.processExchangeOrders(
        body.exchangeOrderIds
      );
    } else {
      const limit = Number.parseInt(body.limit || "10", 10);
      results = await exchangePayoutJobService.processPendingExchangePayouts({
        limit: Number.isFinite(limit) ? limit : 10,
      });
    }

    res.status(200).json({
      success: true,
      count: results.length,
      data: results,
    });
  } catch (error) {
    sendHttpError(res, error);
  }
});

router.post("/payout-jobs/:exchangeOrderId/resolve", async (req, res) => {
  try {
    exchangePayoutJobService.assertExchangePayoutRouteEnabled(req);
    const job = await exchangePayoutJobService.resolvePayoutReview({
      exchangeOrderId: req.params.exchangeOrderId,
      resolution: req.body.resolution,
      note: req.body.note,
      txid: req.body.txid,
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
