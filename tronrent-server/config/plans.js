"use strict";

const ENERGY_PLANS = Object.freeze({
  basic: Object.freeze({
    id: "basic",
    name: "Basic",
    description: "Small transfers and testing",
    priceSun: 10_000_000,
    paymentAsset: "TRX",
    energyAmount: 1_000,
    durationHours: 24,
    support: "Basic support",
    isPopular: false,
  }),
  standard: Object.freeze({
    id: "standard",
    name: "Standard",
    description: "Regular DApp usage",
    priceSun: 50_000_000,
    paymentAsset: "TRX",
    energyAmount: 10_000,
    durationHours: 72,
    support: "Priority support",
    isPopular: true,
  }),
  enterprise: Object.freeze({
    id: "enterprise",
    name: "Enterprise",
    description: "Business and high-volume usage",
    priceSun: 200_000_000,
    paymentAsset: "TRX",
    energyAmount: 50_000,
    durationHours: 168,
    support: "Dedicated support",
    isPopular: false,
  }),
});

function sunToTrxString(sun) {
  const value = Number(sun) / 1_000_000;
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  });
}

function serializePlan(plan) {
  return {
    ...plan,
    priceSun: String(plan.priceSun),
    priceDisplay: `${sunToTrxString(plan.priceSun)} ${plan.paymentAsset}`,
  };
}

function listEnergyPlans() {
  return Object.values(ENERGY_PLANS).map(serializePlan);
}

function getEnergyPlan(planId) {
  const plan = ENERGY_PLANS[planId];
  return plan ? serializePlan(plan) : null;
}

module.exports = {
  ENERGY_PLANS,
  getEnergyPlan,
  listEnergyPlans,
  sunToTrxString,
};
