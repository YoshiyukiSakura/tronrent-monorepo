"use strict";

const {
  ORDER_STATUSES,
  PAYMENT_STATUSES,
} = require("./orderState");

const DEPOSIT_STATUSES = Object.freeze({
  OBSERVED: "observed",
  MATCHED: "matched",
  UNMATCHED: "unmatched",
  UNMATCHED_AMBIGUOUS: "unmatched_ambiguous",
  MATCHED_BUT_EXPIRED: "matched_but_expired",
  REJECTED_TOKEN: "rejected_token",
});

function buildDepositKey(deposit) {
  return [
    deposit.network || "tron",
    deposit.txHash,
    deposit.eventIndex || "0",
    deposit.contractAddress || "native",
  ].join(":");
}

function normalizeAddress(address) {
  return address ? String(address).trim() : null;
}

function getAllowedTrc20Contracts() {
  return (process.env.TRON_TRC20_ALLOWLIST || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [symbol, contractAddress, decimals] = entry.split(":");
      return {
        symbol,
        contractAddress: contractAddress || "",
        decimals: Number.parseInt(decimals || "0", 10),
      };
    })
    .filter((entry) => entry.contractAddress && Number.isFinite(entry.decimals));
}

function getTrc20AllowlistMatch(deposit) {
  if (deposit.asset !== "TRC20") {
    return null;
  }

  const contractAddress = normalizeAddress(deposit.contractAddress);
  if (!contractAddress) {
    return null;
  }

  return (
    getAllowedTrc20Contracts().find(
      (entry) => entry.contractAddress === contractAddress
    ) || null
  );
}

function isAllowedTrc20Deposit(deposit) {
  if (deposit.asset !== "TRC20") {
    return true;
  }

  const allowlistMatch = getTrc20AllowlistMatch(deposit);
  return Boolean(
    allowlistMatch && Number(deposit.tokenDecimals) === allowlistMatch.decimals
  );
}

function classifyDepositMatch(deposit, candidates, now = new Date()) {
  const amountAddressCandidates = candidates.filter((candidate) => {
    const payment = candidate.payment || candidate;
    const order = candidate.order || payment.order;

    return (
      payment.asset === "TRX" &&
      deposit.asset === "TRX" &&
      normalizeAddress(payment.toAddress) === normalizeAddress(deposit.toAddress) &&
      String(payment.expectedAmountSun) === String(deposit.amountBaseUnits)
    );
  });

  const activeCandidates = amountAddressCandidates.filter((candidate) => {
    const payment = candidate.payment || candidate;
    const order = candidate.order || payment.order;
    return (
      payment.status === PAYMENT_STATUSES.AWAITING_PAYMENT &&
      order?.status === ORDER_STATUSES.PENDING_PAYMENT &&
      order.expiresAt &&
      new Date(order.expiresAt) >= now
    );
  });

  const expiredCandidates = amountAddressCandidates.filter((candidate) => {
    const payment = candidate.payment || candidate;
    const order = candidate.order || payment.order;
    return (
      payment.status === PAYMENT_STATUSES.EXPIRED ||
      order?.status === ORDER_STATUSES.EXPIRED ||
      (order?.expiresAt && new Date(order.expiresAt) < now)
    );
  });

  if (activeCandidates.length === 1) {
    const payment = activeCandidates[0].payment || activeCandidates[0];
    return {
      status: DEPOSIT_STATUSES.MATCHED,
      payment,
      order: activeCandidates[0].order || payment.order,
    };
  }

  if (activeCandidates.length > 1) {
    return {
      status: DEPOSIT_STATUSES.UNMATCHED_AMBIGUOUS,
      candidates: activeCandidates,
    };
  }

  if (expiredCandidates.length > 0) {
    return {
      status: DEPOSIT_STATUSES.MATCHED_BUT_EXPIRED,
      candidates: expiredCandidates,
    };
  }

  return {
    status: DEPOSIT_STATUSES.UNMATCHED,
    candidates: [],
  };
}

module.exports = {
  DEPOSIT_STATUSES,
  buildDepositKey,
  classifyDepositMatch,
  getAllowedTrc20Contracts,
  isAllowedTrc20Deposit,
  normalizeAddress,
};
