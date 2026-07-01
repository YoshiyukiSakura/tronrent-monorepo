"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { getEnergyPlan, listEnergyPlans } = require("../config/plans");

test("energy plans are resolved from the server catalog", () => {
  const standard = getEnergyPlan("standard");

  assert.equal(standard.priceSun, "8000000");
  assert.equal(standard.priceDisplay, "8 TRX");
  assert.equal(standard.energyAmount, 131000);
  assert.equal(standard.durationHours, 1);
  assert.equal(standard.paymentAsset, "TRX");
});

test("energy plans use 65k USDT transfer units with linear retail pricing", () => {
  const plans = listEnergyPlans();

  assert.deepEqual(
    plans.map((plan) => ({
      id: plan.id,
      priceSun: plan.priceSun,
      priceDisplay: plan.priceDisplay,
      energyAmount: plan.energyAmount,
      durationHours: plan.durationHours,
    })),
    [
      {
        id: "basic",
        priceSun: "4000000",
        priceDisplay: "4 TRX",
        energyAmount: 65000,
        durationHours: 1,
      },
      {
        id: "standard",
        priceSun: "8000000",
        priceDisplay: "8 TRX",
        energyAmount: 131000,
        durationHours: 1,
      },
      {
        id: "enterprise",
        priceSun: "40000000",
        priceDisplay: "40 TRX",
        energyAmount: 650000,
        durationHours: 1,
      },
    ]
  );
});

test("unknown plans are not accepted by the catalog", () => {
  assert.equal(getEnergyPlan("client-supplied-discount"), null);
});

test("plan list does not expose mutable catalog references", () => {
  const plans = listEnergyPlans();

  assert.equal(plans.length, 3);
  plans[0].priceSun = "1";
  assert.equal(getEnergyPlan(plans[0].id).priceSun, "4000000");
});
