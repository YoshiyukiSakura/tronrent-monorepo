"use strict";

const {
  ChainDeposit,
  ExchangeOrder,
  ExchangePayoutJob,
  Order,
  ProviderJob,
  Sequelize,
} = require("../db/models");
const { requireEnabledAdminRoute } = require("../utils/adminRouteGate");
const { createHttpError } = require("../utils/httpErrors");
const {
  EXCHANGE_ORDER_STATUSES,
  EXCHANGE_PAYOUT_STATUSES,
} = require("./exchangeOrderService");
const {
  DEPOSIT_STATUSES,
  normalizeAddress,
} = require("./depositMatcher");
const {
  ORDER_STATUSES,
  PROVIDER_JOB_STATUSES,
} = require("./orderState");

const AUTOMATION_BACKLOG_ENDPOINT_FLAG = "ENABLE_AUTOMATION_BACKLOG_ENDPOINT";
const AUTOMATION_BACKLOG_DISABLED_MESSAGE =
  "Automation backlog endpoint is disabled";

const ORDER_BACKLOG_STATUSES = Object.freeze([
  ORDER_STATUSES.PAID,
  ORDER_STATUSES.PROVISIONING,
  ORDER_STATUSES.PROVISIONING_INDETERMINATE,
]);
const PROVIDER_JOB_BACKLOG_STATUSES = Object.freeze([
  PROVIDER_JOB_STATUSES.PENDING,
  PROVIDER_JOB_STATUSES.PROCESSING,
  PROVIDER_JOB_STATUSES.FAILED,
  PROVIDER_JOB_STATUSES.INDETERMINATE,
]);
const EXCHANGE_ORDER_BACKLOG_STATUSES = Object.freeze([
  EXCHANGE_ORDER_STATUSES.FUNDS_RECEIVED,
  EXCHANGE_ORDER_STATUSES.PAYOUT_PROCESSING,
  EXCHANGE_ORDER_STATUSES.PAYOUT_FAILED,
  EXCHANGE_ORDER_STATUSES.PAYOUT_INDETERMINATE,
]);
const EXCHANGE_PAYOUT_JOB_BACKLOG_STATUSES = Object.freeze([
  EXCHANGE_PAYOUT_STATUSES.PROCESSING,
  EXCHANGE_PAYOUT_STATUSES.FAILED,
  EXCHANGE_PAYOUT_STATUSES.INDETERMINATE,
]);
const DEPOSIT_REVIEW_STATUSES = Object.freeze([
  DEPOSIT_STATUSES.UNMATCHED,
  DEPOSIT_STATUSES.UNMATCHED_AMBIGUOUS,
  DEPOSIT_STATUSES.MATCHED_BUT_EXPIRED,
  DEPOSIT_STATUSES.REJECTED_TOKEN,
]);
const DIRECT_ENERGY_DEPOSIT_REVIEW_STATUSES = Object.freeze([
  DEPOSIT_STATUSES.UNMATCHED,
  DEPOSIT_STATUSES.UNMATCHED_AMBIGUOUS,
]);

function getStaleMinutes(rawMinutes, env = process.env) {
  const raw = rawMinutes || env.AUTOMATION_BACKLOG_STALE_MINUTES || "10";
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 10;
  }
  return Math.min(parsed, 24 * 60);
}

function parseCount(rawCount) {
  const parsed = Number.parseInt(rawCount || "0", 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function makeZeroCounts(statuses) {
  return statuses.reduce((counts, status) => {
    counts[status] = 0;
    return counts;
  }, {});
}

function getRowValue(row, key) {
  if (!row) {
    return undefined;
  }
  if (typeof row.get === "function") {
    const value = row.get(key);
    if (value !== undefined) {
      return value;
    }
    const plain = row.get({ plain: true });
    return plain ? plain[key] : undefined;
  }
  if (row.dataValues) {
    return row.dataValues[key];
  }
  return row[key];
}

async function countByStatus(model, statuses, sequelizeLib) {
  const Op = sequelizeLib.Op;
  const rows = await model.findAll({
    attributes: [
      "status",
      [sequelizeLib.fn("COUNT", sequelizeLib.col("id")), "count"],
    ],
    where: {
      status: { [Op.in]: statuses },
    },
    group: ["status"],
    raw: true,
  });
  const counts = makeZeroCounts(statuses);

  for (const row of rows) {
    const status = getRowValue(row, "status");
    if (!Object.prototype.hasOwnProperty.call(counts, status)) {
      continue;
    }
    counts[status] = parseCount(getRowValue(row, "count"));
  }

  return counts;
}

async function countStaleStatus(model, status, staleCutoff, sequelizeLib) {
  const Op = sequelizeLib.Op;
  const count = await model.count({
    where: {
      status,
      updatedAt: { [Op.lte]: staleCutoff },
    },
  });
  return parseCount(count);
}

async function countDirectEnergyReviewDeposits({
  env,
  model,
  sequelizeLib,
  statuses,
}) {
  const energyTreasury = normalizeAddress(env.TREASURY_TRON_ADDRESS);
  const exchangeTreasury = normalizeAddress(env.EXCHANGE_TREASURY_TRON_ADDRESS);
  const sharedTreasuryWithExchange = Boolean(
    energyTreasury &&
      exchangeTreasury &&
      energyTreasury === exchangeTreasury
  );

  if (!energyTreasury || sharedTreasuryWithExchange) {
    return {
      manualReviewCount: 0,
      sharedTreasuryWithExchange,
    };
  }

  const Op = sequelizeLib.Op;
  const rows = await model.findAll({
    attributes: ["status", "asset", "toAddress"],
    where: {
      asset: "TRX",
      status: { [Op.in]: statuses },
    },
    raw: true,
  });
  const allowedStatuses = new Set(statuses);
  const manualReviewCount = rows.filter((row) => {
    return (
      allowedStatuses.has(getRowValue(row, "status")) &&
      getRowValue(row, "asset") === "TRX" &&
      normalizeAddress(getRowValue(row, "toAddress")) === energyTreasury
    );
  }).length;

  return {
    manualReviewCount,
    sharedTreasuryWithExchange,
  };
}

function sumValues(object) {
  return Object.values(object).reduce((sum, value) => sum + Number(value || 0), 0);
}

async function buildAutomationBacklogSnapshot({
  staleMinutes,
  now = new Date(),
  env = process.env,
  models = {
    ChainDeposit,
    ExchangeOrder,
    ExchangePayoutJob,
    Order,
    ProviderJob,
    Sequelize,
  },
} = {}) {
  const sequelizeLib = models.Sequelize;
  const minutes = getStaleMinutes(staleMinutes, env);
  const staleCutoff = new Date(now.getTime() - minutes * 60 * 1000);

  try {
    const [
      orderStatuses,
      providerJobStatuses,
      exchangeOrderStatuses,
      exchangePayoutJobStatuses,
      depositStatuses,
      directEnergyDepositReview,
      staleProviderProvisioning,
      staleExchangePayoutProcessing,
    ] = await Promise.all([
      countByStatus(models.Order, ORDER_BACKLOG_STATUSES, sequelizeLib),
      countByStatus(
        models.ProviderJob,
        PROVIDER_JOB_BACKLOG_STATUSES,
        sequelizeLib
      ),
      countByStatus(
        models.ExchangeOrder,
        EXCHANGE_ORDER_BACKLOG_STATUSES,
        sequelizeLib
      ),
      countByStatus(
        models.ExchangePayoutJob,
        EXCHANGE_PAYOUT_JOB_BACKLOG_STATUSES,
        sequelizeLib
      ),
      countByStatus(models.ChainDeposit, DEPOSIT_REVIEW_STATUSES, sequelizeLib),
      countDirectEnergyReviewDeposits({
        env,
        model: models.ChainDeposit,
        sequelizeLib,
        statuses: DIRECT_ENERGY_DEPOSIT_REVIEW_STATUSES,
      }),
      countStaleStatus(
        models.Order,
        ORDER_STATUSES.PROVISIONING,
        staleCutoff,
        sequelizeLib
      ),
      countStaleStatus(
        models.ExchangeOrder,
        EXCHANGE_ORDER_STATUSES.PAYOUT_PROCESSING,
        staleCutoff,
        sequelizeLib
      ),
    ]);

    const providerManualReviewCount =
      orderStatuses[ORDER_STATUSES.PROVISIONING_INDETERMINATE] +
      staleProviderProvisioning;
    const exchangeManualReviewCount =
      exchangeOrderStatuses[EXCHANGE_ORDER_STATUSES.PAYOUT_INDETERMINATE] +
      staleExchangePayoutProcessing;
    const depositReviewCount = sumValues(depositStatuses);
    const drainableProviderCount = orderStatuses[ORDER_STATUSES.PAID];
    const drainableExchangeCount =
      exchangeOrderStatuses[EXCHANGE_ORDER_STATUSES.FUNDS_RECEIVED];
    const staleProcessingCount =
      staleProviderProvisioning + staleExchangePayoutProcessing;
    const indeterminateOrderCount =
      orderStatuses[ORDER_STATUSES.PROVISIONING_INDETERMINATE] +
      exchangeOrderStatuses[EXCHANGE_ORDER_STATUSES.PAYOUT_INDETERMINATE];
    const activeJobCount =
      providerJobStatuses[PROVIDER_JOB_STATUSES.PENDING] +
      providerJobStatuses[PROVIDER_JOB_STATUSES.PROCESSING] +
      exchangePayoutJobStatuses[EXCHANGE_PAYOUT_STATUSES.PROCESSING];
    const failedOrIndeterminateJobCount =
      providerJobStatuses[PROVIDER_JOB_STATUSES.FAILED] +
      exchangePayoutJobStatuses[EXCHANGE_PAYOUT_STATUSES.FAILED] +
      providerJobStatuses[PROVIDER_JOB_STATUSES.INDETERMINATE] +
      exchangePayoutJobStatuses[EXCHANGE_PAYOUT_STATUSES.INDETERMINATE];

    return {
      generatedAt: now.toISOString(),
      staleOlderThanMinutes: minutes,
      staleCutoff: staleCutoff.toISOString(),
      summary: {
        drainableCount: drainableProviderCount + drainableExchangeCount,
        manualReviewCount:
          providerManualReviewCount +
          exchangeManualReviewCount +
          depositReviewCount,
        depositReviewCount,
        staleProcessingCount,
        indeterminateOrderCount,
        activeJobCount,
        failedOrIndeterminateJobCount,
        trackedStatusCount:
          sumValues(orderStatuses) +
          sumValues(providerJobStatuses) +
          sumValues(exchangeOrderStatuses) +
          sumValues(exchangePayoutJobStatuses) +
          depositReviewCount,
      },
      provider: {
        orders: {
          statuses: orderStatuses,
          drainable: {
            paid: drainableProviderCount,
          },
          manualReview: {
            provisioningIndeterminate:
              orderStatuses[ORDER_STATUSES.PROVISIONING_INDETERMINATE],
            staleProvisioning: staleProviderProvisioning,
          },
        },
        jobs: {
          statuses: providerJobStatuses,
        },
      },
      exchangePayout: {
        orders: {
          statuses: exchangeOrderStatuses,
          drainable: {
            fundsReceived: drainableExchangeCount,
          },
          manualReview: {
            payoutIndeterminate:
              exchangeOrderStatuses[
                EXCHANGE_ORDER_STATUSES.PAYOUT_INDETERMINATE
              ],
            stalePayoutProcessing: staleExchangePayoutProcessing,
          },
        },
        jobs: {
          statuses: exchangePayoutJobStatuses,
        },
      },
      depositReview: {
        statuses: depositStatuses,
        manualReview: {
          unmatched: depositStatuses[DEPOSIT_STATUSES.UNMATCHED],
          ambiguous: depositStatuses[DEPOSIT_STATUSES.UNMATCHED_AMBIGUOUS],
          matchedButExpired:
            depositStatuses[DEPOSIT_STATUSES.MATCHED_BUT_EXPIRED],
          rejectedToken: depositStatuses[DEPOSIT_STATUSES.REJECTED_TOKEN],
        },
        directEnergy: directEnergyDepositReview,
      },
    };
  } catch (error) {
    throw createHttpError(500, "Automation backlog snapshot unavailable", {
      reason: "database_query_failed",
    });
  }
}

function assertAutomationBacklogRouteEnabled(req) {
  requireEnabledAdminRoute({
    req,
    enabledEnvVar: AUTOMATION_BACKLOG_ENDPOINT_FLAG,
    disabledMessage: AUTOMATION_BACKLOG_DISABLED_MESSAGE,
  });
}

module.exports = {
  AUTOMATION_BACKLOG_DISABLED_MESSAGE,
  AUTOMATION_BACKLOG_ENDPOINT_FLAG,
  assertAutomationBacklogRouteEnabled,
  buildAutomationBacklogSnapshot,
  getStaleMinutes,
};
