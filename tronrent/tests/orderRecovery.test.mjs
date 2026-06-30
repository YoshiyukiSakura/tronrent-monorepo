import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_RECENT_ORDERS,
  STORAGE_KEYS,
  buildOrderSearch,
  clearRecentOrders,
  extractOrderIdFromSearch,
  forgetRecentOrder,
  readRecentOrders,
  rememberEnergyOrder,
  rememberExchangeOrder,
  replaceOrderIdInUrl,
  upsertRecentOrder,
} from "../src/lib/orderRecovery.js";

class MemoryStorage {
  constructor() {
    this.items = new Map();
  }

  getItem(key) {
    return this.items.has(key) ? this.items.get(key) : null;
  }

  setItem(key, value) {
    this.items.set(key, String(value));
  }

  removeItem(key) {
    this.items.delete(key);
  }
}

function orderId(number) {
  return `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

test("rememberEnergyOrder stores minimal order metadata", () => {
  const storage = new MemoryStorage();

  rememberEnergyOrder(
    {
      id: orderId(1).toUpperCase(),
      status: "pending_payment",
      paymentInstructions: {
        amountDisplay: "12.345 TRX",
      },
    },
    storage
  );

  assert.deepEqual(readRecentOrders("energy", storage), [
    {
      id: orderId(1),
      status: "pending_payment",
      amount: "12.345 TRX",
      rememberedAt: readRecentOrders("energy", storage)[0].rememberedAt,
      updatedAt: readRecentOrders("energy", storage)[0].updatedAt,
    },
  ]);
});

test("rememberEnergyOrder falls back to priceDisplay", () => {
  const storage = new MemoryStorage();

  rememberEnergyOrder(
    {
      id: orderId(7),
      status: "pending_payment",
      priceDisplay: "6.5 TRX",
    },
    storage
  );

  const [recentOrder] = readRecentOrders("energy", storage);
  assert.equal(recentOrder.amount, "6.5 TRX");
});

test("recent orders are deduped, newest first, and capped", () => {
  const storage = new MemoryStorage();

  for (let index = 1; index <= MAX_RECENT_ORDERS + 2; index += 1) {
    upsertRecentOrder(
      "energy",
      {
        id: orderId(index),
        status: `status-${index}`,
        amount: `${index} TRX`,
      },
      storage
    );
  }

  upsertRecentOrder(
    "energy",
    {
      id: orderId(5),
      status: "paid",
      amount: "5 TRX",
    },
    storage
  );

  const recentOrders = readRecentOrders("energy", storage);
  assert.equal(recentOrders.length, MAX_RECENT_ORDERS);
  assert.equal(recentOrders[0].id, orderId(5));
  assert.equal(recentOrders[0].status, "paid");
  assert.equal(
    recentOrders.some((order) => order.id === orderId(1)),
    false
  );
});

test("forget and clear remove local recent orders", () => {
  const storage = new MemoryStorage();
  upsertRecentOrder("energy", { id: orderId(1), status: "pending" }, storage);
  upsertRecentOrder("energy", { id: orderId(2), status: "paid" }, storage);

  assert.deepEqual(
    forgetRecentOrder("energy", orderId(1), storage).map((order) => order.id),
    [orderId(2)]
  );
  assert.deepEqual(clearRecentOrders("energy", storage), []);
  assert.deepEqual(readRecentOrders("energy", storage), []);
});

test("storage parse and write failures do not throw", () => {
  const storage = new MemoryStorage();
  storage.setItem(STORAGE_KEYS.energy, "{broken");
  assert.deepEqual(readRecentOrders("energy", storage), []);

  const throwingStorage = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
    removeItem() {
      throw new Error("blocked");
    },
  };

  assert.doesNotThrow(() => readRecentOrders("energy", throwingStorage));
  assert.doesNotThrow(() =>
    rememberEnergyOrder({ id: orderId(3), status: "pending" }, throwingStorage)
  );
  assert.doesNotThrow(() => clearRecentOrders("energy", throwingStorage));
});

test("URL helpers extract, set, replace, and clear order ids", () => {
  assert.equal(extractOrderIdFromSearch(`?order=${orderId(3)}`), orderId(3));
  assert.equal(extractOrderIdFromSearch("?order=not-a-uuid"), "");
  assert.equal(buildOrderSearch("?tab=rent", orderId(4)), `?tab=rent&order=${orderId(4)}`);
  assert.equal(buildOrderSearch(`?tab=rent&order=${orderId(4)}`, ""), "?tab=rent");
});

test("replaceOrderIdInUrl preserves path, unrelated query params, and hash", () => {
  const calls = [];
  const fakeWindow = {
    location: {
      pathname: "/rent",
      search: "?tab=orders",
      hash: "#payment",
    },
    history: {
      replaceState(state, title, url) {
        calls.push({ state, title, url });
      },
    },
  };

  replaceOrderIdInUrl(orderId(8), fakeWindow);

  assert.deepEqual(calls, [
    {
      state: null,
      title: "",
      url: `/rent?tab=orders&order=${orderId(8)}#payment`,
    },
  ]);
});

test("rememberExchangeOrder stores input and output amounts", () => {
  const storage = new MemoryStorage();

  rememberExchangeOrder(
    {
      id: orderId(6),
      status: "pending_deposit",
      depositInstructions: {
        amountDisplay: "100.000001 TRX",
      },
      outputAmountDisplay: "9.95 USDT",
    },
    storage
  );

  const [recentOrder] = readRecentOrders("exchange", storage);
  assert.equal(recentOrder.id, orderId(6));
  assert.equal(recentOrder.amount, "100.000001 TRX -> 9.95 USDT");
});
