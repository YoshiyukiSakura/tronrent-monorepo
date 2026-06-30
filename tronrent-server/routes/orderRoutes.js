"use strict";

const express = require("express");
const orderService = require("../services/orderService");
const { sendHttpError } = require("../utils/httpErrors");

const router = express.Router();

router.post("/", async (req, res) => {
  try {
    const result = await orderService.createOrder(req.body);
    res.status(result.idempotentReplay ? 200 : 201).json({
      success: true,
      idempotentReplay: result.idempotentReplay,
      data: result.order,
    });
  } catch (error) {
    sendHttpError(res, error);
  }
});

router.get("/:id", async (req, res) => {
  try {
    const order = await orderService.getOrderById(req.params.id);
    res.status(200).json({
      success: true,
      data: order,
    });
  } catch (error) {
    sendHttpError(res, error);
  }
});

router.post("/:id/dev-confirm-payment", async (req, res) => {
  try {
    const order = await orderService.confirmPaymentForDev(
      req.params.id,
      req.body
    );
    res.status(200).json({
      success: true,
      data: order,
    });
  } catch (error) {
    sendHttpError(res, error);
  }
});

module.exports = router;
