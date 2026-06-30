"use strict";

const { isValidTronAddress } = require("./orderService");

const DEFAULT_APITRX_API_BASE_URL = "https://web.apitrx.com";
const DEFAULT_APITRX_TIMEOUT_MS = 15_000;
const APITRX_SUPPORTED_DURATION_HOURS = Object.freeze([1, 24, 72, 168, 336, 720]);

let fetchOverride = null;

function isProviderLiveMode() {
  return process.env.PROVIDER_LIVE === "true";
}

function getEnergyProvider() {
  return process.env.ENERGY_PROVIDER || "apitrx";
}

function getApitrxApiBaseUrl() {
  return (
    process.env.APITRX_API_BASE_URL || DEFAULT_APITRX_API_BASE_URL
  ).replace(/\/+$/, "");
}

function getApitrxTimeoutMs() {
  const parsed = Number.parseInt(
    process.env.APITRX_TIMEOUT_MS || String(DEFAULT_APITRX_TIMEOUT_MS),
    10
  );
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_APITRX_TIMEOUT_MS;
  }
  return Math.min(parsed, 60_000);
}

function getFetch() {
  if (fetchOverride) {
    return fetchOverride;
  }

  if (typeof fetch !== "function") {
    throw createProviderError("Global fetch is not available for provider calls");
  }

  return fetch;
}

function setFetchForTesting(nextFetch) {
  fetchOverride = nextFetch;
}

function resetFetchForTesting() {
  fetchOverride = null;
}

function redactSensitive(value) {
  if (value === undefined || value === null) {
    return value;
  }

  let redacted = String(value).replace(
    /(apikey=)[^&\s"']+/gi,
    "$1[redacted]"
  );
  const configuredKey = process.env.APITRX_API_KEY;
  if (configuredKey) {
    redacted = redacted.split(configuredKey).join("[redacted]");
  }
  return redacted;
}

function createProviderError(message, statusCode = 502, details, options = {}) {
  const error = new Error(redactSensitive(message));
  error.statusCode = statusCode;
  error.providerIndeterminate = Boolean(options.indeterminate);
  if (details) {
    error.providerDetails = sanitizeProviderPayload(details);
  }
  return error;
}

function sanitizeProviderPayload(payload) {
  if (payload === undefined || payload === null) {
    return payload;
  }

  if (typeof payload === "string") {
    return redactSensitive(payload);
  }

  if (Array.isArray(payload)) {
    return payload.map((item) => sanitizeProviderPayload(item));
  }

  if (typeof payload === "object") {
    return Object.fromEntries(
      Object.entries(payload).map(([key, value]) => [
        key,
        key.toLowerCase().includes("apikey")
          ? "[redacted]"
          : sanitizeProviderPayload(value),
      ])
    );
  }

  return payload;
}

function buildApitrxUrl(pathname, params) {
  const url = new URL(pathname, `${getApitrxApiBaseUrl()}/`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });
  return url;
}

function buildApitrxEnergyOrderParams(order) {
  if (!process.env.APITRX_API_KEY) {
    throw createProviderError("APITRX_API_KEY is required for live provider mode", 500);
  }

  if (!isValidTronAddress(order.targetAddress)) {
    throw createProviderError("Order targetAddress is not a valid Tron address", 400);
  }

  const energyAmount = Number(order.energyAmount);
  if (!Number.isInteger(energyAmount) || energyAmount <= 0) {
    throw createProviderError("Order energyAmount must be a positive integer", 400);
  }

  const durationHours = Number(order.durationHours);
  if (
    !Number.isInteger(durationHours) ||
    !APITRX_SUPPORTED_DURATION_HOURS.includes(durationHours)
  ) {
    throw createProviderError(
      `Order durationHours must be one of ${APITRX_SUPPORTED_DURATION_HOURS.join(", ")}`,
      400
    );
  }

  return {
    apikey: process.env.APITRX_API_KEY,
    add: order.targetAddress,
    value: energyAmount,
    hour: durationHours,
  };
}

function readPositiveNumber(value, errorMessage, details) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw createProviderError(errorMessage, 502, details);
  }
  return parsed;
}

function readNonNegativeNumber(value, errorMessage, details) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw createProviderError(errorMessage, 502, details);
  }
  return parsed;
}

function parseJsonBody(bodyText) {
  try {
    return JSON.parse(bodyText);
  } catch (error) {
    return null;
  }
}

function extractUpstreamOrderId(data) {
  if (!data || typeof data !== "object") {
    return null;
  }

  return (
    data.orderId ||
    data.order_id ||
    data.id ||
    data.txid ||
    data.txHash ||
    data.hash ||
    null
  );
}

function assertApitrxSuccess({
  endpoint,
  httpStatus,
  bodyText,
  indeterminateOnFailure = false,
}) {
  const parsed = parseJsonBody(bodyText);
  if (!parsed || typeof parsed !== "object") {
    if (indeterminateOnFailure) {
      throw createProviderError(
        `APITRX ${endpoint} returned an unrecognized response shape; outcome is indeterminate`,
        502,
        { endpoint, httpStatus, reason: "unrecognized_response" },
        { indeterminate: true }
      );
    }

    throw createProviderError(
      `APITRX ${endpoint} returned an unrecognized response shape`,
      502,
      { endpoint, httpStatus, reason: "unrecognized_response" }
    );
  }

  if (indeterminateOnFailure && httpStatus >= 500) {
    throw createProviderError(
      `APITRX ${endpoint} returned HTTP ${httpStatus}; outcome is indeterminate`,
      502,
      {
        endpoint,
        httpStatus,
        providerCode: parsed.code,
        providerMessage: parsed.message,
        reason: "http_5xx",
      },
      { indeterminate: true }
    );
  }

  if (httpStatus < 200 || httpStatus >= 300 || parsed.code !== 200) {
    throw createProviderError(
      `APITRX ${endpoint} rejected the request: code ${parsed.code || httpStatus} ${parsed.message || ""}`.trim(),
      502,
      { endpoint, httpStatus, body: parsed }
    );
  }

  return parsed;
}

async function requestApitrx(endpoint, params, options = {}) {
  const url = buildApitrxUrl(endpoint, params);
  const controller = new AbortController();
  const timeoutMs = getApitrxTimeoutMs();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await getFetch()(url, {
      method: "GET",
      signal: controller.signal,
    });
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    if (options.indeterminateOnFailure) {
      throw createProviderError(
        timedOut
          ? `APITRX ${endpoint} request timed out after ${timeoutMs}ms; outcome is indeterminate`
          : `APITRX ${endpoint} request failed; outcome is indeterminate`,
        502,
        {
          endpoint,
          timeoutMs,
          reason: timedOut ? "timeout" : "network_error",
        },
        { indeterminate: true }
      );
    }

    throw createProviderError(
      timedOut
        ? `APITRX ${endpoint} request timed out after ${timeoutMs}ms`
        : `APITRX ${endpoint} request failed`
    );
  } finally {
    clearTimeout(timeout);
  }

  const bodyText = await response.text();
  const parsed = assertApitrxSuccess({
    endpoint,
    httpStatus: response.status,
    bodyText,
    indeterminateOnFailure: Boolean(options.indeterminateOnFailure),
  });

  return {
    endpoint,
    httpStatus: response.status,
    body: sanitizeProviderPayload(parsed),
  };
}

async function preflightApitrxEnergyOrder(params) {
  const priceResult = await requestApitrx("price", {
    apikey: params.apikey,
    value: params.value,
  });
  const durationKey = String(params.hour);
  const estimatedCostTrx = readPositiveNumber(
    priceResult.body?.data?.[durationKey],
    `APITRX price response did not include a valid ${durationKey}h TRX price`,
    {
      endpoint: "price",
      durationHours: params.hour,
      body: priceResult.body,
    }
  );

  const balanceResult = await requestApitrx("balance", {
    apikey: params.apikey,
  });
  const availableBalanceTrx = readNonNegativeNumber(
    balanceResult.body?.data?.balance,
    "APITRX balance response did not include a valid TRX balance",
    {
      endpoint: "balance",
      body: balanceResult.body,
    }
  );

  if (availableBalanceTrx < estimatedCostTrx) {
    throw createProviderError(
      `APITRX balance is insufficient for this order: required ${estimatedCostTrx} TRX, available ${availableBalanceTrx} TRX`,
      402,
      {
        endpoint: "balance",
        requiredTrx: estimatedCostTrx,
        availableTrx: availableBalanceTrx,
        price: priceResult.body,
        balance: balanceResult.body,
      }
    );
  }

  return {
    price: {
      endpoint: priceResult.endpoint,
      httpStatus: priceResult.httpStatus,
      energyAmount: params.value,
      durationHours: params.hour,
      unit: "TRX",
      estimatedCostTrx,
      body: priceResult.body,
    },
    balance: {
      endpoint: balanceResult.endpoint,
      httpStatus: balanceResult.httpStatus,
      unit: "TRX",
      availableBalanceTrx,
      body: balanceResult.body,
    },
  };
}

async function provisionApitrxEnergy(order) {
  const params = buildApitrxEnergyOrderParams(order);
  const preflight = await preflightApitrxEnergyOrder(params);
  const result = await requestApitrx("getenergy", params, {
    indeterminateOnFailure: true,
  });

  return {
    dryRun: false,
    provider: "apitrx",
    accepted: true,
    upstreamOrderId: extractUpstreamOrderId(result.body.data),
    targetAddress: order.targetAddress,
    energyAmount: order.energyAmount,
    durationHours: order.durationHours,
    providerCode: result.body.code,
    providerMessage: result.body.message,
    providerResponse: {
      preflight,
      energyOrder: {
        endpoint: result.endpoint,
        httpStatus: result.httpStatus,
        body: result.body,
      },
    },
  };
}

async function provisionEnergy(order) {
  if (!isProviderLiveMode()) {
    return {
      dryRun: true,
      provider: getEnergyProvider(),
      upstreamOrderId: `dry-run-${order.id}`,
      accepted: true,
      targetAddress: order.targetAddress,
      energyAmount: order.energyAmount,
      durationHours: order.durationHours,
    };
  }

  if (getEnergyProvider() !== "apitrx") {
    throw createProviderError(
      `Unsupported live energy provider: ${getEnergyProvider()}`,
      400
    );
  }

  return provisionApitrxEnergy(order);
}

function isIndeterminateProviderError(error) {
  return Boolean(error?.providerIndeterminate);
}

module.exports = {
  APITRX_SUPPORTED_DURATION_HOURS,
  DEFAULT_APITRX_API_BASE_URL,
  buildApitrxEnergyOrderParams,
  buildApitrxUrl,
  isIndeterminateProviderError,
  isProviderLiveMode,
  provisionEnergy,
  redactSensitive,
  resetFetchForTesting,
  setFetchForTesting,
};
