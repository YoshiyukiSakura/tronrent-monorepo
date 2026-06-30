"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  addBaseUnits,
  baseUnitsToDecimalString,
  decimalToBaseUnits,
} = require("../utils/assetUnits");

test("converts decimal amounts to exact base units", () => {
  assert.equal(decimalToBaseUnits("10.003748", 6), "10003748");
  assert.equal(decimalToBaseUnits("1", 6), "1000000");
  assert.equal(decimalToBaseUnits("0.000001", 6), "1");
});

test("rejects amounts with too much precision", () => {
  assert.throws(() => decimalToBaseUnits("0.0000001", 6), /decimal places/);
});

test("formats base units without trailing zero noise", () => {
  assert.equal(baseUnitsToDecimalString("10003748", 6), "10.003748");
  assert.equal(baseUnitsToDecimalString("10000000", 6), "10");
});

test("adds base units as integers", () => {
  assert.equal(addBaseUnits("10000000", 3748), "10003748");
});
