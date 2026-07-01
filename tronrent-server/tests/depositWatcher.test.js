"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEPOSIT_STATUSES,
  buildDepositKey,
  classifyDepositMatch,
  isAllowedTrc20Deposit,
} = require("../services/depositMatcher");
const depositWatcherService = require("../services/depositWatcherService");
const exchangePayoutJobService = require("../services/exchangePayoutJobService");
const providerJobService = require("../services/providerJobService");
const tronGridClient = require("../services/tronGridClient");
const {
  assertDepositScanRouteEnabled,
  classifyExchangeDepositMatch,
  depositMatchesExchangeOrder,
  fetchPaginatedInboundTransfers,
  getDepositScanMaxPages,
  resolveDepositScanMinTimestamp,
  runPostMatchProcessing,
  scanConfiguredTreasury,
} = depositWatcherService;

const ORIGINAL_ENV = { ...process.env };
const ORIGINALS = {
  fetchInboundTrxTransfers: tronGridClient.fetchInboundTrxTransfers,
  fetchInboundTrc20Transfers: tronGridClient.fetchInboundTrc20Transfers,
  processExchangeOrders: exchangePayoutJobService.processExchangeOrders,
  processOrders: providerJobService.processOrders,
  consoleError: console.error,
  consoleWarn: console.warn,
  dateNow: Date.now,
};

test.afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  tronGridClient.fetchInboundTrxTransfers = ORIGINALS.fetchInboundTrxTransfers;
  tronGridClient.fetchInboundTrc20Transfers =
    ORIGINALS.fetchInboundTrc20Transfers;
  exchangePayoutJobService.processExchangeOrders =
    ORIGINALS.processExchangeOrders;
  providerJobService.processOrders = ORIGINALS.processOrders;
  console.error = ORIGINALS.consoleError;
  console.warn = ORIGINALS.consoleWarn;
  Date.now = ORIGINALS.dateNow;
});

function makeCandidate(overrides = {}) {
  return {
    payment: {
      id: overrides.paymentId || "payment-1",
      status: overrides.paymentStatus || "awaiting_payment",
      asset: overrides.asset || "TRX",
      toAddress: overrides.toAddress || "TReceiver111111111111111111111111111",
      expectedAmountSun: overrides.expectedAmountSun || "50001234",
    },
    order: {
      id: overrides.orderId || "order-1",
      status: overrides.orderStatus || "pending_payment",
      expiresAt:
        overrides.expiresAt || new Date(Date.now() + 60_000).toISOString(),
    },
  };
}

test("matches a single active payment candidate by exact unique amount", () => {
  const deposit = {
    asset: "TRX",
    toAddress: "TReceiver111111111111111111111111111",
    amountBaseUnits: "50001234",
  };

  const result = classifyDepositMatch(deposit, [makeCandidate()]);

  assert.equal(result.status, DEPOSIT_STATUSES.MATCHED);
  assert.equal(result.payment.id, "payment-1");
  assert.equal(result.order.id, "order-1");
});

test("does not guess when multiple candidates match the same deposit", () => {
  const deposit = {
    asset: "TRX",
    toAddress: "TReceiver111111111111111111111111111",
    amountBaseUnits: "50001234",
  };

  const result = classifyDepositMatch(deposit, [
    makeCandidate({ paymentId: "payment-1", orderId: "order-1" }),
    makeCandidate({ paymentId: "payment-2", orderId: "order-2" }),
  ]);

  assert.equal(result.status, DEPOSIT_STATUSES.UNMATCHED_AMBIGUOUS);
  assert.equal(result.candidates.length, 2);
});

test("records expired matches without confirming payment", () => {
  const now = new Date("2026-07-01T00:00:00.000Z");
  const deposit = {
    asset: "TRX",
    toAddress: "TReceiver111111111111111111111111111",
    amountBaseUnits: "50001234",
  };

  const result = classifyDepositMatch(
    deposit,
    [
      makeCandidate({
        expiresAt: "2026-06-30T23:59:00.000Z",
      }),
    ],
    now
  );

  assert.equal(result.status, DEPOSIT_STATUSES.MATCHED_BUT_EXPIRED);
});

test("records swept expired payments without confirming payment", () => {
  const deposit = {
    asset: "TRX",
    toAddress: "TReceiver111111111111111111111111111",
    amountBaseUnits: "50001234",
  };

  const result = classifyDepositMatch(deposit, [
    makeCandidate({
      paymentStatus: "expired",
      orderStatus: "expired",
      expiresAt: "2026-06-30T23:59:00.000Z",
    }),
  ]);

  assert.equal(result.status, DEPOSIT_STATUSES.MATCHED_BUT_EXPIRED);
});

test("does not match amount mismatches", () => {
  const deposit = {
    asset: "TRX",
    toAddress: "TReceiver111111111111111111111111111",
    amountBaseUnits: "50000000",
  };

  const result = classifyDepositMatch(deposit, [makeCandidate()]);

  assert.equal(result.status, DEPOSIT_STATUSES.UNMATCHED);
});

test("pins TRC20 deposits to configured contract and decimals", () => {
  process.env.TRON_TRC20_ALLOWLIST = "USDT:TUsdtContract111111111111111111111:6";

  assert.equal(
    isAllowedTrc20Deposit({
      asset: "TRC20",
      contractAddress: "TUsdtContract111111111111111111111",
      tokenDecimals: 6,
    }),
    true
  );
  assert.equal(
    isAllowedTrc20Deposit({
      asset: "TRC20",
      contractAddress: "TEvilUsdt111111111111111111111111",
      tokenDecimals: 6,
    }),
    false
  );
  assert.equal(
    isAllowedTrc20Deposit({
      asset: "TRC20",
      contractAddress: "TUsdtContract111111111111111111111",
      tokenDecimals: 18,
    }),
    false
  );

  delete process.env.TRON_TRC20_ALLOWLIST;
});

test("TRC20 contract allowlist comparison is exact, not lowercased", () => {
  process.env.TRON_TRC20_ALLOWLIST = "USDT:TUsdtContractABC111111111111111:6";

  assert.equal(
    isAllowedTrc20Deposit({
      asset: "TRC20",
      contractAddress: "tusdtcontractabc111111111111111",
      tokenDecimals: 6,
    }),
    false
  );

  delete process.env.TRON_TRC20_ALLOWLIST;
});

test("exchange TRX deposit matches only active exact exchange order", () => {
  const deposit = {
    asset: "TRX",
    toAddress: "TExchangeTreasury111111111111111111",
    amountBaseUnits: "10003748",
  };
  const order = {
    id: "exchange-order-1",
    status: "pending_deposit",
    treasuryAddress: "TExchangeTreasury111111111111111111",
    inputAsset: "TRX",
    inputContractAddress: null,
    expectedInputBaseUnits: "10003748",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };

  assert.equal(depositMatchesExchangeOrder(deposit, order), true);
  assert.equal(
    classifyExchangeDepositMatch(deposit, [order]).status,
    DEPOSIT_STATUSES.MATCHED
  );
});

test("exchange USDT deposit requires the pinned contract", () => {
  const deposit = {
    asset: "TRC20",
    toAddress: "TExchangeTreasury111111111111111111",
    amountBaseUnits: "100003748",
    contractAddress: "TUsdtContract111111111111111111111",
  };
  const order = {
    id: "exchange-order-1",
    status: "pending_deposit",
    treasuryAddress: "TExchangeTreasury111111111111111111",
    inputAsset: "USDT",
    inputContractAddress: "TUsdtContract111111111111111111111",
    expectedInputBaseUnits: "100003748",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
  const wrongContractOrder = {
    ...order,
    inputContractAddress: "TOtherContract1111111111111111111",
  };

  assert.equal(depositMatchesExchangeOrder(deposit, order), true);
  assert.equal(depositMatchesExchangeOrder(deposit, wrongContractOrder), false);
});

test("deposit key distinguishes multiple transfer events in one transaction", () => {
  const first = buildDepositKey({
    network: "tron",
    txHash: "abc",
    eventIndex: "0",
    contractAddress: "TToken",
  });
  const second = buildDepositKey({
    network: "tron",
    txHash: "abc",
    eventIndex: "1",
    contractAddress: "TToken",
  });

  assert.notEqual(first, second);
});

test("deposit scan admin gate rejects disabled endpoint with 403", () => {
  process.env.ENABLE_DEPOSIT_SCAN_ENDPOINT = "false";
  process.env.DEPOSIT_WATCHER_ADMIN_TOKEN = "secret-admin-token";

  assert.throws(
    () =>
      assertDepositScanRouteEnabled({
        get: () => "secret-admin-token",
      }),
    (error) =>
      error.statusCode === 403 &&
      error.message === "Deposit scan endpoint is disabled"
  );
});

test("deposit scan admin gate requires configured token in every environment", () => {
  process.env.NODE_ENV = "development";
  process.env.ENABLE_DEPOSIT_SCAN_ENDPOINT = "true";
  delete process.env.DEPOSIT_WATCHER_ADMIN_TOKEN;

  assert.throws(
    () =>
      assertDepositScanRouteEnabled({
        get: () => "dev-token",
      }),
    /Not found/
  );
});

test("deposit scan admin gate rejects absent header without leaking a buffer error", () => {
  process.env.NODE_ENV = "development";
  process.env.ENABLE_DEPOSIT_SCAN_ENDPOINT = "true";
  process.env.DEPOSIT_WATCHER_ADMIN_TOKEN = "secret-admin-token";

  assert.throws(
    () =>
      assertDepositScanRouteEnabled({
        get: () => undefined,
      }),
    (error) => error.statusCode === 404 && error.message === "Not found"
  );
});

test("deposit scan admin gate accepts matching token when explicitly enabled", () => {
  process.env.NODE_ENV = "development";
  process.env.ENABLE_DEPOSIT_SCAN_ENDPOINT = "true";
  process.env.DEPOSIT_WATCHER_ADMIN_TOKEN = "secret-admin-token";

  assert.doesNotThrow(() =>
    assertDepositScanRouteEnabled({
      get: () => "secret-admin-token",
    })
  );
});

test("deposit scan max pages defaults and clamps unsafe values", () => {
  delete process.env.DEPOSIT_SCAN_MAX_PAGES;
  assert.equal(getDepositScanMaxPages(), 20);
  assert.equal(getDepositScanMaxPages("0"), 20);
  assert.equal(getDepositScanMaxPages("2"), 2);
  assert.equal(getDepositScanMaxPages("9999"), 200);
});

test("post-match processing reports successful provider and payout triggers once", async () => {
  const providerCalls = [];
  const payoutCalls = [];

  providerJobService.processOrders = async (orderIds) => {
    providerCalls.push(orderIds);
    return [{ orderId: orderIds[0], success: true }];
  };
  exchangePayoutJobService.processExchangeOrders = async (exchangeOrderIds) => {
    payoutCalls.push(exchangeOrderIds);
    return [{ exchangeOrderId: exchangeOrderIds[0], success: true }];
  };

  const result = await runPostMatchProcessing({
    matchedOrderIds: ["energy-order-1", "energy-order-1"],
    matchedExchangeOrderIds: ["exchange-order-1"],
    processProviderJobs: true,
    processExchangePayouts: true,
  });

  assert.deepEqual(providerCalls, [["energy-order-1"]]);
  assert.deepEqual(payoutCalls, [["exchange-order-1"]]);
  assert.deepEqual(result.postMatchProcessing.provider, {
    triggered: true,
    attempted: 1,
    succeeded: true,
    failed: false,
    resultCount: 1,
    error: null,
  });
  assert.deepEqual(result.postMatchProcessing.exchangePayout, {
    triggered: true,
    attempted: 1,
    succeeded: true,
    failed: false,
    resultCount: 1,
    error: null,
  });
  assert.deepEqual(result.providerResults, [
    { orderId: "energy-order-1", success: true },
  ]);
  assert.deepEqual(result.exchangePayoutResults, [
    { exchangeOrderId: "exchange-order-1", success: true },
  ]);
});

test("post-match processing surfaces provider failure and still runs payout", async () => {
  const errors = [];
  const payoutCalls = [];
  console.error = (...args) => {
    errors.push(args);
  };
  providerJobService.processOrders = async () => {
    const error = new Error("provider secret api-key should not leak");
    error.code = "PROVIDER_DOWN";
    throw error;
  };
  exchangePayoutJobService.processExchangeOrders = async (exchangeOrderIds) => {
    payoutCalls.push(exchangeOrderIds);
    return [{ exchangeOrderId: exchangeOrderIds[0], success: true }];
  };

  const result = await runPostMatchProcessing({
    matchedOrderIds: ["energy-order-1"],
    matchedExchangeOrderIds: ["exchange-order-1"],
    processProviderJobs: true,
    processExchangePayouts: true,
  });

  assert.equal(result.postMatchProcessing.provider.triggered, true);
  assert.equal(result.postMatchProcessing.provider.succeeded, false);
  assert.equal(result.postMatchProcessing.provider.failed, true);
  assert.deepEqual(result.postMatchProcessing.provider.error, {
    message: "Provider post-match processing failed",
    code: "PROVIDER_DOWN",
    statusCode: null,
  });
  assert.equal(
    JSON.stringify(result.postMatchProcessing).includes("api-key"),
    false
  );
  assert.deepEqual(result.providerResults, []);
  assert.deepEqual(payoutCalls, [["exchange-order-1"]]);
  assert.equal(result.postMatchProcessing.exchangePayout.succeeded, true);
  assert.equal(errors.length, 1);
});

test("post-match processing surfaces exchange payout failure without throwing", async () => {
  const errors = [];
  console.error = (...args) => {
    errors.push(args);
  };
  providerJobService.processOrders = async (orderIds) => [
    { orderId: orderIds[0], success: true },
  ];
  exchangePayoutJobService.processExchangeOrders = async () => {
    const error = new Error("private key must not leak");
    error.code = "private-key-secret";
    error.statusCode = 503;
    throw error;
  };

  const result = await runPostMatchProcessing({
    matchedOrderIds: ["energy-order-1"],
    matchedExchangeOrderIds: ["exchange-order-1"],
    processProviderJobs: true,
    processExchangePayouts: true,
  });

  assert.equal(result.postMatchProcessing.provider.succeeded, true);
  assert.equal(result.postMatchProcessing.exchangePayout.triggered, true);
  assert.equal(result.postMatchProcessing.exchangePayout.succeeded, false);
  assert.deepEqual(result.postMatchProcessing.exchangePayout.error, {
    message: "Exchange payout post-match processing failed",
    code: "POST_MATCH_PROCESSING_FAILED",
    statusCode: 503,
  });
  assert.equal(
    JSON.stringify(result.postMatchProcessing).includes("private key"),
    false
  );
  assert.deepEqual(result.exchangePayoutResults, []);
  assert.equal(errors.length, 1);
});

test("post-match processing is inert when flags are off or no ids matched", async () => {
  let providerCalled = false;
  let payoutCalled = false;
  providerJobService.processOrders = async () => {
    providerCalled = true;
    return [];
  };
  exchangePayoutJobService.processExchangeOrders = async () => {
    payoutCalled = true;
    return [];
  };

  const disabledResult = await runPostMatchProcessing({
    matchedOrderIds: ["energy-order-1"],
    matchedExchangeOrderIds: ["exchange-order-1"],
    processProviderJobs: false,
    processExchangePayouts: false,
  });
  const noMatchResult = await runPostMatchProcessing({
    matchedOrderIds: [],
    matchedExchangeOrderIds: [],
    processProviderJobs: true,
    processExchangePayouts: true,
  });

  assert.equal(providerCalled, false);
  assert.equal(payoutCalled, false);
  assert.deepEqual(disabledResult.postMatchProcessing.provider, {
    triggered: false,
    attempted: 0,
    succeeded: false,
    failed: false,
    resultCount: 0,
    error: null,
  });
  assert.deepEqual(
    disabledResult.postMatchProcessing,
    noMatchResult.postMatchProcessing
  );
});

test("deposit scan min timestamp freezes lookback once per scan", async () => {
  process.env.TREASURY_TRON_ADDRESS = "TTreasury111111111111111111111111111";
  process.env.DEPOSIT_SCAN_LOOKBACK_MINUTES = "1";
  delete process.env.EXCHANGE_TREASURY_TRON_ADDRESS;
  let dateNowCalls = 0;
  const trxCalls = [];
  const trc20Calls = [];

  Date.now = () => {
    dateNowCalls += 1;
    return 1_000_000 + dateNowCalls;
  };
  tronGridClient.fetchInboundTrxTransfers = async (_address, options) => {
    trxCalls.push(options);
    return {
      deposits: [],
      fingerprint: trxCalls.length === 1 ? "trx-cursor-2" : null,
    };
  };
  tronGridClient.fetchInboundTrc20Transfers = async (_address, options) => {
    trc20Calls.push(options);
    return { deposits: [], fingerprint: null };
  };

  const result = await scanConfiguredTreasury({
    limit: 1,
    maxPages: 5,
  });
  const expectedMinTimestamp = 940001;

  assert.equal(result.truncated, false);
  assert.equal(dateNowCalls, 1);
  assert.deepEqual(
    [...trxCalls, ...trc20Calls].map((call) => call.minTimestamp),
    [expectedMinTimestamp, expectedMinTimestamp, expectedMinTimestamp]
  );
  assert.equal(resolveDepositScanMinTimestamp(123), 123);
});

test("paginated inbound transfer fetch walks TronGrid fingerprint pages", async () => {
  const calls = [];
  const result = await fetchPaginatedInboundTransfers({
    address: "TTreasury111111111111111111111111111",
    asset: "TRX",
    limit: 2,
    minTimestamp: 1234567890,
    maxPages: 5,
    fetchPage: async (address, options) => {
      calls.push({ address, options });
      if (calls.length === 1) {
        return {
          deposits: [{ txHash: "first-page" }],
          fingerprint: "cursor-2",
        };
      }
      return {
        deposits: [{ txHash: "second-page" }],
        fingerprint: null,
      };
    },
  });

  assert.equal(result.truncated, false);
  assert.equal(result.pageCount, 2);
  assert.deepEqual(
    result.deposits.map((deposit) => deposit.txHash),
    ["first-page", "second-page"]
  );
  assert.deepEqual(
    calls.map((call) => call.options.fingerprint),
    [null, "cursor-2"]
  );
  assert.equal(calls[0].options.limit, 2);
  assert.equal(calls[0].options.minTimestamp, 1234567890);
});

test("paginated inbound transfer fetch reports truncation at the page cap", async () => {
  const calls = [];
  const result = await fetchPaginatedInboundTransfers({
    address: "TTreasury111111111111111111111111111",
    asset: "TRC20",
    limit: 1,
    maxPages: 2,
    fetchPage: async (_address, options) => {
      calls.push(options);
      return {
        deposits: [{ txHash: `page-${calls.length}` }],
        fingerprint: `cursor-${calls.length + 1}`,
      };
    },
  });

  assert.equal(result.truncated, true);
  assert.equal(result.nextFingerprintAvailable, true);
  assert.equal(result.pageCount, 2);
  assert.deepEqual(
    result.deposits.map((deposit) => deposit.txHash),
    ["page-1", "page-2"]
  );
  assert.deepEqual(
    calls.map((call) => call.fingerprint),
    [null, "cursor-2"]
  );
});

test("paginated inbound transfer fetch does not request another page without cursor", async () => {
  let calls = 0;
  const result = await fetchPaginatedInboundTransfers({
    address: "TTreasury111111111111111111111111111",
    asset: "TRX",
    limit: 50,
    maxPages: 20,
    fetchPage: async () => {
      calls += 1;
      return {
        deposits: [],
        fingerprint: "",
      };
    },
  });

  assert.equal(calls, 1);
  assert.equal(result.pageCount, 1);
  assert.equal(result.truncated, false);
});

test("configured treasury scan returns and logs truncation warnings", async () => {
  process.env.TREASURY_TRON_ADDRESS = "TTreasury111111111111111111111111111";
  delete process.env.EXCHANGE_TREASURY_TRON_ADDRESS;
  const warnMessages = [];
  const trxCalls = [];
  const trc20Calls = [];

  console.warn = (message) => {
    warnMessages.push(message);
  };
  tronGridClient.fetchInboundTrxTransfers = async (_address, options) => {
    trxCalls.push(options);
    return { deposits: [], fingerprint: `trx-cursor-${trxCalls.length}` };
  };
  tronGridClient.fetchInboundTrc20Transfers = async (_address, options) => {
    trc20Calls.push(options);
    return { deposits: [], fingerprint: null };
  };

  const result = await scanConfiguredTreasury({
    limit: 1,
    maxPages: 2,
  });

  assert.equal(result.scanned, 0);
  assert.equal(result.truncated, true);
  assert.equal(result.truncationWarnings.length, 1);
  assert.equal(result.truncationWarnings[0].asset, "TRX");
  assert.equal(result.truncationWarnings[0].pageCount, 2);
  assert.deepEqual(result.postMatchProcessing, {
    provider: {
      triggered: false,
      attempted: 0,
      succeeded: false,
      failed: false,
      resultCount: 0,
      error: null,
    },
    exchangePayout: {
      triggered: false,
      attempted: 0,
      succeeded: false,
      failed: false,
      resultCount: 0,
      error: null,
    },
  });
  assert.equal(warnMessages.length, 1);
  assert.match(warnMessages[0], /reached 2 pages/);
  assert.deepEqual(
    trxCalls.map((call) => call.fingerprint),
    [null, "trx-cursor-1"]
  );
  assert.equal(trc20Calls.length, 1);
  assert.deepEqual(
    result.pageSummaries.map((summary) => ({
      asset: summary.asset,
      pageCount: summary.pageCount,
      truncated: summary.truncated,
    })),
    [
      { asset: "TRX", pageCount: 2, truncated: true },
      { asset: "TRC20", pageCount: 1, truncated: false },
    ]
  );
});
