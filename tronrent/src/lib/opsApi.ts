export type OpsWarning = {
  code: string;
  severity: "error" | "warning" | string;
  message: string;
};

export type OpsReadinessReport = {
  generatedAt: string;
  summary: {
    mode: "dry-run" | "partial-live" | "live" | string;
    readyForLiveOperations: boolean;
    warningCount: number;
  };
  warnings: OpsWarning[];
  admin: Record<string, boolean>;
  depositScan: Record<string, boolean>;
  treasury: Record<string, boolean>;
  trc20: {
    allowlistConfigured: boolean;
    contractCount: number;
    symbols: string[];
    usdtConfigured: boolean;
  };
  provider: {
    energyProvider: string;
    live: boolean;
    apitrxApiKeyConfigured: boolean;
    endpointEnabled: boolean;
    cronEnabled: boolean;
    readyForLive: boolean;
  };
  exchangePayout: {
    live: boolean;
    privateKeyConfigured: boolean;
    fromAddressConfigured: boolean;
    endpointEnabled: boolean;
    cronEnabled: boolean;
    readyForLive: boolean;
  };
  orderExpiry: Record<string, boolean>;
  exchangeExpiry: Record<string, boolean>;
  dev: Record<string, boolean>;
};

export type OpsBacklogSnapshot = {
  generatedAt: string;
  staleOlderThanMinutes: number;
  summary: {
    drainableCount: number;
    manualReviewCount: number;
    staleProcessingCount: number;
    indeterminateOrderCount: number;
    activeJobCount: number;
    failedOrIndeterminateJobCount: number;
    trackedStatusCount: number;
  };
  provider: {
    orders: {
      statuses: Record<string, number>;
      drainable: {
        paid: number;
      };
      manualReview: Record<string, number>;
    };
    jobs: {
      statuses: Record<string, number>;
    };
  };
  exchangePayout: {
    orders: {
      statuses: Record<string, number>;
      drainable: {
        fundsReceived: number;
      };
      manualReview: Record<string, number>;
    };
    jobs: {
      statuses: Record<string, number>;
    };
  };
};

export type OpsActionSummary = {
  action: "scan" | "provider-drain" | "exchange-drain";
  status: "completed";
  count: number;
  matched?: number;
  scanned?: number;
  stored?: number;
  truncated?: boolean;
  warningCount?: number;
  providerTriggered?: boolean;
  exchangeTriggered?: boolean;
};

type OpsEnvelope<T> = {
  success: boolean;
  data?: T;
  count?: number;
  message?: string;
};

export class OpsApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "OpsApiError";
    this.status = status;
  }
}

const OPS_API_BASE_URL =
  process.env.NEXT_PUBLIC_TRONRENT_API_URL || "http://localhost:4000";

function getSafeOpsMessage(status: number) {
  if (status === 403 || status === 404) {
    return "端点未启用或管理员 token 无效。";
  }
  return "运营 API 请求失败。";
}

async function requestOps<T>({
  adminToken,
  path,
  init,
}: {
  adminToken: string;
  path: string;
  init?: RequestInit;
}) {
  const response = await fetch(`${OPS_API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-admin-token": adminToken,
      ...(init?.headers || {}),
    },
  });

  let payload: OpsEnvelope<T> | null = null;
  try {
    payload = (await response.json()) as OpsEnvelope<T>;
  } catch (_error) {
    payload = null;
  }

  if (!response.ok || !payload?.success) {
    throw new OpsApiError(
      getSafeOpsMessage(response.status),
      response.status
    );
  }

  return payload;
}

export async function fetchOpsReadiness(adminToken: string) {
  const payload = await requestOps<OpsReadinessReport>({
    adminToken,
    path: "/api/admin/readiness",
  });
  return payload.data as OpsReadinessReport;
}

export async function fetchOpsBacklog(adminToken: string) {
  const payload = await requestOps<OpsBacklogSnapshot>({
    adminToken,
    path: "/api/admin/automation/backlog",
  });
  return payload.data as OpsBacklogSnapshot;
}

export async function scanOpsDeposits(adminToken: string) {
  const payload = await requestOps<{
    scanned?: number;
    stored?: number;
    matched?: number;
    truncated?: boolean;
    truncationWarnings?: unknown[];
    postMatchProcessing?: {
      providerJobs?: {
        triggered?: boolean;
      };
      exchangePayouts?: {
        triggered?: boolean;
      };
    };
  }>({
    adminToken,
    path: "/api/deposits/scan",
    init: {
      method: "POST",
      body: JSON.stringify({}),
    },
  });
  const data = payload.data || {};
  return {
    action: "scan",
    status: "completed",
    count: Number(data.matched || 0),
    matched: Number(data.matched || 0),
    scanned: Number(data.scanned || 0),
    stored: Number(data.stored || 0),
    truncated: Boolean(data.truncated),
    warningCount: Array.isArray(data.truncationWarnings)
      ? data.truncationWarnings.length
      : 0,
    providerTriggered: Boolean(data.postMatchProcessing?.providerJobs?.triggered),
    exchangeTriggered: Boolean(
      data.postMatchProcessing?.exchangePayouts?.triggered
    ),
  } satisfies OpsActionSummary;
}

export async function drainOpsProvider(adminToken: string) {
  const payload = await requestOps<unknown[]>({
    adminToken,
    path: "/api/provider-jobs/process",
    init: {
      method: "POST",
      body: JSON.stringify({}),
    },
  });
  return {
    action: "provider-drain",
    status: "completed",
    count: Number(payload.count || 0),
  } satisfies OpsActionSummary;
}

export async function drainOpsExchange(adminToken: string) {
  const payload = await requestOps<unknown[]>({
    adminToken,
    path: "/api/exchange/payout-jobs/process",
    init: {
      method: "POST",
      body: JSON.stringify({}),
    },
  });
  return {
    action: "exchange-drain",
    status: "completed",
    count: Number(payload.count || 0),
  } satisfies OpsActionSummary;
}
