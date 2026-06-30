export type RecentOrderKind = "energy" | "exchange";

export type RecentOrderEntry = {
  id: string;
  status: string;
  amount: string;
  rememberedAt: string;
  updatedAt: string;
};

export const MAX_RECENT_ORDERS: number;
export const ORDER_QUERY_PARAM: "order";
export const STORAGE_KEYS: Record<RecentOrderKind, string>;

export function normalizeOrderId(value: string | null | undefined): string;
export function readRecentOrders(
  kind: RecentOrderKind,
  storage?: Storage
): RecentOrderEntry[];
export function rememberEnergyOrder(
  order: {
    id?: string;
    status?: string;
    priceDisplay?: string;
    paymentInstructions?: {
      amountDisplay?: string;
    };
  },
  storage?: Storage
): RecentOrderEntry[];
export function rememberExchangeOrder(
  order: {
    id?: string;
    status?: string;
    inputAmountDisplay?: string;
    outputAmountDisplay?: string;
    depositInstructions?: {
      amountDisplay?: string;
    };
  },
  storage?: Storage
): RecentOrderEntry[];
export function upsertRecentOrder(
  kind: RecentOrderKind,
  entry: Partial<RecentOrderEntry>,
  storage?: Storage
): RecentOrderEntry[];
export function forgetRecentOrder(
  kind: RecentOrderKind,
  orderId: string,
  storage?: Storage
): RecentOrderEntry[];
export function clearRecentOrders(
  kind: RecentOrderKind,
  storage?: Storage
): RecentOrderEntry[];
export function extractOrderIdFromSearch(search: string): string;
export function buildOrderSearch(search: string, orderId?: string | null): string;
export function replaceOrderIdInUrl(
  orderId?: string | null,
  targetWindow?: Window
): void;
