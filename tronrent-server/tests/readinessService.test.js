"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const readinessService = require("../services/readinessService");

const ORIGINAL_ENV = { ...process.env };

test.afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function makeReq(token) {
  return {
    get(headerName) {
      return headerName === "x-admin-token" ? token : undefined;
    },
  };
}

function liveEnv(overrides = {}) {
  return {
    ENABLE_READINESS_ENDPOINT: "true",
    DEPOSIT_WATCHER_ADMIN_TOKEN: "admin-secret",
    ENABLE_DEPOSIT_SCAN_ENDPOINT: "true",
    ENABLE_DEPOSIT_WATCHER_CRON: "true",
    DEPOSIT_WATCHER_PROCESS_PROVIDER_JOBS: "true",
    DEPOSIT_WATCHER_PROCESS_EXCHANGE_PAYOUTS: "true",
    TREASURY_TRON_ADDRESS: "TEnergyTreasury1111111111111111111",
    EXCHANGE_TREASURY_TRON_ADDRESS: "TExchangeTreasury11111111111111",
    TRON_TRC20_ALLOWLIST: "USDT:TUsdtContractSecret111111111111:6",
    ENERGY_PROVIDER: "apitrx",
    PROVIDER_LIVE: "true",
    APITRX_API_KEY: "super-secret-apitrx-key",
    ENABLE_PROVIDER_JOB_ENDPOINT: "true",
    ENABLE_ORDER_PROVIDER_CRON: "false",
    EXCHANGE_PAYOUT_LIVE: "true",
    EXCHANGE_PAYOUT_PRIVATE_KEY: "private-key-must-not-leak",
    EXCHANGE_PAYOUT_FROM_ADDRESS: "THotWalletAddress11111111111111",
    ENABLE_EXCHANGE_PAYOUT_ENDPOINT: "true",
    ENABLE_ORDER_EXPIRY_CRON: "true",
    ENABLE_EXCHANGE_EXPIRY_CRON: "true",
    ENABLE_DEV_PAYMENT_CONFIRMATION: "false",
    ...overrides,
  };
}

test("readiness endpoint gate rejects disabled route with 403", () => {
  process.env.ENABLE_READINESS_ENDPOINT = "false";
  process.env.DEPOSIT_WATCHER_ADMIN_TOKEN = "admin-secret";

  assert.throws(
    () => readinessService.assertReadinessRouteEnabled(makeReq("admin-secret")),
    (error) =>
      error.statusCode === 403 &&
      error.message === readinessService.READINESS_DISABLED_MESSAGE
  );
});

test("readiness endpoint gate rejects disabled route before token checks", () => {
  process.env.ENABLE_READINESS_ENDPOINT = "false";
  delete process.env.DEPOSIT_WATCHER_ADMIN_TOKEN;

  assert.throws(
    () => readinessService.assertReadinessRouteEnabled(makeReq(undefined)),
    (error) =>
      error.statusCode === 403 &&
      error.message === readinessService.READINESS_DISABLED_MESSAGE
  );
});

test("readiness endpoint gate rejects missing admin token with opaque 404", () => {
  process.env.ENABLE_READINESS_ENDPOINT = "true";
  process.env.DEPOSIT_WATCHER_ADMIN_TOKEN = "admin-secret";

  assert.throws(
    () => readinessService.assertReadinessRouteEnabled(makeReq(undefined)),
    (error) => error.statusCode === 404 && error.message === "Not found"
  );
});

test("readiness endpoint gate rejects wrong admin token with opaque 404", () => {
  process.env.ENABLE_READINESS_ENDPOINT = "true";
  process.env.DEPOSIT_WATCHER_ADMIN_TOKEN = "admin-secret";

  assert.throws(
    () => readinessService.assertReadinessRouteEnabled(makeReq("wrong-token")),
    (error) => error.statusCode === 404 && error.message === "Not found"
  );
});

test("readiness endpoint gate accepts matching admin token", () => {
  process.env.ENABLE_READINESS_ENDPOINT = "true";
  process.env.DEPOSIT_WATCHER_ADMIN_TOKEN = "admin-secret";

  assert.doesNotThrow(() =>
    readinessService.assertReadinessRouteEnabled(makeReq("admin-secret"))
  );
});

test("readiness report marks fully automated live configuration without leaking secrets", () => {
  const env = liveEnv();
  const report = readinessService.buildReadinessReport({
    env,
    now: new Date("2026-07-01T00:00:00.000Z"),
  });
  const serialized = JSON.stringify(report);

  assert.equal(report.summary.mode, "live");
  assert.equal(report.summary.readyForLiveOperations, true);
  assert.equal(report.warnings.length, 0);
  assert.equal(report.provider.apitrxApiKeyConfigured, true);
  assert.equal(report.exchangePayout.privateKeyConfigured, true);
  assert.deepEqual(report.trc20.symbols, ["USDT"]);
  assert.equal(serialized.includes(env.APITRX_API_KEY), false);
  assert.equal(serialized.includes(env.EXCHANGE_PAYOUT_PRIVATE_KEY), false);
  assert.equal(serialized.includes(env.EXCHANGE_PAYOUT_FROM_ADDRESS), false);
  assert.equal(serialized.includes(env.TREASURY_TRON_ADDRESS), false);
  assert.equal(serialized.includes("TUsdtContractSecret111111111111"), false);
});

test("readiness report flags provider live mode without APITRX key", () => {
  const report = readinessService.buildReadinessReport({
    env: liveEnv({ APITRX_API_KEY: "" }),
  });

  assert.equal(report.summary.mode, "partial-live");
  assert.equal(report.summary.readyForLiveOperations, false);
  assert.equal(
    report.warnings.some(
      (warning) => warning.code === "PROVIDER_LIVE_MISSING_API_KEY"
    ),
    true
  );
});

test("readiness report flags exchange payout live mode without hot wallet and USDT allowlist", () => {
  const report = readinessService.buildReadinessReport({
    env: liveEnv({
      EXCHANGE_PAYOUT_PRIVATE_KEY: "",
      EXCHANGE_PAYOUT_FROM_ADDRESS: "",
      TRON_TRC20_ALLOWLIST: "",
    }),
  });

  assert.equal(report.summary.mode, "partial-live");
  assert.equal(report.summary.readyForLiveOperations, false);
  assert.equal(
    report.warnings.some(
      (warning) => warning.code === "EXCHANGE_PAYOUT_LIVE_MISSING_PRIVATE_KEY"
    ),
    true
  );
  assert.equal(
    report.warnings.some(
      (warning) => warning.code === "EXCHANGE_PAYOUT_LIVE_MISSING_FROM_ADDRESS"
    ),
    true
  );
  assert.equal(
    report.warnings.some(
      (warning) => warning.code === "EXCHANGE_PAYOUT_LIVE_MISSING_USDT_ALLOWLIST"
    ),
    true
  );
});

test("readiness report distinguishes dry-run from partial-live automation", () => {
  assert.equal(
    readinessService.buildReadinessReport({ env: {} }).summary.mode,
    "dry-run"
  );

  const partial = readinessService.buildReadinessReport({
    env: {
      ENABLE_DEPOSIT_WATCHER_CRON: "true",
      DEPOSIT_WATCHER_PROCESS_PROVIDER_JOBS: "true",
    },
  });

  assert.equal(partial.summary.mode, "partial-live");
  assert.equal(
    partial.warnings.some(
      (warning) => warning.code === "PROVIDER_AUTOMATION_DRY_RUN"
    ),
    true
  );
});

test("readiness report flags live gates without the full automation path", () => {
  const report = readinessService.buildReadinessReport({
    env: liveEnv({
      ENABLE_DEPOSIT_WATCHER_CRON: "false",
      DEPOSIT_WATCHER_PROCESS_PROVIDER_JOBS: "false",
      DEPOSIT_WATCHER_PROCESS_EXCHANGE_PAYOUTS: "false",
    }),
  });

  assert.equal(report.summary.mode, "partial-live");
  assert.equal(report.summary.readyForLiveOperations, false);
  assert.equal(
    report.warnings.some(
      (warning) => warning.code === "PROVIDER_LIVE_WITHOUT_AUTOMATION"
    ),
    true
  );
  assert.equal(
    report.warnings.some(
      (warning) => warning.code === "EXCHANGE_PAYOUT_LIVE_WITHOUT_AUTOMATION"
    ),
    true
  );
});

test("TRC20 allowlist parser reports only valid configured symbols", () => {
  assert.deepEqual(
    readinessService.parseTrc20Allowlist({
      TRON_TRC20_ALLOWLIST:
        "USDT:TUsdtContract111111111111111111:6,BAD:,WIN:TWinContract111111111111111111:18",
    }),
    [
      { symbol: "USDT", configured: true },
      { symbol: "WIN", configured: true },
    ]
  );
});
