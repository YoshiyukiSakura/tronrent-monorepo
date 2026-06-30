export type OrderStatusTone =
  | "waiting"
  | "active"
  | "success"
  | "danger"
  | "warning"
  | "review"
  | "neutral";

export type TimelineStepState =
  | "done"
  | "active"
  | "upcoming"
  | "failed"
  | "review"
  | "neutral";

export type OrderStatusMeta = {
  label: string;
  tone: OrderStatusTone;
  description: string;
};

export type TimelineStep = {
  key: string;
  label: string;
  description: string;
  state: TimelineStepState;
};

export function getEnergyOrderStatusMeta(status: string): OrderStatusMeta;
export function getExchangeOrderStatusMeta(status: string): OrderStatusMeta;
export function shouldPollEnergyOrder(status?: string | null): boolean;
export function shouldPollExchangeOrder(status?: string | null): boolean;
export function buildEnergyOrderTimeline(status: string): TimelineStep[];
export function buildExchangeOrderTimeline(status: string): TimelineStep[];
