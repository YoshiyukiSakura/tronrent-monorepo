"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const providerClient = require("../services/providerClient");

const ORIGINAL_ENV = { ...process.env };
const BASE_ORDER = Object.freeze({
  id: "order-1",
  targetAddress: "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
  energyAmount: 65000,
  durationHours: 1,
});

function restoreEnv() {
  process.env = { ...ORIGINAL_ENV };
  providerClient.resetFetchForTesting();
}

test.afterEach(() => {
  restoreEnv();
});

test("provider client remains dry-run unless live mode is enabled", async () => {
  process.env.PROVIDER_LIVE = "false";
  providerClient.setFetchForTesting(() => {
    throw new Error("network should not be called in dry-run mode");
  });

  const response = await providerClient.provisionEnergy(BASE_ORDER);

  assert.equal(response.dryRun, true);
  assert.equal(response.accepted, true);
  assert.equal(response.upstreamOrderId, "dry-run-order-1");
});

test("live apitrx mode requires an API key before any network call", async () => {
  let fetchCalled = false;
  process.env.PROVIDER_LIVE = "true";
  process.env.ENERGY_PROVIDER = "apitrx";
  delete process.env.APITRX_API_KEY;
  providerClient.setFetchForTesting(() => {
    fetchCalled = true;
  });

  await assert.rejects(
    () => providerClient.provisionEnergy(BASE_ORDER),
    /APITRX_API_KEY is required/
  );
  assert.equal(fetchCalled, false);
});

test("live apitrx mode sends the documented energy order parameters", async () => {
  const requestedUrls = [];
  process.env.PROVIDER_LIVE = "true";
  process.env.ENERGY_PROVIDER = "apitrx";
  process.env.APITRX_API_KEY = "secret-key";
  delete process.env.APITRX_API_BASE_URL;
  providerClient.setFetchForTesting(async (url) => {
    const requestedUrl = new URL(String(url));
    requestedUrls.push(requestedUrl);
    if (requestedUrl.pathname === "/price") {
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            code: 200,
            data: { "1": 2.34 },
            message: "SUCCESS",
          }),
      };
    }
    if (requestedUrl.pathname === "/balance") {
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            code: 200,
            data: { balance: 10 },
            message: "SUCCESS",
          }),
      };
    }
    return {
      status: 200,
      text: async () =>
        JSON.stringify({
          code: 200,
          data: { id: "upstream-123" },
          message: "SUCCESS",
        }),
    };
  });

  const response = await providerClient.provisionEnergy(BASE_ORDER);

  assert.deepEqual(
    requestedUrls.map((url) => url.pathname),
    ["/price", "/balance", "/getenergy"]
  );
  for (const requestedUrl of requestedUrls) {
    assert.equal(requestedUrl.origin, "https://web.apitrx.com");
    assert.equal(requestedUrl.searchParams.get("apikey"), "secret-key");
  }
  assert.equal(requestedUrls[0].searchParams.get("value"), "65000");
  assert.equal(requestedUrls[2].searchParams.get("add"), BASE_ORDER.targetAddress);
  assert.equal(requestedUrls[2].searchParams.get("value"), "65000");
  assert.equal(requestedUrls[2].searchParams.get("hour"), "1");
  assert.equal(response.dryRun, false);
  assert.equal(response.upstreamOrderId, "upstream-123");
  assert.equal(response.providerResponse.preflight.price.estimatedCostTrx, 2.34);
  assert.equal(response.providerResponse.preflight.balance.availableBalanceTrx, 10);
  assert.equal(response.providerResponse.energyOrder.body.data.id, "upstream-123");
});

test("live apitrx provider failures fail closed and redact API keys", async () => {
  process.env.PROVIDER_LIVE = "true";
  process.env.ENERGY_PROVIDER = "apitrx";
  process.env.APITRX_API_KEY = "super-secret-provider-key";
  providerClient.setFetchForTesting(async () => ({
    status: 200,
    text: async () =>
      JSON.stringify({
        code: 501,
        data: { echoedUrl: "https://web.apitrx.com/getenergy?apikey=super-secret-provider-key" },
        message: "请检查Apikey是否正确",
      }),
  }));

  await assert.rejects(
    async () => providerClient.provisionEnergy(BASE_ORDER),
    (error) => {
      assert.equal(error.statusCode, 502);
      assert.match(error.message, /rejected/);
      assert.equal(error.message.includes("super-secret-provider-key"), false);
      assert.equal(
        JSON.stringify(error.providerDetails).includes("super-secret-provider-key"),
        false
      );
      return true;
    }
  );
});

test("live apitrx mode rejects HTTP status failures even when body code is 200", async () => {
  const paths = [];
  process.env.PROVIDER_LIVE = "true";
  process.env.ENERGY_PROVIDER = "apitrx";
  process.env.APITRX_API_KEY = "secret-key";
  providerClient.setFetchForTesting(async (url) => {
    const requestedUrl = new URL(String(url));
    paths.push(requestedUrl.pathname);
    return {
      status: 500,
      text: async () =>
        JSON.stringify({
          code: 200,
          data: { "1": 2.34 },
          message: "SUCCESS",
        }),
    };
  });

  await assert.rejects(
    () => providerClient.provisionEnergy(BASE_ORDER),
    /APITRX price rejected/
  );
  assert.deepEqual(paths, ["/price"]);
});

test("live apitrx mode does not accept unknown HTTP 200 response shapes", async () => {
  process.env.PROVIDER_LIVE = "true";
  process.env.ENERGY_PROVIDER = "apitrx";
  process.env.APITRX_API_KEY = "secret-key";
  providerClient.setFetchForTesting(async () => ({
    status: 200,
    text: async () => "<html>ok</html>",
  }));

  await assert.rejects(
    () => providerClient.provisionEnergy(BASE_ORDER),
    /unrecognized response shape/
  );
});

test("live apitrx mode blocks getenergy when balance preflight fails", async () => {
  const paths = [];
  process.env.PROVIDER_LIVE = "true";
  process.env.ENERGY_PROVIDER = "apitrx";
  process.env.APITRX_API_KEY = "balance-secret-key";
  providerClient.setFetchForTesting(async (url) => {
    const requestedUrl = new URL(String(url));
    paths.push(requestedUrl.pathname);
    if (requestedUrl.pathname === "/price") {
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            code: 200,
            data: { "1": 2.34 },
            message: "SUCCESS",
          }),
      };
    }
    return {
      status: 200,
      text: async () =>
        JSON.stringify({
          code: 500,
          data: {
            echoedUrl: "https://web.apitrx.com/balance?apikey=balance-secret-key",
          },
          message: "balance unavailable",
        }),
    };
  });

  await assert.rejects(
    () => providerClient.provisionEnergy(BASE_ORDER),
    (error) => {
      assert.match(error.message, /APITRX balance rejected/);
      assert.equal(error.message.includes("balance-secret-key"), false);
      assert.equal(
        JSON.stringify(error.providerDetails).includes("balance-secret-key"),
        false
      );
      return true;
    }
  );
  assert.deepEqual(paths, ["/price", "/balance"]);
});

test("live apitrx mode validates the target address before spending", async () => {
  let fetchCalled = false;
  process.env.PROVIDER_LIVE = "true";
  process.env.ENERGY_PROVIDER = "apitrx";
  process.env.APITRX_API_KEY = "secret-key";
  providerClient.setFetchForTesting(() => {
    fetchCalled = true;
  });

  await assert.rejects(
    () =>
      providerClient.provisionEnergy({
        ...BASE_ORDER,
        targetAddress: "not-a-tron-address",
      }),
    /targetAddress/
  );
  assert.equal(fetchCalled, false);
});

test("live apitrx mode rejects unsupported durations before spending", async () => {
  let fetchCalled = false;
  process.env.PROVIDER_LIVE = "true";
  process.env.ENERGY_PROVIDER = "apitrx";
  process.env.APITRX_API_KEY = "secret-key";
  providerClient.setFetchForTesting(() => {
    fetchCalled = true;
  });

  await assert.rejects(
    () =>
      providerClient.provisionEnergy({
        ...BASE_ORDER,
        durationHours: 2,
      }),
    /durationHours/
  );
  assert.equal(fetchCalled, false);
});

test("live apitrx mode blocks getenergy when provider balance is insufficient", async () => {
  const paths = [];
  process.env.PROVIDER_LIVE = "true";
  process.env.ENERGY_PROVIDER = "apitrx";
  process.env.APITRX_API_KEY = "secret-key";
  providerClient.setFetchForTesting(async (url) => {
    const requestedUrl = new URL(String(url));
    paths.push(requestedUrl.pathname);
    if (requestedUrl.pathname === "/price") {
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            code: 200,
            data: { "1": 2.34 },
            message: "SUCCESS",
          }),
      };
    }
    return {
      status: 200,
      text: async () =>
        JSON.stringify({
          code: 200,
          data: { balance: 1 },
          message: "SUCCESS",
        }),
    };
  });

  await assert.rejects(
    () => providerClient.provisionEnergy(BASE_ORDER),
    /balance is insufficient/
  );
  assert.deepEqual(paths, ["/price", "/balance"]);
});

test("live apitrx mode fails closed when preflight price lacks the duration key", async () => {
  const paths = [];
  process.env.PROVIDER_LIVE = "true";
  process.env.ENERGY_PROVIDER = "apitrx";
  process.env.APITRX_API_KEY = "secret-key";
  providerClient.setFetchForTesting(async (url) => {
    const requestedUrl = new URL(String(url));
    paths.push(requestedUrl.pathname);
    return {
      status: 200,
      text: async () =>
        JSON.stringify({
          code: 200,
          data: { "24": 4.83 },
          message: "SUCCESS",
        }),
    };
  });

  await assert.rejects(
    () => providerClient.provisionEnergy(BASE_ORDER),
    /price response/
  );
  assert.deepEqual(paths, ["/price"]);
});

test("live apitrx mode times out fail-closed without leaking API keys", async () => {
  let fetchCalled = 0;
  process.env.PROVIDER_LIVE = "true";
  process.env.ENERGY_PROVIDER = "apitrx";
  process.env.APITRX_API_KEY = "timeout-secret-key";
  process.env.APITRX_TIMEOUT_MS = "1";
  providerClient.setFetchForTesting((_url, options) => {
    fetchCalled += 1;
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    });
  });

  await assert.rejects(
    () => providerClient.provisionEnergy(BASE_ORDER),
    (error) => {
      assert.match(error.message, /timed out/);
      assert.equal(error.message.includes("timeout-secret-key"), false);
      assert.equal(error.providerIndeterminate, false);
      return true;
    }
  );
  assert.equal(fetchCalled, 1);
});

test("live apitrx getenergy timeout is indeterminate after successful preflight", async () => {
  const paths = [];
  process.env.PROVIDER_LIVE = "true";
  process.env.ENERGY_PROVIDER = "apitrx";
  process.env.APITRX_API_KEY = "getenergy-timeout-secret";
  process.env.APITRX_TIMEOUT_MS = "1";
  providerClient.setFetchForTesting((url, options) => {
    const requestedUrl = new URL(String(url));
    paths.push(requestedUrl.pathname);
    if (requestedUrl.pathname === "/price") {
      return Promise.resolve({
        status: 200,
        text: async () =>
          JSON.stringify({
            code: 200,
            data: { "1": 2.34 },
            message: "SUCCESS",
          }),
      });
    }
    if (requestedUrl.pathname === "/balance") {
      return Promise.resolve({
        status: 200,
        text: async () =>
          JSON.stringify({
            code: 200,
            data: { balance: 10 },
            message: "SUCCESS",
          }),
      });
    }
    return new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    });
  });

  await assert.rejects(
    () => providerClient.provisionEnergy(BASE_ORDER),
    (error) => {
      assert.equal(error.providerIndeterminate, true);
      assert.match(error.message, /outcome is indeterminate/);
      assert.equal(error.message.includes("getenergy-timeout-secret"), false);
      assert.deepEqual(error.providerDetails, {
        endpoint: "getenergy",
        timeoutMs: 1,
        reason: "timeout",
      });
      return true;
    }
  );
  assert.deepEqual(paths, ["/price", "/balance", "/getenergy"]);
});

test("live apitrx getenergy explicit provider rejection remains deterministic", async () => {
  const paths = [];
  process.env.PROVIDER_LIVE = "true";
  process.env.ENERGY_PROVIDER = "apitrx";
  process.env.APITRX_API_KEY = "getenergy-reject-secret";
  providerClient.setFetchForTesting(async (url) => {
    const requestedUrl = new URL(String(url));
    paths.push(requestedUrl.pathname);
    if (requestedUrl.pathname === "/price") {
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            code: 200,
            data: { "1": 2.34 },
            message: "SUCCESS",
          }),
      };
    }
    if (requestedUrl.pathname === "/balance") {
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            code: 200,
            data: { balance: 10 },
            message: "SUCCESS",
          }),
      };
    }
    return {
      status: 200,
      text: async () =>
        JSON.stringify({
          code: 501,
          data: {},
          message: "address rejected",
        }),
    };
  });

  await assert.rejects(
    () => providerClient.provisionEnergy(BASE_ORDER),
    (error) => {
      assert.equal(error.providerIndeterminate, false);
      assert.match(error.message, /APITRX getenergy rejected/);
      return true;
    }
  );
  assert.deepEqual(paths, ["/price", "/balance", "/getenergy"]);
});

test("live apitrx getenergy gateway failure is indeterminate", async () => {
  const paths = [];
  process.env.PROVIDER_LIVE = "true";
  process.env.ENERGY_PROVIDER = "apitrx";
  process.env.APITRX_API_KEY = "getenergy-5xx-secret";
  providerClient.setFetchForTesting(async (url) => {
    const requestedUrl = new URL(String(url));
    paths.push(requestedUrl.pathname);
    if (requestedUrl.pathname === "/price") {
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            code: 200,
            data: { "1": 2.34 },
            message: "SUCCESS",
          }),
      };
    }
    if (requestedUrl.pathname === "/balance") {
      return {
        status: 200,
        text: async () =>
          JSON.stringify({
            code: 200,
            data: { balance: 10 },
            message: "SUCCESS",
          }),
      };
    }
    return {
      status: 502,
      text: async () =>
        JSON.stringify({
          code: 500,
          message: "gateway unavailable",
        }),
    };
  });

  await assert.rejects(
    () => providerClient.provisionEnergy(BASE_ORDER),
    (error) => {
      assert.equal(error.providerIndeterminate, true);
      assert.match(error.message, /outcome is indeterminate/);
      assert.equal(error.providerDetails.endpoint, "getenergy");
      assert.equal(error.providerDetails.reason, "http_5xx");
      return true;
    }
  );
  assert.deepEqual(paths, ["/price", "/balance", "/getenergy"]);
});

test("live apitrx mode hides generic network failure details", async () => {
  let fetchCalled = 0;
  process.env.PROVIDER_LIVE = "true";
  process.env.ENERGY_PROVIDER = "apitrx";
  process.env.APITRX_API_KEY = "network-secret-key";
  providerClient.setFetchForTesting(() => {
    fetchCalled += 1;
    throw new Error(
      "connect failed https://web.apitrx.com/price?apikey=network-secret-key"
    );
  });

  await assert.rejects(
    () => providerClient.provisionEnergy(BASE_ORDER),
    (error) => {
      assert.match(error.message, /request failed/);
      assert.equal(error.message.includes("network-secret-key"), false);
      assert.equal(error.message.includes("apikey="), false);
      return true;
    }
  );
  assert.equal(fetchCalled, 1);
});
