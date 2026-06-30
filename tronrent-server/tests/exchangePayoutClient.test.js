"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const payoutClient = require("../services/exchangePayoutClient");

const ORIGINAL_ENV = { ...process.env };
const BASE_ORDER = Object.freeze({
  id: "exchange-order-1",
  outputAsset: "TRX",
  outputContractAddress: null,
  outputAddress: "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
  outputBaseUnits: "1234567",
});
const FROM_ADDRESS = "TAivugS6Zn2EK9RAKeiSQbshkZQAX4fZaA";
const USDT_CONTRACT = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

function restoreEnv() {
  process.env = { ...ORIGINAL_ENV };
  payoutClient.resetPayoutAdapterForTesting();
}

function enableLiveEnv() {
  process.env.EXCHANGE_PAYOUT_LIVE = "true";
  process.env.EXCHANGE_PAYOUT_PRIVATE_KEY = "super-private-key";
  process.env.EXCHANGE_PAYOUT_FROM_ADDRESS = FROM_ADDRESS;
  process.env.TRONGRID_API_BASE_URL = "https://api.trongrid.io";
  process.env.TRON_TRC20_ALLOWLIST = `USDT:${USDT_CONTRACT}:6`;
}

test.afterEach(() => {
  restoreEnv();
});

test("exchange payout client remains dry-run unless live mode is enabled", async () => {
  let adapterCalled = false;
  payoutClient.setPayoutAdapterForTesting({
    getTrxBalance: async () => {
      adapterCalled = true;
    },
  });

  const response = await payoutClient.executeExchangePayout(BASE_ORDER);

  assert.equal(response.dryRun, true);
  assert.equal(response.accepted, true);
  assert.equal(response.wouldTransfer.amountBaseUnits, BASE_ORDER.outputBaseUnits);
  assert.equal(adapterCalled, false);
});

test("live exchange payout requires secrets before adapter calls", async () => {
  let adapterCalled = false;
  process.env.EXCHANGE_PAYOUT_LIVE = "true";
  payoutClient.setPayoutAdapterForTesting({
    getTrxBalance: async () => {
      adapterCalled = true;
    },
  });

  await assert.rejects(
    () => payoutClient.executeExchangePayout(BASE_ORDER),
    /EXCHANGE_PAYOUT_PRIVATE_KEY is required/
  );
  assert.equal(adapterCalled, false);
});

test("live TRX payout preflights balance before broadcasting exact safe amount", async () => {
  let sent;
  enableLiveEnv();
  payoutClient.setPayoutAdapterForTesting({
    getTrxBalance: async () => "1000000000",
    sendTrx: async (payload) => {
      sent = payload;
      return { txid: "trx-tx-1" };
    },
  });

  const response = await payoutClient.executeExchangePayout(BASE_ORDER);

  assert.deepEqual(sent, {
    toAddress: BASE_ORDER.outputAddress,
    amountSun: 1234567,
  });
  assert.equal(response.dryRun, false);
  assert.equal(response.txid, "trx-tx-1");
  assert.equal(
    response.completionMeaning,
    "broadcast_submitted_not_final_chain_confirmation"
  );
});

test("live TRX payout blocks insufficient balance without broadcasting", async () => {
  let sendCalled = false;
  enableLiveEnv();
  payoutClient.setPayoutAdapterForTesting({
    getTrxBalance: async () => "1",
    sendTrx: async () => {
      sendCalled = true;
    },
  });

  await assert.rejects(
    () => payoutClient.executeExchangePayout(BASE_ORDER),
    /TRX balance is insufficient/
  );
  assert.equal(sendCalled, false);
});

test("live USDT payout sends exact base-unit string to allowlisted contract", async () => {
  let sent;
  enableLiveEnv();
  payoutClient.setPayoutAdapterForTesting({
    getTrxBalance: async () => "1000000000",
    getTrc20Balance: async () => "999999999999999999",
    sendTrc20: async (payload) => {
      sent = payload;
      return { txID: "usdt-tx-1" };
    },
  });

  const order = {
    ...BASE_ORDER,
    outputAsset: "USDT",
    outputContractAddress: USDT_CONTRACT,
    outputBaseUnits: "500000123456789",
  };
  const response = await payoutClient.executeExchangePayout(order);

  assert.deepEqual(sent, {
    contractAddress: USDT_CONTRACT,
    toAddress: BASE_ORDER.outputAddress,
    amountBaseUnits: "500000123456789",
    feeLimit: 100000000,
  });
  assert.equal(response.txid, "usdt-tx-1");
});

test("live USDT payout rejects contracts missing from the allowlist", async () => {
  let sendCalled = false;
  enableLiveEnv();
  payoutClient.setPayoutAdapterForTesting({
    getTrxBalance: async () => "1000000000",
    getTrc20Balance: async () => "999999999999999999",
    sendTrc20: async () => {
      sendCalled = true;
    },
  });

  await assert.rejects(
    () =>
      payoutClient.executeExchangePayout({
        ...BASE_ORDER,
        outputAsset: "USDT",
        outputContractAddress: "TLmZv2DCEc3snUyDaUWdZRba59vpt4NMcD",
      }),
    /USDT contract is not allowlisted/
  );
  assert.equal(sendCalled, false);
});

test("live USDT payout blocks insufficient TRX fee reserve", async () => {
  let sendCalled = false;
  enableLiveEnv();
  payoutClient.setPayoutAdapterForTesting({
    getTrxBalance: async () => "1",
    getTrc20Balance: async () => "999999999999999999",
    sendTrc20: async () => {
      sendCalled = true;
    },
  });

  await assert.rejects(
    () =>
      payoutClient.executeExchangePayout({
        ...BASE_ORDER,
        outputAsset: "USDT",
        outputContractAddress: USDT_CONTRACT,
      }),
    /fee TRX balance is insufficient/
  );
  assert.equal(sendCalled, false);
});

test("live USDT payout blocks insufficient USDT balance", async () => {
  let sendCalled = false;
  enableLiveEnv();
  payoutClient.setPayoutAdapterForTesting({
    getTrxBalance: async () => "1000000000",
    getTrc20Balance: async () => "1",
    sendTrc20: async () => {
      sendCalled = true;
    },
  });

  await assert.rejects(
    () =>
      payoutClient.executeExchangePayout({
        ...BASE_ORDER,
        outputAsset: "USDT",
        outputContractAddress: USDT_CONTRACT,
        outputBaseUnits: "1000000",
      }),
    /USDT balance is insufficient/
  );
  assert.equal(sendCalled, false);
});

test("live broadcast errors become indeterminate and redact private keys", async () => {
  enableLiveEnv();
  payoutClient.setPayoutAdapterForTesting({
    getTrxBalance: async () => "1000000000",
    sendTrx: async () => {
      throw new Error("broadcast failed with super-private-key");
    },
  });

  await assert.rejects(
    () => payoutClient.executeExchangePayout(BASE_ORDER),
    (error) => {
      assert.equal(error.payoutIndeterminate, true);
      assert.match(error.message, /indeterminate/);
      assert.equal(error.message.includes("super-private-key"), false);
      assert.equal(JSON.stringify(error.payoutDetails).includes("super-private-key"), false);
      return true;
    }
  );
});

test("live broadcast rejection payloads are indeterminate even with a txid", async () => {
  enableLiveEnv();
  payoutClient.setPayoutAdapterForTesting({
    getTrxBalance: async () => "1000000000",
    sendTrx: async () => ({
      result: false,
      txid: "rejected-txid",
      code: "BROADCAST_ERROR",
    }),
  });

  await assert.rejects(
    () => payoutClient.executeExchangePayout(BASE_ORDER),
    (error) => {
      assert.equal(error.payoutIndeterminate, true);
      assert.match(error.message, /rejected/);
      assert.equal(error.payoutDetails.result.txid, "rejected-txid");
      return true;
    }
  );
});
