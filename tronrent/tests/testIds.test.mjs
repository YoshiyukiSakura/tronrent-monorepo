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

test("README documents every frontend browser-proof test id", () => {
  const readme = readSource("README.md");
  for (const [key, testId] of Object.entries(FRONTEND_TEST_IDS)) {
    assert.ok(
      readme.includes(`\`${testId}\``),
      `README.md must document FRONTEND_TEST_IDS.${key} (${testId})`
    );
  }
});

test("rent page exposes proof selectors for browser smoke tests", () => {
  const source = readSource("src/app/rent/page.tsx");
  assert.match(source, /data-testid={FRONTEND_TEST_IDS\.rentCreateOrderCta}/);
  assert.match(
    source,
    /data-testid={FRONTEND_TEST_IDS\.rentPaymentMethodWallet}/
  );
  assert.match(
    source,
    /data-testid={FRONTEND_TEST_IDS\.rentPaymentMethodDeposit}/
  );
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
    /data-testid={FRONTEND_TEST_IDS\.rentWalletPaymentCta}/
  );
  assert.match(
    source,
    /testId={FRONTEND_TEST_IDS\.rentWalletPaymentTxid}/
  );
  assert.match(source, /testId={FRONTEND_TEST_IDS\.rentPaymentAmount}/);
  assert.match(source, /testId={FRONTEND_TEST_IDS\.rentPaymentAddress}/);
  assert.match(source, /testId={FRONTEND_TEST_IDS\.rentPaymentReference}/);
  assert.match(source, /testId={FRONTEND_TEST_IDS\.rentDirectPayPanel}/);
  assert.match(source, /testId={FRONTEND_TEST_IDS\.rentDirectPayAddress}/);
  assert.match(source, /testId={FRONTEND_TEST_IDS\.rentDirectPayAmount}/);
  assert.match(
    source,
    /<ProofPollingError[\s\S]*?testId={FRONTEND_TEST_IDS\.rentPollingError}/
  );
});

test("rent page explains the 65k USDT transfer-unit plan framing", () => {
  const source = readSource("src/app/rent/page.tsx");

  assert.match(source, /function formatTransferCount/);
  assert.match(source, /65_000/);
  assert.match(source, /≈ \$\{transferCount\} 笔 USDT 转账/);
  assert.match(source, /首次收款或无 USDT/);
  assert.match(source, /APITRX 成本与毛利/);
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
    /data-testid={FRONTEND_TEST_IDS\.exchangeWalletDepositCta}/
  );
  assert.match(
    source,
    /testId={FRONTEND_TEST_IDS\.exchangeWalletDepositTxid}/
  );
  assert.match(source, /testId={FRONTEND_TEST_IDS\.exchangePaymentAmount}/);
  assert.match(source, /testId={FRONTEND_TEST_IDS\.exchangePaymentAddress}/);
  assert.match(source, /testId={FRONTEND_TEST_IDS\.exchangePaymentReference}/);
  assert.match(source, /testId={FRONTEND_TEST_IDS\.exchangePaymentContract}/);
  assert.match(
    source,
    /<ProofPollingError[\s\S]*?testId={FRONTEND_TEST_IDS\.exchangePollingError}/
  );
});

test("wallet pages route payments through the wallet context tronWeb seam", () => {
  const rentSource = readSource("src/app/rent/page.tsx");
  const exchangeSource = readSource("src/app/exchange/page.tsx");

  assert.match(rentSource, /const \{ address, isConnected, connect, tronWeb \} = useWallet\(\)/);
  assert.match(exchangeSource, /const \{ address, connect, isConnected, tronWeb \} = useWallet\(\)/);
  assert.doesNotMatch(rentSource, /tronWeb:\s*window\.tronWeb/);
  assert.doesNotMatch(exchangeSource, /tronWeb:\s*window\.tronWeb/);
});

test("ops page exposes proof selectors for operator smoke tests", () => {
  const source = readSource("src/app/ops/page.tsx");

  for (const key of [
    "opsTokenInput",
    "opsLoadStatus",
    "opsMode",
    "opsReadyForLive",
    "opsWarnings",
    "opsBacklogSummary",
    "opsConfirmActions",
    "opsScanDeposits",
    "opsDrainProvider",
    "opsDrainExchange",
    "opsActionResult",
    "opsError",
  ]) {
    assert.match(source, new RegExp(`FRONTEND_TEST_IDS\\.${key}`));
  }
});

test("e2e wallet mock is gated and dynamically loaded from the provider", () => {
  const providerSource = readSource("src/app/providers/WalletProvider.tsx");
  const nextConfigSource = readSource("next.config.ts");

  assert.match(providerSource, /NEXT_PUBLIC_E2E_WALLET_MOCK/);
  assert.match(providerSource, /process\.env\.NODE_ENV === "production"/);
  assert.match(providerSource, /import\("@\/lib\/dev\/e2eWalletMock"\)/);
  assert.match(
    nextConfigSource,
    /NEXT_PUBLIC_E2E_WALLET_MOCK[\s\S]*production builds/
  );
});

function renderProofSurface({
  instructionTestId,
  orderIdTestId,
  paymentAddressTestId,
  paymentAmountTestId,
  paymentContractTestId,
  paymentMethodDepositTestId,
  paymentMethodWalletTestId,
  paymentReferenceTestId,
  pollingErrorTestId,
  refreshTestId,
  statusTestId,
  walletCtaTestId,
  walletTxidTestId,
}) {
  return renderToStaticMarkup(
    React.createElement(
      ProofSelectorRegion,
      { testId: instructionTestId },
      React.createElement(
        "button",
        { "data-testid": paymentMethodWalletTestId },
        "钱包付款"
      ),
      React.createElement(
        "button",
        { "data-testid": paymentMethodDepositTestId },
        "地址转账"
      ),
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
      React.createElement(
        ProofSelectorRegion,
        { testId: paymentAmountTestId },
        "2.340001 TRX"
      ),
      React.createElement(
        ProofSelectorRegion,
        { testId: paymentAddressTestId },
        "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb"
      ),
      paymentContractTestId
        ? React.createElement(
            ProofSelectorRegion,
            { testId: paymentContractTestId },
            "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
          )
        : null,
      React.createElement(
        ProofSelectorRegion,
        { testId: paymentReferenceTestId },
        "TR-123"
      ),
      React.createElement(
        "button",
        { "data-testid": walletCtaTestId },
        "用钱包付款"
      ),
      React.createElement(
        ProofSelectorRegion,
        { testId: walletTxidTestId },
        "tx-123"
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
    paymentAddressTestId: FRONTEND_TEST_IDS.rentPaymentAddress,
    paymentAmountTestId: FRONTEND_TEST_IDS.rentPaymentAmount,
    paymentContractTestId: null,
    paymentMethodDepositTestId: FRONTEND_TEST_IDS.rentPaymentMethodDeposit,
    paymentMethodWalletTestId: FRONTEND_TEST_IDS.rentPaymentMethodWallet,
    paymentReferenceTestId: FRONTEND_TEST_IDS.rentPaymentReference,
    pollingErrorTestId: FRONTEND_TEST_IDS.rentPollingError,
    refreshTestId: FRONTEND_TEST_IDS.rentRefreshStatus,
    statusTestId: FRONTEND_TEST_IDS.rentOrderStatus,
    walletCtaTestId: FRONTEND_TEST_IDS.rentWalletPaymentCta,
    walletTxidTestId: FRONTEND_TEST_IDS.rentWalletPaymentTxid,
  });

  for (const testId of [
    FRONTEND_TEST_IDS.rentPaymentInstructions,
    FRONTEND_TEST_IDS.rentOrderId,
    FRONTEND_TEST_IDS.rentOrderStatus,
    FRONTEND_TEST_IDS.rentRefreshStatus,
    FRONTEND_TEST_IDS.rentWalletPaymentCta,
    FRONTEND_TEST_IDS.rentWalletPaymentTxid,
    FRONTEND_TEST_IDS.rentPaymentMethodWallet,
    FRONTEND_TEST_IDS.rentPaymentMethodDeposit,
    FRONTEND_TEST_IDS.rentPaymentAmount,
    FRONTEND_TEST_IDS.rentPaymentAddress,
    FRONTEND_TEST_IDS.rentPaymentReference,
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
    paymentAddressTestId: FRONTEND_TEST_IDS.exchangePaymentAddress,
    paymentAmountTestId: FRONTEND_TEST_IDS.exchangePaymentAmount,
    paymentContractTestId: FRONTEND_TEST_IDS.exchangePaymentContract,
    paymentMethodDepositTestId: "exchange-placeholder-deposit",
    paymentMethodWalletTestId: "exchange-placeholder-wallet",
    paymentReferenceTestId: FRONTEND_TEST_IDS.exchangePaymentReference,
    pollingErrorTestId: FRONTEND_TEST_IDS.exchangePollingError,
    refreshTestId: FRONTEND_TEST_IDS.exchangeRefreshStatus,
    statusTestId: FRONTEND_TEST_IDS.exchangeOrderStatus,
    walletCtaTestId: FRONTEND_TEST_IDS.exchangeWalletDepositCta,
    walletTxidTestId: FRONTEND_TEST_IDS.exchangeWalletDepositTxid,
  });

  for (const testId of [
    FRONTEND_TEST_IDS.exchangeDepositInstructions,
    FRONTEND_TEST_IDS.exchangeOrderId,
    FRONTEND_TEST_IDS.exchangeOrderStatus,
    FRONTEND_TEST_IDS.exchangeRefreshStatus,
    FRONTEND_TEST_IDS.exchangeWalletDepositCta,
    FRONTEND_TEST_IDS.exchangeWalletDepositTxid,
    FRONTEND_TEST_IDS.exchangePaymentAmount,
    FRONTEND_TEST_IDS.exchangePaymentAddress,
    FRONTEND_TEST_IDS.exchangePaymentReference,
    FRONTEND_TEST_IDS.exchangePaymentContract,
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
