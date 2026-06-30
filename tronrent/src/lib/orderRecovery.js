"use strict";

const MAX_RECENT_ORDERS = 10;
const ORDER_QUERY_PARAM = "order";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const STORAGE_KEYS = Object.freeze({
  energy: "tronrent:recent-rent-orders",
  exchange: "tronrent:recent-exchange-orders",
});

function getStorageKey(kind) {
  const key = STORAGE_KEYS[kind];
  if (!key) {
    throw new Error(`Unsupported order recovery kind: ${kind}`);
  }
  return key;
}

function resolveStorage(storage) {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage || null;
  } catch (_error) {
    return null;
  }
}

function normalizeOrderId(value) {
  const orderId = String(value || "").trim();
  return UUID_PATTERN.test(orderId) ? orderId.toLowerCase() : "";
}

function sanitizeRecentOrderEntry(entry) {
  const id = normalizeOrderId(entry?.id);
  if (!id) return null;

  return {
    id,
    status: String(entry?.status || "unknown"),
    amount: String(entry?.amount || ""),
    rememberedAt: String(entry?.rememberedAt || new Date().toISOString()),
    updatedAt: String(entry?.updatedAt || new Date().toISOString()),
  };
}

function readRecentOrders(kind, storage) {
  const targetStorage = resolveStorage(storage);
  if (!targetStorage) return [];

  try {
    const raw = targetStorage.getItem(getStorageKey(kind));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(sanitizeRecentOrderEntry)
      .filter(Boolean)
      .slice(0, MAX_RECENT_ORDERS);
  } catch (_error) {
    return [];
  }
}

function writeRecentOrders(kind, entries, storage) {
  const targetStorage = resolveStorage(storage);
  if (!targetStorage) return;

  try {
    targetStorage.setItem(
      getStorageKey(kind),
      JSON.stringify(entries.slice(0, MAX_RECENT_ORDERS))
    );
  } catch (_error) {
    // localStorage can be unavailable or full. Recovery must never break orders.
  }
}

function upsertRecentOrder(kind, entry, storage) {
  const sanitized = sanitizeRecentOrderEntry(entry);
  if (!sanitized) return readRecentOrders(kind, storage);

  const existing = readRecentOrders(kind, storage);
  const previous = existing.find((order) => order.id === sanitized.id);
  const merged = {
    ...previous,
    ...sanitized,
    rememberedAt: previous?.rememberedAt || sanitized.rememberedAt,
    updatedAt: new Date().toISOString(),
  };
  const nextOrders = [
    merged,
    ...existing.filter((order) => order.id !== sanitized.id),
  ].slice(0, MAX_RECENT_ORDERS);

  writeRecentOrders(kind, nextOrders, storage);
  return nextOrders;
}

function rememberEnergyOrder(order, storage) {
  return upsertRecentOrder(
    "energy",
    {
      id: order?.id,
      status: order?.status,
      amount:
        order?.paymentInstructions?.amountDisplay || order?.priceDisplay || "",
    },
    storage
  );
}

function rememberExchangeOrder(order, storage) {
  const inputAmount =
    order?.depositInstructions?.amountDisplay || order?.inputAmountDisplay || "";
  const outputAmount = order?.outputAmountDisplay || "";

  return upsertRecentOrder(
    "exchange",
    {
      id: order?.id,
      status: order?.status,
      amount:
        inputAmount && outputAmount
          ? `${inputAmount} -> ${outputAmount}`
          : inputAmount || outputAmount,
    },
    storage
  );
}

function forgetRecentOrder(kind, orderId, storage) {
  const normalizedOrderId = normalizeOrderId(orderId);
  const nextOrders = readRecentOrders(kind, storage).filter(
    (order) => order.id !== normalizedOrderId
  );
  writeRecentOrders(kind, nextOrders, storage);
  return nextOrders;
}

function clearRecentOrders(kind, storage) {
  const targetStorage = resolveStorage(storage);
  if (!targetStorage) return [];

  try {
    targetStorage.removeItem(getStorageKey(kind));
  } catch (_error) {
    // Ignore browser storage failures; the UI can continue without recovery.
  }
  return [];
}

function extractOrderIdFromSearch(search) {
  try {
    const params = new URLSearchParams(search || "");
    return normalizeOrderId(params.get(ORDER_QUERY_PARAM));
  } catch (_error) {
    return "";
  }
}

function buildOrderSearch(search, orderId) {
  const params = new URLSearchParams(search || "");
  const normalizedOrderId = normalizeOrderId(orderId);
  if (normalizedOrderId) {
    params.set(ORDER_QUERY_PARAM, normalizedOrderId);
  } else {
    params.delete(ORDER_QUERY_PARAM);
  }

  const nextSearch = params.toString();
  return nextSearch ? `?${nextSearch}` : "";
}

function replaceOrderIdInUrl(orderId, targetWindow) {
  const win = targetWindow || (typeof window !== "undefined" ? window : null);
  if (!win?.history?.replaceState || !win.location) return;

  const nextSearch = buildOrderSearch(win.location.search, orderId);
  win.history.replaceState(
    null,
    "",
    `${win.location.pathname}${nextSearch}${win.location.hash || ""}`
  );
}

module.exports = {
  MAX_RECENT_ORDERS,
  ORDER_QUERY_PARAM,
  STORAGE_KEYS,
  buildOrderSearch,
  clearRecentOrders,
  extractOrderIdFromSearch,
  forgetRecentOrder,
  normalizeOrderId,
  readRecentOrders,
  rememberEnergyOrder,
  rememberExchangeOrder,
  replaceOrderIdInUrl,
  upsertRecentOrder,
};
