import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.PLAYWRIGHT_TRONRENT_PORT || 3110);
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "../outputs/tronrent-wallet-e2e",
  workers: 1,
  timeout: 30_000,
  expect: {
    timeout: 8_000,
  },
  use: {
    baseURL,
    channel: process.env.PLAYWRIGHT_CHROME_CHANNEL || "chrome",
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: process.env.PLAYWRIGHT_SKIP_WEB_SERVER
    ? undefined
    : {
        command: [
          "NEXT_DIST_DIR=.next-e2e",
          "NEXT_PUBLIC_E2E_WALLET_MOCK=1",
          "NEXT_PUBLIC_TRON_NETWORK=mainnet",
          "NEXT_PUBLIC_EXCHANGE_TREASURY_TRON_ADDRESS=TAivugS6Zn2EK9RAKeiSQbshkZQAX4fZaA",
          "NEXT_PUBLIC_TRON_USDT_CONTRACT_ADDRESS=TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
          `next dev --hostname 127.0.0.1 --port ${PORT}`,
        ].join(" "),
        cwd: ".",
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
      },
});
