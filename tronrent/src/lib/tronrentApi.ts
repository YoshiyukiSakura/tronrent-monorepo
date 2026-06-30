export type EnergyPlan = {
  id: string;
  name: string;
  description: string;
  priceSun: string;
  priceDisplay: string;
  paymentAsset: string;
  energyAmount: number;
  durationHours: number;
  support: string;
  isPopular: boolean;
};

export type PaymentMethod = "wallet_connect" | "deposit_address";
export type ExchangeDirection = "TRX_TO_USDT" | "USDT_TO_TRX";

export type TronRentOrder = {
  id: string;
  idempotencyKey: string;
  planId: string;
  targetAddress: string;
  customerWalletAddress: string | null;
  paymentMethod: PaymentMethod;
  status: string;
  priceAmountSun: string;
  basePriceAmountSun: string;
  priceOffsetSun: number;
  priceDisplay: string;
  energyAmount: number;
  durationHours: number;
  paymentReference: string;
  expiresAt: string;
  paymentInstructions: {
    method: PaymentMethod;
    asset: string;
    amountSun: string;
    amountDisplay: string;
    address: string | null;
    paymentReference: string;
    configured: boolean;
    warnings: string[];
  };
};

export type ExchangeQuote = {
  id: string;
  direction: ExchangeDirection;
  inputAsset: "TRX" | "USDT";
  outputAsset: "TRX" | "USDT";
  inputAmount: string;
  outputAmount: string;
  spreadBps: number;
  status: string;
  expiresAt: string;
  metadata?: {
    executionEnabled?: boolean;
    rate?: number;
    source?: string;
  };
};

export type ExchangeOrder = {
  id: string;
  idempotencyKey: string;
  quoteId: string;
  direction: ExchangeDirection;
  status: string;
  customerWalletAddress: string | null;
  outputAddress: string;
  treasuryAddress: string;
  inputAsset: "TRX" | "USDT";
  outputAsset: "TRX" | "USDT";
  inputContractAddress: string | null;
  outputContractAddress: string | null;
  expectedInputBaseUnits: string;
  baseInputBaseUnits: string;
  inputOffsetBaseUnits: number;
  outputBaseUnits: string;
  quoteInputAmount: string;
  quoteOutputAmount: string;
  inputAmountDisplay: string;
  outputAmountDisplay: string;
  spreadBps: number;
  rate: string;
  depositReference: string;
  expiresAt: string;
  depositInstructions: {
    asset: "TRX" | "USDT";
    amountBaseUnits: string;
    amountDisplay: string;
    address: string;
    contractAddress: string | null;
    depositReference: string;
    warnings: string[];
  };
  payoutJobs: Array<{
    id: string;
    status: string;
    dryRun: boolean;
  }>;
};

type ApiEnvelope<T> = {
  success: boolean;
  data: T;
  message?: string;
};

const API_BASE_URL =
  process.env.NEXT_PUBLIC_TRONRENT_API_URL || "http://localhost:4000";

async function requestJson<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const payload = (await response.json()) as ApiEnvelope<T>;

  if (!response.ok || !payload.success) {
    throw new Error(payload.message || "TronRent API request failed");
  }

  return payload.data;
}

export async function fetchEnergyPlans() {
  return requestJson<EnergyPlan[]>("/api/catalog/plans");
}

export async function createEnergyOrder(input: {
  planId: string;
  targetAddress: string;
  customerWalletAddress: string | null;
  paymentMethod: PaymentMethod;
}) {
  const idempotencyKey =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return requestJson<TronRentOrder>("/api/orders", {
    method: "POST",
    body: JSON.stringify({
      ...input,
      idempotencyKey,
    }),
  });
}

export async function getEnergyOrder(orderId: string) {
  return requestJson<TronRentOrder>(`/api/orders/${orderId}`);
}

export async function createExchangeQuote(input: {
  direction: ExchangeDirection;
  inputAmount: string;
}) {
  return requestJson<ExchangeQuote>("/api/exchange/quotes", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function createExchangeOrder(input: {
  quoteId: string;
  outputAddress: string;
  customerWalletAddress: string | null;
  idempotencyKey: string;
}) {
  return requestJson<ExchangeOrder>("/api/exchange/orders", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getExchangeOrder(orderId: string) {
  return requestJson<ExchangeOrder>(`/api/exchange/orders/${orderId}`);
}
