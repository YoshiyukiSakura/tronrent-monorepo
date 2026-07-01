import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { FRONTEND_TEST_IDS } = require("../src/lib/testIds.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function readSource(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("frontend test ids are unique and stable", () => {
  const values = Object.values(FRONTEND_TEST_IDS);
  assert.equal(values.length, new Set(values).size);
  for (const value of values) {
    assert.match(value, /^[a-z0-9-]+$/);
  }
});

test("rent page exposes proof selectors for browser smoke tests", () => {
  const source = readSource("src/app/rent/page.tsx");
  for (const key of [
    "rentCreateOrderCta",
    "rentPaymentInstructions",
    "rentOrderId",
    "rentOrderStatus",
    "rentRefreshStatus",
    "rentPollingError",
  ]) {
    assert.match(source, new RegExp(`FRONTEND_TEST_IDS\\.${key}\\b`));
  }
});

test("exchange page exposes proof selectors for browser smoke tests", () => {
  const source = readSource("src/app/exchange/page.tsx");
  for (const key of [
    "exchangeCreateOrderCta",
    "exchangeDepositInstructions",
    "exchangeOrderId",
    "exchangeOrderStatus",
    "exchangeRefreshStatus",
    "exchangePollingError",
  ]) {
    assert.match(source, new RegExp(`FRONTEND_TEST_IDS\\.${key}\\b`));
  }
});
