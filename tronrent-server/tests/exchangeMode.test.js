"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const db = require("../db/models");
const exchangeOrderService = require("../services/exchangeOrderService");
const exchangeQuoteService = require("../services/exchangeQuoteService");
const orderService = require("../services/orderService");

const ORIGINALS = {
  exchangeQuoteCreate: db.ExchangeQuote.create,
};

function restoreState() {
  db.ExchangeQuote.create = ORIGINALS.exchangeQuoteCreate;
  delete process.env.EXCHANGE_PAYOUT_LIVE;
  delete process.env.PROVIDER_LIVE;
}

function buildExchangeOrder(overrides = {}) {
  return {
    id: "exchange-order-mode",
    direction: "TRX_TO_USDT",
    status: exchangeOrderService.EXCHANGE_ORDER_STATUSES.PENDING_DEPOSIT,
    expectedInputBaseUnits: "100000000",
    baseInputBaseUnits: "100000000",
    outputBaseUnits: "11880000",
    inputAsset: "TRX",
    outputAsset: "USDT",
    inputContractAddress: null,
    outputContractAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    inputDecimals: 6,
    outputDecimals: 6,
    inputOffsetBaseUnits: 0,
    quoteInputAmount: "100.000000",
    quoteOutputAmount: "11.880000",
    treasuryAddress: "TAivugS6Zn2EK9RAKeiSQbshkZQAX4fZaA",
    depositReference: "EX-test",
    payoutJobs: [],
    get() {
      return { ...this };
    },
    ...overrides,
  };
}

test.afterEach(() => {
  restoreState();
});

test("exchange quote executionEnabled follows live payout gate", async () => {
  db.ExchangeQuote.create = async (payload) => payload;

  const dryRunQuote = await exchangeQuoteService.createExchangeQuote({
    direction: "TRX_TO_USDT",
    inputAmount: "100",
  });
  assert.equal(dryRunQuote.metadata.executionEnabled, false);

  process.env.EXCHANGE_PAYOUT_LIVE = "true";
  const liveQuote = await exchangeQuoteService.createExchangeQuote({
    direction: "TRX_TO_USDT",
    inputAmount: "100",
  });
  assert.equal(liveQuote.metadata.executionEnabled, true);
});

test("exchange order deposit warnings describe payout execution gate", () => {
  const dryRunOrder = exchangeOrderService.serializeExchangeOrder(
    buildExchangeOrder()
  );
  assert.equal(dryRunOrder.depositInstructions.executionMode.payoutLive, false);
  assert.match(
    dryRunOrder.depositInstructions.warnings[0],
    /后台出款未启用/
  );

  process.env.EXCHANGE_PAYOUT_LIVE = "true";
  const liveOrder = exchangeOrderService.serializeExchangeOrder(
    buildExchangeOrder()
  );
  assert.equal(liveOrder.depositInstructions.executionMode.payoutLive, true);
  assert.match(liveOrder.depositInstructions.warnings[0], /自动执行兑换出款/);
});

test("energy payment instructions expose provider execution gate", () => {
  const baseOrder = {
    paymentMethod: "deposit_address",
    paymentAsset: "TRX",
    priceAmountSun: "10000000",
    priceOffsetSun: 0,
    depositAddress: "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
    treasuryAddress: "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
    paymentReference: "TR-test",
  };

  assert.equal(
    orderService.buildPaymentInstructions(baseOrder).executionMode.providerLive,
    false
  );

  process.env.PROVIDER_LIVE = "true";
  assert.equal(
    orderService.buildPaymentInstructions(baseOrder).executionMode.providerLive,
    true
  );
});
