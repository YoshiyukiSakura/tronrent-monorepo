"use strict";

const crypto = require("crypto");
const {
  ExchangeOrder,
  ExchangePayoutJob,
  ExchangeQuote,
  Sequelize,
  sequelize,
} = require("../db/models");
const { createHttpError } = require("../utils/httpErrors");
const {
  addBaseUnits,
  baseUnitsToDecimalString,
  decimalToBaseUnits,
} = require("../utils/assetUnits");
const { getAllowedTrc20Contracts } = require("./depositMatcher");
const { DIRECTIONS } = require("./exchangeQuoteService");
const { isValidTronAddress } = require("./orderService");

const EXCHANGE_ORDER_STATUSES = Object.freeze({
  PENDING_DEPOSIT: "pending_deposit",
  FUNDS_RECEIVED: "funds_received",
  PAYOUT_PROCESSING: "payout_processing",
  PAYOUT_COMPLETED: "payout_completed",
  PAYOUT_FAILED: "payout_failed",
  PAYOUT_INDETERMINATE: "payout_indeterminate",
  EXPIRED: "expired",
  CANCELLED: "cancelled",
});

const EXCHANGE_PAYOUT_STATUSES = Object.freeze({
  PROCESSING: "processing",
  COMPLETED: "completed",
  FAILED: "failed",
  INDETERMINATE: "indeterminate",
});

const ACTIVE_EXCHANGE_INPUT_INDEX =
  "exchange_orders_active_input_identity_unique";
const Op = Sequelize.Op;

const ALLOWED_EXCHANGE_TRANSITIONS = Object.freeze({
  [EXCHANGE_ORDER_STATUSES.PENDING_DEPOSIT]: Object.freeze([
    EXCHANGE_ORDER_STATUSES.FUNDS_RECEIVED,
    EXCHANGE_ORDER_STATUSES.EXPIRED,
    EXCHANGE_ORDER_STATUSES.CANCELLED,
  ]),
  [EXCHANGE_ORDER_STATUSES.FUNDS_RECEIVED]: Object.freeze([
    EXCHANGE_ORDER_STATUSES.PAYOUT_PROCESSING,
    EXCHANGE_ORDER_STATUSES.PAYOUT_FAILED,
  ]),
  [EXCHANGE_ORDER_STATUSES.PAYOUT_PROCESSING]: Object.freeze([
    EXCHANGE_ORDER_STATUSES.PAYOUT_COMPLETED,
    EXCHANGE_ORDER_STATUSES.PAYOUT_FAILED,
    EXCHANGE_ORDER_STATUSES.PAYOUT_INDETERMINATE,
  ]),
  [EXCHANGE_ORDER_STATUSES.PAYOUT_COMPLETED]: Object.freeze([]),
  [EXCHANGE_ORDER_STATUSES.PAYOUT_FAILED]: Object.freeze([]),
  [EXCHANGE_ORDER_STATUSES.PAYOUT_INDETERMINATE]: Object.freeze([
    EXCHANGE_ORDER_STATUSES.PAYOUT_COMPLETED,
    EXCHANGE_ORDER_STATUSES.PAYOUT_FAILED,
  ]),
  [EXCHANGE_ORDER_STATUSES.EXPIRED]: Object.freeze([]),
  [EXCHANGE_ORDER_STATUSES.CANCELLED]: Object.freeze([]),
});

function assertExchangeOrderTransition(fromStatus, toStatus) {
  if (fromStatus === toStatus) {
    return true;
  }

  const allowed = ALLOWED_EXCHANGE_TRANSITIONS[fromStatus] || [];
  if (!allowed.includes(toStatus)) {
    const error = createHttpError(
      409,
      `Illegal exchange order status transition: ${fromStatus} -> ${toStatus}`
    );
    throw error;
  }

  return true;
}

function getExchangeTreasuryAddress() {
  return process.env.EXCHANGE_TREASURY_TRON_ADDRESS || null;
}

function isExchangePayoutExecutionEnabled() {
  return process.env.EXCHANGE_PAYOUT_LIVE === "true";
}

function getUsdtConfig() {
  const usdtConfig = getAllowedTrc20Contracts().find(
    (entry) => entry.symbol === "USDT"
  );
  if (!usdtConfig) {
    throw createHttpError(
      500,
      "TRON_TRC20_ALLOWLIST must include USDT:<contract>:<decimals>"
    );
  }
  return usdtConfig;
}

function getAssetConfig(asset) {
  if (asset === "TRX") {
    return {
      asset: "TRX",
      decimals: 6,
      contractAddress: null,
    };
  }

  if (asset === "USDT") {
    const usdtConfig = getUsdtConfig();
    return {
      asset: "USDT",
      decimals: usdtConfig.decimals,
      contractAddress: usdtConfig.contractAddress,
    };
  }

  throw createHttpError(400, "Unsupported exchange asset");
}

function getExchangeMaxOffsetBaseUnits() {
  const parsed = Number.parseInt(
    process.env.EXCHANGE_MAX_PAYMENT_OFFSET_BASE_UNITS || "9999",
    10
  );
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 9999;
  }
  return Math.min(parsed, 999999);
}

function getCreateExchangeOrderMaxAttempts() {
  const parsed = Number.parseInt(
    process.env.EXCHANGE_ORDER_CREATE_MAX_ATTEMPTS || "8",
    10
  );
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 8;
  }
  return Math.min(parsed, 50);
}

function isUniqueConstraintError(error, constraintName) {
  return (
    error.name === "SequelizeUniqueConstraintError" &&
    (error.parent?.constraint === constraintName ||
      error.original?.constraint === constraintName)
  );
}

function isIdempotencyUniqueError(error) {
  return (
    error.name === "SequelizeUniqueConstraintError" &&
    (error.parent?.constraint === "exchange_orders_idempotencyKey_key" ||
      error.original?.constraint === "exchange_orders_idempotencyKey_key" ||
      Object.prototype.hasOwnProperty.call(error.fields || {}, "idempotencyKey"))
  );
}

function isQuoteUniqueError(error) {
  return (
    error.name === "SequelizeUniqueConstraintError" &&
    (error.parent?.constraint === "exchange_orders_quoteId_key" ||
      error.original?.constraint === "exchange_orders_quoteId_key" ||
      Object.prototype.hasOwnProperty.call(error.fields || {}, "quoteId"))
  );
}

function makeDepositReference() {
  return `EX-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function getOrderInclude() {
  return [
    { model: ExchangeQuote, as: "quote", required: false },
    { model: ExchangePayoutJob, as: "payoutJobs", required: false },
  ];
}

function serializeExchangeOrder(orderInstance) {
  const order = orderInstance.get
    ? orderInstance.get({ plain: true })
    : orderInstance;

  return {
    ...order,
    expectedInputBaseUnits: String(order.expectedInputBaseUnits),
    baseInputBaseUnits: String(order.baseInputBaseUnits),
    outputBaseUnits: String(order.outputBaseUnits),
    inputAmountDisplay: `${baseUnitsToDecimalString(
      order.expectedInputBaseUnits,
      order.inputDecimals
    )} ${order.inputAsset}`,
    outputAmountDisplay: `${baseUnitsToDecimalString(
      order.outputBaseUnits,
      order.outputDecimals
    )} ${order.outputAsset}`,
    payoutJobs: order.payoutJobs || [],
    depositInstructions: {
      asset: order.inputAsset,
      amountBaseUnits: String(order.expectedInputBaseUnits),
      amountDisplay: `${baseUnitsToDecimalString(
        order.expectedInputBaseUnits,
        order.inputDecimals
      )} ${order.inputAsset}`,
      address: order.treasuryAddress,
      contractAddress: order.inputContractAddress,
      depositReference: order.depositReference,
      executionMode: {
        payoutLive: isExchangePayoutExecutionEnabled(),
      },
      warnings: [
        isExchangePayoutExecutionEnabled()
          ? "链上入金确认后，系统会按后台出款开关自动执行兑换出款。"
          : "当前后台出款未启用；订单可用于本地流程验证，不会触发真实转账。",
        order.inputOffsetBaseUnits > 0
          ? "Pay the exact displayed amount, including the small tail amount used to identify this exchange order."
          : null,
      ].filter(Boolean),
    },
  };
}

async function getExchangeOrderById(orderId) {
  const order = await ExchangeOrder.findByPk(orderId, {
    include: getOrderInclude(),
    order: [[{ model: ExchangePayoutJob, as: "payoutJobs" }, "createdAt", "DESC"]],
  });

  if (!order) {
    throw createHttpError(404, "Exchange order not found");
  }

  return serializeExchangeOrder(order);
}

async function allocateExchangeInputAmount({
  treasuryAddress,
  inputAsset,
  inputContractAddress,
  baseInputBaseUnits,
  transaction,
}) {
  const maxOffset = getExchangeMaxOffsetBaseUnits();

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const offset = maxOffset === 0 ? 0 : crypto.randomInt(1, maxOffset + 1);
    const expectedInputBaseUnits = addBaseUnits(baseInputBaseUnits, offset);

    const collision = await ExchangeOrder.findOne({
      where: {
        treasuryAddress,
        inputAsset,
        inputContractAddress,
        expectedInputBaseUnits,
        status: EXCHANGE_ORDER_STATUSES.PENDING_DEPOSIT,
        expiresAt: {
          [Op.gt]: new Date(),
        },
      },
      transaction,
    });

    if (!collision) {
      return {
        inputOffsetBaseUnits: offset,
        expectedInputBaseUnits,
      };
    }
  }

  throw createHttpError(
    503,
    "Unable to allocate a unique exchange deposit amount"
  );
}

function validateCreateExchangeOrderInput(payload) {
  if (!payload.idempotencyKey || typeof payload.idempotencyKey !== "string") {
    throw createHttpError(400, "idempotencyKey is required");
  }

  if (payload.idempotencyKey.length > 128) {
    throw createHttpError(400, "idempotencyKey is too long");
  }

  if (!payload.quoteId) {
    throw createHttpError(400, "quoteId is required");
  }

  if (!isValidTronAddress(payload.outputAddress)) {
    throw createHttpError(400, "outputAddress must be a valid Tron address");
  }

  if (
    payload.customerWalletAddress &&
    !isValidTronAddress(payload.customerWalletAddress)
  ) {
    throw createHttpError(
      400,
      "customerWalletAddress must be a valid Tron address"
    );
  }

  return {
    idempotencyKey: payload.idempotencyKey,
    quoteId: payload.quoteId,
    outputAddress: payload.outputAddress,
    customerWalletAddress: payload.customerWalletAddress || null,
  };
}

async function createExchangeOrder(payload) {
  const validated = validateCreateExchangeOrderInput(payload);
  const treasuryAddress = getExchangeTreasuryAddress();
  if (!treasuryAddress || !isValidTronAddress(treasuryAddress)) {
    throw createHttpError(400, "EXCHANGE_TREASURY_TRON_ADDRESS is not configured");
  }

  const existingOrder = await ExchangeOrder.findOne({
    where: { idempotencyKey: validated.idempotencyKey },
    include: getOrderInclude(),
  });
  if (existingOrder) {
    return {
      idempotentReplay: true,
      order: serializeExchangeOrder(existingOrder),
    };
  }

  const maxAttempts = getCreateExchangeOrderMaxAttempts();
  let lastAmountCollision = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const createdOrder = await sequelize.transaction(async (transaction) => {
        const quote = await ExchangeQuote.findByPk(validated.quoteId, {
          transaction,
          lock: true,
        });

        if (!quote) {
          throw createHttpError(404, "Exchange quote not found");
        }

        if (quote.status !== "quote_only") {
          throw createHttpError(409, "Exchange quote has already been used");
        }

        if (new Date(quote.expiresAt) < new Date()) {
          throw createHttpError(409, "Exchange quote has expired");
        }

        const inputConfig = getAssetConfig(quote.inputAsset);
        const outputConfig = getAssetConfig(quote.outputAsset);
        const baseInputBaseUnits = decimalToBaseUnits(
          quote.inputAmount,
          inputConfig.decimals
        );
        const outputBaseUnits = decimalToBaseUnits(
          quote.outputAmount,
          outputConfig.decimals
        );
        const allocated = await allocateExchangeInputAmount({
          treasuryAddress,
          inputAsset: quote.inputAsset,
          inputContractAddress: inputConfig.contractAddress,
          baseInputBaseUnits,
          transaction,
        });

        const order = await ExchangeOrder.create(
          {
            idempotencyKey: validated.idempotencyKey,
            quoteId: quote.id,
            direction: quote.direction,
            status: EXCHANGE_ORDER_STATUSES.PENDING_DEPOSIT,
            customerWalletAddress: validated.customerWalletAddress,
            outputAddress: validated.outputAddress,
            treasuryAddress,
            inputAsset: quote.inputAsset,
            outputAsset: quote.outputAsset,
            inputContractAddress: inputConfig.contractAddress,
            outputContractAddress: outputConfig.contractAddress,
            inputDecimals: inputConfig.decimals,
            outputDecimals: outputConfig.decimals,
            quoteInputAmount: quote.inputAmount,
            quoteOutputAmount: quote.outputAmount,
            expectedInputBaseUnits: allocated.expectedInputBaseUnits,
            baseInputBaseUnits,
            inputOffsetBaseUnits: allocated.inputOffsetBaseUnits,
            outputBaseUnits,
            spreadBps: quote.spreadBps,
            rate: quote.metadata?.rate || 0,
            depositReference: makeDepositReference(),
            expiresAt: new Date(Date.now() + 30 * 60 * 1000),
            metadata: {
              quoteSnapshot: {
                id: quote.id,
                inputAmount: quote.inputAmount,
                outputAmount: quote.outputAmount,
                spreadBps: quote.spreadBps,
                rate: quote.metadata?.rate,
              },
              payoutLiveAtCreation: isExchangePayoutExecutionEnabled(),
            },
          },
          { transaction }
        );

        await quote.update(
          {
            status: "consumed",
            metadata: {
              ...quote.metadata,
              consumedByExchangeOrderId: order.id,
            },
          },
          { transaction }
        );

        return order;
      });

      return {
        idempotentReplay: false,
        order: await getExchangeOrderById(createdOrder.id),
      };
    } catch (error) {
      if (isUniqueConstraintError(error, ACTIVE_EXCHANGE_INPUT_INDEX)) {
        lastAmountCollision = error;
        continue;
      }

      if (isIdempotencyUniqueError(error)) {
        const replayedOrder = await ExchangeOrder.findOne({
          where: { idempotencyKey: validated.idempotencyKey },
          include: getOrderInclude(),
        });
        if (replayedOrder) {
          return {
            idempotentReplay: true,
            order: serializeExchangeOrder(replayedOrder),
          };
        }
      }

      if (isQuoteUniqueError(error)) {
        throw createHttpError(409, "Exchange quote has already been used");
      }

      throw error;
    }
  }

  throw createHttpError(
    503,
    "Unable to allocate a unique exchange deposit amount; retry order creation",
    { cause: lastAmountCollision?.message }
  );
}

async function expirePendingExchangeOrders({ limit = 100 } = {}) {
  const now = new Date();
  const orders = await ExchangeOrder.findAll({
    where: {
      status: EXCHANGE_ORDER_STATUSES.PENDING_DEPOSIT,
      expiresAt: {
        [Op.lt]: now,
      },
    },
    order: [["expiresAt", "ASC"]],
    limit,
  });

  let expiredCount = 0;
  for (const order of orders) {
    await sequelize.transaction(async (transaction) => {
      const lockedOrder = await ExchangeOrder.findByPk(order.id, {
        transaction,
        lock: true,
      });
      if (
        !lockedOrder ||
        lockedOrder.status !== EXCHANGE_ORDER_STATUSES.PENDING_DEPOSIT ||
        new Date(lockedOrder.expiresAt) >= now
      ) {
        return;
      }

      assertExchangeOrderTransition(
        lockedOrder.status,
        EXCHANGE_ORDER_STATUSES.EXPIRED
      );
      await lockedOrder.update(
        { status: EXCHANGE_ORDER_STATUSES.EXPIRED },
        { transaction }
      );
      expiredCount += 1;
    });
  }

  return expiredCount;
}

module.exports = {
  EXCHANGE_ORDER_STATUSES,
  EXCHANGE_PAYOUT_STATUSES,
  assertExchangeOrderTransition,
  createExchangeOrder,
  expirePendingExchangeOrders,
  getAssetConfig,
  getExchangeOrderById,
  isExchangePayoutExecutionEnabled,
  serializeExchangeOrder,
};
