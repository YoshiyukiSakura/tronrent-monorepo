import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const {
  ProofPollingError,
  ProofRefreshButton,
  ProofSelectorRegion,
} = require("../src/components/ProofSelectors.js");
const { FRONTEND_TEST_IDS } = require("../src/lib/testIds.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function readSource(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("frontend test ids are unique and stable", () => {
  const values = Object.values(FRONTEND_TEST_IDS);
  assert.equal(values.length, new Set(values).size);
  for (const value of values) {
    assert.match(value, /^[a-z0-9-]+$/);
  }
});

test("rent page exposes proof selectors for browser smoke tests", () => {
  const source = readSource("src/app/rent/page.tsx");
  assert.match(source, /data-testid={FRONTEND_TEST_IDS\.rentCreateOrderCta}/);
  assert.match(
    source,
    /<ProofSelectorRegion[\s\S]*?testId={FRONTEND_TEST_IDS\.rentPaymentInstructions}/
  );
  assert.match(
    source,
    /<ProofSelectorRegion testId={FRONTEND_TEST_IDS\.rentOrderId}>/
  );
  assert.match(
    source,
    /<ProofSelectorRegion testId={FRONTEND_TEST_IDS\.rentOrderStatus}>/
  );
  assert.match(
    source,
    /<ProofRefreshButton[\s\S]*?testId={FRONTEND_TEST_IDS\.rentRefreshStatus}/
  );
  assert.match(
    source,
    /<ProofPollingError[\s\S]*?testId={FRONTEND_TEST_IDS\.rentPollingError}/
  );
});

test("exchange page exposes proof selectors for browser smoke tests", () => {
  const source = readSource("src/app/exchange/page.tsx");
  assert.match(
    source,
    /data-testid={FRONTEND_TEST_IDS\.exchangeCreateOrderCta}/
  );
  assert.match(
    source,
    /<ProofSelectorRegion[\s\S]*?testId={FRONTEND_TEST_IDS\.exchangeDepositInstructions}/
  );
  assert.match(
    source,
    /<ProofSelectorRegion testId={FRONTEND_TEST_IDS\.exchangeOrderId}>/
  );
  assert.match(
    source,
    /<ProofSelectorRegion[\s\S]*?testId={FRONTEND_TEST_IDS\.exchangeOrderStatus}/
  );
  assert.match(
    source,
    /<ProofRefreshButton[\s\S]*?testId={FRONTEND_TEST_IDS\.exchangeRefreshStatus}/
  );
  assert.match(
    source,
    /<ProofPollingError[\s\S]*?testId={FRONTEND_TEST_IDS\.exchangePollingError}/
  );
});

function renderProofSurface({
  instructionTestId,
  orderIdTestId,
  pollingErrorTestId,
  refreshTestId,
  statusTestId,
}) {
  return renderToStaticMarkup(
    React.createElement(
      ProofSelectorRegion,
      { testId: instructionTestId },
      React.createElement(
        ProofSelectorRegion,
        { testId: statusTestId },
        "等待付款"
      ),
      React.createElement(ProofRefreshButton, {
        isRefreshing: false,
        testId: refreshTestId,
      }),
      React.createElement(
        ProofSelectorRegion,
        { testId: orderIdTestId },
        "order-123"
      ),
      React.createElement(ProofPollingError, {
        message: "network down",
        testId: pollingErrorTestId,
      })
    )
  );
}

test("proof selector components server-render rent browser-smoke hooks", () => {
  const html = renderProofSurface({
    instructionTestId: FRONTEND_TEST_IDS.rentPaymentInstructions,
    orderIdTestId: FRONTEND_TEST_IDS.rentOrderId,
    pollingErrorTestId: FRONTEND_TEST_IDS.rentPollingError,
    refreshTestId: FRONTEND_TEST_IDS.rentRefreshStatus,
    statusTestId: FRONTEND_TEST_IDS.rentOrderStatus,
  });

  for (const testId of [
    FRONTEND_TEST_IDS.rentPaymentInstructions,
    FRONTEND_TEST_IDS.rentOrderId,
    FRONTEND_TEST_IDS.rentOrderStatus,
    FRONTEND_TEST_IDS.rentRefreshStatus,
    FRONTEND_TEST_IDS.rentPollingError,
  ]) {
    assert.match(html, new RegExp(`data-testid="${testId}"`));
  }
  assert.match(html, /刷新状态/);
  assert.match(html, /状态刷新失败：network down/);
});

test("proof selector components server-render exchange browser-smoke hooks", () => {
  const html = renderProofSurface({
    instructionTestId: FRONTEND_TEST_IDS.exchangeDepositInstructions,
    orderIdTestId: FRONTEND_TEST_IDS.exchangeOrderId,
    pollingErrorTestId: FRONTEND_TEST_IDS.exchangePollingError,
    refreshTestId: FRONTEND_TEST_IDS.exchangeRefreshStatus,
    statusTestId: FRONTEND_TEST_IDS.exchangeOrderStatus,
  });

  for (const testId of [
    FRONTEND_TEST_IDS.exchangeDepositInstructions,
    FRONTEND_TEST_IDS.exchangeOrderId,
    FRONTEND_TEST_IDS.exchangeOrderStatus,
    FRONTEND_TEST_IDS.exchangeRefreshStatus,
    FRONTEND_TEST_IDS.exchangePollingError,
  ]) {
    assert.match(html, new RegExp(`data-testid="${testId}"`));
  }
  assert.match(html, /刷新状态/);
  assert.match(html, /状态刷新失败：network down/);
});

test("proof polling error renders nothing until an error is present", () => {
  const html = renderToStaticMarkup(
    React.createElement(ProofPollingError, {
      message: "",
      testId: FRONTEND_TEST_IDS.rentPollingError,
    })
  );

  assert.equal(html, "");
});
