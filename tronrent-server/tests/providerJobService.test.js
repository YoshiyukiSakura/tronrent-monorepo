"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const db = require("../db/models");
const providerClient = require("../services/providerClient");
const providerJobService = require("../services/providerJobService");
const {
  ORDER_STATUSES,
  PROVIDER_JOB_STATUSES,
} = require("../services/orderState");

const ORIGINAL_ENV = { ...process.env };
const ORIGINALS = {
  consoleError: console.error,
  orderFindAll: db.Order.findAll,
  orderFindByPk: db.Order.findByPk,
  providerJobCreate: db.ProviderJob.create,
  providerJobFindByPk: db.ProviderJob.findByPk,
  providerJobFindOne: db.ProviderJob.findOne,
  transaction: db.sequelize.transaction,
};

function restoreState() {
  process.env = { ...ORIGINAL_ENV };
  console.error = ORIGINALS.consoleError;
  providerClient.resetFetchForTesting();
  db.Order.findAll = ORIGINALS.orderFindAll;
  db.Order.findByPk = ORIGINALS.orderFindByPk;
  db.ProviderJob.create = ORIGINALS.providerJobCreate;
  db.ProviderJob.findByPk = ORIGINALS.providerJobFindByPk;
  db.ProviderJob.findOne = ORIGINALS.providerJobFindOne;
  db.sequelize.transaction = ORIGINALS.transaction;
}

function buildMutableOrder(overrides = {}) {
  const data = {
    id: "order-live-failure",
    status: ORDER_STATUSES.PAID,
    targetAddress: "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
    energyAmount: 65000,
    durationHours: 1,
    planId: "standard",
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

function buildMutableProviderJob(overrides = {}) {
  return {
    id: overrides.id || "provider-job-live-failure",
    status: overrides.status || PROVIDER_JOB_STATUSES.PROCESSING,
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
    id: overrides.id || "order-provider-review",
    status: overrides.status || ORDER_STATUSES.PROVISIONING_INDETERMINATE,
    planId: overrides.planId || "standard",
    targetAddress:
      overrides.targetAddress || "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
    energyAmount: overrides.energyAmount || 65000,
    durationHours: overrides.durationHours || 1,
    paidAt: overrides.paidAt || new Date("2026-07-01T00:00:00.000Z"),
    provisionedAt:
      overrides.provisionedAt || new Date("2026-07-01T00:01:00.000Z"),
    fulfilledAt: overrides.fulfilledAt || null,
    updatedAt: overrides.updatedAt || new Date("2026-07-01T00:02:00.000Z"),
    providerJobs: overrides.providerJobs || [],
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
    id: overrides.id || "provider-job-review",
    status: overrides.status || PROVIDER_JOB_STATUSES.INDETERMINATE,
    dryRun: overrides.dryRun ?? false,
    provider: overrides.provider || "apitrx",
    action: overrides.action || "rent_energy",
    request:
      overrides.request || {
        orderId: "order-provider-review",
        targetAddress: "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
        energyAmount: 65000,
        durationHours: 1,
        planId: "standard",
        apikey: "should-not-be-serialized",
      },
    response:
      overrides.response || {
        error: "APITRX getenergy timed out",
        indeterminate: true,
        providerDetails: {
          endpoint: "getenergy",
          reason: "timeout",
          timeoutMs: 1,
          requestUrl:
            "https://web.apitrx.com/getenergy?apikey=should-not-be-serialized",
        },
      },
    attemptCount: overrides.attemptCount || 1,
    lastError: overrides.lastError || "APITRX getenergy timed out",
    processedAt: overrides.processedAt || new Date("2026-07-01T00:02:00.000Z"),
    updatedAt: overrides.updatedAt || new Date("2026-07-01T00:02:00.000Z"),
  };
}

test.afterEach(() => {
  restoreState();
});

test("provider job endpoint gate rejects disabled endpoint with 403", () => {
  process.env.ENABLE_PROVIDER_JOB_ENDPOINT = "false";
  process.env.DEPOSIT_WATCHER_ADMIN_TOKEN = "secret-admin-token";

  assert.throws(
    () =>
      providerJobService.assertProviderJobRouteEnabled({
        get: () => "secret-admin-token",
      }),
    (error) =>
      error.statusCode === 403 &&
      error.message === "Provider job endpoint is disabled"
  );
});

test("provider job endpoint gate requires admin token when enabled", () => {
  process.env.ENABLE_PROVIDER_JOB_ENDPOINT = "true";
  delete process.env.DEPOSIT_WATCHER_ADMIN_TOKEN;

  assert.throws(
    () =>
      providerJobService.assertProviderJobRouteEnabled({
        get: () => "secret-admin-token",
      }),
    /Not found/
  );
});

test("provider job endpoint gate rejects wrong admin token", () => {
  process.env.ENABLE_PROVIDER_JOB_ENDPOINT = "true";
  process.env.DEPOSIT_WATCHER_ADMIN_TOKEN = "secret-admin-token";

  assert.throws(
    () =>
      providerJobService.assertProviderJobRouteEnabled({
        get: () => "wrong-token",
      }),
    /Not found/
  );
});

test("provider job endpoint gate accepts matching token when explicitly enabled", () => {
  process.env.ENABLE_PROVIDER_JOB_ENDPOINT = "true";
  process.env.DEPOSIT_WATCHER_ADMIN_TOKEN = "secret-admin-token";

  assert.doesNotThrow(() =>
    providerJobService.assertProviderJobRouteEnabled({
      get: () => "secret-admin-token",
    })
  );
});

test("provider getenergy timeout lands in manual-review state", async () => {
  const rawApiKey = "provider-timeout-secret";
  const order = buildMutableOrder();
  const job = buildMutableProviderJob();
  const paths = [];

  process.env.PROVIDER_LIVE = "true";
  process.env.ENERGY_PROVIDER = "apitrx";
  process.env.APITRX_API_KEY = rawApiKey;
  process.env.APITRX_TIMEOUT_MS = "1";

  db.sequelize.transaction = async (callback) => callback({ testTransaction: true });
  db.Order.findByPk = async () => order;
  db.ProviderJob.create = async (payload) => {
    Object.assign(job, payload);
    return job;
  };
  db.ProviderJob.findByPk = async () => job;
  providerClient.setFetchForTesting((url, options) => {
    const requestedUrl = new URL(String(url));
    paths.push(requestedUrl.pathname);
    if (requestedUrl.pathname === "/price") {
      return Promise.resolve({
        status: 200,
        text: async () =>
          JSON.stringify({
            code: 200,
            data: { "1": 2.34 },
            message: "SUCCESS",
          }),
      });
    }
    if (requestedUrl.pathname === "/balance") {
      return Promise.resolve({
        status: 200,
        text: async () =>
          JSON.stringify({
            code: 200,
            data: { balance: 10 },
            message: "SUCCESS",
          }),
      });
    }
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    });
  });

  await assert.rejects(
    () => providerJobService.processOrder(order.id),
    /indeterminate/
  );

  assert.deepEqual(paths, ["/price", "/balance", "/getenergy"]);
  assert.equal(order.status, ORDER_STATUSES.PROVISIONING_INDETERMINATE);
  assert.equal(job.status, PROVIDER_JOB_STATUSES.INDETERMINATE);
  assert.equal(job.response.indeterminate, true);
  assert.equal(job.response.providerDetails.endpoint, "getenergy");
  assert.equal(JSON.stringify(job.response).includes(rawApiKey), false);
});

test("provider processing orders are not rebroadcast after claim", async () => {
  const order = buildMutableOrder({
    status: ORDER_STATUSES.PROVISIONING,
  });
  let fetchCalled = 0;

  db.sequelize.transaction = async (callback) => callback({ testTransaction: true });
  db.Order.findByPk = async () => order;
  providerClient.setFetchForTesting(() => {
    fetchCalled += 1;
    return {
      status: 200,
      text: async () => "{}",
    };
  });

  await assert.rejects(
    () => providerJobService.processOrder(order.id),
    /not ready for provider processing/
  );
  assert.equal(fetchCalled, 0);
});

test("provider completion persistence failure becomes indeterminate with upstream response", async () => {
  const order = buildMutableOrder();
  const job = buildMutableProviderJob();
  let transactionCalls = 0;

  process.env.PROVIDER_LIVE = "false";
  db.sequelize.transaction = async (callback) => {
    transactionCalls += 1;
    if (transactionCalls === 2) {
      throw new Error("database unavailable after provider accepted");
    }
    return callback({ testTransaction: true });
  };
  db.Order.findByPk = async () => order;
  db.ProviderJob.create = async (payload) => {
    Object.assign(job, payload);
    return job;
  };
  db.ProviderJob.findByPk = async () => job;

  await assert.rejects(
    () => providerJobService.processOrder(order.id),
    /database unavailable after provider accepted/
  );

  assert.equal(transactionCalls, 3);
  assert.equal(order.status, ORDER_STATUSES.PROVISIONING_INDETERMINATE);
  assert.equal(job.status, PROVIDER_JOB_STATUSES.INDETERMINATE);
  assert.equal(job.response.upstreamOrderId, `dry-run-${order.id}`);
  assert.equal(job.response.indeterminate, true);
  assert.equal(
    job.response.completionMeaning,
    "provider_accepted_but_local_completion_persistence_failed"
  );
});

test("provider review list surfaces indeterminate and stale provisioning orders read-only", async () => {
  const now = new Date("2026-07-01T01:00:00.000Z");
  let findAllOptions;
  let mutationCalls = 0;

  db.Order.findAll = async (options) => {
    findAllOptions = options;
    return [
      buildReviewOrder({
        id: "indeterminate-provider-order",
        status: ORDER_STATUSES.PROVISIONING_INDETERMINATE,
        updatedAt: new Date("2026-07-01T00:10:00.000Z"),
        providerJobs: [
          buildReviewJob({
            id: "indeterminate-provider-job",
            response: {
              error: "APITRX getenergy timed out",
              indeterminate: true,
              providerDetails: {
                endpoint: "getenergy",
                reason: "timeout",
                timeoutMs: 1,
                requestUrl:
                  "https://web.apitrx.com/getenergy?apikey=should-not-leak",
              },
              providerResponse: {
                energyOrder: {
                  endpoint: "getenergy",
                  httpStatus: 200,
                  body: {
                    code: 200,
                    message: "SUCCESS",
                    unexpectedFutureSecret: "should-not-be-serialized",
                  },
                },
              },
            },
          }),
        ],
      }),
      buildReviewOrder({
        id: "stale-provider-no-job",
        status: ORDER_STATUSES.PROVISIONING,
        updatedAt: new Date("2026-07-01T00:20:00.000Z"),
        providerJobs: [],
      }),
      buildReviewOrder({
        id: "fresh-provider",
        status: ORDER_STATUSES.PROVISIONING,
        updatedAt: new Date("2026-07-01T00:59:00.000Z"),
        providerJobs: [],
      }),
    ];
  };
  db.Order.findByPk = async () => {
    mutationCalls += 1;
  };
  db.ProviderJob.create = async () => {
    mutationCalls += 1;
  };
  db.sequelize.transaction = async () => {
    mutationCalls += 1;
  };

  const result = await providerJobService.listProviderReviewItems({
    staleProvisioningMinutes: 10,
    limit: 999,
    now,
  });

  assert.equal(findAllOptions.limit, 200);
  assert.equal(findAllOptions.include[0].required, false);
  assert.equal(findAllOptions.include[0].separate, true);
  assert.equal(findAllOptions.include[0].limit, 1);
  assert.deepEqual(findAllOptions.include[0].order, [["createdAt", "DESC"]]);
  assert.deepEqual(findAllOptions.order, [
    ["updatedAt", "ASC"],
    ["id", "ASC"],
  ]);
  assert.equal(result.count, 2);
  assert.deepEqual(
    result.data.map((item) => item.order.id),
    ["indeterminate-provider-order", "stale-provider-no-job"]
  );
  assert.equal(
    result.data[0].reason,
    "manual_review_provider_indeterminate"
  );
  assert.equal(
    result.data[0].latestProviderJob.response.providerDetails.endpoint,
    "getenergy"
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      result.data[0].latestProviderJob.response.providerDetails,
      "requestUrl"
    ),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      result.data[0].latestProviderJob.response.energyOrder,
      "unexpectedFutureSecret"
    ),
    false
  );
  assert.equal(result.data[1].reason, "stale_provider_provisioning");
  assert.equal(result.data[1].latestProviderJob, null);
  assert.equal(mutationCalls, 0);
});

test("provider manual resolution marks indeterminate order fulfilled without rebroadcasting", async () => {
  const order = buildMutableOrder({
    status: ORDER_STATUSES.PROVISIONING_INDETERMINATE,
  });
  const job = buildMutableProviderJob({
    status: PROVIDER_JOB_STATUSES.INDETERMINATE,
    response: {
      indeterminate: true,
      providerDetails: { endpoint: "getenergy", reason: "timeout" },
    },
  });
  let fetchCalled = 0;

  db.sequelize.transaction = async (callback) => callback({ testTransaction: true });
  db.Order.findByPk = async () => order;
  db.ProviderJob.findOne = async () => job;
  db.ProviderJob.findByPk = async () => job;
  providerClient.setFetchForTesting(() => {
    fetchCalled += 1;
    throw new Error("provider client must not be called");
  });

  const result = await providerJobService.resolveProviderReview({
    orderId: order.id,
    resolution: "fulfilled",
    note: "confirmed in apitrx console",
    upstreamOrderId: "apitrx-order-123",
    resolvedBy: "ops-yoshi",
    now: new Date("2026-07-01T02:00:00.000Z"),
  });

  assert.equal(result.id, job.id);
  assert.equal(fetchCalled, 0);
  assert.equal(order.status, ORDER_STATUSES.FULFILLED);
  assert.equal(order.fulfilledAt.toISOString(), "2026-07-01T02:00:00.000Z");
  assert.equal(job.status, PROVIDER_JOB_STATUSES.COMPLETED);
  assert.equal(job.response.upstreamOrderId, undefined);
  assert.deepEqual(job.response.manualResolution, {
    resolution: "fulfilled",
    note: "confirmed in apitrx console",
    resolvedBy: "ops-yoshi",
    resolvedAt: "2026-07-01T02:00:00.000Z",
    resolvedFromIndeterminate: true,
    upstreamOrderId: "apitrx-order-123",
  });
});

test("provider manual resolution marks indeterminate order failed with operator evidence", async () => {
  const order = buildMutableOrder({
    status: ORDER_STATUSES.PROVISIONING_INDETERMINATE,
  });
  const job = buildMutableProviderJob({
    status: PROVIDER_JOB_STATUSES.INDETERMINATE,
    response: { indeterminate: true },
  });

  db.sequelize.transaction = async (callback) => callback({ testTransaction: true });
  db.Order.findByPk = async () => order;
  db.ProviderJob.findOne = async () => job;
  db.ProviderJob.findByPk = async () => job;

  await providerJobService.resolveProviderReview({
    orderId: order.id,
    resolution: "failed",
    note: "apitrx confirms no order was accepted",
    resolvedBy: "ops-yoshi",
    now: new Date("2026-07-01T02:05:00.000Z"),
  });

  assert.equal(order.status, ORDER_STATUSES.FAILED);
  assert.equal(job.status, PROVIDER_JOB_STATUSES.FAILED);
  assert.equal(job.response.manualResolution.resolution, "failed");
  assert.equal(job.response.manualResolution.upstreamOrderId, undefined);
});

test("provider manual resolution rejects missing success evidence and wrong states", async () => {
  const order = buildMutableOrder({
    status: ORDER_STATUSES.PROVISIONING_INDETERMINATE,
  });
  const job = buildMutableProviderJob({
    status: PROVIDER_JOB_STATUSES.INDETERMINATE,
    response: { indeterminate: true },
  });

  db.sequelize.transaction = async (callback) => callback({ testTransaction: true });
  db.Order.findByPk = async () => order;
  db.ProviderJob.findOne = async () => job;

  await assert.rejects(
    () =>
      providerJobService.resolveProviderReview({
        orderId: order.id,
        resolution: "fulfilled",
        note: "confirmed but missing id",
        resolvedBy: "ops-yoshi",
      }),
    /upstreamOrderId is required/
  );

  order.status = ORDER_STATUSES.PROVISIONING;
  await assert.rejects(
    () =>
      providerJobService.resolveProviderReview({
        orderId: order.id,
        resolution: "failed",
        note: "not in manual state",
        resolvedBy: "ops-yoshi",
      }),
    /not in provider manual-review state/
  );

  order.status = ORDER_STATUSES.PROVISIONING_INDETERMINATE;
  job.status = PROVIDER_JOB_STATUSES.COMPLETED;
  await assert.rejects(
    () =>
      providerJobService.resolveProviderReview({
        orderId: order.id,
        resolution: "failed",
        note: "job is already resolved",
        resolvedBy: "ops-yoshi",
      }),
    /Latest provider job is not indeterminate/
  );
});

test("pending paid provider batch clamps limit and continues after provider failures", async () => {
  const rawApiKey = "provider-pending-batch-secret";
  const failedOrder = buildMutableOrder({
    id: "order-provider-fails",
    energyAmount: 65000,
  });
  const successfulOrder = buildMutableOrder({
    id: "order-provider-success",
    energyAmount: 131000,
  });
  const failedJob = buildMutableProviderJob({ id: "provider-job-failed" });
  const successfulJob = buildMutableProviderJob({
    id: "provider-job-success",
  });
  const fetchCalls = [];
  const loggedErrors = [];
  let findAllOptions;

  process.env.PROVIDER_LIVE = "true";
  process.env.ENERGY_PROVIDER = "apitrx";
  process.env.APITRX_API_KEY = rawApiKey;

  console.error = (...args) => {
    loggedErrors.push(args);
  };
  db.Order.findAll = async (options) => {
    findAllOptions = options;
    return [
      { id: failedOrder.id },
      { id: "order-provider-missing" },
      { id: successfulOrder.id },
    ];
  };
  db.sequelize.transaction = async (callback) => callback({ testTransaction: true });
  db.Order.findByPk = async (id) => {
    if (id === failedOrder.id) {
      return failedOrder;
    }
    if (id === successfulOrder.id) {
      return successfulOrder;
    }
    return null;
  };
  db.ProviderJob.create = async (payload) => {
    const job =
      payload.orderId === failedOrder.id ? failedJob : successfulJob;
    Object.assign(job, payload);
    return job;
  };
  db.ProviderJob.findByPk = async (id) => {
    if (id === failedJob.id) {
      return failedJob;
    }
    if (id === successfulJob.id) {
      return successfulJob;
    }
    return null;
  };
  providerClient.setFetchForTesting(async (url) => {
    const requestedUrl = new URL(String(url));
    fetchCalls.push({
      endpoint: requestedUrl.pathname,
      value: requestedUrl.searchParams.get("value"),
    });

    if (
      requestedUrl.pathname === "/price" &&
      requestedUrl.searchParams.get("value") === String(failedOrder.energyAmount)
    ) {
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            code: 501,
            message: "provider rejected this energy amount",
          }),
      };
    }

    if (requestedUrl.pathname === "/price") {
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            code: 200,
            data: { "1": 2.34 },
            message: "SUCCESS",
          }),
      };
    }

    if (requestedUrl.pathname === "/balance") {
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            code: 200,
            data: { balance: 10 },
            message: "SUCCESS",
          }),
      };
    }

    return {
      status: 200,
      text: async () =>
        JSON.stringify({
          code: 200,
          data: { orderId: "upstream-order-success" },
          message: "SUCCESS",
        }),
    };
  });

  const results = await providerJobService.processPendingPaidOrders({
    limit: 999,
  });

  assert.deepEqual(findAllOptions.where, { status: ORDER_STATUSES.PAID });
  assert.deepEqual(findAllOptions.order, [["paidAt", "ASC"]]);
  assert.equal(findAllOptions.limit, 200);
  assert.deepEqual(
    results.map((result) => ({
      orderId: result.orderId,
      success: result.success,
      skipped: Boolean(result.skipped),
      indeterminate: Boolean(result.indeterminate),
    })),
    [
      {
        orderId: failedOrder.id,
        success: false,
        skipped: false,
        indeterminate: false,
      },
      {
        orderId: "order-provider-missing",
        success: false,
        skipped: true,
        indeterminate: false,
      },
      {
        orderId: successfulOrder.id,
        success: true,
        skipped: false,
        indeterminate: false,
      },
    ]
  );
  assert.match(results[0].message, /APITRX price rejected/);
  assert.equal(failedOrder.status, ORDER_STATUSES.FAILED);
  assert.equal(failedJob.status, PROVIDER_JOB_STATUSES.FAILED);
  assert.equal(successfulOrder.status, ORDER_STATUSES.FULFILLED);
  assert.equal(successfulJob.status, PROVIDER_JOB_STATUSES.COMPLETED);
  assert.equal(results[2].job.id, successfulJob.id);
  assert.deepEqual(fetchCalls, [
    { endpoint: "/price", value: "65000" },
    { endpoint: "/price", value: "131000" },
    { endpoint: "/balance", value: null },
    { endpoint: "/getenergy", value: "131000" },
  ]);
  assert.equal(loggedErrors.length, 1);
  assert.equal(JSON.stringify(results).includes(rawApiKey), false);
});

test("provider job stores redacted live provider failures and does not retry", async () => {
  const rawApiKey = "provider-job-secret-key";
  const order = buildMutableOrder();
  const job = buildMutableProviderJob();
  let fetchCalled = 0;
  let createdJobPayload;

  process.env.PROVIDER_LIVE = "true";
  process.env.ENERGY_PROVIDER = "apitrx";
  process.env.APITRX_API_KEY = rawApiKey;

  db.sequelize.transaction = async (callback) => callback({ testTransaction: true });
  db.Order.findByPk = async () => order;
  db.ProviderJob.create = async (payload) => {
    createdJobPayload = payload;
    Object.assign(job, payload);
    return job;
  };
  db.ProviderJob.findByPk = async () => job;
  providerClient.setFetchForTesting(async () => {
    fetchCalled += 1;
    return {
      status: 200,
      text: async () =>
        JSON.stringify({
          code: 501,
          data: {
            echoedUrl: `https://web.apitrx.com/getenergy?apikey=${rawApiKey}`,
          },
          message: "请检查Apikey是否正确",
        }),
    };
  });

  await assert.rejects(
    () => providerJobService.processOrder(order.id),
    /APITRX price rejected/
  );

  assert.equal(fetchCalled, 1);
  assert.equal(createdJobPayload.dryRun, false);
  assert.equal(createdJobPayload.attemptCount, 1);
  assert.equal(job.status, PROVIDER_JOB_STATUSES.FAILED);
  assert.equal(order.status, ORDER_STATUSES.FAILED);
  assert.equal(String(job.lastError).includes(rawApiKey), false);
  assert.equal(JSON.stringify(job.response).includes(rawApiKey), false);
});
