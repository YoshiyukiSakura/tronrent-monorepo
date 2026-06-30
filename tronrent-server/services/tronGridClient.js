"use strict";

const axios = require("axios");

function getBaseUrl() {
  return (process.env.TRONGRID_API_BASE_URL || "https://api.trongrid.io").replace(
    /\/$/,
    ""
  );
}

function getHeaders() {
  const headers = {};
  if (process.env.TRONGRID_API_KEY) {
    headers["TRON-PRO-API-KEY"] = process.env.TRONGRID_API_KEY;
  }
  return headers;
}

function buildLookbackMinTimestamp() {
  const lookbackMinutes = Number.parseInt(
    process.env.DEPOSIT_SCAN_LOOKBACK_MINUTES || "180",
    10
  );
  const safeLookback = Number.isFinite(lookbackMinutes)
    ? Math.max(1, lookbackMinutes)
    : 180;
  return Date.now() - safeLookback * 60 * 1000;
}

async function fetchInboundTrxTransfers(address, options = {}) {
  const response = await axios.get(
    `${getBaseUrl()}/v1/accounts/${address}/transactions`,
    {
      headers: getHeaders(),
      params: {
        only_confirmed: true,
        only_to: true,
        limit: options.limit || 50,
        min_timestamp: options.minTimestamp || buildLookbackMinTimestamp(),
        fingerprint: options.fingerprint,
      },
    }
  );

  const rows = response.data?.data || [];
  return {
    fingerprint: response.data?.meta?.fingerprint || null,
    deposits: rows
      .map((row) => normalizeTrxTransfer(row, address))
      .filter((row) => row !== null),
  };
}

async function fetchInboundTrc20Transfers(address, options = {}) {
  const response = await axios.get(
    `${getBaseUrl()}/v1/accounts/${address}/transactions/trc20`,
    {
      headers: getHeaders(),
      params: {
        only_confirmed: true,
        only_to: true,
        limit: options.limit || 50,
        min_timestamp: options.minTimestamp || buildLookbackMinTimestamp(),
        fingerprint: options.fingerprint,
      },
    }
  );

  const rows = response.data?.data || [];
  return {
    fingerprint: response.data?.meta?.fingerprint || null,
    deposits: rows.map((row, index) =>
      normalizeTrc20Transfer(row, address, index)
    ).filter((row) => row !== null),
  };
}

function normalizeTrxTransfer(row, configuredToAddress) {
  const value = row?.raw_data?.contract?.[0]?.parameter?.value;
  if (!value?.amount || !row.txID) {
    return null;
  }

  return {
    network: "tron",
    asset: "TRX",
    txHash: row.txID,
    eventIndex: "0",
    contractAddress: null,
    tokenDecimals: 6,
    tokenSymbol: "TRX",
    fromAddress: value.owner_address || null,
    toAddress: configuredToAddress,
    amountBaseUnits: String(value.amount),
    blockNumber: row.blockNumber || null,
    blockTimestamp: row.block_timestamp
      ? new Date(row.block_timestamp)
      : null,
    confirmations: Number.parseInt(
      process.env.DEPOSIT_REQUIRED_CONFIRMATIONS || "19",
      10
    ),
    raw: row,
  };
}

function normalizeTrc20Transfer(row, configuredToAddress, index) {
  if (!row.transaction_id || row.value === undefined || row.value === null) {
    return null;
  }

  const tokenInfo = row.token_info || {};
  const eventIndex =
    row.event_index ||
    row.log_index ||
    row.eventIndex ||
    row.logIndex ||
    String(index);

  return {
    network: "tron",
    asset: "TRC20",
    txHash: row.transaction_id,
    eventIndex: String(eventIndex),
    contractAddress: tokenInfo.address || row.contract_address || null,
    tokenDecimals:
      tokenInfo.decimals === undefined
        ? null
        : Number.parseInt(tokenInfo.decimals, 10),
    tokenSymbol: tokenInfo.symbol || null,
    fromAddress: row.from || null,
    toAddress: row.to || configuredToAddress,
    amountBaseUnits: String(row.value),
    blockNumber: row.block_number || row.blockNumber || null,
    blockTimestamp: row.block_timestamp
      ? new Date(row.block_timestamp)
      : null,
    confirmations: Number.parseInt(
      process.env.DEPOSIT_REQUIRED_CONFIRMATIONS || "19",
      10
    ),
    raw: row,
  };
}

module.exports = {
  fetchInboundTrc20Transfers,
  fetchInboundTrxTransfers,
  normalizeTrc20Transfer,
  normalizeTrxTransfer,
};
