import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const walletPayment = require("../src/lib/walletPayment.js");
const e2eWalletMock = require("../src/lib/dev/e2eWalletMock.js");

const {
  sendExchangeWalletDeposit,
  sendWalletTrxPayment,
} = walletPayment;
const {
  E2E_TREASURY_ADDRESS,
  E2E_USDT_CONTRACT_ADDRESS,
  E2E_WALLET_ADDRESS,
  assertE2EWalletMockAllowed,
  createE2ETronWebMock,
  isE2EWalletMockEnabled,
} = e2eWalletMock;

function makeEnergyOrder(overrides = {}) {
  return {
    id: "energy-order-e2e",
    paymentMethod: "wallet_connect",
    customerWalletAddress: E2E_WALLET_ADDRESS,
    ...overrides,
    paymentInstructions: {
      configured: true,
      asset: "TRX",
      address: E2E_TREASURY_ADDRESS,
      amountSun: "2340001",
      ...overrides.paymentInstructions,
    },
  };
}

function makeExchangeOrder(overrides = {}) {
  return {
    id: "exchange-order-e2e",
    status: "pending_deposit",
    customerWalletAddress: E2E_WALLET_ADDRESS,
    treasuryAddress: E2E_TREASURY_ADDRESS,
    inputAsset: "TRX",
    ...overrides,
    depositInstructions: {
      asset: "TRX",
      amountBaseUnits: "100000001",
      address: E2E_TREASURY_ADDRESS,
      contractAddress: null,
      ...overrides.depositInstructions,
    },
  };
}

test("e2e wallet mock is double-gated away from production", () => {
  assert.equal(
    isE2EWalletMockEnabled({
      NODE_ENV: "development",
      NEXT_PUBLIC_E2E_WALLET_MOCK: "1",
    }),
    true
  );
  assert.equal(
    isE2EWalletMockEnabled({
      NODE_ENV: "test",
      NEXT_PUBLIC_E2E_WALLET_MOCK: "",
    }),
    false
  );
  assert.throws(
    () =>
      assertE2EWalletMockAllowed({
        NODE_ENV: "production",
        NEXT_PUBLIC_E2E_WALLET_MOCK: "1",
      }),
    /must never be enabled in production/
  );
});

test("e2e wallet mock broadcasts energy wallet payment through real guards", async () => {
  const tronWeb = createE2ETronWebMock({
    env: { NODE_ENV: "test", NEXT_PUBLIC_E2E_WALLET_MOCK: "1" },
  });

  const result = await sendWalletTrxPayment({
    tronWeb,
    connectedAddress: E2E_WALLET_ADDRESS,
    order: makeEnergyOrder(),
    expectedNetwork: "mainnet",
  });

  assert.equal(result.txid, "e2e-trx-0001");
  assert.deepEqual(tronWeb.__tronrentE2E.transactions[0], {
    txid: "e2e-trx-0001",
    asset: "TRX",
    fromAddress: E2E_WALLET_ADDRESS,
    toAddress: E2E_TREASURY_ADDRESS,
    amountSun: 2340001,
  });
});

test("e2e wallet mock still fails closed on wrong network", async () => {
  const tronWeb = createE2ETronWebMock({
    env: { NODE_ENV: "test", NEXT_PUBLIC_E2E_WALLET_MOCK: "1" },
    network: "nile",
  });

  await assert.rejects(
    () =>
      sendWalletTrxPayment({
        tronWeb,
        connectedAddress: E2E_WALLET_ADDRESS,
        order: makeEnergyOrder(),
        expectedNetwork: "mainnet",
      }),
    /订单要求 mainnet/
  );
  assert.equal(tronWeb.__tronrentE2E.transactions.length, 0);
});

test("e2e wallet mock supports TRX and USDT exchange deposits without settlement", async () => {
  const tronWeb = createE2ETronWebMock({
    env: { NODE_ENV: "test", NEXT_PUBLIC_E2E_WALLET_MOCK: "1" },
  });

  const trxResult = await sendExchangeWalletDeposit({
    tronWeb,
    connectedAddress: E2E_WALLET_ADDRESS,
    order: makeExchangeOrder(),
    allowedTreasuryAddresses: [E2E_TREASURY_ADDRESS],
  });
  const usdtResult = await sendExchangeWalletDeposit({
    tronWeb,
    connectedAddress: E2E_WALLET_ADDRESS,
    order: makeExchangeOrder({
      inputAsset: "USDT",
      depositInstructions: {
        asset: "USDT",
        amountBaseUnits: "500000123",
        contractAddress: E2E_USDT_CONTRACT_ADDRESS,
      },
    }),
    allowedTreasuryAddresses: [E2E_TREASURY_ADDRESS],
    allowedUsdtContracts: [E2E_USDT_CONTRACT_ADDRESS],
  });

  assert.equal(trxResult.txid, "e2e-trx-0001");
  assert.equal(usdtResult.txid, "e2e-usdt-0002");
  assert.deepEqual(
    tronWeb.__tronrentE2E.transactions.map((tx) => tx.asset),
    ["TRX", "USDT"]
  );
});
