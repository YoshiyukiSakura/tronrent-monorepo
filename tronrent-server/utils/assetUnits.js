"use strict";

function decimalToBaseUnits(value, decimals) {
  const text = String(value).trim();
  if (!/^\d+(\.\d+)?$/.test(text)) {
    throw new Error("Invalid decimal amount");
  }

  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > decimals) {
    throw new Error(`Amount has more than ${decimals} decimal places`);
  }

  const padded = fraction.padEnd(decimals, "0");
  return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt(padded || "0")).toString();
}

function baseUnitsToDecimalString(value, decimals) {
  const amount = BigInt(String(value));
  const scale = 10n ** BigInt(decimals);
  const whole = amount / scale;
  const fraction = (amount % scale).toString().padStart(decimals, "0");
  const trimmedFraction = fraction.replace(/0+$/, "");
  return trimmedFraction ? `${whole}.${trimmedFraction}` : whole.toString();
}

function addBaseUnits(left, right) {
  return (BigInt(String(left)) + BigInt(String(right))).toString();
}

module.exports = {
  addBaseUnits,
  baseUnitsToDecimalString,
  decimalToBaseUnits,
};
