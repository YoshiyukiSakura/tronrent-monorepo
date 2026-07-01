"use strict";

const { requireEnabledAdminRoute } = require("../utils/adminRouteGate");

const READINESS_ENDPOINT_FLAG = "ENABLE_READINESS_ENDPOINT";
const READINESS_DISABLED_MESSAGE = "Readiness endpoint is disabled";

function isEnabled(env, key) {
  return env[key] === "true";
}

function isPresent(env, key) {
  return Boolean(String(env[key] || "").trim());
}

function parseTrc20Allowlist(env = process.env) {
  return String(env.TRON_TRC20_ALLOWLIST || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [symbol, contractAddress, decimals] = entry.split(":");
      const parsedDecimals = Number.parseInt(decimals || "0", 10);
      return {
        symbol: String(symbol || "").trim().toUpperCase(),
        configured: Boolean(contractAddress && Number.isFinite(parsedDecimals)),
      };
    })
    .filter((entry) => entry.symbol && entry.configured);
}

function makeWarning(code, message, severity = "warning") {
  return { code, severity, message };
}

function buildWarnings(report) {
  const warnings = [];
  const depositTriggeredExchangePayoutsEnabled =
    report.depositScan.cronEnabled && report.depositScan.processExchangePayouts;

  if (!report.admin.adminTokenConfigured) {
    warnings.push(
      makeWarning(
        "ADMIN_TOKEN_MISSING",
        "DEPOSIT_WATCHER_ADMIN_TOKEN is not configured; admin endpoints cannot authenticate.",
        "error"
      )
    );
  }

  if (
    report.depositScan.cronEnabled &&
    !report.treasury.energyTreasuryConfigured &&
    !report.treasury.exchangeTreasuryConfigured
  ) {
    warnings.push(
      makeWarning(
        "DEPOSIT_SCAN_WITHOUT_TREASURY",
        "Deposit watcher cron is enabled but no treasury address is configured.",
        "error"
      )
    );
  }

  if (
    (report.depositScan.processProviderJobs || report.provider.cronEnabled) &&
    !report.provider.live
  ) {
    warnings.push(
      makeWarning(
        "PROVIDER_AUTOMATION_DRY_RUN",
        "Provider job automation is enabled while PROVIDER_LIVE=false; paid energy orders will not call APITRX live mode."
      )
    );
  }

  if (report.provider.live && !report.provider.apitrxApiKeyConfigured) {
    warnings.push(
      makeWarning(
        "PROVIDER_LIVE_MISSING_API_KEY",
        "PROVIDER_LIVE=true requires APITRX_API_KEY.",
        "error"
      )
    );
  }

  if (report.provider.live && !report.treasury.energyTreasuryConfigured) {
    warnings.push(
      makeWarning(
        "PROVIDER_LIVE_MISSING_TREASURY",
        "PROVIDER_LIVE=true requires TREASURY_TRON_ADDRESS for customer payments.",
        "error"
      )
    );
  }

  if (report.provider.live && !report.depositScan.endpointEnabled) {
    warnings.push(
      makeWarning(
        "PROVIDER_LIVE_DEPOSIT_ENDPOINT_DISABLED",
        "PROVIDER_LIVE=true but ENABLE_DEPOSIT_SCAN_ENDPOINT=false; operators cannot manually scan deposits through the admin API."
      )
    );
  }

  if (report.provider.live && !report.provider.endpointEnabled) {
    warnings.push(
      makeWarning(
        "PROVIDER_LIVE_REVIEW_ENDPOINT_DISABLED",
        "PROVIDER_LIVE=true but ENABLE_PROVIDER_JOB_ENDPOINT=false; operators cannot process or resolve provider jobs through the admin API."
      )
    );
  }

  if (
    report.provider.live &&
    !report.provider.cronEnabled &&
    !(
      report.depositScan.cronEnabled && report.depositScan.processProviderJobs
    )
  ) {
    warnings.push(
      makeWarning(
        "PROVIDER_LIVE_WITHOUT_AUTOMATION",
        "PROVIDER_LIVE=true but no provider automation path is enabled."
      )
    );
  }

  if (
    report.depositScan.processProviderJobs &&
    !report.depositScan.cronEnabled
  ) {
    warnings.push(
      makeWarning(
        "PROVIDER_AUTOPROCESS_WITHOUT_DEPOSIT_CRON",
        "DEPOSIT_WATCHER_PROCESS_PROVIDER_JOBS=true has no cron effect unless ENABLE_DEPOSIT_WATCHER_CRON=true."
      )
    );
  }

  if (
    (report.depositScan.processExchangePayouts ||
      report.exchangePayout.cronEnabled ||
      report.exchangePayout.endpointEnabled) &&
    !report.exchangePayout.live
  ) {
    warnings.push(
      makeWarning(
        "EXCHANGE_PAYOUT_AUTOMATION_DRY_RUN",
        "Exchange payout automation is enabled while EXCHANGE_PAYOUT_LIVE=false; payouts will not broadcast live transactions."
      )
    );
  }

  if (
    report.depositScan.processExchangePayouts &&
    !report.depositScan.cronEnabled
  ) {
    warnings.push(
      makeWarning(
        "EXCHANGE_AUTOPROCESS_WITHOUT_DEPOSIT_CRON",
        "DEPOSIT_WATCHER_PROCESS_EXCHANGE_PAYOUTS=true has no cron effect unless ENABLE_DEPOSIT_WATCHER_CRON=true."
      )
    );
  }

  if (report.exchangePayout.live && !report.exchangePayout.privateKeyConfigured) {
    warnings.push(
      makeWarning(
        "EXCHANGE_PAYOUT_LIVE_MISSING_PRIVATE_KEY",
        "EXCHANGE_PAYOUT_LIVE=true requires EXCHANGE_PAYOUT_PRIVATE_KEY.",
        "error"
      )
    );
  }

  if (report.exchangePayout.live && !report.exchangePayout.fromAddressConfigured) {
    warnings.push(
      makeWarning(
        "EXCHANGE_PAYOUT_LIVE_MISSING_FROM_ADDRESS",
        "EXCHANGE_PAYOUT_LIVE=true requires EXCHANGE_PAYOUT_FROM_ADDRESS.",
        "error"
      )
    );
  }

  if (
    report.exchangePayout.live &&
    !report.treasury.exchangeTreasuryConfigured
  ) {
    warnings.push(
      makeWarning(
        "EXCHANGE_PAYOUT_LIVE_MISSING_TREASURY",
        "EXCHANGE_PAYOUT_LIVE=true requires EXCHANGE_TREASURY_TRON_ADDRESS.",
        "error"
      )
    );
  }

  if (report.exchangePayout.live && !report.trc20.usdtConfigured) {
    warnings.push(
      makeWarning(
        "EXCHANGE_PAYOUT_LIVE_MISSING_USDT_ALLOWLIST",
        "EXCHANGE_PAYOUT_LIVE=true requires TRON_TRC20_ALLOWLIST to include USDT.",
        "error"
      )
    );
  }

  if (report.exchangePayout.live && !report.depositScan.endpointEnabled) {
    warnings.push(
      makeWarning(
        "EXCHANGE_PAYOUT_LIVE_DEPOSIT_ENDPOINT_DISABLED",
        "EXCHANGE_PAYOUT_LIVE=true but ENABLE_DEPOSIT_SCAN_ENDPOINT=false; operators cannot manually scan deposits through the admin API."
      )
    );
  }

  if (report.exchangePayout.live && !report.exchangePayout.endpointEnabled) {
    warnings.push(
      makeWarning(
        "EXCHANGE_PAYOUT_LIVE_REVIEW_ENDPOINT_DISABLED",
        "EXCHANGE_PAYOUT_LIVE=true but ENABLE_EXCHANGE_PAYOUT_ENDPOINT=false; operators cannot process or resolve payouts through the admin API."
      )
    );
  }

  if (
    report.exchangePayout.live &&
    !(
      depositTriggeredExchangePayoutsEnabled ||
      report.exchangePayout.cronEnabled
    )
  ) {
    warnings.push(
      makeWarning(
        "EXCHANGE_PAYOUT_LIVE_WITHOUT_AUTOMATION",
        "EXCHANGE_PAYOUT_LIVE=true but no exchange payout automation path is enabled."
      )
    );
  }

  if (report.exchangePayout.live && !depositTriggeredExchangePayoutsEnabled) {
    warnings.push(
      makeWarning(
        "EXCHANGE_PAYOUT_LIVE_WITHOUT_DEPOSIT_TRIGGER",
        "EXCHANGE_PAYOUT_LIVE=true but deposit-triggered exchange payout processing is not enabled."
      )
    );
  }

  if (report.exchangePayout.live && !report.exchangePayout.cronEnabled) {
    warnings.push(
      makeWarning(
        "EXCHANGE_PAYOUT_LIVE_WITHOUT_PENDING_DRAIN",
        "EXCHANGE_PAYOUT_LIVE=true but ENABLE_EXCHANGE_PAYOUT_CRON=false; existing funds_received exchange orders will not be drained automatically."
      )
    );
  }

  if (
    report.depositScan.processExchangePayouts &&
    !report.exchangePayout.endpointEnabled
  ) {
    warnings.push(
      makeWarning(
        "EXCHANGE_AUTOPROCESS_ENDPOINT_DISABLED",
        "Exchange payout auto-processing is enabled while ENABLE_EXCHANGE_PAYOUT_ENDPOINT=false; manual review endpoints remain unavailable."
      )
    );
  }

  return warnings;
}

function deriveMode(report, warnings) {
  const hasLiveGate =
    report.provider.live ||
    report.exchangePayout.live ||
    report.depositScan.processProviderJobs ||
    report.depositScan.processExchangePayouts ||
    report.provider.cronEnabled ||
    report.exchangePayout.cronEnabled;

  if (!hasLiveGate) {
    return "dry-run";
  }

  const hasError = warnings.some((warning) => warning.severity === "error");
  const fullyAutomatedLive =
    report.depositScan.cronEnabled &&
    report.depositScan.processProviderJobs &&
    report.depositScan.processExchangePayouts &&
    report.provider.live &&
    report.provider.readyForLive &&
    report.provider.endpointEnabled &&
    report.depositScan.endpointEnabled &&
    report.exchangePayout.live &&
    report.exchangePayout.readyForLive &&
    report.exchangePayout.endpointEnabled &&
    report.exchangePayout.cronEnabled &&
    report.orderExpiry.cronEnabled &&
    report.exchangeExpiry.cronEnabled;

  if (!hasError && fullyAutomatedLive) {
    return "live";
  }

  return "partial-live";
}

function buildReadinessReport({ env = process.env, now = new Date() } = {}) {
  const trc20Contracts = parseTrc20Allowlist(env);
  const trc20Symbols = Array.from(
    new Set(trc20Contracts.map((contract) => contract.symbol))
  ).sort();
  const usdtConfigured = trc20Symbols.includes("USDT");

  const report = {
    generatedAt: now.toISOString(),
    admin: {
      readinessEndpointEnabled: isEnabled(env, READINESS_ENDPOINT_FLAG),
      adminTokenConfigured: isPresent(env, "DEPOSIT_WATCHER_ADMIN_TOKEN"),
    },
    depositScan: {
      endpointEnabled: isEnabled(env, "ENABLE_DEPOSIT_SCAN_ENDPOINT"),
      cronEnabled: isEnabled(env, "ENABLE_DEPOSIT_WATCHER_CRON"),
      processProviderJobs: isEnabled(
        env,
        "DEPOSIT_WATCHER_PROCESS_PROVIDER_JOBS"
      ),
      processExchangePayouts: isEnabled(
        env,
        "DEPOSIT_WATCHER_PROCESS_EXCHANGE_PAYOUTS"
      ),
    },
    treasury: {
      energyTreasuryConfigured: isPresent(env, "TREASURY_TRON_ADDRESS"),
      exchangeTreasuryConfigured: isPresent(
        env,
        "EXCHANGE_TREASURY_TRON_ADDRESS"
      ),
    },
    trc20: {
      allowlistConfigured: trc20Contracts.length > 0,
      contractCount: trc20Contracts.length,
      symbols: trc20Symbols,
      usdtConfigured,
    },
    provider: {
      energyProvider: String(env.ENERGY_PROVIDER || "apitrx"),
      live: isEnabled(env, "PROVIDER_LIVE"),
      apitrxApiKeyConfigured: isPresent(env, "APITRX_API_KEY"),
      endpointEnabled: isEnabled(env, "ENABLE_PROVIDER_JOB_ENDPOINT"),
      cronEnabled: isEnabled(env, "ENABLE_ORDER_PROVIDER_CRON"),
      readyForLive:
        isEnabled(env, "PROVIDER_LIVE") &&
        isPresent(env, "APITRX_API_KEY") &&
        isPresent(env, "TREASURY_TRON_ADDRESS"),
    },
    exchangePayout: {
      live: isEnabled(env, "EXCHANGE_PAYOUT_LIVE"),
      privateKeyConfigured: isPresent(env, "EXCHANGE_PAYOUT_PRIVATE_KEY"),
      fromAddressConfigured: isPresent(env, "EXCHANGE_PAYOUT_FROM_ADDRESS"),
      endpointEnabled: isEnabled(env, "ENABLE_EXCHANGE_PAYOUT_ENDPOINT"),
      cronEnabled: isEnabled(env, "ENABLE_EXCHANGE_PAYOUT_CRON"),
      readyForLive:
        isEnabled(env, "EXCHANGE_PAYOUT_LIVE") &&
        isPresent(env, "EXCHANGE_PAYOUT_PRIVATE_KEY") &&
        isPresent(env, "EXCHANGE_PAYOUT_FROM_ADDRESS") &&
        isPresent(env, "EXCHANGE_TREASURY_TRON_ADDRESS") &&
        usdtConfigured,
    },
    orderExpiry: {
      cronEnabled: isEnabled(env, "ENABLE_ORDER_EXPIRY_CRON"),
    },
    exchangeExpiry: {
      cronEnabled: isEnabled(env, "ENABLE_EXCHANGE_EXPIRY_CRON"),
    },
    dev: {
      devPaymentConfirmationEnabled: isEnabled(
        env,
        "ENABLE_DEV_PAYMENT_CONFIRMATION"
      ),
    },
  };

  const warnings = buildWarnings(report);
  const mode = deriveMode(report, warnings);
  return {
    ...report,
    summary: {
      mode,
      readyForLiveOperations: mode === "live",
      warningCount: warnings.length,
    },
    warnings,
  };
}

function assertReadinessRouteEnabled(req) {
  requireEnabledAdminRoute({
    req,
    enabledEnvVar: READINESS_ENDPOINT_FLAG,
    disabledMessage: READINESS_DISABLED_MESSAGE,
  });
}

module.exports = {
  READINESS_DISABLED_MESSAGE,
  READINESS_ENDPOINT_FLAG,
  assertReadinessRouteEnabled,
  buildReadinessReport,
  parseTrc20Allowlist,
};
