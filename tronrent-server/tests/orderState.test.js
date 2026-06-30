"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ORDER_STATUSES,
  assertOrderTransition,
} = require("../services/orderState");

test("allows the paid order to enter provider provisioning", () => {
  assert.equal(
    assertOrderTransition(
      ORDER_STATUSES.PAID,
      ORDER_STATUSES.PROVISIONING
    ),
    true
  );
});

test("allows provider provisioning to enter manual review", () => {
  assert.equal(
    assertOrderTransition(
      ORDER_STATUSES.PROVISIONING,
      ORDER_STATUSES.PROVISIONING_INDETERMINATE
    ),
    true
  );
});

test("allows manual provider review to be resolved by an operator later", () => {
  assert.equal(
    assertOrderTransition(
      ORDER_STATUSES.PROVISIONING_INDETERMINATE,
      ORDER_STATUSES.FULFILLED
    ),
    true
  );
  assert.equal(
    assertOrderTransition(
      ORDER_STATUSES.PROVISIONING_INDETERMINATE,
      ORDER_STATUSES.FAILED
    ),
    true
  );
});

test("rejects skipping payment before fulfillment", () => {
  assert.throws(
    () =>
      assertOrderTransition(
        ORDER_STATUSES.PENDING_PAYMENT,
        ORDER_STATUSES.FULFILLED
      ),
    /Illegal order status transition/
  );
});

test("terminal fulfilled orders cannot be reprocessed", () => {
  assert.throws(
    () =>
      assertOrderTransition(
        ORDER_STATUSES.FULFILLED,
        ORDER_STATUSES.PROVISIONING
      ),
    /Illegal order status transition/
  );
});
