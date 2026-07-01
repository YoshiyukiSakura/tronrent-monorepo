"use strict";

const { Order, ProviderJob, Sequelize, sequelize } = require("../db/models");
const { requireEnabledAdminRoute } = require("../utils/adminRouteGate");
const { createHttpError } = require("../utils/httpErrors");
const {
  buildManualResolution,
  serializeManualResolution,
} = require("../utils/manualResolution");
const {
  ORDER_STATUSES,
  PROVIDER_JOB_STATUSES,
  assertOrderTransition,
} = require("./orderState");
const providerClient = require("./providerClient");
const Op = Sequelize.Op;

function getReviewLimit(rawLimit) {
  const parsed = Number.parseInt(rawLimit || "50", 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 50;
  }
  return Math.min(parsed, 200);
}

function getPendingPaidOrderLimit(rawLimit) {
  const parsed = Number.parseInt(rawLimit || "10", 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 10;
  }
  return Math.min(parsed, 200);
}

function getStaleProvisioningMinutes(rawMinutes) {
  const parsed = Number.parseInt(rawMinutes || "10", 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 10;
  }
  return Math.min(parsed, 24 * 60);
}

function assertProviderJobRouteEnabled(req) {
  requireEnabledAdminRoute({
    req,
    enabledEnvVar: "ENABLE_PROVIDER_JOB_ENDPOINT",
    disabledMessage: "Provider job endpoint is disabled",
  });
}

function buildProviderRequest(order) {
  return {
    orderId: order.id,
    targetAddress: order.targetAddress,
    energyAmount: order.energyAmount,
    durationHours: order.durationHours,
    planId: order.planId,
  };
}

function serializeProviderRequest(request = {}) {
  return {
    orderId: request.orderId,
    targetAddress: request.targetAddress,
    energyAmount: request.energyAmount,
    durationHours: request.durationHours,
    planId: request.planId,
  };
}

function serializeProviderDetails(details) {
  if (!details || typeof details !== "object") {
    return null;
  }

  return {
    endpoint: details.endpoint,
    httpStatus: details.httpStatus,
    reason: details.reason,
    timeoutMs: details.timeoutMs,
    providerCode: details.providerCode,
    providerMessage: details.providerMessage,
  };
}

function serializeProviderResponse(response = {}) {
  const providerResponse = response.providerResponse || {};
  const price = providerResponse.preflight?.price || {};
  const balance = providerResponse.preflight?.balance || {};
  const energyOrder = providerResponse.energyOrder || {};
  const energyOrderBody = energyOrder.body || {};

  return {
    dryRun: response.dryRun,
    provider: response.provider,
    accepted: response.accepted,
    upstreamOrderId: response.upstreamOrderId || null,
    targetAddress: response.targetAddress,
    energyAmount: response.energyAmount,
    durationHours: response.durationHours,
    providerCode: response.providerCode,
    providerMessage: response.providerMessage,
    error: response.error || null,
    indeterminate: Boolean(response.indeterminate),
    completionMeaning: response.completionMeaning || null,
    completionPersistenceError: response.completionPersistenceError || null,
    manualResolution: serializeManualResolution(response.manualResolution),
    providerDetails: serializeProviderDetails(response.providerDetails),
    preflight: {
      price: {
        endpoint: price.endpoint,
        httpStatus: price.httpStatus,
        energyAmount: price.energyAmount,
        durationHours: price.durationHours,
        estimatedCostTrx: price.estimatedCostTrx,
      },
      balance: {
        endpoint: balance.endpoint,
        httpStatus: balance.httpStatus,
        availableBalanceTrx: balance.availableBalanceTrx,
      },
    },
    energyOrder: {
      endpoint: energyOrder.endpoint,
      httpStatus: energyOrder.httpStatus,
      providerCode: energyOrderBody.code,
      providerMessage: energyOrderBody.message,
    },
  };
}

function getProviderResolutionTarget(resolution) {
  if (resolution === "fulfilled") {
    return {
      orderStatus: ORDER_STATUSES.FULFILLED,
      jobStatus: PROVIDER_JOB_STATUSES.COMPLETED,
      requireEvidence: true,
    };
  }

  if (resolution === "failed") {
    return {
      orderStatus: ORDER_STATUSES.FAILED,
      jobStatus: PROVIDER_JOB_STATUSES.FAILED,
      requireEvidence: false,
    };
  }

  throw createHttpError(400, "Unsupported provider manual resolution");
}

async function resolveProviderReview({
  orderId,
  resolution,
  note,
  upstreamOrderId,
  resolvedBy,
  now = new Date(),
}) {
  const target = getProviderResolutionTarget(resolution);
  let resolvedJobId;

  await sequelize.transaction(async (transaction) => {
    const order = await Order.findByPk(orderId, {
      transaction,
      lock: true,
    });
    if (!order) {
      throw createHttpError(404, "Order not found");
    }
    if (order.status !== ORDER_STATUSES.PROVISIONING_INDETERMINATE) {
      throw createHttpError(409, "Order is not in provider manual-review state");
    }

    const job = await ProviderJob.findOne({
      where: { orderId: order.id },
      transaction,
      lock: true,
      order: [["createdAt", "DESC"]],
    });
    if (!job || job.status !== PROVIDER_JOB_STATUSES.INDETERMINATE) {
      throw createHttpError(409, "Latest provider job is not indeterminate");
    }

    const manualResolution = buildManualResolution({
      resolution,
      note,
      resolvedBy,
      evidenceField: "upstreamOrderId",
      evidenceValue: upstreamOrderId,
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

    assertOrderTransition(order.status, target.orderStatus);
    await order.update(
      {
        status: target.orderStatus,
        ...(target.orderStatus === ORDER_STATUSES.FULFILLED
          ? { fulfilledAt: now }
          : {}),
      },
      { transaction }
    );

    resolvedJobId = job.id;
  });

  return ProviderJob.findByPk(resolvedJobId, {
    include: [{ model: Order, as: "order" }],
  });
}

function serializeLatestProviderJob(job) {
  if (!job) {
    return null;
  }

  const plain = job.get ? job.get({ plain: true }) : job;
  return {
    id: plain.id,
    status: plain.status,
    dryRun: Boolean(plain.dryRun),
    provider: plain.provider,
    action: plain.action,
    request: serializeProviderRequest(plain.request),
    response: plain.response ? serializeProviderResponse(plain.response) : null,
    attemptCount: Number(plain.attemptCount || 0),
    lastError: plain.lastError || null,
    processedAt: plain.processedAt || null,
    updatedAt: plain.updatedAt || null,
  };
}

function getProviderReviewReason(order, staleCutoff) {
  if (order.status === ORDER_STATUSES.PROVISIONING_INDETERMINATE) {
    return "manual_review_provider_indeterminate";
  }

  if (
    order.status === ORDER_STATUSES.PROVISIONING &&
    new Date(order.updatedAt) <= staleCutoff
  ) {
    return "stale_provider_provisioning";
  }

  return null;
}

function serializeProviderReviewItem(order, latestJob, staleCutoff) {
  const plain = order.get ? order.get({ plain: true }) : order;
  const reason = getProviderReviewReason(plain, staleCutoff);
  if (!reason) {
    return null;
  }

  return {
    reason,
    order: {
      id: plain.id,
      status: plain.status,
      planId: plain.planId,
      targetAddress: plain.targetAddress,
      energyAmount: plain.energyAmount,
      durationHours: plain.durationHours,
      paidAt: plain.paidAt || null,
      provisionedAt: plain.provisionedAt || null,
      fulfilledAt: plain.fulfilledAt || null,
      updatedAt: plain.updatedAt,
    },
    latestProviderJob: serializeLatestProviderJob(latestJob),
  };
}

async function listProviderReviewItems({
  staleProvisioningMinutes,
  limit,
  now = new Date(),
} = {}) {
  const clampedLimit = getReviewLimit(limit);
  const minutes = getStaleProvisioningMinutes(staleProvisioningMinutes);
  const staleCutoff = new Date(now.getTime() - minutes * 60 * 1000);

  const orders = await Order.findAll({
    where: {
      [Op.or]: [
        { status: ORDER_STATUSES.PROVISIONING_INDETERMINATE },
        {
          status: ORDER_STATUSES.PROVISIONING,
          updatedAt: { [Op.lte]: staleCutoff },
        },
      ],
    },
    include: [
      {
        model: ProviderJob,
        as: "providerJobs",
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

  const items = [];
  const seen = new Set();
  for (const order of orders) {
    const plain = order.get ? order.get({ plain: true }) : order;
    if (seen.has(plain.id)) {
      continue;
    }
    seen.add(plain.id);

    const latestJob = (plain.providerJobs || [])[0] || null;
    const item = serializeProviderReviewItem(plain, latestJob, staleCutoff);
    if (item) {
      items.push(item);
    }
  }

  return {
    staleProvisioningMinutes: minutes,
    staleCutoff: staleCutoff.toISOString(),
    count: items.length,
    data: items,
  };
}

async function markProviderFailure({
  orderId,
  job,
  error,
  indeterminate,
  response = null,
}) {
  const nextJobStatus = indeterminate
    ? PROVIDER_JOB_STATUSES.INDETERMINATE
    : PROVIDER_JOB_STATUSES.FAILED;
  const nextOrderStatus = indeterminate
    ? ORDER_STATUSES.PROVISIONING_INDETERMINATE
    : ORDER_STATUSES.FAILED;

  await sequelize.transaction(async (transaction) => {
    const order = await Order.findByPk(orderId, {
      transaction,
      lock: true,
    });
    assertOrderTransition(order.status, nextOrderStatus);

    const jobResponse =
      response || {
        error: error.message,
        providerDetails: error.providerDetails || null,
        indeterminate: Boolean(indeterminate),
      };

    await job.update(
      {
        status: nextJobStatus,
        lastError: error.message,
        response: jobResponse,
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

async function processOrder(orderId) {
  let job;
  let orderSnapshot;

  await sequelize.transaction(async (transaction) => {
    const order = await Order.findByPk(orderId, {
      transaction,
      lock: true,
    });

    if (!order) {
      throw createHttpError(404, "Order not found");
    }

    if (order.status !== ORDER_STATUSES.PAID) {
      throw createHttpError(409, "Order is not ready for provider processing");
    }

    assertOrderTransition(order.status, ORDER_STATUSES.PROVISIONING);
    await order.update(
      {
        status: ORDER_STATUSES.PROVISIONING,
        provisionedAt: new Date(),
      },
      { transaction }
    );

    job = await ProviderJob.create(
      {
        orderId: order.id,
        provider: process.env.ENERGY_PROVIDER || "apitrx",
        action: "rent_energy",
        status: PROVIDER_JOB_STATUSES.PROCESSING,
        dryRun: !providerClient.isProviderLiveMode(),
        request: buildProviderRequest(order),
        attemptCount: 1,
      },
      { transaction }
    );

    orderSnapshot = order.get({ plain: true });
  });

  let response;
  try {
    response = await providerClient.provisionEnergy(orderSnapshot);
  } catch (error) {
    await markProviderFailure({
      orderId,
      job,
      error,
      indeterminate: providerClient.isIndeterminateProviderError(error),
    });
    throw error;
  }

  const now = new Date();
  try {
    await sequelize.transaction(async (transaction) => {
      const order = await Order.findByPk(orderId, {
        transaction,
        lock: true,
      });
      assertOrderTransition(order.status, ORDER_STATUSES.FULFILLED);

      await job.update(
        {
          status: PROVIDER_JOB_STATUSES.COMPLETED,
          response,
          processedAt: now,
        },
        { transaction }
      );

      await order.update(
        {
          status: ORDER_STATUSES.FULFILLED,
          fulfilledAt: now,
        },
        { transaction }
      );
    });
  } catch (error) {
    await markProviderFailure({
      orderId,
      job,
      error,
      indeterminate: true,
      response: {
        ...response,
        indeterminate: true,
        completionMeaning:
          "provider_accepted_but_local_completion_persistence_failed",
        completionPersistenceError: error.message,
      },
    });
    throw error;
  }

  return ProviderJob.findByPk(job.id, {
    include: [{ model: Order, as: "order" }],
  });
}

async function processPendingPaidOrders({ limit = 10 } = {}) {
  const clampedLimit = getPendingPaidOrderLimit(limit);
  const orders = await Order.findAll({
    where: { status: ORDER_STATUSES.PAID },
    order: [["paidAt", "ASC"]],
    limit: clampedLimit,
  });

  const orderIds = orders.map((order) => order.id).filter(Boolean);
  return processOrders(orderIds);
}

async function processOrders(orderIds = []) {
  const uniqueOrderIds = Array.from(
    new Set(orderIds.map((orderId) => String(orderId)).filter(Boolean))
  );

  const results = [];
  for (const orderId of uniqueOrderIds) {
    try {
      const job = await processOrder(orderId);
      results.push({
        orderId,
        success: true,
        job,
      });
    } catch (error) {
      const nonfatal = error.statusCode === 404 || error.statusCode === 409;
      results.push({
        orderId,
        success: false,
        indeterminate: providerClient.isIndeterminateProviderError(error),
        skipped: nonfatal,
        message: error.message,
      });

      if (!nonfatal) {
        console.error(`Provider processing failed for order ${orderId}:`, error);
      }
    }
  }

  return results;
}

module.exports = {
  assertProviderJobRouteEnabled,
  listProviderReviewItems,
  processOrder,
  processOrders,
  processPendingPaidOrders,
  resolveProviderReview,
};
