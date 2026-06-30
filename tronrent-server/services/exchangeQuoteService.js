"use strict";

const { ExchangeQuote } = require("../db/models");
const { createHttpError } = require("../utils/httpErrors");

const DIRECTIONS = Object.freeze({
  TRX_TO_USDT: "TRX_TO_USDT",
  USDT_TO_TRX: "USDT_TO_TRX",
});

function getSpreadBps() {
  const parsed = Number.parseInt(process.env.EXCHANGE_SPREAD_BPS || "100", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 100;
}

function getStaticRate() {
  const parsed = Number.parseFloat(process.env.EXCHANGE_TRX_USDT_RATE || "0.12");
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0.12;
}

function calculateQuote(direction, inputAmount) {
  const amount = Number.parseFloat(inputAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw createHttpError(400, "inputAmount must be a positive number");
  }

  const spreadBps = getSpreadBps();
  const rate = getStaticRate();
  const multiplier = Math.max(0, 1 - spreadBps / 10_000);

  if (direction === DIRECTIONS.TRX_TO_USDT) {
    return {
      inputAsset: "TRX",
      outputAsset: "USDT",
      outputAmount: amount * rate * multiplier,
      spreadBps,
      rate,
    };
  }

  if (direction === DIRECTIONS.USDT_TO_TRX) {
    return {
      inputAsset: "USDT",
      outputAsset: "TRX",
      outputAmount: (amount / rate) * multiplier,
      spreadBps,
      rate,
    };
  }

  throw createHttpError(400, "Unsupported quote direction");
}

async function createExchangeQuote(payload) {
  const quote = calculateQuote(payload.direction, payload.inputAmount);
  const expiresAt = new Date(Date.now() + 60 * 1000);

  const created = await ExchangeQuote.create({
    direction: payload.direction,
    inputAsset: quote.inputAsset,
    outputAsset: quote.outputAsset,
    inputAmount: Number.parseFloat(payload.inputAmount).toFixed(6),
    outputAmount: quote.outputAmount.toFixed(6),
    spreadBps: quote.spreadBps,
    status: "quote_only",
    expiresAt,
    metadata: {
      source: process.env.EXCHANGE_TRX_USDT_RATE
        ? "env-static-rate"
        : "dev-static-rate",
      rate: quote.rate,
      executionEnabled: false,
    },
  });

  return created;
}

module.exports = {
  DIRECTIONS,
  calculateQuote,
  createExchangeQuote,
};
