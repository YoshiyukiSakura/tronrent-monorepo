"use strict";

const http = require("node:http");
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const db = require("../db/models");
const exchangeRoutes = require("../routes/exchangeRoutes");
const payoutClient = require("../services/exchangePayoutClient");
const payoutJobService = require("../services/exchangePayoutJobService");
const {
  EXCHANGE_ORDER_STATUSES,
  EXCHANGE_PAYOUT_STATUSES,
} = require("../services/exchangeOrderService");

const ORIGINAL_ENV = { ...process.env };
const ORIGINALS = {
  chainDepositUpdate: db.ChainDeposit.update,
  exchangeOrderFindAll: db.ExchangeOrder.findAll,
  exchangeOrderFindByPk: db.ExchangeOrder.findByPk,
  payoutJobCreate: db.ExchangePayoutJob.create,
  payoutJobFindByPk: db.ExchangePayoutJob.findByPk,
  payoutJobFindOne: db.ExchangePayoutJob.findOne,
  processExchangeOrders: payoutJobService.processExchangeOrders,
  processPendingExchangePayouts: payoutJobService.processPendingExchangePayouts,
  transaction: db.sequelize.transaction,
};

function restoreState() {
  process.env = { ...ORIGINAL_ENV };
  payoutClient.resetPayoutAdapterForTesting();
  db.ChainDeposit.update = ORIGINALS.chainDepositUpdate;
  db.ExchangeOrder.findAll = ORIGINALS.exchangeOrderFindAll;
  db.ExchangeOrder.findByPk = ORIGINALS.exchangeOrderFindByPk;
  db.ExchangePayoutJob.create = ORIGINALS.payoutJobCreate;
  db.ExchangePayoutJob.findByPk = ORIGINALS.payoutJobFindByPk;
  db.ExchangePayoutJob.findOne = ORIGINALS.payoutJobFindOne;
  payoutJobService.processExchangeOrders = ORIGINALS.processExchangeOrders;
  payoutJobService.processPendingExchangePayouts =
    ORIGINALS.processPendingExchangePayouts;
  db.sequelize.transaction = ORIGINALS.transaction;
}

function requestJson(app, { method, path, body, headers = {} }) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      const payload = body === undefined ? "" : JSON.stringify(body);
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          method,
          path,
          headers: {
            "content-type": "application/json",
            "content-length": Buffer.byteLength(payload),
            ...headers,
          },
        },
        (res) => {
          let responseBody = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            responseBody += chunk;
          });
          res.on("end", () => {
            server.close(() => {
              resolve({
                statusCode: res.statusCode,
                body: responseBody ? JSON.parse(responseBody) : null,
              });
            });
          });
        }
      );
      req.on("error", (error) => {
        server.close(() => reject(error));
      });
      req.end(payload);
    });
  });
}

function makeExchangeRouteApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/exchange", exchangeRoutes);
  return app;
}

function buildMutableExchangeOrder(overrides = {}) {
  const data = {
    id: "exchange-order-live",
    status: EXCHANGE_ORDER_STATUSES.FUNDS_RECEIVED,
    outputAsset: "TRX",
    outputContractAddress: null,
    outputAddress: "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
    outputBaseUnits: "1234567",
    ...overrides,
  };

  return {
    ...data,
    updates: [],
    get() {
      return { ...data };
    },
    async update(patch) {
      Object.assign(data, patch);
      Object.assign(this, patch);
      this.updates.push(patch);
      return this;
    },
  };
}

function buildMutablePayoutJob(overrides = {}) {
  return {
    id: overrides.id || "exchange-payout-job-live",
    status: overrides.status || EXCHANGE_PAYOUT_STATUSES.PROCESSING,
    response: overrides.response || null,
    lastError: overrides.lastError || null,
    updates: [],
    get() {
      return { ...this };
    },
    async update(patch) {
      Object.assign(this, patch);
      this.updates.push(patch);
      return this;
    },
  };
}

function buildReviewOrder(overrides = {}) {
  const data = {
    id: overrides.id || "exchange-order-review",
    direction: overrides.direction || "TRX_TO_USDT",
    status: overrides.status || EXCHANGE_ORDER_STATUSES.PAYOUT_INDETERMINATE,
    outputAsset: overrides.outputAsset || "USDT",
    outputAddress:
      overrides.outputAddress || "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
    outputContractAddress: overrides.outputContractAddress || null,
    outputBaseUnits: overrides.outputBaseUnits || "1234567",
    fundsReceivedAt:
      overrides.fundsReceivedAt || new Date("2026-07-01T00:00:00.000Z"),
    payoutCompletedAt: overrides.payoutCompletedAt || null,
    updatedAt: overrides.updatedAt || new Date("2026-07-01T00:01:00.000Z"),
    payoutJobs: overrides.payoutJobs || [],
  };

  return {
    ...data,
    get() {
      return { ...data };
    },
  };
}

function buildReviewJob(overrides = {}) {
  return {
    id: overrides.id || "payout-job-review",
    status: overrides.status || EXCHANGE_PAYOUT_STATUSES.INDETERMINATE,
    dryRun: overrides.dryRun ?? false,
    asset: overrides.asset || "USDT",
    contractAddress: overrides.contractAddress || null,
    toAddress:
      overrides.toAddress || "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
    amountBaseUnits: overrides.amountBaseUnits || "1234567",
    attemptCount: overrides.attemptCount || 1,
    lastError: overrides.lastError || "broadcast indeterminate",
    processedAt: overrides.processedAt || new Date("2026-07-01T00:02:00.000Z"),
    updatedAt: overrides.updatedAt || new Date("2026-07-01T00:02:00.000Z"),
    response:
      overrides.response || {
        indeterminate: true,
        broadcastResponse: {
          txid: "tx-review-123",
          transfer: "visible reconciliation payload",
        },
      },
  };
}

function enableLiveEnv() {
  process.env.EXCHANGE_PAYOUT_LIVE = "true";
  process.env.EXCHANGE_PAYOUT_PRIVATE_KEY = "service-private-key";
  process.env.EXCHANGE_PAYOUT_FROM_ADDRESS =
    "TAivugS6Zn2EK9RAKeiSQbshkZQAX4fZaA";
  process.env.TRONGRID_API_BASE_URL = "https://api.trongrid.io";
}

test.afterEach(() => {
  restoreState();
});

test("exchange payout indeterminate broadcast lands in manual-review state", async () => {
  const order = buildMutableExchangeOrder();
  const job = buildMutablePayoutJob();
  let sendCalled = 0;
  let createdJobPayload;

  enableLiveEnv();
  db.sequelize.transaction = async (callback) => callback({ testTransaction: true });
  db.ExchangeOrder.findByPk = async () => order;
  db.ExchangePayoutJob.findOne = async () => null;
  db.ExchangePayoutJob.create = async (payload) => {
    createdJobPayload = payload;
    Object.assign(job, payload);
    return job;
  };
  db.ExchangePayoutJob.findByPk = async () => job;
  db.ChainDeposit.update = async () => {};
  payoutClient.setPayoutAdapterForTesting({
    getTrxBalance: async () => "1000000000",
    sendTrx: async () => {
      sendCalled += 1;
      throw new Error("timeout service-private-key");
    },
  });

  await assert.rejects(
    () => payoutJobService.processExchangeOrder(order.id),
    /indeterminate/
  );

  assert.equal(sendCalled, 1);
  assert.equal(createdJobPayload.dryRun, false);
  assert.equal(createdJobPayload.attemptCount, 1);
  assert.equal(order.status, EXCHANGE_ORDER_STATUSES.PAYOUT_INDETERMINATE);
  assert.equal(job.status, EXCHANGE_PAYOUT_STATUSES.INDETERMINATE);
  assert.equal(String(job.lastError).includes("service-private-key"), false);
  assert.equal(JSON.stringify(job.response).includes("service-private-key"), false);
});

test("exchange payout processing orders are not rebroadcast after claim", async () => {
  const order = buildMutableExchangeOrder({
    status: EXCHANGE_ORDER_STATUSES.PAYOUT_PROCESSING,
  });
  let sendCalled = 0;

  enableLiveEnv();
  db.sequelize.transaction = async (callback) => callback({ testTransaction: true });
  db.ExchangeOrder.findByPk = async () => order;
  db.ExchangePayoutJob.findOne = async () => null;
  payoutClient.setPayoutAdapterForTesting({
    getTrxBalance: async () => "1000000000",
    sendTrx: async () => {
      sendCalled += 1;
      return { txid: "should-not-send" };
    },
  });

  await assert.rejects(
    () => payoutJobService.processExchangeOrder(order.id),
    /not ready for payout/
  );
  assert.equal(sendCalled, 0);
});

test("exchange payout completion persistence failure becomes indeterminate with txid", async () => {
  const order = buildMutableExchangeOrder();
  const job = buildMutablePayoutJob();
  let sendCalled = 0;
  let transactionCalls = 0;

  enableLiveEnv();
  db.sequelize.transaction = async (callback) => {
    transactionCalls += 1;
    if (transactionCalls === 2) {
      throw new Error("database unavailable after broadcast");
    }
    return callback({ testTransaction: true });
  };
  db.ExchangeOrder.findByPk = async () => order;
  db.ExchangePayoutJob.findOne = async () => null;
  db.ExchangePayoutJob.create = async (payload) => {
    Object.assign(job, payload);
    return job;
  };
  db.ExchangePayoutJob.findByPk = async () => job;
  db.ChainDeposit.update = async () => {};
  payoutClient.setPayoutAdapterForTesting({
    getTrxBalance: async () => "1000000000",
    sendTrx: async () => {
      sendCalled += 1;
      return { txid: "broadcasted-before-db-error" };
    },
  });

  await assert.rejects(
    () => payoutJobService.processExchangeOrder(order.id),
    /completion persistence failed/
  );

  assert.equal(sendCalled, 1);
  assert.equal(transactionCalls, 3);
  assert.equal(order.status, EXCHANGE_ORDER_STATUSES.PAYOUT_INDETERMINATE);
  assert.equal(job.status, EXCHANGE_PAYOUT_STATUSES.INDETERMINATE);
  assert.equal(
    job.response.broadcastResponse.txid,
    "broadcasted-before-db-error"
  );
  assert.equal(job.response.indeterminate, true);
});

test("payout review list surfaces indeterminate and stale processing orders read-only", async () => {
  const now = new Date("2026-07-01T01:00:00.000Z");
  let findAllOptions;
  let mutationCalls = 0;

  db.ExchangeOrder.findAll = async (options) => {
    findAllOptions = options;
    return [
      buildReviewOrder({
        id: "indeterminate-order",
        status: EXCHANGE_ORDER_STATUSES.PAYOUT_INDETERMINATE,
        updatedAt: new Date("2026-07-01T00:10:00.000Z"),
        payoutJobs: [
          buildReviewJob({
            id: "indeterminate-job",
            toAddress: "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
            response: {
              indeterminate: true,
              broadcastResponse: {
                txid: "tx-indeterminate-1",
                transfer: {
                  exchangeOrderId: "indeterminate-order",
                  asset: "USDT",
                  contractAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
                  toAddress: "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
                  amountBaseUnits: 1234567,
                  nestedFutureSecret: "should-not-be-serialized",
                },
                unexpectedFutureSecret: "should-not-be-serialized",
              },
            },
          }),
        ],
      }),
      buildReviewOrder({
        id: "stale-processing-no-job",
        status: EXCHANGE_ORDER_STATUSES.PAYOUT_PROCESSING,
        updatedAt: new Date("2026-07-01T00:20:00.000Z"),
        payoutJobs: [],
      }),
      buildReviewOrder({
        id: "fresh-processing",
        status: EXCHANGE_ORDER_STATUSES.PAYOUT_PROCESSING,
        updatedAt: new Date("2026-07-01T00:59:00.000Z"),
        payoutJobs: [],
      }),
    ];
  };
  db.ExchangeOrder.findByPk = async () => {
    mutationCalls += 1;
  };
  db.ExchangePayoutJob.create = async () => {
    mutationCalls += 1;
  };
  db.ExchangePayoutJob.findOne = async () => {
    mutationCalls += 1;
  };
  db.ChainDeposit.update = async () => {
    mutationCalls += 1;
  };
  db.sequelize.transaction = async () => {
    mutationCalls += 1;
  };

  const result = await payoutJobService.listPayoutReviewItems({
    staleProcessingMinutes: 10,
    limit: 999,
    now,
  });

  assert.equal(findAllOptions.limit, 200);
  assert.equal(findAllOptions.include[0].required, false);
  assert.equal(findAllOptions.include[0].separate, true);
  assert.equal(findAllOptions.include[0].limit, 1);
  assert.deepEqual(findAllOptions.include[0].order, [["createdAt", "DESC"]]);
  assert.equal(findAllOptions.order[0][0], "updatedAt");
  assert.equal(findAllOptions.order[0][1], "ASC");
  assert.deepEqual(findAllOptions.order[1], ["id", "ASC"]);
  assert.equal(result.count, 2);
  assert.deepEqual(
    result.data.map((item) => item.exchangeOrder.id),
    ["indeterminate-order", "stale-processing-no-job"]
  );
  assert.equal(result.data[0].reason, "manual_review_indeterminate");
  assert.equal(
    result.data[0].latestPayoutJob.response.txid,
    "tx-indeterminate-1"
  );
  assert.equal(
    result.data[0].latestPayoutJob.response.broadcastResponse.txid,
    "tx-indeterminate-1"
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      result.data[0].latestPayoutJob.response.broadcastResponse,
      "unexpectedFutureSecret"
    ),
    false
  );
  assert.equal(
    result.data[0].latestPayoutJob.response.broadcastResponse.transfer
      .toAddress,
    "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb"
  );
  assert.equal(
    result.data[0].latestPayoutJob.response.broadcastResponse.transfer
      .amountBaseUnits,
    "1234567"
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      result.data[0].latestPayoutJob.response.broadcastResponse.transfer,
      "nestedFutureSecret"
    ),
    false
  );
  assert.equal(
    result.data[0].latestPayoutJob.toAddress,
    "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb"
  );
  assert.equal(result.data[1].reason, "stale_processing_claim");
  assert.equal(result.data[1].latestPayoutJob, null);
  assert.equal(mutationCalls, 0);
});

test("payout review uses inclusive stale threshold", async () => {
  const now = new Date("2026-07-01T01:00:00.000Z");
  db.ExchangeOrder.findAll = async () => [
    buildReviewOrder({
      id: "threshold-processing",
      status: EXCHANGE_ORDER_STATUSES.PAYOUT_PROCESSING,
      updatedAt: new Date("2026-07-01T00:50:00.000Z"),
      payoutJobs: [],
    }),
  ];

  const result = await payoutJobService.listPayoutReviewItems({
    staleProcessingMinutes: 10,
    now,
  });

  assert.equal(result.count, 1);
  assert.equal(result.data[0].exchangeOrder.id, "threshold-processing");
});

test("pending exchange payouts drain funds-received orders by limit and continue after skips", async () => {
  let findAllOptions;
  const successfulOrder = buildMutableExchangeOrder({
    id: "exchange-order-success",
    fundsReceivedAt: new Date("2026-07-01T00:02:00.000Z"),
  });
  const job = buildMutablePayoutJob({ id: "payout-job-success" });
  let sendCalled = 0;

  db.ExchangeOrder.findAll = async (options) => {
    findAllOptions = options;
    return [
      { id: "exchange-order-skip" },
      { id: successfulOrder.id },
    ];
  };
  db.sequelize.transaction = async (callback) => callback({ testTransaction: true });
  db.ExchangeOrder.findByPk = async (id) => {
    if (id === "exchange-order-skip") {
      return null;
    }
    return successfulOrder;
  };
  db.ExchangePayoutJob.findOne = async () => null;
  db.ExchangePayoutJob.create = async (payload) => {
    Object.assign(job, payload);
    return job;
  };
  db.ExchangePayoutJob.findByPk = async () => job;
  db.ChainDeposit.update = async () => {};
  payoutClient.setPayoutAdapterForTesting({
    sendTrx: async () => {
      sendCalled += 1;
      return { txid: "dry-run-success" };
    },
  });

  const results = await payoutJobService.processPendingExchangePayouts({
    limit: 999,
  });

  assert.deepEqual(findAllOptions.where, {
    status: EXCHANGE_ORDER_STATUSES.FUNDS_RECEIVED,
  });
  assert.deepEqual(findAllOptions.order, [
    ["fundsReceivedAt", "ASC"],
    ["id", "ASC"],
  ]);
  assert.equal(findAllOptions.limit, 200);
  assert.equal(results.length, 2);
  assert.deepEqual(
    results.map((result) => ({
      exchangeOrderId: result.exchangeOrderId,
      success: result.success,
      skipped: Boolean(result.skipped),
    })),
    [
      {
        exchangeOrderId: "exchange-order-skip",
        success: false,
        skipped: true,
      },
      {
        exchangeOrderId: successfulOrder.id,
        success: true,
        skipped: false,
      },
    ]
  );
  assert.equal(job.dryRun, true);
  assert.equal(sendCalled, 0);
  assert.equal(successfulOrder.status, EXCHANGE_ORDER_STATUSES.PAYOUT_COMPLETED);
});

test("exchange payout process endpoint drains pending orders when ids are absent", async () => {
  process.env.ENABLE_EXCHANGE_PAYOUT_ENDPOINT = "true";
  process.env.DEPOSIT_WATCHER_ADMIN_TOKEN = "secret-admin-token";
  let pendingLimit;
  let explicitCalled = false;

  payoutJobService.processExchangeOrders = async () => {
    explicitCalled = true;
    return [];
  };
  payoutJobService.processPendingExchangePayouts = async ({ limit }) => {
    pendingLimit = limit;
    return [
      {
        exchangeOrderId: "exchange-order-pending",
        success: true,
      },
    ];
  };

  const response = await requestJson(makeExchangeRouteApp(), {
    method: "POST",
    path: "/api/exchange/payout-jobs/process",
    headers: { "x-admin-token": "secret-admin-token" },
    body: { limit: 3 },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(pendingLimit, 3);
  assert.equal(explicitCalled, false);
  assert.equal(response.body.count, 1);
  assert.equal(response.body.data[0].exchangeOrderId, "exchange-order-pending");
});

test("exchange payout process endpoint treats explicit empty ids as no-op", async () => {
  process.env.ENABLE_EXCHANGE_PAYOUT_ENDPOINT = "true";
  process.env.DEPOSIT_WATCHER_ADMIN_TOKEN = "secret-admin-token";
  let explicitIds;
  let pendingCalled = false;

  payoutJobService.processExchangeOrders = async (exchangeOrderIds) => {
    explicitIds = exchangeOrderIds;
    return [];
  };
  payoutJobService.processPendingExchangePayouts = async () => {
    pendingCalled = true;
    return [];
  };

  const response = await requestJson(makeExchangeRouteApp(), {
    method: "POST",
    path: "/api/exchange/payout-jobs/process",
    headers: { "x-admin-token": "secret-admin-token" },
    body: { exchangeOrderIds: [] },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(explicitIds, []);
  assert.equal(pendingCalled, false);
  assert.equal(response.body.count, 0);
});

test("exchange payout manual resolution marks indeterminate payout completed without rebroadcasting", async () => {
  const order = buildMutableExchangeOrder({
    status: EXCHANGE_ORDER_STATUSES.PAYOUT_INDETERMINATE,
  });
  const job = buildMutablePayoutJob({
    status: EXCHANGE_PAYOUT_STATUSES.INDETERMINATE,
    response: {
      indeterminate: true,
      broadcastResponse: {
        accepted: false,
        txid: "ambiguous-broadcast-txid",
      },
    },
  });
  let chainDepositUpdate;
  let payoutClientCalled = 0;

  db.sequelize.transaction = async (callback) => callback({ testTransaction: true });
  db.ExchangeOrder.findByPk = async () => order;
  db.ExchangePayoutJob.findOne = async () => job;
  db.ExchangePayoutJob.findByPk = async () => job;
  db.ChainDeposit.update = async (patch, options) => {
    chainDepositUpdate = { patch, options };
  };
  payoutClient.setPayoutAdapterForTesting({
    getTrxBalance: async () => {
      payoutClientCalled += 1;
      throw new Error("payout client must not be called");
    },
  });

  const manualTxid =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const result = await payoutJobService.resolvePayoutReview({
    exchangeOrderId: order.id,
    resolution: "completed",
    note: "confirmed manually on tronscan",
    txid: manualTxid,
    resolvedBy: "ops-yoshi",
    now: new Date("2026-07-01T03:00:00.000Z"),
  });

  assert.equal(result.id, job.id);
  assert.equal(payoutClientCalled, 0);
  assert.equal(order.status, EXCHANGE_ORDER_STATUSES.PAYOUT_COMPLETED);
  assert.equal(
    order.payoutCompletedAt.toISOString(),
    "2026-07-01T03:00:00.000Z"
  );
  assert.equal(job.status, EXCHANGE_PAYOUT_STATUSES.COMPLETED);
  assert.equal(job.response.txid, undefined);
  assert.deepEqual(job.response.manualResolution, {
    resolution: "completed",
    note: "confirmed manually on tronscan",
    resolvedBy: "ops-yoshi",
    resolvedAt: "2026-07-01T03:00:00.000Z",
    resolvedFromIndeterminate: true,
    txid: manualTxid,
  });
  assert.equal(
    chainDepositUpdate.patch.matchedExchangePayoutJobId,
    "exchange-payout-job-live"
  );
  assert.equal(
    chainDepositUpdate.options.where.matchedExchangeOrderId,
    order.id
  );
});

test("exchange payout manual resolution marks indeterminate payout failed", async () => {
  const order = buildMutableExchangeOrder({
    status: EXCHANGE_ORDER_STATUSES.PAYOUT_INDETERMINATE,
  });
  const job = buildMutablePayoutJob({
    status: EXCHANGE_PAYOUT_STATUSES.INDETERMINATE,
    response: { indeterminate: true },
  });
  let chainDepositCalled = false;

  db.sequelize.transaction = async (callback) => callback({ testTransaction: true });
  db.ExchangeOrder.findByPk = async () => order;
  db.ExchangePayoutJob.findOne = async () => job;
  db.ExchangePayoutJob.findByPk = async () => job;
  db.ChainDeposit.update = async () => {
    chainDepositCalled = true;
  };

  await payoutJobService.resolvePayoutReview({
    exchangeOrderId: order.id,
    resolution: "failed",
    note: "operator confirmed broadcast did not happen",
    resolvedBy: "ops-yoshi",
    now: new Date("2026-07-01T03:05:00.000Z"),
  });

  assert.equal(order.status, EXCHANGE_ORDER_STATUSES.PAYOUT_FAILED);
  assert.equal(job.status, EXCHANGE_PAYOUT_STATUSES.FAILED);
  assert.equal(job.response.manualResolution.resolution, "failed");
  assert.equal(job.response.manualResolution.txid, undefined);
  assert.equal(chainDepositCalled, false);
});

test("exchange payout manual resolution rejects missing success evidence and wrong states", async () => {
  const order = buildMutableExchangeOrder({
    status: EXCHANGE_ORDER_STATUSES.PAYOUT_INDETERMINATE,
  });
  const job = buildMutablePayoutJob({
    status: EXCHANGE_PAYOUT_STATUSES.INDETERMINATE,
    response: { indeterminate: true },
  });

  db.sequelize.transaction = async (callback) => callback({ testTransaction: true });
  db.ExchangeOrder.findByPk = async () => order;
  db.ExchangePayoutJob.findOne = async () => job;

  await assert.rejects(
    () =>
      payoutJobService.resolvePayoutReview({
        exchangeOrderId: order.id,
        resolution: "completed",
        note: "confirmed but missing txid",
        resolvedBy: "ops-yoshi",
      }),
    /txid is required/
  );

  order.status = EXCHANGE_ORDER_STATUSES.PAYOUT_PROCESSING;
  await assert.rejects(
    () =>
      payoutJobService.resolvePayoutReview({
        exchangeOrderId: order.id,
        resolution: "failed",
        note: "not in manual state",
        resolvedBy: "ops-yoshi",
      }),
    /not in payout manual-review state/
  );

  order.status = EXCHANGE_ORDER_STATUSES.PAYOUT_INDETERMINATE;
  job.status = EXCHANGE_PAYOUT_STATUSES.COMPLETED;
  await assert.rejects(
    () =>
      payoutJobService.resolvePayoutReview({
        exchangeOrderId: order.id,
        resolution: "failed",
        note: "job is already resolved",
        resolvedBy: "ops-yoshi",
      }),
    /Latest exchange payout job is not indeterminate/
  );
});

test("payout review admin gate requires configured token in every environment", () => {
  process.env.NODE_ENV = "development";
  process.env.ENABLE_EXCHANGE_PAYOUT_ENDPOINT = "true";
  delete process.env.DEPOSIT_WATCHER_ADMIN_TOKEN;

  assert.throws(
    () =>
      payoutJobService.assertExchangePayoutRouteEnabled({
        get: () => "dev-token",
      }),
    /Not found/
  );
});

test("payout review admin gate rejects wrong token in every environment", () => {
  process.env.NODE_ENV = "development";
  process.env.ENABLE_EXCHANGE_PAYOUT_ENDPOINT = "true";
  process.env.DEPOSIT_WATCHER_ADMIN_TOKEN = "secret-admin-token";

  assert.throws(
    () =>
      payoutJobService.assertExchangePayoutRouteEnabled({
        get: () => "wrong-token",
      }),
    /Not found/
  );
});

test("payout review admin gate accepts matching token when explicitly enabled", () => {
  process.env.NODE_ENV = "development";
  process.env.ENABLE_EXCHANGE_PAYOUT_ENDPOINT = "true";
  process.env.DEPOSIT_WATCHER_ADMIN_TOKEN = "secret-admin-token";

  assert.doesNotThrow(() =>
    payoutJobService.assertExchangePayoutRouteEnabled({
      get: () => "secret-admin-token",
    })
  );
});
