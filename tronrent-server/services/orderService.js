"use strict";

const crypto = require("crypto");
const {
  Order,
  Payment,
  ProviderJob,
  Sequelize,
  sequelize,
} = require("../db/models");
const { getEnergyPlan, sunToTrxString } = require("../config/plans");
const { createHttpError } = require("../utils/httpErrors");
const {
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  assertOrderTransition,
} = require("./orderState");

const PAYMENT_METHODS = Object.freeze(["wallet_connect", "deposit_address"]);
const TRON_ADDRESS_PATTERN = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const ACTIVE_PAYMENT_AMOUNT_INDEX =
  "payments_active_amount_identity_unique";
const Op = Sequelize.Op;

function isValidTronAddress(address) {
  return typeof address === "string" && TRON_ADDRESS_PATTERN.test(address);
}

function normalizeOptionalAddress(address) {
  if (address === undefined || address === null || address === "") {
    return null;
  }
  return String(address).trim();
}

function getTreasuryAddress() {
  const address = normalizeOptionalAddress(process.env.TREASURY_TRON_ADDRESS);
  return address || null;
}

function makePaymentReference() {
  return `TR-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function getOrderInclude() {
  return [
    {
      model: Payment,
      as: "payments",
      required: false,
    },
    {
      model: ProviderJob,
      as: "providerJobs",
      required: false,
    },
  ];
}

function buildPaymentInstructions(orderLike) {
  const order = orderLike.get ? orderLike.get({ plain: true }) : orderLike;
  const address =
    order.paymentMethod === "deposit_address"
      ? order.depositAddress
      : order.treasuryAddress;
  const configured = Boolean(address);

  return {
    method: order.paymentMethod,
    asset: order.paymentAsset,
    amountSun: String(order.priceAmountSun),
    amountDisplay: `${sunToTrxString(order.priceAmountSun)} ${
      order.paymentAsset
    }`,
    address,
    paymentReference: order.paymentReference,
    configured,
    warnings: configured
      ? order.paymentMethod === "wallet_connect"
        ? [
            "Wallet payment is initiated client-side; chain scanning remains the source of truth for payment confirmation.",
            Number(order.priceOffsetSun) > 0
              ? "Pay the exact displayed amount, including the small tail amount used to identify this order."
              : null,
          ].filter(Boolean)
        : [
            Number(order.priceOffsetSun) > 0
              ? "Pay the exact displayed amount, including the small tail amount used to identify this order."
              : null,
          ].filter(Boolean)
      : [
          "TREASURY_TRON_ADDRESS is not configured. Do not send funds until a real treasury address is configured.",
        ],
  };
}

function serializePayment(payment) {
  return {
    ...payment,
    expectedAmountSun: String(payment.expectedAmountSun),
    receivedAmountSun:
      payment.receivedAmountSun === null || payment.receivedAmountSun === undefined
        ? null
        : String(payment.receivedAmountSun),
  };
}

function serializeOrder(orderInstance) {
  const order = orderInstance.get
    ? orderInstance.get({ plain: true })
    : orderInstance;

  return {
    ...order,
    priceAmountSun: String(order.priceAmountSun),
    basePriceAmountSun: String(order.basePriceAmountSun || order.priceAmountSun),
    priceOffsetSun: Number(order.priceOffsetSun || 0),
    priceDisplay: `${sunToTrxString(order.priceAmountSun)} ${
      order.paymentAsset
    }`,
    payments: (order.payments || []).map(serializePayment),
    providerJobs: order.providerJobs || [],
    paymentInstructions: buildPaymentInstructions(order),
  };
}

function getMaxPaymentOffsetSun() {
  const parsed = Number.parseInt(process.env.MAX_PAYMENT_OFFSET_SUN || "9999", 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 9999;
  }
  return Math.min(parsed, 999999);
}

function getCreateOrderMaxAttempts() {
  const parsed = Number.parseInt(process.env.ORDER_CREATE_MAX_ATTEMPTS || "8", 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 8;
  }
  return Math.min(parsed, 50);
}

function isUniqueConstraintError(error, constraintName) {
  if (error.name !== "SequelizeUniqueConstraintError") {
    return false;
  }

  return (
    error.parent?.constraint === constraintName ||
    error.original?.constraint === constraintName
  );
}

function isIdempotencyUniqueError(error) {
  if (error.name !== "SequelizeUniqueConstraintError") {
    return false;
  }

  return (
    error.parent?.constraint === "orders_idempotencyKey_key" ||
    error.original?.constraint === "orders_idempotencyKey_key" ||
    Object.prototype.hasOwnProperty.call(error.fields || {}, "idempotencyKey")
  );
}

async function allocatePayableAmountSun(basePriceSun, transaction) {
  const maxOffsetSun = getMaxPaymentOffsetSun();
  const baseAmount = Number(basePriceSun);

  if (!Number.isSafeInteger(baseAmount) || baseAmount <= 0) {
    throw createHttpError(500, "Invalid server plan price");
  }

  for (let attempt = 0; attempt < 30; attempt += 1) {
    const offsetSun =
      maxOffsetSun === 0 ? 0 : crypto.randomInt(1, maxOffsetSun + 1);
    const payableAmountSun = baseAmount + offsetSun;

    const collision = await Payment.findOne({
      where: {
        expectedAmountSun: payableAmountSun,
        status: PAYMENT_STATUSES.AWAITING_PAYMENT,
      },
      include: [
        {
          model: Order,
          as: "order",
          required: true,
          where: {
            status: ORDER_STATUSES.PENDING_PAYMENT,
            expiresAt: {
              [Op.gt]: new Date(),
            },
          },
        },
      ],
      transaction,
    });

    if (!collision) {
      return {
        basePriceAmountSun: baseAmount,
        priceOffsetSun: offsetSun,
        payableAmountSun,
      };
    }
  }

  throw createHttpError(
    503,
    "Unable to allocate a unique payment amount; retry order creation"
  );
}

async function expirePendingOrders({ limit = 100 } = {}) {
  const now = new Date();
  const orders = await Order.findAll({
    where: {
      status: ORDER_STATUSES.PENDING_PAYMENT,
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
      const lockedOrder = await Order.findByPk(order.id, {
        transaction,
        lock: true,
      });

      if (
        !lockedOrder ||
        lockedOrder.status !== ORDER_STATUSES.PENDING_PAYMENT ||
        new Date(lockedOrder.expiresAt) >= now
      ) {
        return;
      }

      assertOrderTransition(lockedOrder.status, ORDER_STATUSES.EXPIRED);
      await Payment.update(
        {
          status: PAYMENT_STATUSES.EXPIRED,
        },
        {
          where: {
            orderId: lockedOrder.id,
            status: PAYMENT_STATUSES.AWAITING_PAYMENT,
          },
          transaction,
        }
      );

      await lockedOrder.update(
        {
          status: ORDER_STATUSES.EXPIRED,
        },
        { transaction }
      );
      expiredCount += 1;
    });
  }

  return expiredCount;
}

async function getOrderById(orderId) {
  const order = await Order.findByPk(orderId, {
    include: getOrderInclude(),
    order: [
      [{ model: Payment, as: "payments" }, "createdAt", "DESC"],
      [{ model: ProviderJob, as: "providerJobs" }, "createdAt", "DESC"],
    ],
  });

  if (!order) {
    throw createHttpError(404, "Order not found");
  }

  return serializeOrder(order);
}

function validateCreateOrderInput(payload) {
  const plan = getEnergyPlan(payload.planId);
  if (!plan) {
    throw createHttpError(400, "Unknown energy plan");
  }

  if (!payload.idempotencyKey || typeof payload.idempotencyKey !== "string") {
    throw createHttpError(400, "idempotencyKey is required");
  }

  if (payload.idempotencyKey.length > 128) {
    throw createHttpError(400, "idempotencyKey is too long");
  }

  if (!PAYMENT_METHODS.includes(payload.paymentMethod)) {
    throw createHttpError(400, "Unsupported paymentMethod");
  }

  const targetAddress = normalizeOptionalAddress(payload.targetAddress);
  if (!isValidTronAddress(targetAddress)) {
    throw createHttpError(400, "targetAddress must be a valid Tron address");
  }

  const customerWalletAddress = normalizeOptionalAddress(
    payload.customerWalletAddress
  );
  if (customerWalletAddress && !isValidTronAddress(customerWalletAddress)) {
    throw createHttpError(
      400,
      "customerWalletAddress must be a valid Tron address"
    );
  }

  return {
    plan,
    targetAddress,
    customerWalletAddress,
    idempotencyKey: payload.idempotencyKey,
    paymentMethod: payload.paymentMethod,
  };
}

async function createOrder(payload) {
  const validated = validateCreateOrderInput(payload);
  await expirePendingOrders();

  const existingOrder = await Order.findOne({
    where: { idempotencyKey: validated.idempotencyKey },
    include: getOrderInclude(),
  });

  if (existingOrder) {
    return {
      idempotentReplay: true,
      order: serializeOrder(existingOrder),
    };
  }

  const treasuryAddress = getTreasuryAddress();
  const paymentAddress = treasuryAddress;
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

  let lastAmountCollision = null;
  const maxAttempts = getCreateOrderMaxAttempts();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const order = await sequelize.transaction(async (transaction) => {
      const paymentAmount = await allocatePayableAmountSun(
        validated.plan.priceSun,
        transaction
      );

      const createdOrder = await Order.create(
        {
          idempotencyKey: validated.idempotencyKey,
          planId: validated.plan.id,
          targetAddress: validated.targetAddress,
          customerWalletAddress: validated.customerWalletAddress,
          paymentMethod: validated.paymentMethod,
          status: ORDER_STATUSES.PENDING_PAYMENT,
          paymentAsset: validated.plan.paymentAsset,
          priceAmountSun: paymentAmount.payableAmountSun,
          basePriceAmountSun: paymentAmount.basePriceAmountSun,
          priceOffsetSun: paymentAmount.priceOffsetSun,
          energyAmount: validated.plan.energyAmount,
          durationHours: validated.plan.durationHours,
          treasuryAddress,
          depositAddress: paymentAddress,
          paymentReference: makePaymentReference(),
          expiresAt,
          metadata: {
            planName: validated.plan.name,
            planDescription: validated.plan.description,
            basePriceAmountSun: String(paymentAmount.basePriceAmountSun),
            priceOffsetSun: paymentAmount.priceOffsetSun,
            paymentConfigured: Boolean(paymentAddress),
            safetyMode: "no-live-funds-or-provider-calls",
          },
        },
        { transaction }
      );

      await Payment.create(
        {
          orderId: createdOrder.id,
          method: validated.paymentMethod,
          asset: validated.plan.paymentAsset,
          expectedAmountSun: paymentAmount.payableAmountSun,
          status: PAYMENT_STATUSES.AWAITING_PAYMENT,
          toAddress: paymentAddress,
          metadata: {
            paymentReference: createdOrder.paymentReference,
            paymentConfigured: Boolean(paymentAddress),
          },
        },
        { transaction }
      );

      return createdOrder;
      });

      return {
        idempotentReplay: false,
        order: await getOrderById(order.id),
      };
    } catch (error) {
      if (isUniqueConstraintError(error, ACTIVE_PAYMENT_AMOUNT_INDEX)) {
        lastAmountCollision = error;
        continue;
      }

      if (isIdempotencyUniqueError(error)) {
      const replayedOrder = await Order.findOne({
        where: { idempotencyKey: validated.idempotencyKey },
        include: getOrderInclude(),
      });

      if (replayedOrder) {
        return {
          idempotentReplay: true,
          order: serializeOrder(replayedOrder),
        };
      }

        throw error;
      }

      throw error;
    }
  }

  throw createHttpError(
    503,
    "Unable to allocate a unique payment amount; retry order creation",
    { cause: lastAmountCollision?.message }
  );
}

function assertDevPaymentConfirmationEnabled() {
  if (process.env.NODE_ENV === "production") {
    throw createHttpError(404, "Not found");
  }

  if (process.env.ENABLE_DEV_PAYMENT_CONFIRMATION !== "true") {
    throw createHttpError(403, "Dev payment confirmation is disabled");
  }
}

async function confirmPaymentForDev(orderId, payload = {}) {
  assertDevPaymentConfirmationEnabled();

  const now = new Date();
  await sequelize.transaction(async (transaction) => {
    const order = await Order.findByPk(orderId, {
      transaction,
      lock: true,
    });

    if (!order) {
      throw createHttpError(404, "Order not found");
    }

    if (order.status === ORDER_STATUSES.PAID) {
      return;
    }

    assertOrderTransition(order.status, ORDER_STATUSES.PAID);

    const payment = await Payment.findOne({
      where: { orderId },
      transaction,
      lock: true,
      order: [["createdAt", "DESC"]],
    });

    if (!payment) {
      throw createHttpError(404, "Payment not found for order");
    }

    await payment.update(
      {
        status: PAYMENT_STATUSES.CONFIRMED,
        receivedAmountSun: order.priceAmountSun,
        txHash:
          normalizeOptionalAddress(payload.txHash) ||
          `dev-confirmed-${crypto.randomUUID()}`,
        fromAddress:
          normalizeOptionalAddress(payload.fromAddress) ||
          order.customerWalletAddress,
        toAddress: payment.toAddress,
        detectedAt: now,
        confirmedAt: now,
        metadata: {
          ...payment.metadata,
          devConfirmed: true,
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
  });

  return getOrderById(orderId);
}

module.exports = {
  PAYMENT_METHODS,
  buildPaymentInstructions,
  confirmPaymentForDev,
  createOrder,
  expirePendingOrders,
  getOrderById,
  isValidTronAddress,
  serializeOrder,
};
