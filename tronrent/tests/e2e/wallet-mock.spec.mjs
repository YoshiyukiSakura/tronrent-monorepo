import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { FRONTEND_TEST_IDS } = require("../../src/lib/testIds.js");
const {
  E2E_TREASURY_ADDRESS,
  E2E_USDT_CONTRACT_ADDRESS,
  E2E_WALLET_ADDRESS,
} = require("../../src/lib/dev/e2eWalletMock.js");

const API_BASE_URL_PATTERN = "**/api/**";

function futureIso(minutes = 10) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function envelope(data) {
  return {
    success: true,
    data,
  };
}

async function fulfillJson(route, data, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
    },
    body: JSON.stringify(data),
  });
}

function makeEnergyOrder() {
  return {
    id: "energy-order-wallet-e2e",
    idempotencyKey: "energy-idempotency-e2e",
    planId: "starter",
    targetAddress: E2E_WALLET_ADDRESS,
    customerWalletAddress: E2E_WALLET_ADDRESS,
    paymentMethod: "wallet_connect",
    status: "pending_payment",
    priceAmountSun: "2340001",
    basePriceAmountSun: "2340000",
    priceOffsetSun: 1,
    priceDisplay: "2.340001 TRX",
    energyAmount: 65000,
    durationHours: 1,
    paymentReference: "energy-order-wallet-e2e",
    expiresAt: futureIso(),
    paidAt: null,
    fulfilledAt: null,
    payments: [],
    providerJobs: [],
    treasuryAddress: E2E_TREASURY_ADDRESS,
    paymentInstructions: {
      method: "wallet_connect",
      asset: "TRX",
      amountSun: "2340001",
      amountDisplay: "2.340001 TRX",
      address: E2E_TREASURY_ADDRESS,
      paymentReference: "energy-order-wallet-e2e",
      executionMode: {
        providerLive: false,
      },
      configured: true,
      warnings: ["E2E 假后端不会把钱包广播自动标记为已付款。"],
    },
  };
}

function makeExchangeQuote(direction) {
  const inputAsset = direction === "TRX_TO_USDT" ? "TRX" : "USDT";
  const outputAsset = direction === "TRX_TO_USDT" ? "USDT" : "TRX";
  return {
    id: `quote-${direction.toLowerCase()}`,
    direction,
    inputAsset,
    outputAsset,
    inputAmount: "100",
    outputAmount: direction === "TRX_TO_USDT" ? "10.00" : "995.00",
    spreadBps: 50,
    status: "active",
    expiresAt: futureIso(),
    metadata: {
      executionEnabled: false,
      rate: direction === "TRX_TO_USDT" ? 0.1 : 9.95,
      source: "playwright-e2e",
    },
  };
}

function makeExchangeOrder(direction) {
  const inputAsset = direction === "TRX_TO_USDT" ? "TRX" : "USDT";
  const outputAsset = direction === "TRX_TO_USDT" ? "USDT" : "TRX";
  const isUsdtInput = inputAsset === "USDT";
  return {
    id: `exchange-order-${direction.toLowerCase()}`,
    idempotencyKey: `exchange-idempotency-${direction.toLowerCase()}`,
    quoteId: `quote-${direction.toLowerCase()}`,
    direction,
    status: "pending_deposit",
    customerWalletAddress: E2E_WALLET_ADDRESS,
    outputAddress: E2E_WALLET_ADDRESS,
    treasuryAddress: E2E_TREASURY_ADDRESS,
    inputAsset,
    outputAsset,
    inputContractAddress: isUsdtInput ? E2E_USDT_CONTRACT_ADDRESS : null,
    outputContractAddress: isUsdtInput ? null : E2E_USDT_CONTRACT_ADDRESS,
    expectedInputBaseUnits: isUsdtInput ? "100000000" : "100000000",
    baseInputBaseUnits: isUsdtInput ? "100000000" : "100000000",
    inputOffsetBaseUnits: 0,
    outputBaseUnits: direction === "TRX_TO_USDT" ? "10000000" : "995000000",
    quoteInputAmount: "100",
    quoteOutputAmount: direction === "TRX_TO_USDT" ? "10.00" : "995.00",
    inputAmountDisplay: `100 ${inputAsset}`,
    outputAmountDisplay: direction === "TRX_TO_USDT" ? "10 USDT" : "995 TRX",
    spreadBps: 50,
    rate: direction === "TRX_TO_USDT" ? "0.1" : "9.95",
    depositReference: `exchange-order-${direction.toLowerCase()}`,
    expiresAt: futureIso(),
    fundsReceivedAt: null,
    payoutCompletedAt: null,
    depositInstructions: {
      asset: inputAsset,
      amountBaseUnits: isUsdtInput ? "100000000" : "100000000",
      amountDisplay: `100 ${inputAsset}`,
      address: E2E_TREASURY_ADDRESS,
      contractAddress: isUsdtInput ? E2E_USDT_CONTRACT_ADDRESS : null,
      depositReference: `exchange-order-${direction.toLowerCase()}`,
      executionMode: {
        payoutLive: false,
      },
      warnings: ["E2E 假后端不会把钱包广播自动标记为已入金。"],
    },
    payoutJobs: [],
  };
}

async function installApiRoutes(page) {
  let lastExchangeDirection = "TRX_TO_USDT";

  await page.route(API_BASE_URL_PATTERN, async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await fulfillJson(route, {}, 204);
      return;
    }

    const url = new URL(request.url());
    const path = url.pathname;

    if (path === "/api/catalog/plans") {
      await fulfillJson(
        route,
        envelope([
          {
            id: "starter",
            name: "Starter",
            description: "E2E energy plan",
            priceSun: "2340001",
            priceDisplay: "2.340001 TRX",
            paymentAsset: "TRX",
            energyAmount: 65000,
            durationHours: 1,
            support: "E2E",
            isPopular: true,
          },
        ])
      );
      return;
    }

    if (path === "/api/orders" && request.method() === "POST") {
      await fulfillJson(route, envelope(makeEnergyOrder()));
      return;
    }

    if (path === "/api/orders/energy-order-wallet-e2e") {
      await fulfillJson(route, envelope(makeEnergyOrder()));
      return;
    }

    if (path === "/api/exchange/quotes" && request.method() === "POST") {
      const body = JSON.parse(request.postData() || "{}");
      lastExchangeDirection = body.direction || "TRX_TO_USDT";
      await fulfillJson(route, envelope(makeExchangeQuote(lastExchangeDirection)));
      return;
    }

    if (path === "/api/exchange/orders" && request.method() === "POST") {
      await fulfillJson(route, envelope(makeExchangeOrder(lastExchangeDirection)));
      return;
    }

    if (path.startsWith("/api/exchange/orders/")) {
      const direction = path.includes("usdt_to_trx")
        ? "USDT_TO_TRX"
        : lastExchangeDirection;
      await fulfillJson(route, envelope(makeExchangeOrder(direction)));
      return;
    }

    await fulfillJson(route, { success: false, message: `Unhandled ${path}` }, 404);
  });
}

async function waitForMockWallet(page) {
  await page.waitForFunction(
    () => Boolean(window.tronWeb && window.__TRONRENT_E2E_WALLET_MOCK__),
    null,
    { timeout: 15_000 }
  );
  await expect(page.getByRole("button", { name: /T9yD14.*uWwb/ })).toBeVisible({
    timeout: 15_000,
  });
}

test.beforeEach(async ({ page }) => {
  await installApiRoutes(page);
});

test("rent wallet payment broadcasts through dev wallet mock without settling order", async ({
  page,
}) => {
  await page.goto("/rent");
  await waitForMockWallet(page);
  await page.locator('input[placeholder="T..."]').fill(E2E_WALLET_ADDRESS);
  await page.getByTestId(FRONTEND_TEST_IDS.rentCreateOrderCta).click();

  await expect(
    page.getByTestId(FRONTEND_TEST_IDS.rentPaymentInstructions)
  ).toBeVisible();
  await page.getByTestId(FRONTEND_TEST_IDS.rentWalletPaymentCta).click();

  await expect(
    page.getByTestId(FRONTEND_TEST_IDS.rentWalletPaymentTxid)
  ).toContainText("e2e-trx-0001");
  await expect(page.getByTestId(FRONTEND_TEST_IDS.rentOrderStatus)).toContainText(
    "等待付款"
  );

  const transactions = await page.evaluate(
    () => window.__TRONRENT_E2E_WALLET_MOCK__.transactions
  );
  expect(transactions).toMatchObject([
    {
      asset: "TRX",
      toAddress: E2E_TREASURY_ADDRESS,
      amountSun: 2340001,
    },
  ]);
});

test("exchange wallet deposit broadcasts TRX and remains pending backend scan", async ({
  page,
}) => {
  await page.goto("/exchange");
  await waitForMockWallet(page);
  await page.getByRole("button", { name: "获取报价" }).click();
  await page.getByTestId(FRONTEND_TEST_IDS.exchangeCreateOrderCta).click();
  await page.getByTestId(FRONTEND_TEST_IDS.exchangeWalletDepositCta).click();

  await expect(
    page.getByTestId(FRONTEND_TEST_IDS.exchangeWalletDepositTxid)
  ).toContainText("e2e-trx-0001");
  await expect(
    page.getByTestId(FRONTEND_TEST_IDS.exchangeOrderStatus)
  ).toContainText("等待入金");
});

test("exchange wallet deposit broadcasts USDT through allowlisted contract", async ({
  page,
}) => {
  await page.goto("/exchange");
  await waitForMockWallet(page);
  await page.getByRole("button", { name: "USDT -> TRX" }).click();
  await page.getByRole("button", { name: "获取报价" }).click();
  await page.getByTestId(FRONTEND_TEST_IDS.exchangeCreateOrderCta).click();
  await page.getByTestId(FRONTEND_TEST_IDS.exchangeWalletDepositCta).click();

  await expect(
    page.getByTestId(FRONTEND_TEST_IDS.exchangeWalletDepositTxid)
  ).toContainText("e2e-usdt-0001");

  const transactions = await page.evaluate(
    () => window.__TRONRENT_E2E_WALLET_MOCK__.transactions
  );
  expect(transactions).toMatchObject([
    {
      asset: "USDT",
      contractAddress: E2E_USDT_CONTRACT_ADDRESS,
      toAddress: E2E_TREASURY_ADDRESS,
      amountBaseUnits: "100000000",
    },
  ]);
});

test("wallet mock browser path still fails closed on wrong network", async ({
  page,
}) => {
  await page.goto("/rent");
  await waitForMockWallet(page);
  await page
    .locator('input[placeholder="T..."]')
    .fill(E2E_WALLET_ADDRESS);
  await page.getByTestId(FRONTEND_TEST_IDS.rentCreateOrderCta).click();
  await page.evaluate(() => {
    window.__TRONRENT_E2E_WALLET_MOCK__.setNetworkHost(
      "https://nile.trongrid.io"
    );
  });
  await page.getByTestId(FRONTEND_TEST_IDS.rentWalletPaymentCta).click();

  await expect(page.getByText(/订单要求 mainnet/)).toBeVisible();
  await expect(
    page.getByTestId(FRONTEND_TEST_IDS.rentWalletPaymentTxid)
  ).toHaveCount(0);

  const transactions = await page.evaluate(
    () => window.__TRONRENT_E2E_WALLET_MOCK__.transactions
  );
  expect(transactions).toEqual([]);
});
