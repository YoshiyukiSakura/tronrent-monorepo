"use strict";

const { Op } = require("sequelize");
const {
  ChainDeposit,
  ExchangeOrder,
  Order,
  Payment,
  sequelize,
} = require("../db/models");
const { requireEnabledAdminRoute } = require("../utils/adminRouteGate");
const { createHttpError } = require("../utils/httpErrors");
const {
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  assertOrderTransition,
} = require("./orderState");
const {
  DEPOSIT_STATUSES,
  buildDepositKey,
  classifyDepositMatch,
  getAllowedTrc20Contracts,
  isAllowedTrc20Deposit,
} = require("./depositMatcher");
const {
  EXCHANGE_ORDER_STATUSES,
  assertExchangeOrderTransition,
} = require("./exchangeOrderService");
const exchangePayoutJobService = require("./exchangePayoutJobService");
const providerJobService = require("./providerJobService");
const tronGridClient = require("./tronGridClient");

let scanInProgress = false;

function normalizeAddress(address) {
  return address ? String(address).trim() : null;
}

function normalizeFingerprint(fingerprint) {
  const normalized = String(fingerprint || "").trim();
  return normalized || null;
}

function getDepositScanMaxPages(rawMaxPages) {
  const parsed = Number.parseInt(
    rawMaxPages || process.env.DEPOSIT_SCAN_MAX_PAGES || "20",
    10
  );
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 20;
  }
  return Math.min(parsed, 200);
}

function resolveDepositScanMinTimestamp(rawMinTimestamp) {
  if (
    rawMinTimestamp !== undefined &&
    rawMinTimestamp !== null &&
    rawMinTimestamp !== ""
  ) {
    return rawMinTimestamp;
  }

  const lookbackMinutes = Number.parseInt(
    process.env.DEPOSIT_SCAN_LOOKBACK_MINUTES || "180",
    10
  );
  const safeLookback = Number.isFinite(lookbackMinutes)
    ? Math.max(1, lookbackMinutes)
    : 180;
  return Date.now() - safeLookback * 60 * 1000;
}

function buildTruncationWarning({ address, asset, pageCount }) {
  return {
    code: "DEPOSIT_SCAN_TRUNCATED",
    severity: "warning",
    address,
    asset,
    pageCount,
    message: `Deposit scan for ${asset} ${address} reached ${pageCount} pages while TronGrid still returned another page.`,
  };
}

function logTruncationWarning(warning) {
  console.warn(`[deposit-scan] ${warning.message}`);
}

function buildSkippedPostMatchProcessing() {
  return {
    triggered: false,
    attempted: 0,
    succeeded: false,
    failed: false,
    resultCount: 0,
    error: null,
  };
}

function sanitizePostMatchProcessingCode(rawCode) {
  const code = String(rawCode || "").trim();
  if (/^[A-Z0-9_:-]{1,80}$/.test(code)) {
    return code;
  }
  return "POST_MATCH_PROCESSING_FAILED";
}

function sanitizePostMatchProcessingError(error, message) {
  return {
    message,
    code: sanitizePostMatchProcessingCode(error?.code),
    statusCode: Number.isInteger(error?.statusCode) ? error.statusCode : null,
  };
}

async function runPostMatchProcessor({
  ids,
  enabled,
  processor,
  failureMessage,
  logMessage,
}) {
  const uniqueIds = Array.from(
    new Set(ids.map((id) => String(id)).filter(Boolean))
  );
  if (!enabled || uniqueIds.length === 0) {
    return {
      summary: buildSkippedPostMatchProcessing(),
      results: [],
    };
  }

  try {
    const results = await processor(uniqueIds);
    return {
      summary: {
        triggered: true,
        attempted: uniqueIds.length,
        succeeded: true,
        failed: false,
        resultCount: Array.isArray(results) ? results.length : 0,
        error: null,
      },
      results: Array.isArray(results) ? results : [],
    };
  } catch (error) {
    console.error(logMessage, error);
    return {
      summary: {
        triggered: true,
        attempted: uniqueIds.length,
        succeeded: false,
        failed: true,
        resultCount: 0,
        error: sanitizePostMatchProcessingError(error, failureMessage),
      },
      results: [],
    };
  }
}

async function runPostMatchProcessing({
  matchedOrderIds = [],
  matchedExchangeOrderIds = [],
  processProviderJobs = false,
  processExchangePayouts = false,
} = {}) {
  const provider = await runPostMatchProcessor({
    ids: matchedOrderIds,
    enabled: processProviderJobs,
    processor: (ids) => providerJobService.processOrders(ids),
    failureMessage: "Provider post-match processing failed",
    logMessage: "Provider processing after deposit scan failed:",
  });
  const exchangePayout = await runPostMatchProcessor({
    ids: matchedExchangeOrderIds,
    enabled: processExchangePayouts,
    processor: (ids) => exchangePayoutJobService.processExchangeOrders(ids),
    failureMessage: "Exchange payout post-match processing failed",
    logMessage: "Exchange payout processing after deposit scan failed:",
  });

  return {
    postMatchProcessing: {
      provider: provider.summary,
      exchangePayout: exchangePayout.summary,
    },
    providerResults: provider.results,
    exchangePayoutResults: exchangePayout.results,
  };
}

function assertDepositScanRouteEnabled(req) {
  requireEnabledAdminRoute({
    req,
    enabledEnvVar: "ENABLE_DEPOSIT_SCAN_ENDPOINT",
    disabledMessage: "Deposit scan endpoint is disabled",
  });
}

async function listDeposits({ limit = 50, status } = {}) {
  const where = {};
  if (status) {
    where.status = status;
  }

  return ChainDeposit.findAll({
    where,
    order: [["createdAt", "DESC"]],
    limit,
  });
}

async function findCandidatePayments(deposit, transaction) {
  return Payment.findAll({
    where: {
      asset: "TRX",
      status: PAYMENT_STATUSES.AWAITING_PAYMENT,
      toAddress: deposit.toAddress,
      expectedAmountSun: String(deposit.amountBaseUnits),
    },
    include: [
      {
        model: Order,
        as: "order",
        required: true,
        where: {
          status: {
            [Op.in]: [ORDER_STATUSES.PENDING_PAYMENT, ORDER_STATUSES.EXPIRED],
          },
        },
      },
    ],
    transaction,
    lock: true,
  });
}

function depositMatchesExchangeOrder(deposit, order) {
  if (normalizeAddress(order.treasuryAddress) !== normalizeAddress(deposit.toAddress)) {
    return false;
  }

  if (String(order.expectedInputBaseUnits) !== String(deposit.amountBaseUnits)) {
    return false;
  }

  if (order.inputAsset === "TRX") {
    return deposit.asset === "TRX" && !order.inputContractAddress;
  }

  if (order.inputAsset === "USDT") {
    return (
      deposit.asset === "TRC20" &&
      normalizeAddress(order.inputContractAddress) ===
        normalizeAddress(deposit.contractAddress)
    );
  }

  return false;
}

function classifyExchangeDepositMatch(deposit, candidates, now = new Date()) {
  const matchingCandidates = candidates.filter((order) =>
    depositMatchesExchangeOrder(deposit, order)
  );
  const activeCandidates = matchingCandidates.filter(
    (order) =>
      order.status === EXCHANGE_ORDER_STATUSES.PENDING_DEPOSIT &&
      order.expiresAt &&
      new Date(order.expiresAt) >= now
  );
  const expiredCandidates = matchingCandidates.filter(
    (order) =>
      order.status === EXCHANGE_ORDER_STATUSES.EXPIRED ||
      (order.expiresAt && new Date(order.expiresAt) < now)
  );

  if (activeCandidates.length === 1) {
    return {
      status: DEPOSIT_STATUSES.MATCHED,
      exchangeOrder: activeCandidates[0],
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

async function findCandidateExchangeOrders(deposit, transaction) {
  const inputAsset = deposit.asset === "TRX" ? "TRX" : "USDT";
  const where = {
    treasuryAddress: deposit.toAddress,
    inputAsset,
    expectedInputBaseUnits: String(deposit.amountBaseUnits),
    status: {
      [Op.in]: [
        EXCHANGE_ORDER_STATUSES.PENDING_DEPOSIT,
        EXCHANGE_ORDER_STATUSES.EXPIRED,
      ],
    },
  };

  if (deposit.asset === "TRC20") {
    where.inputContractAddress = deposit.contractAddress;
  }

  if (deposit.asset === "TRX") {
    where.inputContractAddress = null;
  }

  return ExchangeOrder.findAll({
    where,
    transaction,
    lock: true,
  });
}

async function fetchPaginatedInboundTransfers({
  address,
  asset,
  fetchPage,
  limit,
  minTimestamp,
  maxPages,
}) {
  const deposits = [];
  const safeMaxPages = getDepositScanMaxPages(maxPages);
  let fingerprint = null;
  let pageCount = 0;

  while (pageCount < safeMaxPages) {
    const page = await fetchPage(address, {
      limit,
      minTimestamp,
      fingerprint,
    });
    pageCount += 1;
    deposits.push(...(page.deposits || []));

    fingerprint = normalizeFingerprint(page.fingerprint);
    if (!fingerprint) {
      break;
    }
  }

  const truncated = Boolean(fingerprint);
  return {
    address,
    asset,
    deposits,
    pageCount,
    truncated,
    nextFingerprintAvailable: truncated,
  };
}

async function fetchTreasuryAddressDeposits({
  treasuryAddress,
  limit,
  minTimestamp,
  maxPages,
}) {
  const trxResult = await fetchPaginatedInboundTransfers({
    address: treasuryAddress,
    asset: "TRX",
    fetchPage: tronGridClient.fetchInboundTrxTransfers,
    limit,
    minTimestamp,
    maxPages,
  });
  const trc20Result = await fetchPaginatedInboundTransfers({
    address: treasuryAddress,
    asset: "TRC20",
    fetchPage: tronGridClient.fetchInboundTrc20Transfers,
    limit,
    minTimestamp,
    maxPages,
  });

  const pageResults = [trxResult, trc20Result];
  return {
    events: pageResults.flatMap((result) => result.deposits),
    pageSummaries: pageResults.map((result) => ({
      address: result.address,
      asset: result.asset,
      pageCount: result.pageCount,
      depositCount: result.deposits.length,
      truncated: result.truncated,
    })),
    truncationWarnings: pageResults
      .filter((result) => result.truncated)
      .map((result) =>
        buildTruncationWarning({
          address: result.address,
          asset: result.asset,
          pageCount: result.pageCount,
        })
      ),
  };
}

async function recordAndMatchDeposit(inputDeposit) {
  const deposit = {
    ...inputDeposit,
    depositKey: inputDeposit.depositKey || buildDepositKey(inputDeposit),
    eventIndex: String(inputDeposit.eventIndex || "0"),
    amountBaseUnits: String(inputDeposit.amountBaseUnits),
    status: DEPOSIT_STATUSES.OBSERVED,
  };

  let matchedOrderId = null;
  let matchedPaymentId = null;
  let matchedExchangeOrderId = null;
  let created = false;

  const savedDeposit = await sequelize.transaction(async (transaction) => {
    const [chainDeposit, wasCreated] = await ChainDeposit.findOrCreate({
      where: { depositKey: deposit.depositKey },
      defaults: deposit,
      transaction,
      lock: true,
    });

    created = wasCreated;
    if (!wasCreated) {
      return chainDeposit;
    }

    if (!isAllowedTrc20Deposit(deposit)) {
      await chainDeposit.update(
        { status: DEPOSIT_STATUSES.REJECTED_TOKEN },
        { transaction }
      );
      return chainDeposit;
    }

    const candidates = await findCandidatePayments(deposit, transaction);
    const classification = classifyDepositMatch(
      deposit,
      candidates.map((payment) => ({ payment, order: payment.order }))
    );

    if (classification.status === DEPOSIT_STATUSES.MATCHED) {
      const payment = await Payment.findByPk(classification.payment.id, {
        transaction,
        lock: true,
      });
      const order = await Order.findByPk(classification.order.id, {
        transaction,
        lock: true,
      });

      if (
        !payment ||
        !order ||
        payment.status !== PAYMENT_STATUSES.AWAITING_PAYMENT ||
        order.status !== ORDER_STATUSES.PENDING_PAYMENT ||
        String(payment.expectedAmountSun) !== String(deposit.amountBaseUnits)
      ) {
        await chainDeposit.update(
          { status: DEPOSIT_STATUSES.UNMATCHED },
          { transaction }
        );
        return chainDeposit;
      }

      assertOrderTransition(order.status, ORDER_STATUSES.PAID);

      const now = new Date();
      await payment.update(
        {
          status: PAYMENT_STATUSES.CONFIRMED,
          receivedAmountSun: deposit.amountBaseUnits,
          txHash: deposit.txHash,
          fromAddress: deposit.fromAddress,
          toAddress: deposit.toAddress,
          detectedAt: deposit.blockTimestamp || now,
          confirmedAt: now,
          metadata: {
            ...payment.metadata,
            chainDepositKey: deposit.depositKey,
            matchedBy: "unique_amount",
          },
        },
        { transaction }
      );

      await order.update(
        {
          status: ORDER_STATUSES.PAID,
          paidAt: now,
        },
        { transaction }
      );

      matchedOrderId = order.id;
      matchedPaymentId = payment.id;
      await chainDeposit.update(
        {
          status: DEPOSIT_STATUSES.MATCHED,
          matchedOrderId: order.id,
          matchedPaymentId: payment.id,
        },
        { transaction }
      );
      return chainDeposit;
    }

    if (classification.status !== DEPOSIT_STATUSES.UNMATCHED) {
      await chainDeposit.update(
        {
          status: classification.status,
          raw: {
            ...deposit.raw,
            candidateCount: classification.candidates?.length || 0,
          },
        },
        { transaction }
      );
      return chainDeposit;
    }

    const exchangeCandidates = await findCandidateExchangeOrders(
      deposit,
      transaction
    );
    const exchangeClassification = classifyExchangeDepositMatch(
      deposit,
      exchangeCandidates
    );

    if (exchangeClassification.status !== DEPOSIT_STATUSES.MATCHED) {
      await chainDeposit.update(
        {
          status: exchangeClassification.status,
          raw: {
            ...deposit.raw,
            candidateCount: exchangeClassification.candidates?.length || 0,
          },
        },
        { transaction }
      );
      return chainDeposit;
    }

    const exchangeOrder = await ExchangeOrder.findByPk(
      exchangeClassification.exchangeOrder.id,
      {
        transaction,
        lock: true,
      }
    );

    if (
      !exchangeOrder ||
      exchangeOrder.status !== EXCHANGE_ORDER_STATUSES.PENDING_DEPOSIT ||
      !depositMatchesExchangeOrder(deposit, exchangeOrder) ||
      new Date(exchangeOrder.expiresAt) < new Date()
    ) {
      await chainDeposit.update(
        { status: DEPOSIT_STATUSES.UNMATCHED },
        { transaction }
      );
      return chainDeposit;
    }

    assertExchangeOrderTransition(
      exchangeOrder.status,
      EXCHANGE_ORDER_STATUSES.FUNDS_RECEIVED
    );

    matchedExchangeOrderId = exchangeOrder.id;
    await exchangeOrder.update(
      {
        status: EXCHANGE_ORDER_STATUSES.FUNDS_RECEIVED,
        fundsReceivedAt: new Date(),
      },
      { transaction }
    );

    await chainDeposit.update(
      {
        status: DEPOSIT_STATUSES.MATCHED,
        matchedExchangeOrderId: exchangeOrder.id,
      },
      { transaction }
    );

    return chainDeposit;
  });

  return {
    created,
    matched: Boolean(matchedPaymentId || matchedExchangeOrderId),
    matchedOrderId,
    matchedPaymentId,
    matchedExchangeOrderId,
    deposit: savedDeposit,
  };
}

async function scanConfiguredTreasury(options = {}) {
  if (scanInProgress) {
    throw createHttpError(409, "Deposit scan already in progress");
  }

  const treasuryAddresses = Array.from(
    new Set(
      [
        normalizeAddress(process.env.TREASURY_TRON_ADDRESS),
        normalizeAddress(process.env.EXCHANGE_TREASURY_TRON_ADDRESS),
      ].filter(Boolean)
    )
  );
  if (treasuryAddresses.length === 0) {
    throw createHttpError(
      400,
      "TREASURY_TRON_ADDRESS or EXCHANGE_TREASURY_TRON_ADDRESS is required"
    );
  }

  scanInProgress = true;
  try {
    const scanLimit = options.limit || 50;
    const minTimestamp = resolveDepositScanMinTimestamp(options.minTimestamp);
    const maxPages = getDepositScanMaxPages(options.maxPages);
    const events = [];
    const pageSummaries = [];
    const truncationWarnings = [];
    for (const treasuryAddress of treasuryAddresses) {
      const treasuryResult = await fetchTreasuryAddressDeposits({
        treasuryAddress,
        limit: scanLimit,
        minTimestamp,
        maxPages,
      });
      events.push(...treasuryResult.events);
      pageSummaries.push(...treasuryResult.pageSummaries);
      for (const warning of treasuryResult.truncationWarnings) {
        logTruncationWarning(warning);
        truncationWarnings.push(warning);
      }
    }

    const results = [];
    for (const event of events) {
      const result = await recordAndMatchDeposit(event);
      results.push(result);
    }

    const matchedCount = results.filter((result) => result.matched).length;
    const matchedOrderIds = results
      .map((result) => result.matchedOrderId)
      .filter(Boolean);
    const matchedExchangeOrderIds = results
      .map((result) => result.matchedExchangeOrderId)
      .filter(Boolean);
    const postMatchResult = await runPostMatchProcessing({
      matchedOrderIds,
      matchedExchangeOrderIds,
      processProviderJobs: options.processProviderJobs,
      processExchangePayouts: options.processExchangePayouts,
    });

    return {
      scanned: events.length,
      created: results.filter((result) => result.created).length,
      matched: matchedCount,
      truncated: truncationWarnings.length > 0,
      truncationWarnings,
      pageSummaries,
      postMatchProcessing: postMatchResult.postMatchProcessing,
      providerResults: postMatchResult.providerResults,
      exchangePayoutResults: postMatchResult.exchangePayoutResults,
      results,
    };
  } finally {
    scanInProgress = false;
  }
}

module.exports = {
  DEPOSIT_STATUSES,
  assertDepositScanRouteEnabled,
  buildDepositKey,
  classifyExchangeDepositMatch,
  classifyDepositMatch,
  depositMatchesExchangeOrder,
  fetchPaginatedInboundTransfers,
  fetchTreasuryAddressDeposits,
  getAllowedTrc20Contracts,
  getDepositScanMaxPages,
  isAllowedTrc20Deposit,
  listDeposits,
  recordAndMatchDeposit,
  resolveDepositScanMinTimestamp,
  runPostMatchProcessing,
  scanConfiguredTreasury,
};
