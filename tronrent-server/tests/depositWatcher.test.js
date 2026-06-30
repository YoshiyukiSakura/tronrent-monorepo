"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DEPOSIT_STATUSES,
  buildDepositKey,
  classifyDepositMatch,
  isAllowedTrc20Deposit,
} = require("../services/depositMatcher");
const {
  assertDepositScanRouteEnabled,
  classifyExchangeDepositMatch,
  depositMatchesExchangeOrder,
} = require("../services/depositWatcherService");

const ORIGINAL_ENV = { ...process.env };

test.afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
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
