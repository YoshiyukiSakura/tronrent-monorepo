"use strict";

const { getAllowedTrc20Contracts } = require("./depositMatcher");
const { isValidTronAddress } = require("./orderService");

const DEFAULT_PAYOUT_FEE_LIMIT_SUN = 100_000_000;
const DEFAULT_TRX_RESERVE_SUN = 50_000_000;

let adapterOverride = null;

function isExchangePayoutLiveMode() {
  return process.env.EXCHANGE_PAYOUT_LIVE === "true";
}

function redactSensitive(value) {
  if (value === undefined || value === null) {
    return value;
  }

  let redacted = String(value);
  const privateKey = process.env.EXCHANGE_PAYOUT_PRIVATE_KEY;
  if (privateKey) {
    redacted = redacted.split(privateKey).join("[redacted]");
  }
  return redacted.replace(/(privateKey=)[^&\s"']+/gi, "$1[redacted]");
}

function sanitizePayload(payload) {
  if (payload === undefined || payload === null) {
    return payload;
  }

  if (typeof payload === "string") {
    return redactSensitive(payload);
  }

  if (Array.isArray(payload)) {
    return payload.map((entry) => sanitizePayload(entry));
  }

  if (typeof payload === "object") {
    return Object.fromEntries(
      Object.entries(payload).map(([key, value]) => [
        key,
        key.toLowerCase().includes("privatekey")
          ? "[redacted]"
          : sanitizePayload(value),
      ])
    );
  }

  return payload;
}

function createPayoutError(message, statusCode = 502, details, options = {}) {
  const error = new Error(redactSensitive(message));
  error.statusCode = statusCode;
  error.payoutDetails = sanitizePayload(details);
  error.payoutIndeterminate = Boolean(options.indeterminate);
  return error;
}

function isIndeterminatePayoutError(error) {
  return Boolean(error?.payoutIndeterminate);
}

function parsePositiveBaseUnits(value, label = "amountBaseUnits") {
  const raw = String(value || "").trim();
  if (!/^\d+$/.test(raw) || BigInt(raw) <= 0n) {
    throw createPayoutError(`${label} must be a positive integer`, 400);
  }
  return raw;
}

function toSafeSunInteger(value, label) {
  const raw = parsePositiveBaseUnits(value, label);
  const asBigInt = BigInt(raw);
  if (asBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw createPayoutError(`${label} exceeds JavaScript safe integer range`, 400);
  }
  const asNumber = Number(raw);
  if (!Number.isSafeInteger(asNumber) || BigInt(asNumber) !== asBigInt) {
    throw createPayoutError(`${label} cannot be safely represented`, 400);
  }
  return asNumber;
}

function parseNonNegativeIntegerEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name] || String(fallback), 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return parsed;
}

function getRequiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw createPayoutError(`${name} is required for live exchange payout`, 500);
  }
  return value;
}

function getUsdtContractAddress() {
  const usdt = getAllowedTrc20Contracts().find((entry) => entry.symbol === "USDT");
  if (!usdt?.contractAddress) {
    throw createPayoutError(
      "TRON_TRC20_ALLOWLIST must include USDT contract for live payout",
      500
    );
  }
  return usdt.contractAddress;
}

function validateOrderForPayout(order) {
  if (!order || typeof order !== "object") {
    throw createPayoutError("Exchange payout order is required", 400);
  }

  if (!isValidTronAddress(order.outputAddress)) {
    throw createPayoutError("Exchange payout outputAddress is invalid", 400);
  }

  if (!["TRX", "USDT"].includes(order.outputAsset)) {
    throw createPayoutError("Exchange payout outputAsset is unsupported", 400);
  }

  const amountBaseUnits = parsePositiveBaseUnits(
    order.outputBaseUnits,
    "outputBaseUnits"
  );

  return {
    asset: order.outputAsset,
    contractAddress: order.outputContractAddress || null,
    toAddress: order.outputAddress,
    amountBaseUnits,
  };
}

function buildDryRunResponse(order) {
  const request = validateOrderForPayout(order);
  return {
    dryRun: true,
    accepted: true,
    completionMeaning: "dry_run_no_transfer_broadcast",
    wouldTransfer: request,
  };
}

function extractTxId(result) {
  if (typeof result === "string" && result) {
    return result;
  }
  return (
    result?.txid ||
    result?.txID ||
    result?.transaction?.txID ||
    result?.transaction?.txid ||
    null
  );
}

function isRejectedBroadcastResult(result) {
  return Boolean(
    result &&
      typeof result === "object" &&
      (result.result === false || result.code || result.error || result.Error)
  );
}

function getAdapter(config) {
  if (adapterOverride) {
    return adapterOverride;
  }

  const { TronWeb } = require("tronweb");
  const tronWeb = new TronWeb({
    fullHost: config.fullHost,
    privateKey: config.privateKey,
  });

  return {
    async getTrxBalance(address) {
      return String(await tronWeb.trx.getBalance(address));
    },
    async getTrc20Balance(contractAddress, address) {
      const contract = await tronWeb.contract().at(contractAddress);
      const balance = await contract.balanceOf(address).call();
      return String(balance);
    },
    async sendTrx({ toAddress, amountSun }) {
      return tronWeb.trx.sendTransaction(toAddress, amountSun);
    },
    async sendTrc20({ contractAddress, toAddress, amountBaseUnits, feeLimit }) {
      const contract = await tronWeb.contract().at(contractAddress);
      return contract.transfer(toAddress, amountBaseUnits).send({ feeLimit });
    },
  };
}

function setPayoutAdapterForTesting(adapter) {
  adapterOverride = adapter;
}

function resetPayoutAdapterForTesting() {
  adapterOverride = null;
}

async function executeLivePayout(order) {
  const request = validateOrderForPayout(order);
  const privateKey = getRequiredEnv("EXCHANGE_PAYOUT_PRIVATE_KEY");
  const fromAddress = getRequiredEnv("EXCHANGE_PAYOUT_FROM_ADDRESS");
  const fullHost = getRequiredEnv("TRONGRID_API_BASE_URL");
  if (!isValidTronAddress(fromAddress)) {
    throw createPayoutError("EXCHANGE_PAYOUT_FROM_ADDRESS is invalid", 500);
  }

  const feeLimit = parseNonNegativeIntegerEnv(
    "EXCHANGE_PAYOUT_FEE_LIMIT_SUN",
    DEFAULT_PAYOUT_FEE_LIMIT_SUN
  );
  const trxReserveSun = parseNonNegativeIntegerEnv(
    "EXCHANGE_PAYOUT_TRX_RESERVE_SUN",
    DEFAULT_TRX_RESERVE_SUN
  );
  const adapter = getAdapter({ privateKey, fullHost });

  if (request.asset === "TRX") {
    const amountSun = toSafeSunInteger(request.amountBaseUnits, "TRX payout amount");
    const trxBalance = BigInt(await adapter.getTrxBalance(fromAddress));
    const requiredBalance = BigInt(amountSun) + BigInt(trxReserveSun);
    if (trxBalance < requiredBalance) {
      throw createPayoutError(
        "Exchange payout TRX balance is insufficient",
        402,
        {
          asset: "TRX",
          availableSun: trxBalance.toString(),
          requiredSun: requiredBalance.toString(),
        }
      );
    }

    let result;
    try {
      result = await adapter.sendTrx({
        toAddress: request.toAddress,
        amountSun,
      });
    } catch (_error) {
      throw createPayoutError(
        "Exchange payout TRX broadcast outcome is indeterminate",
        202,
        { asset: "TRX", toAddress: request.toAddress, amountBaseUnits: request.amountBaseUnits },
        { indeterminate: true }
      );
    }

    if (isRejectedBroadcastResult(result)) {
      throw createPayoutError(
        "Exchange payout TRX broadcast was rejected by the node",
        202,
        { asset: "TRX", result },
        { indeterminate: true }
      );
    }

    const txid = extractTxId(result);
    if (!txid) {
      throw createPayoutError(
        "Exchange payout TRX broadcast returned no txid",
        202,
        { asset: "TRX", result },
        { indeterminate: true }
      );
    }

    return {
      dryRun: false,
      accepted: true,
      asset: "TRX",
      txid,
      completionMeaning: "broadcast_submitted_not_final_chain_confirmation",
      transfer: request,
    };
  }

  const expectedUsdtContract = getUsdtContractAddress();
  if (request.contractAddress !== expectedUsdtContract) {
    throw createPayoutError("Exchange payout USDT contract is not allowlisted", 400, {
      contractAddress: request.contractAddress,
      expectedContractAddress: expectedUsdtContract,
    });
  }

  const trxBalance = BigInt(await adapter.getTrxBalance(fromAddress));
  if (trxBalance < BigInt(trxReserveSun)) {
    throw createPayoutError(
      "Exchange payout fee TRX balance is insufficient",
      402,
      {
        asset: "TRX",
        availableSun: trxBalance.toString(),
        requiredSun: String(trxReserveSun),
      }
    );
  }

  const usdtBalance = BigInt(
    await adapter.getTrc20Balance(expectedUsdtContract, fromAddress)
  );
  const amountBaseUnits = BigInt(request.amountBaseUnits);
  if (usdtBalance < amountBaseUnits) {
    throw createPayoutError(
      "Exchange payout USDT balance is insufficient",
      402,
      {
        asset: "USDT",
        availableBaseUnits: usdtBalance.toString(),
        requiredBaseUnits: amountBaseUnits.toString(),
      }
    );
  }

  let result;
  try {
    result = await adapter.sendTrc20({
      contractAddress: expectedUsdtContract,
      toAddress: request.toAddress,
      amountBaseUnits: request.amountBaseUnits,
      feeLimit,
    });
  } catch (_error) {
    throw createPayoutError(
      "Exchange payout USDT broadcast outcome is indeterminate",
      202,
      { asset: "USDT", toAddress: request.toAddress, amountBaseUnits: request.amountBaseUnits },
      { indeterminate: true }
    );
  }

  const txid = extractTxId(result);
  if (isRejectedBroadcastResult(result)) {
    throw createPayoutError(
      "Exchange payout USDT broadcast was rejected by the node",
      202,
      { asset: "USDT", result },
      { indeterminate: true }
    );
  }

  if (!txid) {
    throw createPayoutError(
      "Exchange payout USDT broadcast returned no txid",
      202,
      { asset: "USDT", result },
      { indeterminate: true }
    );
  }

  return {
    dryRun: false,
    accepted: true,
    asset: "USDT",
    txid,
    completionMeaning: "broadcast_submitted_not_final_chain_confirmation",
    transfer: request,
  };
}

async function executeExchangePayout(order) {
  if (!isExchangePayoutLiveMode()) {
    return buildDryRunResponse(order);
  }
  return executeLivePayout(order);
}

module.exports = {
  DEFAULT_PAYOUT_FEE_LIMIT_SUN,
  DEFAULT_TRX_RESERVE_SUN,
  createPayoutError,
  executeExchangePayout,
  isRejectedBroadcastResult,
  isExchangePayoutLiveMode,
  isIndeterminatePayoutError,
  redactSensitive,
  resetPayoutAdapterForTesting,
  setPayoutAdapterForTesting,
  validateOrderForPayout,
};
