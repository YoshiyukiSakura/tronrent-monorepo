import test from "node:test";
import assert from "node:assert/strict";
import walletPayment from "../src/lib/walletPayment.js";

const {
  extractTxId,
  inferTronNetwork,
  normalizeTronAddress,
  parseSafeSunAmount,
  sendExchangeWalletDeposit,
  sendWalletTrxPayment,
} = walletPayment;

const payer = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb";
const treasury = "TAivugS6Zn2EK9RAKeiSQbshkZQAX4fZaA";
const usdtContract = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

function makeOrder(overrides = {}) {
  return {
    id: "order-1",
    paymentMethod: "wallet_connect",
    customerWalletAddress: payer,
    ...overrides,
    paymentInstructions: {
      configured: true,
      asset: "TRX",
      address: treasury,
      amountSun: "2340001",
      ...overrides.paymentInstructions,
    },
  };
}

function makeTronWeb(sendTransaction) {
  return {
    defaultAddress: {
      base58: payer,
      hex: "410000000000000000000000000000000000000000",
    },
    fullNode: {
      host: "https://api.trongrid.io",
    },
    address: {
      fromHex(value) {
        if (value === "410000000000000000000000000000000000000000") {
          return payer;
        }
        return treasury;
      },
    },
    trx: {
      sendTransaction,
    },
    contract() {
      return {
        async at(contractAddress) {
          return {
            transfer(toAddress, amountBaseUnits) {
              return {
                async send(options) {
                  return {
                    txID: "usdt-tx-123",
                    contractAddress,
                    toAddress,
                    amountBaseUnits,
                    options,
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}

function makeExchangeOrder(overrides = {}) {
  return {
    id: "exchange-order-1",
    status: "pending_deposit",
    customerWalletAddress: payer,
    treasuryAddress: treasury,
    inputAsset: "TRX",
    ...overrides,
    depositInstructions: {
      asset: "TRX",
      amountBaseUnits: "100000001",
      address: treasury,
      contractAddress: null,
      ...overrides.depositInstructions,
    },
  };
}

test("parseSafeSunAmount rejects unsafe integer values", () => {
  assert.throws(
    () => parseSafeSunAmount(String(Number.MAX_SAFE_INTEGER + 1)),
    /安全整数/
  );
});

test("wallet payment broadcasts the exact sun amount without rounding", async () => {
  let captured;
  const tronWeb = makeTronWeb(async (toAddress, amountSun) => {
    captured = { toAddress, amountSun };
    return { txid: "tx-123" };
  });

  const result = await sendWalletTrxPayment({
    tronWeb,
    connectedAddress: payer,
    order: makeOrder(),
  });

  assert.deepEqual(captured, {
    toAddress: treasury,
    amountSun: 2340001,
  });
  assert.equal(result.txid, "tx-123");
});

test("wallet payment blocks mismatched connected wallets", async () => {
  let called = false;
  const tronWeb = makeTronWeb(async () => {
    called = true;
  });

  await assert.rejects(
    () =>
      sendWalletTrxPayment({
        tronWeb,
        connectedAddress: "TLmZv2DCEc3snUyDaUWdZRba59vpt4NMcD",
        order: makeOrder(),
      }),
    /钱包不一致/
  );
  assert.equal(called, false);
});

test("wallet payment allows absent customerWalletAddress", async () => {
  let called = false;
  const tronWeb = makeTronWeb(async () => {
    called = true;
    return { txID: "tx-allowed" };
  });

  const result = await sendWalletTrxPayment({
    tronWeb,
    connectedAddress: payer,
    order: makeOrder({ customerWalletAddress: null }),
  });

  assert.equal(called, true);
  assert.equal(result.txid, "tx-allowed");
});

test("wallet payment blocks wrong wallet network", async () => {
  let called = false;
  const tronWeb = makeTronWeb(async () => {
    called = true;
  });
  tronWeb.fullNode.host = "https://nile.trongrid.io";

  await assert.rejects(
    () =>
      sendWalletTrxPayment({
        tronWeb,
        connectedAddress: payer,
        order: makeOrder(),
        expectedNetwork: "mainnet",
      }),
    /订单要求 mainnet/
  );
  assert.equal(called, false);
});

test("wallet payment fails closed when TronLink is unavailable", async () => {
  await assert.rejects(
    () =>
      sendWalletTrxPayment({
        tronWeb: {},
        connectedAddress: payer,
        order: makeOrder(),
      }),
    /TronLink/
  );
});

test("wallet payment rejects non-wallet or non-TRX orders before sending", async () => {
  let called = false;
  const tronWeb = makeTronWeb(async () => {
    called = true;
  });

  await assert.rejects(
    () =>
      sendWalletTrxPayment({
        tronWeb,
        connectedAddress: payer,
        order: makeOrder({ paymentMethod: "deposit_address" }),
      }),
    /不是钱包付款/
  );

  await assert.rejects(
    () =>
      sendWalletTrxPayment({
        tronWeb,
        connectedAddress: payer,
        order: makeOrder({
          paymentInstructions: {
            configured: false,
            address: null,
          },
        }),
      }),
    /收款地址/
  );

  await assert.rejects(
    () =>
      sendWalletTrxPayment({
        tronWeb,
        connectedAddress: payer,
        order: makeOrder({
          paymentInstructions: {
            asset: "USDT",
          },
        }),
      }),
    /只支持 TRX/
  );

  assert.equal(called, false);
});

test("extractTxId supports common TronLink result shapes", () => {
  assert.equal(extractTxId("tx-string"), "tx-string");
  assert.equal(extractTxId({ txID: "tx-id" }), "tx-id");
  assert.equal(extractTxId({ transaction: { txID: "tx-nested" } }), "tx-nested");
  assert.equal(extractTxId({ result: true }), null);
});

test("inferTronNetwork does not classify arbitrary trx hosts as mainnet", () => {
  assert.equal(
    inferTronNetwork({ fullNode: { host: "https://internal-trx.example" } }),
    "unknown"
  );
});

test("normalizeTronAddress converts known hex addresses to base58", () => {
  const tronWeb = makeTronWeb(async () => {});

  assert.equal(
    normalizeTronAddress("410000000000000000000000000000000000000000", tronWeb),
    payer
  );
});

test("exchange TRX wallet deposit preserves exact safe base units", async () => {
  let captured;
  const tronWeb = makeTronWeb(async (toAddress, amountSun) => {
    captured = { toAddress, amountSun };
    return "exchange-trx-tx";
  });

  const result = await sendExchangeWalletDeposit({
    tronWeb,
    connectedAddress: payer,
    order: makeExchangeOrder(),
    allowedTreasuryAddresses: [treasury],
  });

  assert.deepEqual(captured, {
    toAddress: treasury,
    amountSun: 100000001,
  });
  assert.equal(result.asset, "TRX");
  assert.equal(result.txid, "exchange-trx-tx");
});

test("exchange TRX wallet deposit rejects unsafe base units before sending", async () => {
  let called = false;
  const tronWeb = makeTronWeb(async () => {
    called = true;
  });

  await assert.rejects(
    () =>
      sendExchangeWalletDeposit({
        tronWeb,
        connectedAddress: payer,
        order: makeExchangeOrder({
          depositInstructions: {
            amountBaseUnits: String(Number.MAX_SAFE_INTEGER + 1),
          },
        }),
        allowedTreasuryAddresses: [treasury],
      }),
    /安全整数/
  );
  assert.equal(called, false);
});

test("exchange USDT wallet deposit passes exact amount string to allowlisted contract", async () => {
  const tronWeb = makeTronWeb(async () => {});
  const order = makeExchangeOrder({
    inputAsset: "USDT",
    depositInstructions: {
      asset: "USDT",
      amountBaseUnits: "500000123456789123",
      contractAddress: usdtContract,
    },
  });

  const result = await sendExchangeWalletDeposit({
    tronWeb,
    connectedAddress: payer,
    order,
    allowedTreasuryAddresses: [treasury],
    allowedUsdtContracts: [usdtContract],
  });

  assert.equal(result.asset, "USDT");
  assert.equal(result.contractAddress, usdtContract);
  assert.equal(result.amountBaseUnits, "500000123456789123");
  assert.equal(result.raw.amountBaseUnits, "500000123456789123");
  assert.equal(result.raw.toAddress, treasury);
  assert.deepEqual(result.raw.options, { feeLimit: 100_000_000 });
});

test("exchange USDT wallet deposit rejects unknown contract allowlist entries", async () => {
  const tronWeb = makeTronWeb(async () => {});

  await assert.rejects(
    () =>
      sendExchangeWalletDeposit({
        tronWeb,
        connectedAddress: payer,
        order: makeExchangeOrder({
          inputAsset: "USDT",
          depositInstructions: {
            asset: "USDT",
            contractAddress: "TLmZv2DCEc3snUyDaUWdZRba59vpt4NMcD",
          },
        }),
        allowedTreasuryAddresses: [treasury],
        allowedUsdtContracts: [usdtContract],
      }),
    /USDT 合约地址不在前端 allowlist/
  );
});

test("exchange wallet deposit rejects missing treasury allowlist and destination mismatches", async () => {
  const tronWeb = makeTronWeb(async () => {});

  await assert.rejects(
    () =>
      sendExchangeWalletDeposit({
        tronWeb,
        connectedAddress: payer,
        order: makeExchangeOrder(),
        allowedTreasuryAddresses: [],
      }),
    /treasury 地址未配置/
  );

  await assert.rejects(
    () =>
      sendExchangeWalletDeposit({
        tronWeb,
        connectedAddress: payer,
        order: makeExchangeOrder({
          treasuryAddress: payer,
        }),
        allowedTreasuryAddresses: [treasury],
    }),
    /不一致/
  );

  await assert.rejects(
    () =>
      sendExchangeWalletDeposit({
        tronWeb,
        connectedAddress: payer,
        order: makeExchangeOrder({
          treasuryAddress: null,
        }),
        allowedTreasuryAddresses: [treasury],
      }),
    /treasury 地址缺失/
  );
});
