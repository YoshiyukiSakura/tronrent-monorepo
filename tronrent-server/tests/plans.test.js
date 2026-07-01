"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  getEnergyPlan,
  listDirectPayEnergyPlans,
  listEnergyPlans,
} = require("../config/plans");

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

test("direct-pay energy catalog hides fixed amounts until treasury is configured", () => {
  const config = listDirectPayEnergyPlans({
    env: {},
  });

  assert.deepEqual(config, {
    configured: false,
    asset: "TRX",
    treasuryAddress: null,
    plans: [],
  });
});

test("direct-pay energy catalog exposes only uniquely matchable TRX plan amounts", () => {
  const config = listDirectPayEnergyPlans({
    env: {
      TREASURY_TRON_ADDRESS: "TTreasury111111111111111111111111111",
    },
    plans: [
      {
        id: "basic",
        name: "Basic",
        description: "Basic",
        paymentAsset: "TRX",
        priceSun: "4000000",
        priceDisplay: "4 TRX",
        energyAmount: 65000,
        durationHours: 1,
      },
      {
        id: "duplicate-a",
        name: "Duplicate A",
        description: "Duplicate A",
        paymentAsset: "TRX",
        priceSun: "8000000",
        priceDisplay: "8 TRX",
        energyAmount: 131000,
        durationHours: 1,
      },
      {
        id: "duplicate-b",
        name: "Duplicate B",
        description: "Duplicate B",
        paymentAsset: "TRX",
        priceSun: "8000000",
        priceDisplay: "8 TRX",
        energyAmount: 131000,
        durationHours: 1,
      },
      {
        id: "usdt-plan",
        name: "USDT",
        description: "USDT",
        paymentAsset: "USDT",
        priceSun: "6000000",
        priceDisplay: "6 USDT",
        energyAmount: 65000,
        durationHours: 1,
      },
    ],
  });

  assert.equal(config.configured, true);
  assert.equal(config.asset, "TRX");
  assert.equal(config.treasuryAddress, "TTreasury111111111111111111111111111");
  assert.deepEqual(
    config.plans.map((plan) => ({
      planId: plan.planId,
      amountSun: plan.amountSun,
      amountDisplay: plan.amountDisplay,
    })),
    [
      {
        planId: "basic",
        amountSun: "4000000",
        amountDisplay: "4 TRX",
      },
    ]
  );
  assert.match(config.plans[0].warnings.join(" "), /exact displayed TRX amount/);
});
