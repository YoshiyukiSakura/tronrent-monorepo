"use strict";

const ORDER_STATUSES = Object.freeze({
  PENDING_PAYMENT: "pending_payment",
  PAID: "paid",
  PROVISIONING: "provisioning",
  PROVISIONING_INDETERMINATE: "provisioning_indeterminate",
  FULFILLED: "fulfilled",
  FAILED: "failed",
  EXPIRED: "expired",
  CANCELLED: "cancelled",
});

const PAYMENT_STATUSES = Object.freeze({
  AWAITING_PAYMENT: "awaiting_payment",
  CONFIRMED: "confirmed",
  UNDERPAID: "underpaid",
  OVERPAID: "overpaid",
  FAILED: "failed",
  EXPIRED: "expired",
});

const PROVIDER_JOB_STATUSES = Object.freeze({
  PENDING: "pending",
  PROCESSING: "processing",
  COMPLETED: "completed",
  FAILED: "failed",
  INDETERMINATE: "indeterminate",
});

const ALLOWED_ORDER_TRANSITIONS = Object.freeze({
  [ORDER_STATUSES.PENDING_PAYMENT]: Object.freeze([
    ORDER_STATUSES.PAID,
    ORDER_STATUSES.EXPIRED,
    ORDER_STATUSES.CANCELLED,
  ]),
  [ORDER_STATUSES.PAID]: Object.freeze([
    ORDER_STATUSES.PROVISIONING,
    ORDER_STATUSES.FAILED,
  ]),
  [ORDER_STATUSES.PROVISIONING]: Object.freeze([
    ORDER_STATUSES.FULFILLED,
    ORDER_STATUSES.FAILED,
    ORDER_STATUSES.PROVISIONING_INDETERMINATE,
  ]),
  [ORDER_STATUSES.PROVISIONING_INDETERMINATE]: Object.freeze([
    ORDER_STATUSES.FULFILLED,
    ORDER_STATUSES.FAILED,
  ]),
  [ORDER_STATUSES.FULFILLED]: Object.freeze([]),
  [ORDER_STATUSES.FAILED]: Object.freeze([]),
  [ORDER_STATUSES.EXPIRED]: Object.freeze([]),
  [ORDER_STATUSES.CANCELLED]: Object.freeze([]),
});

function assertOrderTransition(fromStatus, toStatus) {
  if (fromStatus === toStatus) {
    return true;
  }

  const allowed = ALLOWED_ORDER_TRANSITIONS[fromStatus] || [];
  if (!allowed.includes(toStatus)) {
    const error = new Error(
      `Illegal order status transition: ${fromStatus} -> ${toStatus}`
    );
    error.statusCode = 409;
    throw error;
  }

  return true;
}

module.exports = {
  ALLOWED_ORDER_TRANSITIONS,
  ORDER_STATUSES,
  PAYMENT_STATUSES,
  PROVIDER_JOB_STATUSES,
  assertOrderTransition,
};
