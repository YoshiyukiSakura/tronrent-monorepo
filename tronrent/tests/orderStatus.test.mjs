import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEnergyOrderTimeline,
  buildExchangeOrderTimeline,
  getEnergyOrderStatusMeta,
  getExchangeOrderStatusMeta,
  shouldPollEnergyOrder,
  shouldPollExchangeOrder,
} from "../src/lib/orderStatus.js";

test("energy order polling continues through provisioning and manual review", () => {
  assert.equal(shouldPollEnergyOrder("pending_payment"), true);
  assert.equal(shouldPollEnergyOrder("paid"), true);
  assert.equal(shouldPollEnergyOrder("provisioning"), true);
  assert.equal(shouldPollEnergyOrder("provisioning_indeterminate"), true);
});

test("energy order polling stops only on terminal states", () => {
  for (const status of ["fulfilled", "failed", "expired", "cancelled"]) {
    assert.equal(shouldPollEnergyOrder(status), false, status);
  }
  assert.equal(shouldPollEnergyOrder("future_status"), true);
});

test("exchange order polling continues through payout processing and review", () => {
  assert.equal(shouldPollExchangeOrder("pending_deposit"), true);
  assert.equal(shouldPollExchangeOrder("funds_received"), true);
  assert.equal(shouldPollExchangeOrder("payout_processing"), true);
  assert.equal(shouldPollExchangeOrder("payout_indeterminate"), true);
});

test("exchange order polling stops only on terminal states", () => {
  for (const status of [
    "payout_completed",
    "payout_failed",
    "expired",
    "cancelled",
  ]) {
    assert.equal(shouldPollExchangeOrder(status), false, status);
  }
  assert.equal(shouldPollExchangeOrder("future_status"), true);
});

test("status metadata covers manual-review states without raw enum fallback", () => {
  assert.deepEqual(getEnergyOrderStatusMeta("provisioning_indeterminate"), {
    label: "需人工核查",
    tone: "review",
    description: "上游结果暂不确定，系统会继续刷新，操作员可在后台核查。",
  });
  assert.deepEqual(getExchangeOrderStatusMeta("payout_indeterminate"), {
    label: "需人工核查",
    tone: "review",
    description: "出款结果暂不确定，系统会继续刷新，操作员可在后台核查。",
  });
});

test("status timelines mark manual-review and terminal failures distinctly", () => {
  assert.equal(
    buildEnergyOrderTimeline("provisioning_indeterminate")[2].state,
    "review"
  );
  assert.equal(buildEnergyOrderTimeline("failed")[2].state, "failed");
  assert.equal(
    buildExchangeOrderTimeline("payout_indeterminate")[2].state,
    "review"
  );
  assert.equal(buildExchangeOrderTimeline("payout_failed")[2].state, "failed");
});

test("status timelines render cancelled as neutral instead of failed", () => {
  assert.equal(buildEnergyOrderTimeline("cancelled")[0].state, "neutral");
  assert.equal(buildExchangeOrderTimeline("cancelled")[0].state, "neutral");
});
