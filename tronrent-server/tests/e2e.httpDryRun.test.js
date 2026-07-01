"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const HAS_TEST_DATABASE = Boolean(process.env.TEST_DATABASE_URL);
const ADMIN_TOKEN = "runtime-e2e-token";
const USDT_CONTRACT_ADDRESS = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

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

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function listen(server, port = 0) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => resolve(server.address().port));
  });
}

function closeServer(server) {
  if (!server.listening) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function terminateProcess(child) {
  if (!child || child.exitCode !== null || child.signalCode) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 2_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

async function requestJson(baseUrl, pathname, init = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const payload = await response.json();
  if (!response.ok || payload.success === false) {
    throw new Error(
      `${init.method || "GET"} ${pathname} failed: ${
        payload.message || response.statusText
      }`
    );
  }
  return { response, payload };
}

async function waitForHealth(baseUrl, child, logs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 8_000) {
    if (child.exitCode !== null) {
      throw new Error(`app process exited early:\n${logs.join("")}`);
    }

    try {
      const { payload } = await requestJson(baseUrl, "/health", {
        headers: { Origin: "http://localhost:3101" },
      });
      if (payload.status === "ok") {
        return;
      }
    } catch (error) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  throw new Error(`app did not become healthy:\n${logs.join("")}`);
}

function createFakeTronGridServer({ trxDepositsByAddress, trc20DepositsByAddress }) {
  return http.createServer((req, res) => {
    const requestUrl = new URL(req.url, "http://fake-trongrid.local");
    const match = requestUrl.pathname.match(/^\/v1\/accounts\/([^/]+)\/transactions(\/trc20)?$/);
    const address = match?.[1];
    const isTrc20 = Boolean(match?.[2]);
    const rows = address
      ? isTrc20
        ? trc20DepositsByAddress.get(address) || []
        : trxDepositsByAddress.get(address) || []
      : [];

    res.writeHead(match ? 200 : 404, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        data: match ? rows : [],
        meta: {},
      })
    );
  });
}

function buildTrxTransferRow({ txHash, fromAddress, amountBaseUnits }) {
  return {
    txID: txHash,
    raw_data: {
      contract: [
        {
          parameter: {
            value: {
              owner_address: fromAddress,
              amount: Number(amountBaseUnits),
            },
          },
        },
      ],
    },
    blockNumber: 70_001,
    block_timestamp: Date.now(),
  };
}

function buildTrc20TransferRow({ txHash, fromAddress, toAddress, amountBaseUnits }) {
  return {
    transaction_id: txHash,
    event_index: "0",
    token_info: {
      address: USDT_CONTRACT_ADDRESS,
      decimals: 6,
      symbol: "USDT",
    },
    from: fromAddress,
    to: toAddress,
    value: String(amountBaseUnits),
    block_number: 70_002,
    block_timestamp: Date.now(),
  };
}

async function createEnergyOrder(baseUrl) {
  const { payload } = await requestJson(baseUrl, "/api/orders", {
    method: "POST",
    body: JSON.stringify({
      idempotencyKey: "http-e2e-energy-order",
      planId: "basic",
      targetAddress: fixtureAddress(3),
      customerWalletAddress: fixtureAddress(4),
      paymentMethod: "deposit_address",
    }),
  });

  const order = payload.data;
  assert.equal(payload.success, true);
  assert.equal(order.status, "pending_payment");
  assert.equal(order.paymentMethod, "deposit_address");
  assert.equal(order.paymentInstructions.method, "deposit_address");
  assert.equal(order.paymentInstructions.asset, "TRX");
  assert.equal(order.paymentInstructions.address, fixtureAddress(1));
  assert.equal(order.paymentInstructions.amountSun, order.priceAmountSun);
  assert.equal(order.paymentInstructions.configured, true);

  return order;
}

async function createExchangeOrder({ baseUrl, direction, inputAmount, seed }) {
  const quoteResponse = await requestJson(baseUrl, "/api/exchange/quotes", {
    method: "POST",
    body: JSON.stringify({ direction, inputAmount }),
  });
  const quote = quoteResponse.payload.data;
  assert.equal(quote.direction, direction);
  assert.equal(quote.status, "quote_only");
  assert.equal(quote.metadata.executionEnabled, false);

  const orderResponse = await requestJson(baseUrl, "/api/exchange/orders", {
    method: "POST",
    body: JSON.stringify({
      idempotencyKey: `http-e2e-${direction.toLowerCase()}`,
      quoteId: quote.id,
      outputAddress: fixtureAddress(seed),
      customerWalletAddress: fixtureAddress(seed + 1),
    }),
  });
  const order = orderResponse.payload.data;
  assert.equal(order.status, "pending_deposit");
  assert.equal(order.direction, direction);
  assert.equal(order.depositInstructions.address, fixtureAddress(2));
  assert.equal(
    order.depositInstructions.amountBaseUnits,
    order.expectedInputBaseUnits
  );
  assert.equal(order.depositInstructions.executionMode.payoutLive, false);

  return order;
}

test(
  "HTTP runtime smoke drives dry-run automation through Express routes",
  {
    skip: HAS_TEST_DATABASE
      ? false
      : "TEST_DATABASE_URL is required for the HTTP dry-run E2E",
  },
  async (t) => {
    assertSafeTestDatabaseUrl(process.env.TEST_DATABASE_URL);

    const originalEnv = { ...process.env };
    process.env.NODE_ENV = "test";
    const serverRoot = path.resolve(__dirname, "..");
    const db = require("../db/models");
    const trxDepositsByAddress = new Map();
    const trc20DepositsByAddress = new Map();
    const fakeTronGrid = createFakeTronGridServer({
      trxDepositsByAddress,
      trc20DepositsByAddress,
    });
    let appProcess = null;

    t.after(async () => {
      await terminateProcess(appProcess);
      await closeServer(fakeTronGrid);
      await db.sequelize.close();
      process.env = originalEnv;
    });

    await db.sequelize.sync({ force: true });

    const fakeTronGridPort = await listen(fakeTronGrid);
    const appPort = await getFreePort();
    const appBaseUrl = `http://127.0.0.1:${appPort}`;
    const appLogs = [];

    appProcess = childProcess.spawn(process.execPath, ["app.js"], {
      cwd: serverRoot,
      env: {
        ...process.env,
        NODE_ENV: "test",
        PORT: String(appPort),
        TEST_DATABASE_URL: process.env.TEST_DATABASE_URL,
        CORS_ALLOWED_ORIGINS: "http://localhost:3101",
        TREASURY_TRON_ADDRESS: fixtureAddress(1),
        EXCHANGE_TREASURY_TRON_ADDRESS: fixtureAddress(2),
        TRON_TRC20_ALLOWLIST: `USDT:${USDT_CONTRACT_ADDRESS}:6`,
        MAX_PAYMENT_OFFSET_SUN: "0",
        ORDER_CREATE_MAX_ATTEMPTS: "1",
        EXCHANGE_MAX_PAYMENT_OFFSET_BASE_UNITS: "0",
        EXCHANGE_ORDER_CREATE_MAX_ATTEMPTS: "1",
        EXCHANGE_SPREAD_BPS: "0",
        EXCHANGE_TRX_USDT_RATE: "0.1",
        PROVIDER_LIVE: "false",
        ENERGY_PROVIDER: "apitrx",
        EXCHANGE_PAYOUT_LIVE: "false",
        ENABLE_DB_SYNC: "false",
        ENABLE_QUEUE_CRON: "false",
        ENABLE_ORDER_PROVIDER_CRON: "false",
        ENABLE_DEPOSIT_WATCHER_CRON: "false",
        ENABLE_EXCHANGE_PAYOUT_CRON: "false",
        ENABLE_ORDER_EXPIRY_CRON: "false",
        ENABLE_EXCHANGE_EXPIRY_CRON: "false",
        ENABLE_DEPOSIT_SCAN_ENDPOINT: "true",
        DEPOSIT_WATCHER_ADMIN_TOKEN: ADMIN_TOKEN,
        TRONGRID_API_BASE_URL: `http://127.0.0.1:${fakeTronGridPort}`,
        DEPOSIT_SCAN_LOOKBACK_MINUTES: "60",
        DEPOSIT_SCAN_MAX_PAGES: "2",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    appProcess.stdout.on("data", (chunk) => appLogs.push(chunk.toString()));
    appProcess.stderr.on("data", (chunk) => appLogs.push(chunk.toString()));

    await waitForHealth(appBaseUrl, appProcess, appLogs);

    const healthResponse = await fetch(`${appBaseUrl}/health`, {
      headers: { Origin: "http://localhost:3101" },
    });
    assert.equal(healthResponse.status, 200);
    assert.equal(
      healthResponse.headers.get("access-control-allow-origin"),
      "http://localhost:3101"
    );

    const plansResponse = await requestJson(appBaseUrl, "/api/catalog/plans");
    assert.equal(plansResponse.payload.success, true);
    assert.ok(Array.isArray(plansResponse.payload.data));
    assert.ok(plansResponse.payload.data.some((plan) => plan.id === "basic"));

    const energyOrder = await createEnergyOrder(appBaseUrl);
    const trxExchangeOrder = await createExchangeOrder({
      baseUrl: appBaseUrl,
      direction: "TRX_TO_USDT",
      inputAmount: "10",
      seed: 5,
    });
    const usdtExchangeOrder = await createExchangeOrder({
      baseUrl: appBaseUrl,
      direction: "USDT_TO_TRX",
      inputAmount: "2.5",
      seed: 7,
    });

    trxDepositsByAddress.set(fixtureAddress(1), [
      buildTrxTransferRow({
        txHash: "http-e2e-energy-payment",
        fromAddress: fixtureAddress(4),
        amountBaseUnits: energyOrder.priceAmountSun,
      }),
    ]);
    trxDepositsByAddress.set(fixtureAddress(2), [
      buildTrxTransferRow({
        txHash: "http-e2e-exchange-trx-payment",
        fromAddress: fixtureAddress(6),
        amountBaseUnits: trxExchangeOrder.expectedInputBaseUnits,
      }),
    ]);
    trc20DepositsByAddress.set(fixtureAddress(2), [
      buildTrc20TransferRow({
        txHash: "http-e2e-exchange-usdt-payment",
        fromAddress: fixtureAddress(8),
        toAddress: fixtureAddress(2),
        amountBaseUnits: usdtExchangeOrder.expectedInputBaseUnits,
      }),
    ]);

    const scanResponse = await requestJson(appBaseUrl, "/api/deposits/scan", {
      method: "POST",
      headers: { "x-admin-token": ADMIN_TOKEN },
      body: JSON.stringify({
        limit: 10,
        maxPages: 2,
        minTimestamp: Date.now() - 60_000,
        processProviderJobs: true,
        processExchangePayouts: true,
      }),
    });
    const scan = scanResponse.payload.data;
    assert.equal(scan.scanned, 3);
    assert.equal(scan.created, 3);
    assert.equal(scan.matched, 3);
    assert.equal(scan.postMatchProcessing.provider.triggered, true);
    assert.equal(scan.postMatchProcessing.provider.succeeded, true);
    assert.equal(scan.postMatchProcessing.exchangePayout.triggered, true);
    assert.equal(scan.postMatchProcessing.exchangePayout.succeeded, true);

    const finalEnergyResponse = await requestJson(
      appBaseUrl,
      `/api/orders/${energyOrder.id}`
    );
    const finalEnergyOrder = finalEnergyResponse.payload.data;
    assert.equal(finalEnergyOrder.status, "fulfilled");
    assert.equal(finalEnergyOrder.payments[0].status, "confirmed");
    assert.equal(finalEnergyOrder.payments[0].receivedAmountSun, energyOrder.priceAmountSun);
    assert.equal(finalEnergyOrder.providerJobs[0].status, "completed");
    assert.equal(finalEnergyOrder.providerJobs[0].dryRun, true);
    assert.equal(finalEnergyOrder.providerJobs[0].response.dryRun, true);

    for (const exchangeOrder of [trxExchangeOrder, usdtExchangeOrder]) {
      const finalExchangeResponse = await requestJson(
        appBaseUrl,
        `/api/exchange/orders/${exchangeOrder.id}`
      );
      const finalExchangeOrder = finalExchangeResponse.payload.data;
      assert.equal(finalExchangeOrder.status, "payout_completed");
      assert.equal(finalExchangeOrder.payoutJobs[0].status, "completed");
      assert.equal(finalExchangeOrder.payoutJobs[0].dryRun, true);
      assert.equal(finalExchangeOrder.payoutJobs[0].response.dryRun, true);
      assert.equal(
        finalExchangeOrder.payoutJobs[0].response.completionMeaning,
        "dry_run_no_transfer_broadcast"
      );
    }
  }
);
