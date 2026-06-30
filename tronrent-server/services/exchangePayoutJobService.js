"use strict";

const {
  ChainDeposit,
  ExchangeOrder,
  ExchangePayoutJob,
  Sequelize,
  sequelize,
} = require("../db/models");
const { requireEnabledAdminRoute } = require("../utils/adminRouteGate");
const { createHttpError } = require("../utils/httpErrors");
const {
  buildManualResolution,
  serializeManualResolution,
} = require("../utils/manualResolution");
const {
  EXCHANGE_ORDER_STATUSES,
  EXCHANGE_PAYOUT_STATUSES,
  assertExchangeOrderTransition,
} = require("./exchangeOrderService");
const exchangePayoutClient = require("./exchangePayoutClient");
const Op = Sequelize.Op;

function getReviewLimit(rawLimit) {
  const parsed = Number.parseInt(rawLimit || "50", 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 50;
  }
  return Math.min(parsed, 200);
}

function getStaleProcessingMinutes(rawMinutes) {
  const parsed = Number.parseInt(rawMinutes || "10", 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 10;
  }
  return Math.min(parsed, 24 * 60);
}

function assertExchangePayoutRouteEnabled(req) {
  requireEnabledAdminRoute({
    req,
    enabledEnvVar: "ENABLE_EXCHANGE_PAYOUT_ENDPOINT",
    disabledMessage: "Exchange payout endpoint is disabled",
  });
}

function serializePayoutTransferPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  return {
    exchangeOrderId: payload.exchangeOrderId,
    dryRun: payload.dryRun,
    asset: payload.asset,
    contractAddress: payload.contractAddress,
    toAddress: payload.toAddress,
    amountBaseUnits:
      payload.amountBaseUnits === undefined
        ? undefined
        : String(payload.amountBaseUnits),
  };
}

function buildPayoutRequest(order) {
  return {
    exchangeOrderId: order.id,
    dryRun: !exchangePayoutClient.isExchangePayoutLiveMode(),
    asset: order.outputAsset,
    contractAddress: order.outputContractAddress,
    toAddress: order.outputAddress,
    amountBaseUnits: String(order.outputBaseUnits),
  };
}

function serializeLatestPayoutJob(job) {
  if (!job) {
    return null;
  }

  const plain = job.get ? job.get({ plain: true }) : job;
  const response = plain.response || {};
  const broadcastResponse = response.broadcastResponse || null;
  const broadcastTxid = response.txid || broadcastResponse?.txid || null;
  const safeBroadcastResponse = broadcastResponse
      ? {
          dryRun: broadcastResponse.dryRun,
          accepted: broadcastResponse.accepted,
          asset: broadcastResponse.asset,
          txid: broadcastTxid,
          completionMeaning: broadcastResponse.completionMeaning,
          transfer: serializePayoutTransferPayload(
            broadcastResponse.transfer || broadcastResponse.wouldTransfer
          ),
        }
      : null;

  return {
    id: plain.id,
    status: plain.status,
    dryRun: Boolean(plain.dryRun),
    asset: plain.asset,
    contractAddress: plain.contractAddress,
    toAddress: plain.toAddress,
    amountBaseUnits: String(plain.amountBaseUnits),
    attemptCount: Number(plain.attemptCount || 0),
    lastError: plain.lastError || null,
    processedAt: plain.processedAt || null,
    updatedAt: plain.updatedAt || null,
    response: {
      completionMeaning: response.completionMeaning || null,
      txid: broadcastTxid,
      broadcastResponse: safeBroadcastResponse,
      indeterminate: Boolean(response.indeterminate),
      manualResolution: serializeManualResolution(response.manualResolution),
    },
  };
}

function getPayoutResolutionTarget(resolution) {
  if (resolution === "completed") {
    return {
      orderStatus: EXCHANGE_ORDER_STATUSES.PAYOUT_COMPLETED,
      jobStatus: EXCHANGE_PAYOUT_STATUSES.COMPLETED,
      requireEvidence: true,
    };
  }

  if (resolution === "failed") {
    return {
      orderStatus: EXCHANGE_ORDER_STATUSES.PAYOUT_FAILED,
      jobStatus: EXCHANGE_PAYOUT_STATUSES.FAILED,
      requireEvidence: false,
    };
  }

  throw createHttpError(400, "Unsupported exchange payout manual resolution");
}

async function resolvePayoutReview({
  exchangeOrderId,
  resolution,
  note,
  txid,
  resolvedBy,
  now = new Date(),
}) {
  const target = getPayoutResolutionTarget(resolution);
  let resolvedJobId;

  await sequelize.transaction(async (transaction) => {
    const order = await ExchangeOrder.findByPk(exchangeOrderId, {
      transaction,
      lock: true,
    });
    if (!order) {
      throw createHttpError(404, "Exchange order not found");
    }
    if (order.status !== EXCHANGE_ORDER_STATUSES.PAYOUT_INDETERMINATE) {
      throw createHttpError(409, "Exchange order is not in payout manual-review state");
    }

    const job = await ExchangePayoutJob.findOne({
      where: { exchangeOrderId: order.id },
      transaction,
      lock: true,
      order: [["createdAt", "DESC"]],
    });
    if (!job || job.status !== EXCHANGE_PAYOUT_STATUSES.INDETERMINATE) {
      throw createHttpError(409, "Latest exchange payout job is not indeterminate");
    }

    const manualResolution = buildManualResolution({
      resolution,
      note,
      resolvedBy,
      evidenceField: "txid",
      evidenceValue: txid,
      requireEvidence: target.requireEvidence,
      now,
    });

    const existingResponse = job.response || {};
    await job.update(
      {
        status: target.jobStatus,
        response: {
          ...existingResponse,
          manualResolution,
        },
        processedAt: now,
      },
      { transaction }
    );

    assertExchangeOrderTransition(order.status, target.orderStatus);
    await order.update(
      {
        status: target.orderStatus,
        ...(target.orderStatus === EXCHANGE_ORDER_STATUSES.PAYOUT_COMPLETED
          ? { payoutCompletedAt: now }
          : {}),
      },
      { transaction }
    );

    if (target.orderStatus === EXCHANGE_ORDER_STATUSES.PAYOUT_COMPLETED) {
      await ChainDeposit.update(
        {
          matchedExchangePayoutJobId: job.id,
        },
        {
          where: {
            matchedExchangeOrderId: exchangeOrderId,
            matchedExchangePayoutJobId: null,
          },
          transaction,
        }
      );
    }

    resolvedJobId = job.id;
  });

  return ExchangePayoutJob.findByPk(resolvedJobId, {
    include: [{ model: ExchangeOrder, as: "exchangeOrder" }],
  });
}

function getReviewReason(order, staleCutoff) {
  if (order.status === EXCHANGE_ORDER_STATUSES.PAYOUT_INDETERMINATE) {
    return "manual_review_indeterminate";
  }

  if (
    order.status === EXCHANGE_ORDER_STATUSES.PAYOUT_PROCESSING &&
    new Date(order.updatedAt) <= staleCutoff
  ) {
    return "stale_processing_claim";
  }

  return null;
}

function serializePayoutReviewItem(order, latestJob, staleCutoff) {
  const plain = order.get ? order.get({ plain: true }) : order;
  const reason = getReviewReason(plain, staleCutoff);
  if (!reason) {
    return null;
  }

  return {
    reason,
    exchangeOrder: {
      id: plain.id,
      direction: plain.direction,
      status: plain.status,
      outputAsset: plain.outputAsset,
      outputAddress: plain.outputAddress,
      outputContractAddress: plain.outputContractAddress,
      outputBaseUnits: String(plain.outputBaseUnits),
      fundsReceivedAt: plain.fundsReceivedAt || null,
      payoutCompletedAt: plain.payoutCompletedAt || null,
      updatedAt: plain.updatedAt,
    },
    latestPayoutJob: serializeLatestPayoutJob(latestJob),
  };
}

async function listPayoutReviewItems({
  staleProcessingMinutes,
  limit,
  now = new Date(),
} = {}) {
  const clampedLimit = getReviewLimit(limit);
  const minutes = getStaleProcessingMinutes(staleProcessingMinutes);
  const staleCutoff = new Date(now.getTime() - minutes * 60 * 1000);

  const orders = await ExchangeOrder.findAll({
    where: {
      [Op.or]: [
        { status: EXCHANGE_ORDER_STATUSES.PAYOUT_INDETERMINATE },
        {
          status: EXCHANGE_ORDER_STATUSES.PAYOUT_PROCESSING,
          updatedAt: { [Op.lte]: staleCutoff },
        },
      ],
    },
    include: [
      {
        model: ExchangePayoutJob,
        as: "payoutJobs",
        required: false,
        separate: true,
        limit: 1,
        order: [["createdAt", "DESC"]],
      },
    ],
    order: [
      ["updatedAt", "ASC"],
      ["id", "ASC"],
    ],
    limit: clampedLimit,
  });

  const seen = new Set();
  const items = [];
  for (const order of orders) {
    const plain = order.get ? order.get({ plain: true }) : order;
    if (seen.has(plain.id)) {
      continue;
    }
    seen.add(plain.id);

    const latestJob = (plain.payoutJobs || [])[0] || null;
    const item = serializePayoutReviewItem(plain, latestJob, staleCutoff);
    if (item) {
      items.push(item);
    }
  }

  return {
    staleProcessingMinutes: minutes,
    staleCutoff: staleCutoff.toISOString(),
    count: items.length,
    data: items,
  };
}

async function markPayoutFailure({
  exchangeOrderId,
  job,
  error,
  indeterminate,
  response = null,
}) {
  const nextJobStatus = indeterminate
    ? EXCHANGE_PAYOUT_STATUSES.INDETERMINATE
    : EXCHANGE_PAYOUT_STATUSES.FAILED;
  const nextOrderStatus = indeterminate
    ? EXCHANGE_ORDER_STATUSES.PAYOUT_INDETERMINATE
    : EXCHANGE_ORDER_STATUSES.PAYOUT_FAILED;

  await sequelize.transaction(async (transaction) => {
    const order = await ExchangeOrder.findByPk(exchangeOrderId, {
      transaction,
      lock: true,
    });
    assertExchangeOrderTransition(order.status, nextOrderStatus);

    await job.update(
      {
        status: nextJobStatus,
        lastError: error.message,
        response: {
          error: error.message,
          indeterminate,
          details: error.payoutDetails || null,
          broadcastResponse: response,
        },
        processedAt: new Date(),
      },
      { transaction }
    );

    await order.update(
      {
        status: nextOrderStatus,
      },
      { transaction }
    );
  });
}

async function processExchangeOrder(exchangeOrderId) {
  let job;
  let orderSnapshot;

  await sequelize.transaction(async (transaction) => {
    const order = await ExchangeOrder.findByPk(exchangeOrderId, {
      transaction,
      lock: true,
    });

    if (!order) {
      throw createHttpError(404, "Exchange order not found");
    }

    if (order.status !== EXCHANGE_ORDER_STATUSES.FUNDS_RECEIVED) {
      throw createHttpError(409, "Exchange order is not ready for payout");
    }

    const existingJob = await ExchangePayoutJob.findOne({
      where: { exchangeOrderId: order.id },
      transaction,
      lock: true,
      order: [["createdAt", "DESC"]],
    });
    if (existingJob) {
      throw createHttpError(409, "Exchange payout job already exists");
    }

    assertExchangeOrderTransition(
      order.status,
      EXCHANGE_ORDER_STATUSES.PAYOUT_PROCESSING
    );
    await order.update(
      { status: EXCHANGE_ORDER_STATUSES.PAYOUT_PROCESSING },
      { transaction }
    );

    job = await ExchangePayoutJob.create(
      {
        exchangeOrderId: order.id,
        status: EXCHANGE_PAYOUT_STATUSES.PROCESSING,
        dryRun: !exchangePayoutClient.isExchangePayoutLiveMode(),
        asset: order.outputAsset,
        contractAddress: order.outputContractAddress,
        toAddress: order.outputAddress,
        amountBaseUnits: order.outputBaseUnits,
        request: buildPayoutRequest(order),
        attemptCount: 1,
      },
      { transaction }
    );

    orderSnapshot = order.get({ plain: true });
  });

  let response;
  try {
    response = await exchangePayoutClient.executeExchangePayout(orderSnapshot);
  } catch (error) {
    await markPayoutFailure({
      exchangeOrderId,
      job,
      error,
      indeterminate: exchangePayoutClient.isIndeterminatePayoutError(error),
    });
    throw error;
  }

  try {
    const now = new Date();
    await sequelize.transaction(async (transaction) => {
      const order = await ExchangeOrder.findByPk(exchangeOrderId, {
        transaction,
        lock: true,
      });
      assertExchangeOrderTransition(
        order.status,
        EXCHANGE_ORDER_STATUSES.PAYOUT_COMPLETED
      );

      await job.update(
        {
          status: EXCHANGE_PAYOUT_STATUSES.COMPLETED,
          dryRun: Boolean(response.dryRun),
          response,
          processedAt: now,
        },
        { transaction }
      );

      await order.update(
        {
          status: EXCHANGE_ORDER_STATUSES.PAYOUT_COMPLETED,
          payoutCompletedAt: now,
        },
        { transaction }
      );

      await ChainDeposit.update(
        {
          matchedExchangePayoutJobId: job.id,
        },
        {
          where: {
            matchedExchangeOrderId: exchangeOrderId,
            matchedExchangePayoutJobId: null,
          },
          transaction,
        }
      );
    });
  } catch (error) {
    const persistenceError = new Error(
      `Exchange payout broadcast was submitted but completion persistence failed: ${error.message}`
    );
    await markPayoutFailure({
      exchangeOrderId,
      job,
      error: persistenceError,
      indeterminate: true,
      response,
    });
    throw persistenceError;
  }

  return ExchangePayoutJob.findByPk(job.id, {
    include: [{ model: ExchangeOrder, as: "exchangeOrder" }],
  });
}

async function processExchangeOrders(exchangeOrderIds = []) {
  const uniqueOrderIds = Array.from(
    new Set(exchangeOrderIds.map((orderId) => String(orderId)).filter(Boolean))
  );

  const results = [];
  for (const exchangeOrderId of uniqueOrderIds) {
    try {
      const job = await processExchangeOrder(exchangeOrderId);
      results.push({
        exchangeOrderId,
        success: true,
        job,
      });
    } catch (error) {
      const nonfatal = error.statusCode === 404 || error.statusCode === 409;
      results.push({
        exchangeOrderId,
        success: false,
        skipped: nonfatal,
        message: error.message,
      });

      if (!nonfatal) {
        console.error(
          `Exchange payout processing failed for order ${exchangeOrderId}:`,
          error
        );
      }
    }
  }

  return results;
}

module.exports = {
  assertExchangePayoutRouteEnabled,
  listPayoutReviewItems,
  processExchangeOrder,
  processExchangeOrders,
  resolvePayoutReview,
  serializePayoutReviewItem,
};
