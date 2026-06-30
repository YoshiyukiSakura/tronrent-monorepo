"use strict";

const TRON_BASE58_PATTERN = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;

function parseSafeSunAmount(amountSun) {
  const value = String(amountSun || "").trim();
  if (!/^\d+$/.test(value)) {
    throw new Error("付款金额格式无效，请改用地址转账。");
  }

  const asBigInt = BigInt(value);
  if (asBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("付款金额超出浏览器安全整数范围，请改用地址转账。");
  }

  const asNumber = Number(value);
  if (!Number.isSafeInteger(asNumber) || BigInt(asNumber) !== asBigInt) {
    throw new Error("付款金额无法安全转换，请改用地址转账。");
  }

  return asNumber;
}

function parseBaseUnitString(amountBaseUnits, label = "付款金额") {
  const value = String(amountBaseUnits || "").trim();
  if (!/^\d+$/.test(value) || BigInt(value) <= 0n) {
    throw new Error(`${label}格式无效，请改用地址转账。`);
  }
  return value;
}

function normalizeTronAddress(address, tronWeb) {
  const value = String(address || "").trim();
  if (!value) {
    return null;
  }

  if (TRON_BASE58_PATTERN.test(value)) {
    return value;
  }

  if (/^41[0-9a-fA-F]{40}$/.test(value) && tronWeb?.address?.fromHex) {
    try {
      const converted = tronWeb.address.fromHex(value);
      return TRON_BASE58_PATTERN.test(converted) ? converted : null;
    } catch (_error) {
      return null;
    }
  }

  return null;
}

function inferTronNetwork(tronWeb) {
  const host = String(tronWeb?.fullNode?.host || "").toLowerCase();
  if (!host) {
    return "unknown";
  }
  if (host.includes("nile")) {
    return "nile";
  }
  if (host.includes("shasta")) {
    return "shasta";
  }
  if (host.includes("trongrid.io") || host.includes("mainnet")) {
    return "mainnet";
  }
  return "unknown";
}

function assertExpectedNetwork(tronWeb, expectedNetwork = "mainnet") {
  const expected = String(expectedNetwork || "mainnet").toLowerCase();
  if (expected === "any") {
    return;
  }

  const actual = inferTronNetwork(tronWeb);
  if (actual !== expected) {
    throw new Error(
      `当前钱包网络为 ${actual}，订单要求 ${expected}，请切换网络后重试。`
    );
  }
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

function normalizeAllowlist(allowlist, tronWeb) {
  return (allowlist || [])
    .map((address) => normalizeTronAddress(address, tronWeb))
    .filter(Boolean);
}

function assertAddressAllowed(address, allowlist, label, tronWeb) {
  const normalized = normalizeTronAddress(address, tronWeb);
  if (!normalized) {
    throw new Error(`${label}无效，请改用地址转账。`);
  }

  const normalizedAllowlist = normalizeAllowlist(allowlist, tronWeb);
  if (normalizedAllowlist.length === 0) {
    throw new Error(`${label}未配置前端 allowlist，请改用地址转账。`);
  }

  if (!normalizedAllowlist.includes(normalized)) {
    throw new Error(`${label}不在前端 allowlist 中，请勿付款。`);
  }

  return normalized;
}

function assertMatchingPayer({ connectedAddress, expectedAddress, tronWeb }) {
  const payerAddress = normalizeTronAddress(
    connectedAddress || tronWeb.defaultAddress?.base58 || tronWeb.defaultAddress?.hex,
    tronWeb
  );
  if (!payerAddress) {
    throw new Error("无法确认当前钱包地址。");
  }

  const expectedPayer = normalizeTronAddress(expectedAddress, tronWeb);
  if (expectedPayer && payerAddress !== expectedPayer) {
    throw new Error("当前连接的钱包与订单钱包不一致，请切换钱包后重试。");
  }

  return payerAddress;
}

function assertOrderDestinationConsistency(order, instructions, tronWeb) {
  const instructionAddress = normalizeTronAddress(instructions.address, tronWeb);
  const treasuryAddress = normalizeTronAddress(order.treasuryAddress, tronWeb);
  if (!instructionAddress) {
    throw new Error("订单收款地址无效，请改用地址转账或重新下单。");
  }

  if (!treasuryAddress) {
    throw new Error("订单 treasury 地址缺失，请勿付款。");
  }

  if (instructionAddress !== treasuryAddress) {
    throw new Error("订单收款地址与 treasury 地址不一致，请勿付款。");
  }

  return instructionAddress;
}

async function sendWalletTrxPayment({
  tronWeb,
  connectedAddress,
  order,
  expectedNetwork = "mainnet",
}) {
  if (!tronWeb?.trx?.sendTransaction) {
    throw new Error("未检测到可用的 TronLink 钱包。");
  }

  if (order?.paymentMethod !== "wallet_connect") {
    throw new Error("当前订单不是钱包付款订单。");
  }

  const instructions = order.paymentInstructions || {};
  if (!instructions.configured || !instructions.address) {
    throw new Error("收款地址尚未配置，请勿付款。");
  }

  if (instructions.asset !== "TRX") {
    throw new Error("当前钱包付款只支持 TRX。");
  }

  assertExpectedNetwork(tronWeb, expectedNetwork);

  assertMatchingPayer({
    connectedAddress,
    expectedAddress: order.customerWalletAddress,
    tronWeb,
  });

  const toAddress = normalizeTronAddress(instructions.address, tronWeb);
  if (!toAddress) {
    throw new Error("订单收款地址无效，请改用地址转账或重新下单。");
  }

  const amountSun = parseSafeSunAmount(instructions.amountSun);
  const result = await tronWeb.trx.sendTransaction(toAddress, amountSun);
  const txid = extractTxId(result);

  return {
    amountSun: String(instructions.amountSun),
    toAddress,
    txid,
    raw: result,
  };
}

async function sendExchangeWalletDeposit({
  tronWeb,
  connectedAddress,
  order,
  expectedNetwork = "mainnet",
  allowedTreasuryAddresses = [],
  allowedUsdtContracts = [],
  feeLimit = 100_000_000,
}) {
  if (!tronWeb) {
    throw new Error("未检测到可用的 TronLink 钱包。");
  }

  if (order?.status !== "pending_deposit") {
    throw new Error("当前兑换订单不在待入金状态。");
  }

  const instructions = order.depositInstructions || {};
  const inputAsset = instructions.asset || order.inputAsset;
  if (!instructions.address || !instructions.amountBaseUnits) {
    throw new Error("兑换入金指令不完整，请改用地址转账或重新下单。");
  }

  assertExpectedNetwork(tronWeb, expectedNetwork);
  assertMatchingPayer({
    connectedAddress,
    expectedAddress: order.customerWalletAddress,
    tronWeb,
  });

  const instructionAddress = assertOrderDestinationConsistency(
    order,
    instructions,
    tronWeb
  );
  const toAddress = assertAddressAllowed(
    instructionAddress,
    allowedTreasuryAddresses,
    "兑换 treasury 地址",
    tronWeb
  );

  if (inputAsset === "TRX") {
    if (!tronWeb.trx?.sendTransaction) {
      throw new Error("未检测到可用的 TRX 钱包转账能力。");
    }

    const amountSun = parseSafeSunAmount(instructions.amountBaseUnits);
    const result = await tronWeb.trx.sendTransaction(toAddress, amountSun);
    return {
      asset: "TRX",
      amountBaseUnits: String(instructions.amountBaseUnits),
      toAddress,
      txid: extractTxId(result),
      raw: result,
    };
  }

  if (inputAsset === "USDT") {
    if (!instructions.contractAddress) {
      throw new Error("USDT 合约地址缺失，请改用地址转账。");
    }

    const contractAddress = assertAddressAllowed(
      instructions.contractAddress,
      allowedUsdtContracts,
      "USDT 合约地址",
      tronWeb
    );
    const amountBaseUnits = parseBaseUnitString(
      instructions.amountBaseUnits,
      "USDT 入金金额"
    );
    if (!tronWeb.contract) {
      throw new Error("未检测到可用的 TRC20 合约调用能力。");
    }

    const contract = await tronWeb.contract().at(contractAddress);
    if (!contract?.transfer) {
      throw new Error("USDT 合约不支持 transfer 调用。");
    }

    const result = await contract.transfer(toAddress, amountBaseUnits).send({
      feeLimit,
    });

    return {
      asset: "USDT",
      amountBaseUnits,
      toAddress,
      contractAddress,
      txid: extractTxId(result),
      raw: result,
    };
  }

  throw new Error("当前兑换钱包入金只支持 TRX 或 USDT。");
}

module.exports = {
  assertExpectedNetwork,
  assertAddressAllowed,
  extractTxId,
  inferTronNetwork,
  normalizeTronAddress,
  parseBaseUnitString,
  parseSafeSunAmount,
  sendExchangeWalletDeposit,
  sendWalletTrxPayment,
};
