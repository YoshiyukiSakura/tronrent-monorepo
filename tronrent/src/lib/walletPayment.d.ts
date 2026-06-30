import { ExchangeOrder, TronRentOrder } from "./tronrentApi";

export function parseSafeSunAmount(amountSun: string): number;
export function parseBaseUnitString(amountBaseUnits: string, label?: string): string;
export function normalizeTronAddress(address: string | null | undefined, tronWeb: any): string | null;
export function inferTronNetwork(tronWeb: any): string;
export function assertExpectedNetwork(tronWeb: any, expectedNetwork?: string): void;
export function assertAddressAllowed(address: string, allowlist: string[], label: string, tronWeb: any): string;
export function extractTxId(result: any): string | null;
export function sendWalletTrxPayment(input: {
  tronWeb: any;
  connectedAddress: string | null;
  order: TronRentOrder;
  expectedNetwork?: string;
}): Promise<{
  amountSun: string;
  toAddress: string;
  txid: string | null;
  raw: any;
}>;
export function sendExchangeWalletDeposit(input: {
  tronWeb: any;
  connectedAddress: string | null;
  order: ExchangeOrder;
  expectedNetwork?: string;
  allowedTreasuryAddresses?: string[];
  allowedUsdtContracts?: string[];
  feeLimit?: number;
}): Promise<{
  asset: "TRX" | "USDT";
  amountBaseUnits: string;
  toAddress: string;
  contractAddress?: string;
  txid: string | null;
  raw: any;
}>;
