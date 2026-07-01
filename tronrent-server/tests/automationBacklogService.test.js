"use strict";

const http = require("node:http");
const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const adminRoutes = require("../routes/adminRoutes");
const automationBacklogService = require("../services/automationBacklogService");
const {
  EXCHANGE_ORDER_STATUSES,
  EXCHANGE_PAYOUT_STATUSES,
} = require("../services/exchangeOrderService");
const {
  ORDER_STATUSES,
  PROVIDER_JOB_STATUSES,
} = require("../services/orderState");

const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_BUILD_SNAPSHOT =
  automationBacklogService.buildAutomationBacklogSnapshot;

test.afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  automationBacklogService.buildAutomationBacklogSnapshot =
    ORIGINAL_BUILD_SNAPSHOT;
});

function requestJson(app, { method, path, headers = {} }) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          method,
          path,
          headers,
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
      req.end();
    });
  });
}

function makeAdminRouteApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/admin", adminRoutes);
  return app;
}

function makeFakeSequelize() {
  return {
    Op: {
      in: Symbol("in"),
      lte: Symbol("lte"),
    },
    fn: (...args) => ({ fn: args }),
    col: (name) => ({ col: name }),
  };
}

function makeFakeModels({ Sequelize, calls }) {
  function makeModel(name, rows, counts = []) {
    const countQueue = [...counts];
    return {
      async findAll(options) {
        calls.push({ model: name, method: "findAll", options });
        return rows;
      },
      async count(options) {
        calls.push({ model: name, method: "count", options });
        return countQueue.shift() || 0;
      },
    };
  }

  return {
    Sequelize,
    Order: makeModel(
      "Order",
      [
        { status: ORDER_STATUSES.PAID, count: "2" },
        { status: ORDER_STATUSES.PROVISIONING, count: "4" },
        { status: ORDER_STATUSES.PROVISIONING_INDETERMINATE, count: "1" },
      ],
      [3]
    ),
    ProviderJob: makeModel("ProviderJob", [
      { status: PROVIDER_JOB_STATUSES.PROCESSING, count: "3" },
      { status: PROVIDER_JOB_STATUSES.FAILED, count: "2" },
      { status: PROVIDER_JOB_STATUSES.INDETERMINATE, count: "1" },
    ]),
    ExchangeOrder: makeModel(
      "ExchangeOrder",
      [
        { status: EXCHANGE_ORDER_STATUSES.FUNDS_RECEIVED, count: "5" },
        { status: EXCHANGE_ORDER_STATUSES.PAYOUT_PROCESSING, count: "6" },
        { status: EXCHANGE_ORDER_STATUSES.PAYOUT_INDETERMINATE, count: "2" },
      ],
      [2]
    ),
    ExchangePayoutJob: makeModel("ExchangePayoutJob", [
      { status: EXCHANGE_PAYOUT_STATUSES.PROCESSING, count: "7" },
      { status: EXCHANGE_PAYOUT_STATUSES.FAILED, count: "1" },
      { status: EXCHANGE_PAYOUT_STATUSES.INDETERMINATE, count: "4" },
    ]),
  };
}

test("automation backlog snapshot aggregates drainable and review queues without row details", async () => {
  const calls = [];
  const Sequelize = makeFakeSequelize();
  const models = makeFakeModels({ Sequelize, calls });
  const now = new Date("2026-07-01T00:00:00.000Z");

  const snapshot = await automationBacklogService.buildAutomationBacklogSnapshot(
    {
      staleMinutes: "20",
      now,
      models,
    }
  );

  assert.equal(snapshot.generatedAt, "2026-07-01T00:00:00.000Z");
  assert.equal(snapshot.staleOlderThanMinutes, 20);
  assert.equal(snapshot.staleCutoff, "2026-06-30T23:40:00.000Z");
  assert.deepEqual(snapshot.summary, {
    drainableCount: 7,
    manualReviewCount: 8,
    staleProcessingCount: 5,
    indeterminateOrderCount: 3,
    activeJobCount: 10,
    failedOrIndeterminateJobCount: 8,
    trackedStatusCount: 38,
  });
  assert.equal(snapshot.provider.orders.drainable.paid, 2);
  assert.equal(
    snapshot.provider.orders.manualReview.provisioningIndeterminate,
    1
  );
  assert.equal(snapshot.provider.orders.manualReview.staleProvisioning, 3);
  assert.equal(snapshot.exchangePayout.orders.drainable.fundsReceived, 5);
  assert.equal(
    snapshot.exchangePayout.orders.manualReview.payoutIndeterminate,
    2
  );
  assert.equal(
    snapshot.exchangePayout.orders.manualReview.stalePayoutProcessing,
    2
  );

  assert.equal(
    calls.filter((call) => call.method === "findAll").length,
    4
  );
  assert.equal(calls.filter((call) => call.method === "count").length, 2);

  const orderStaleCall = calls.find(
    (call) => call.model === "Order" && call.method === "count"
  );
  assert.equal(orderStaleCall.options.where.status, ORDER_STATUSES.PROVISIONING);
  assert.equal(
    orderStaleCall.options.where.updatedAt[Sequelize.Op.lte].toISOString(),
    "2026-06-30T23:40:00.000Z"
  );
});

test("automation backlog stale threshold defaults and clamps", () => {
  assert.equal(
    automationBacklogService.getStaleMinutes(undefined, {
      AUTOMATION_BACKLOG_STALE_MINUTES: "25",
    }),
    25
  );
  assert.equal(automationBacklogService.getStaleMinutes("0", {}), 10);
  assert.equal(automationBacklogService.getStaleMinutes("2000", {}), 1440);
});

test("automation backlog snapshot sanitizes database query failures", async () => {
  const Sequelize = makeFakeSequelize();
  const failingModel = {
    async findAll() {
      throw new Error("database password leaked in adapter error");
    },
    async count() {
      throw new Error("database password leaked in adapter error");
    },
  };

  await assert.rejects(
    () =>
      automationBacklogService.buildAutomationBacklogSnapshot({
        models: {
          Sequelize,
          Order: failingModel,
          ProviderJob: failingModel,
          ExchangeOrder: failingModel,
          ExchangePayoutJob: failingModel,
        },
      }),
    (error) => {
      assert.equal(error.statusCode, 500);
      assert.equal(error.message, "Automation backlog snapshot unavailable");
      assert.deepEqual(error.details, { reason: "database_query_failed" });
      return true;
    }
  );
});

test("automation backlog route rejects disabled endpoint before token checks", async () => {
  process.env.ENABLE_AUTOMATION_BACKLOG_ENDPOINT = "false";
  delete process.env.DEPOSIT_WATCHER_ADMIN_TOKEN;

  const response = await requestJson(makeAdminRouteApp(), {
    method: "GET",
    path: "/api/admin/automation/backlog",
  });

  assert.equal(response.statusCode, 403);
  assert.equal(
    response.body.message,
    automationBacklogService.AUTOMATION_BACKLOG_DISABLED_MESSAGE
  );
});

test("automation backlog route is admin-gated and forwards stale threshold", async () => {
  process.env.ENABLE_AUTOMATION_BACKLOG_ENDPOINT = "true";
  process.env.DEPOSIT_WATCHER_ADMIN_TOKEN = "admin-secret";
  let receivedArgs;
  automationBacklogService.buildAutomationBacklogSnapshot = async (args) => {
    receivedArgs = args;
    return {
      generatedAt: "2026-07-01T00:00:00.000Z",
      summary: { drainableCount: 0 },
    };
  };

  const missingToken = await requestJson(makeAdminRouteApp(), {
    method: "GET",
    path: "/api/admin/automation/backlog",
  });
  assert.equal(missingToken.statusCode, 404);

  const response = await requestJson(makeAdminRouteApp(), {
    method: "GET",
    path: "/api/admin/automation/backlog?staleMinutes=17",
    headers: { "x-admin-token": "admin-secret" },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    success: true,
    data: {
      generatedAt: "2026-07-01T00:00:00.000Z",
      summary: { drainableCount: 0 },
    },
  });
  assert.equal(receivedArgs.staleMinutes, "17");
});
