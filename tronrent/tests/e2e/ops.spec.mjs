import { expect, test } from "@playwright/test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { FRONTEND_TEST_IDS } = require("../../src/lib/testIds.js");

const ADMIN_TOKEN = "ops-e2e-token";
const LEAK_ADDRESS = "TLeak11111111111111111111111111111111";
const LEAK_TXID = "txid-leak-should-not-render";
const LEAK_API_KEY = "secret-api-key-should-not-render";

function envelope(data, extra = {}) {
  return {
    success: true,
    data,
    ...extra,
  };
}

async function fulfillJson(route, data, status = 200) {
  await route.fulfill({
    status,
    contentType: "application/json",
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,x-admin-token",
    },
    body: JSON.stringify(data),
  });
}

function makeReadiness() {
  return {
    generatedAt: "2026-07-01T01:00:00.000Z",
    admin: {
      readinessEndpointEnabled: true,
      adminTokenConfigured: true,
    },
    depositScan: {
      endpointEnabled: true,
      cronEnabled: true,
      processProviderJobs: false,
      processExchangePayouts: false,
    },
    treasury: {
      energyTreasuryConfigured: true,
      exchangeTreasuryConfigured: true,
    },
    trc20: {
      allowlistConfigured: true,
      contractCount: 1,
      symbols: ["USDT"],
      usdtConfigured: true,
    },
    provider: {
      energyProvider: "apitrx",
      live: true,
      apitrxApiKeyConfigured: true,
      endpointEnabled: true,
      cronEnabled: false,
      readyForLive: true,
    },
    exchangePayout: {
      live: false,
      privateKeyConfigured: false,
      fromAddressConfigured: false,
      endpointEnabled: true,
      cronEnabled: false,
      readyForLive: false,
    },
    orderExpiry: {
      cronEnabled: true,
    },
    exchangeExpiry: {
      cronEnabled: true,
    },
    dev: {
      devPaymentConfirmationEnabled: false,
    },
    summary: {
      mode: "partial-live",
      readyForLiveOperations: false,
      warningCount: 1,
    },
    warnings: [
      {
        code: "EXCHANGE_PAYOUT_AUTOMATION_DRY_RUN",
        severity: "warning",
        message: "Exchange payout automation is dry-run in this fixture.",
      },
    ],
  };
}

function makeBacklog() {
  return {
    generatedAt: "2026-07-01T01:01:00.000Z",
    staleOlderThanMinutes: 10,
    staleCutoff: "2026-07-01T00:51:00.000Z",
    summary: {
      drainableCount: 5,
      manualReviewCount: 2,
      staleProcessingCount: 1,
      indeterminateOrderCount: 1,
      activeJobCount: 3,
      failedOrIndeterminateJobCount: 4,
      trackedStatusCount: 15,
    },
    provider: {
      orders: {
        statuses: {
          paid: 3,
          provisioning: 1,
          provisioning_indeterminate: 1,
        },
        drainable: {
          paid: 3,
        },
        manualReview: {
          provisioningIndeterminate: 1,
          staleProvisioning: 1,
        },
      },
      jobs: {
        statuses: {
          pending: 1,
          processing: 1,
          failed: 1,
          indeterminate: 1,
        },
      },
    },
    exchangePayout: {
      orders: {
        statuses: {
          funds_received: 2,
          payout_processing: 1,
          payout_failed: 1,
          payout_indeterminate: 1,
        },
        drainable: {
          fundsReceived: 2,
        },
        manualReview: {
          payoutIndeterminate: 1,
          stalePayoutProcessing: 0,
        },
      },
      jobs: {
        statuses: {
          processing: 1,
          failed: 1,
          indeterminate: 1,
        },
      },
    },
  };
}

async function installOpsRoutes(page, { disabled = false, serverError = false } = {}) {
  const calls = [];

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await fulfillJson(route, {}, 204);
      return;
    }

    const url = new URL(request.url());
    const path = url.pathname;
    calls.push({
      body: request.postData() || "",
      method: request.method(),
      path,
      token: request.headers()["x-admin-token"],
    });

    if (disabled) {
      await fulfillJson(route, { success: false, message: "Not found" }, 404);
      return;
    }

    if (serverError) {
      await fulfillJson(
        route,
        {
          success: false,
          message: `upstream leaked ${LEAK_ADDRESS} ${LEAK_TXID} ${LEAK_API_KEY}`,
        },
        500
      );
      return;
    }

    if (path === "/api/admin/readiness") {
      await fulfillJson(route, envelope(makeReadiness()));
      return;
    }

    if (path === "/api/admin/automation/backlog") {
      await fulfillJson(route, envelope(makeBacklog()));
      return;
    }

    if (path === "/api/deposits/scan") {
      await fulfillJson(
        route,
        envelope({
          scanned: 7,
          stored: 6,
          matched: 2,
          truncated: false,
          truncationWarnings: [],
          postMatchProcessing: {
            providerJobs: { triggered: false },
            exchangePayouts: { triggered: false },
          },
          data: [
            {
              toAddress: LEAK_ADDRESS,
              txHash: LEAK_TXID,
              apiKey: LEAK_API_KEY,
            },
          ],
        })
      );
      return;
    }

    if (path === "/api/provider-jobs/process") {
      await fulfillJson(
        route,
        envelope(
          [
            {
              targetAddress: LEAK_ADDRESS,
              upstreamOrderId: "upstream-leak",
              response: { apiKey: LEAK_API_KEY },
            },
          ],
          { count: 1 }
        )
      );
      return;
    }

    if (path === "/api/exchange/payout-jobs/process") {
      await fulfillJson(
        route,
        envelope(
          [
            {
              txid: LEAK_TXID,
              payoutAddress: LEAK_ADDRESS,
            },
          ],
          { count: 1 }
        )
      );
      return;
    }

    await fulfillJson(route, { success: false, message: `Unhandled ${path}` }, 404);
  });

  return calls;
}

async function loadOps(page) {
  await page.goto("/ops");
  await page.getByTestId(FRONTEND_TEST_IDS.opsTokenInput).fill(ADMIN_TOKEN);
  await page.getByTestId(FRONTEND_TEST_IDS.opsLoadStatus).click();
  await expect(page.getByTestId(FRONTEND_TEST_IDS.opsMode)).toContainText(
    "partial-live"
  );
}

test("ops console loads readiness and backlog with admin token", async ({ page }) => {
  const calls = await installOpsRoutes(page);

  await loadOps(page);

  await expect(page.getByTestId(FRONTEND_TEST_IDS.opsReadyForLive)).toContainText(
    "APITRX key"
  );
  await expect(page.getByTestId(FRONTEND_TEST_IDS.opsWarnings)).toContainText(
    "EXCHANGE_PAYOUT_AUTOMATION_DRY_RUN"
  );
  await expect(
    page.getByTestId(FRONTEND_TEST_IDS.opsBacklogSummary)
  ).toContainText("可处理队列");
  await expect(
    page.getByTestId(FRONTEND_TEST_IDS.opsBacklogSummary)
  ).toContainText("5");
  expect(calls.filter((call) => call.path.startsWith("/api/admin"))).toEqual([
    {
      body: "",
      method: "GET",
      path: "/api/admin/readiness",
      token: ADMIN_TOKEN,
    },
    {
      body: "",
      method: "GET",
      path: "/api/admin/automation/backlog",
      token: ADMIN_TOKEN,
    },
  ]);
});

test("ops console action buttons summarize responses without leaking raw fields", async ({
  page,
}) => {
  const calls = await installOpsRoutes(page);

  await loadOps(page);
  await expect(page.getByTestId(FRONTEND_TEST_IDS.opsDrainProvider)).toBeDisabled();
  await page.locator(`[data-testid="${FRONTEND_TEST_IDS.opsConfirmActions}"] input`).check();

  await page.getByTestId(FRONTEND_TEST_IDS.opsScanDeposits).click();
  await expect(page.getByTestId(FRONTEND_TEST_IDS.opsActionResult)).toContainText(
    "matched: 2"
  );
  await expect(page.getByTestId(FRONTEND_TEST_IDS.opsActionResult)).toContainText(
    "post-match provider: false / exchange: false"
  );

  await page.getByTestId(FRONTEND_TEST_IDS.opsDrainProvider).click();
  await expect(page.getByTestId(FRONTEND_TEST_IDS.opsActionResult)).toContainText(
    "处理能量进货队列完成"
  );

  await page.getByTestId(FRONTEND_TEST_IDS.opsDrainExchange).click();
  await expect(page.getByTestId(FRONTEND_TEST_IDS.opsActionResult)).toContainText(
    "处理兑换出款队列完成"
  );

  await expect(page.getByText(LEAK_ADDRESS)).toHaveCount(0);
  await expect(page.getByText(LEAK_TXID)).toHaveCount(0);
  await expect(page.getByText(LEAK_API_KEY)).toHaveCount(0);

  const actionCalls = calls.filter((call) => call.method === "POST");
  expect(actionCalls).toEqual([
    {
      body: "{}",
      method: "POST",
      path: "/api/deposits/scan",
      token: ADMIN_TOKEN,
    },
    {
      body: "{}",
      method: "POST",
      path: "/api/provider-jobs/process",
      token: ADMIN_TOKEN,
    },
    {
      body: "{}",
      method: "POST",
      path: "/api/exchange/payout-jobs/process",
      token: ADMIN_TOKEN,
    },
  ]);
});

test("ops console folds disabled or invalid admin routes into a generic error", async ({
  page,
}) => {
  await installOpsRoutes(page, { disabled: true });

  await page.goto("/ops");
  await page.getByTestId(FRONTEND_TEST_IDS.opsTokenInput).fill("wrong-token");
  await page.getByTestId(FRONTEND_TEST_IDS.opsLoadStatus).click();

  await expect(page.getByTestId(FRONTEND_TEST_IDS.opsError)).toContainText(
    "端点未启用或管理员 token 无效"
  );
});

test("ops console does not render backend error payloads", async ({ page }) => {
  await installOpsRoutes(page, { serverError: true });

  await page.goto("/ops");
  await page.getByTestId(FRONTEND_TEST_IDS.opsTokenInput).fill(ADMIN_TOKEN);
  await page.getByTestId(FRONTEND_TEST_IDS.opsLoadStatus).click();

  await expect(page.getByTestId(FRONTEND_TEST_IDS.opsError)).toContainText(
    "运营 API 请求失败"
  );
  await expect(page.getByText(LEAK_ADDRESS)).toHaveCount(0);
  await expect(page.getByText(LEAK_TXID)).toHaveCount(0);
  await expect(page.getByText(LEAK_API_KEY)).toHaveCount(0);
});
