"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { getEnergyPlan, listEnergyPlans } = require("../config/plans");

test("energy plans are resolved from the server catalog", () => {
  const standard = getEnergyPlan("standard");

  assert.equal(standard.priceSun, "50000000");
  assert.equal(standard.energyAmount, 10000);
  assert.equal(standard.paymentAsset, "TRX");
});

test("unknown plans are not accepted by the catalog", () => {
  assert.equal(getEnergyPlan("client-supplied-discount"), null);
});

test("plan list does not expose mutable catalog references", () => {
  const plans = listEnergyPlans();

  assert.equal(plans.length, 3);
  plans[0].priceSun = "1";
  assert.equal(getEnergyPlan(plans[0].id).priceSun, "10000000");
});
