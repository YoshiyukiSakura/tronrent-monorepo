"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const HAS_TEST_DATABASE = Boolean(process.env.TEST_DATABASE_URL);

function assertSafeTestDatabaseUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (error) {
    throw new Error(`TEST_DATABASE_URL must be a valid URL: ${error.message}`);
  }

  const databaseName = parsed.pathname.replace(/^\//, "");
  if (!/(^|[_-])(test|e2e|ci)([_-]|$)/i.test(databaseName)) {
    throw new Error(
      `Refusing to reset non-test database "${databaseName}". Use a TEST_DATABASE_URL database name with test, e2e, or ci as a separated token.`
    );
  }
}

function fixtureAddress(seed) {
  return `T${String(seed).repeat(33)}`;
}

function buildTrxDeposit({ txHash, fromAddress, toAddress, amountBaseUnits }) {
  return {
    network: "tron",
    asset: "TRX",
    txHash,
    eventIndex: "0",
    contractAddress: null,
    tokenDecimals: 6,
    tokenSymbol: "TRX",
    fromAddress,
    toAddress,
    amountBaseUnits: String(amountBaseUnits),
    blockNumber: 50_001,
    blockTimestamp: new Date("2026-07-01T00:01:00.000Z"),
    confirmations: 32,
    raw: { fixture: true, txHash },
  };
}

function buildTrc20Deposit({
  txHash,
  fromAddress,
  toAddress,
  amountBaseUnits,
  contractAddress,
}) {
  return {
    network: "tron",
    asset: "TRC20",
    txHash,
    eventIndex: "0",
    contractAddress,
    tokenDecimals: 6,
    tokenSymbol: "USDT",
    fromAddress,
    toAddress,
    amountBaseUnits: String(amountBaseUnits),
    blockNumber: 50_002,
    blockTimestamp: new Date("2026-07-01T00:02:00.000Z"),
    confirmations: 32,
    raw: { fixture: true, txHash },
  };
}

test(
  "dry-run deposit scan drives real energy fulfillment and exchange payouts",
  {
    skip: HAS_TEST_DATABASE
      ? false
      : "TEST_DATABASE_URL is required for the Postgres-backed dry-run E2E",
  },
  async (t) => {
    process.env.NODE_ENV = "test";
    assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL);

    const ORIGINAL_ENV = { ...process.env };
    const ORIGINAL_DATE = Date;
    const FIXED_NOW = Date.now();

    global.Date = class FixedDate extends ORIGINAL_DATE {
      constructor(...args) {
        if (args.length === 0) {
          super(FIXED_NOW);
          return;
        }
        super(...args);
      }

      static now() {
        return FIXED_NOW;
      }

      static parse(value) {
        return ORIGINAL_DATE.parse(value);
      }

      static UTC(...args) {
        return ORIGINAL_DATE.UTC(...args);
      }
    };
    process.env = {
      ...process.env,
      NODE_ENV: "test",
      TREASURY_TRON_ADDRESS: fixtureAddress(1),
      EXCHANGE_TREASURY_TRON_ADDRESS: fixtureAddress(2),
      TRON_TRC20_ALLOWLIST:
        "USDT:TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t:6",
      MAX_PAYMENT_OFFSET_SUN: "0",
      ORDER_CREATE_MAX_ATTEMPTS: "1",
      EXCHANGE_MAX_PAYMENT_OFFSET_BASE_UNITS: "0",
      EXCHANGE_ORDER_CREATE_MAX_ATTEMPTS: "1",
      EXCHANGE_SPREAD_BPS: "0",
      EXCHANGE_TRX_USDT_RATE: "0.1",
      PROVIDER_LIVE: "false",
      ENERGY_PROVIDER: "apitrx",
      EXCHANGE_PAYOUT_LIVE: "false",
      DEPOSIT_SCAN_LOOKBACK_MINUTES: "60",
      DEPOSIT_SCAN_MAX_PAGES: "2",
    };

    const db = require("../db/models");
    const orderService = require("../services/orderService");
    const exchangeQuoteService = require("../services/exchangeQuoteService");
    const exchangeOrderService = require("../services/exchangeOrderService");
    const depositWatcherService = require("../services/depositWatcherService");
    const tronGridClient = require("../services/tronGridClient");
    const {
      ORDER_STATUSES,
      PAYMENT_STATUSES,
      PROVIDER_JOB_STATUSES,
    } = require("../services/orderState");
    const {
      EXCHANGE_ORDER_STATUSES,
      EXCHANGE_PAYOUT_STATUSES,
    } = exchangeOrderService;

    const ORIGINAL_TRONGRID = {
      fetchInboundTrxTransfers: tronGridClient.fetchInboundTrxTransfers,
      fetchInboundTrc20Transfers: tronGridClient.fetchInboundTrc20Transfers,
    };

    t.after(async () => {
      tronGridClient.fetchInboundTrxTransfers =
        ORIGINAL_TRONGRID.fetchInboundTrxTransfers;
      tronGridClient.fetchInboundTrc20Transfers =
        ORIGINAL_TRONGRID.fetchInboundTrc20Transfers;
      global.Date = ORIGINAL_DATE;
      process.env = ORIGINAL_ENV;
      await db.sequelize.close();
    });

    await db.sequelize.sync({ force: true });

    const energyOrderResult = await orderService.createOrder({
      idempotencyKey: "e2e-energy-order",
      planId: "basic",
      targetAddress: fixtureAddress(3),
      customerWalletAddress: fixtureAddress(4),
      paymentMethod: "wallet_connect",
    });
    const energyOrder = energyOrderResult.order;

    const trxQuote = await exchangeQuoteService.createExchangeQuote({
      direction: exchangeQuoteService.DIRECTIONS.TRX_TO_USDT,
      inputAmount: "10",
    });
    const trxExchangeOrderResult =
      await exchangeOrderService.createExchangeOrder({
        idempotencyKey: "e2e-trx-to-usdt",
        quoteId: trxQuote.id,
        outputAddress: fixtureAddress(5),
        customerWalletAddress: fixtureAddress(6),
      });
    const trxExchangeOrder = trxExchangeOrderResult.order;

    const usdtQuote = await exchangeQuoteService.createExchangeQuote({
      direction: exchangeQuoteService.DIRECTIONS.USDT_TO_TRX,
      inputAmount: "2.5",
    });
    const usdtExchangeOrderResult =
      await exchangeOrderService.createExchangeOrder({
        idempotencyKey: "e2e-usdt-to-trx",
        quoteId: usdtQuote.id,
        outputAddress: fixtureAddress(7),
        customerWalletAddress: fixtureAddress(8),
      });
    const usdtExchangeOrder = usdtExchangeOrderResult.order;

    const treasuryAddress = process.env.TREASURY_TRON_ADDRESS;
    const exchangeTreasuryAddress = process.env.EXCHANGE_TREASURY_TRON_ADDRESS;
    const usdtContractAddress = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

    const trxDepositsByAddress = new Map([
      [
        treasuryAddress,
        [
          buildTrxDeposit({
            txHash: "e2e-energy-payment",
            fromAddress: fixtureAddress(4),
            toAddress: treasuryAddress,
            amountBaseUnits: energyOrder.priceAmountSun,
          }),
        ],
      ],
      [
        exchangeTreasuryAddress,
        [
          buildTrxDeposit({
            txHash: "e2e-exchange-trx-payment",
            fromAddress: fixtureAddress(6),
            toAddress: exchangeTreasuryAddress,
            amountBaseUnits: trxExchangeOrder.expectedInputBaseUnits,
          }),
        ],
      ],
    ]);
    const trc20DepositsByAddress = new Map([
      [
        exchangeTreasuryAddress,
        [
          buildTrc20Deposit({
            txHash: "e2e-exchange-usdt-payment",
            fromAddress: fixtureAddress(8),
            toAddress: exchangeTreasuryAddress,
            amountBaseUnits: usdtExchangeOrder.expectedInputBaseUnits,
            contractAddress: usdtContractAddress,
          }),
        ],
      ],
    ]);

    tronGridClient.fetchInboundTrxTransfers = async (address) => ({
      fingerprint: null,
      deposits: trxDepositsByAddress.get(address) || [],
    });
    tronGridClient.fetchInboundTrc20Transfers = async (address) => ({
      fingerprint: null,
      deposits: trc20DepositsByAddress.get(address) || [],
    });

    const scanResult = await depositWatcherService.scanConfiguredTreasury({
      limit: 10,
      minTimestamp: FIXED_NOW - 60_000,
      maxPages: 2,
      processProviderJobs: true,
      processExchangePayouts: true,
    });

    assert.equal(scanResult.scanned, 3);
    assert.equal(scanResult.created, 3);
    assert.equal(scanResult.matched, 3);
    assert.equal(scanResult.truncated, false);
    assert.equal(scanResult.postMatchProcessing.provider.triggered, true);
    assert.equal(scanResult.postMatchProcessing.provider.attempted, 1);
    assert.equal(scanResult.postMatchProcessing.provider.succeeded, true);
    assert.equal(scanResult.postMatchProcessing.exchangePayout.triggered, true);
    assert.equal(scanResult.postMatchProcessing.exchangePayout.attempted, 2);
    assert.equal(scanResult.postMatchProcessing.exchangePayout.succeeded, true);
    assert.equal(scanResult.providerResults.length, 1);
    assert.equal(scanResult.providerResults[0].success, true);
    assert.equal(scanResult.exchangePayoutResults.length, 2);
    assert.deepEqual(
      scanResult.exchangePayoutResults.map((result) => result.success),
      [true, true]
    );

    const persistedEnergyOrder = await db.Order.findByPk(energyOrder.id);
    const persistedEnergyPayment = await db.Payment.findOne({
      where: { orderId: energyOrder.id },
    });
    const providerJob = await db.ProviderJob.findOne({
      where: { orderId: energyOrder.id },
    });

    assert.equal(persistedEnergyOrder.status, ORDER_STATUSES.FULFILLED);
    assert.equal(persistedEnergyPayment.status, PAYMENT_STATUSES.CONFIRMED);
    assert.equal(String(persistedEnergyPayment.receivedAmountSun), energyOrder.priceAmountSun);
    assert.equal(providerJob.status, PROVIDER_JOB_STATUSES.COMPLETED);
    assert.equal(providerJob.dryRun, true);
    assert.equal(providerJob.response.dryRun, true);
    assert.equal(providerJob.response.upstreamOrderId, `dry-run-${energyOrder.id}`);

    for (const exchangeOrder of [trxExchangeOrder, usdtExchangeOrder]) {
      const persistedExchangeOrder = await db.ExchangeOrder.findByPk(
        exchangeOrder.id
      );
      const payoutJob = await db.ExchangePayoutJob.findOne({
        where: { exchangeOrderId: exchangeOrder.id },
      });
      const deposit = await db.ChainDeposit.findOne({
        where: { matchedExchangeOrderId: exchangeOrder.id },
      });

      assert.equal(
        persistedExchangeOrder.status,
        EXCHANGE_ORDER_STATUSES.PAYOUT_COMPLETED
      );
      assert.equal(payoutJob.status, EXCHANGE_PAYOUT_STATUSES.COMPLETED);
      assert.equal(payoutJob.dryRun, true);
      assert.equal(payoutJob.response.dryRun, true);
      assert.equal(
        payoutJob.response.completionMeaning,
        "dry_run_no_transfer_broadcast"
      );
      assert.equal(deposit.status, "matched");
      assert.equal(deposit.matchedExchangePayoutJobId, payoutJob.id);
    }

    const matchedEnergyDeposit = await db.ChainDeposit.findOne({
      where: { matchedOrderId: energyOrder.id },
    });
    assert.equal(matchedEnergyDeposit.status, "matched");
    assert.equal(matchedEnergyDeposit.matchedPaymentId, persistedEnergyPayment.id);
  }
);
