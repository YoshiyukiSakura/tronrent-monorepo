"use strict";

const USDT_TRANSFER_UNIT_ENERGY = 65_000;
const FIRST_TIME_USDT_RECIPIENT_ENERGY = 131_000;
const USDT_TRANSFER_UNIT_PRICE_SUN = 4_000_000;

// Fixed operator-set retail defaults. Review APITRX sourcing cost and margin
// before production; these values are not fetched from the provider.
const ENERGY_PLANS = Object.freeze({
  basic: Object.freeze({
    id: "basic",
    name: "1 笔 USDT 转账",
    description: "约 65k 能量，适合已有 USDT 余额的常规收款地址",
    priceSun: USDT_TRANSFER_UNIT_PRICE_SUN,
    paymentAsset: "TRX",
    energyAmount: USDT_TRANSFER_UNIT_ENERGY,
    durationHours: 1,
    support: "链上扫描 + 自动进货",
    isPopular: false,
  }),
  standard: Object.freeze({
    id: "standard",
    name: "2 笔 USDT 转账",
    description: "约 131k 能量，更适合首次收款或无 USDT 余额地址",
    priceSun: USDT_TRANSFER_UNIT_PRICE_SUN * 2,
    paymentAsset: "TRX",
    energyAmount: FIRST_TIME_USDT_RECIPIENT_ENERGY,
    durationHours: 1,
    support: "链上扫描 + 自动进货",
    isPopular: true,
  }),
  enterprise: Object.freeze({
    id: "enterprise",
    name: "10 笔 USDT 转账",
    description: "约 650k 能量，适合批量归集或连续转账",
    priceSun: USDT_TRANSFER_UNIT_PRICE_SUN * 10,
    paymentAsset: "TRX",
    energyAmount: USDT_TRANSFER_UNIT_ENERGY * 10,
    durationHours: 1,
    support: "链上扫描 + 自动进货",
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
