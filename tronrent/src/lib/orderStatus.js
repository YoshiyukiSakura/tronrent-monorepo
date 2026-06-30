"use strict";

const ENERGY_ORDER_TERMINAL_STATUSES = new Set([
  "fulfilled",
  "failed",
  "expired",
  "cancelled",
]);

const EXCHANGE_ORDER_TERMINAL_STATUSES = new Set([
  "payout_completed",
  "payout_failed",
  "expired",
  "cancelled",
]);

const ENERGY_STATUS_META = Object.freeze({
  pending_payment: {
    label: "等待付款",
    tone: "waiting",
    description: "请按订单显示的精确金额付款，链上扫描确认后自动进入进货。",
  },
  paid: {
    label: "付款已确认",
    tone: "active",
    description: "链上入金已匹配，系统准备向上游进货。",
  },
  provisioning: {
    label: "进货中",
    tone: "active",
    description: "系统正在调用上游能量服务商并转发到接收地址。",
  },
  provisioning_indeterminate: {
    label: "需人工核查",
    tone: "review",
    description: "上游结果暂不确定，系统会继续刷新，操作员可在后台核查。",
  },
  fulfilled: {
    label: "已完成",
    tone: "success",
    description: "能量订单已完成。",
  },
  failed: {
    label: "处理失败",
    tone: "danger",
    description: "订单未能完成，请联系操作员核查付款和上游状态。",
  },
  expired: {
    label: "已过期",
    tone: "danger",
    description: "订单付款窗口已过期，请重新创建订单。",
  },
  cancelled: {
    label: "已取消",
    tone: "neutral",
    description: "订单已取消。",
  },
});

const EXCHANGE_STATUS_META = Object.freeze({
  pending_deposit: {
    label: "等待入金",
    tone: "waiting",
    description: "请按订单显示的精确金额转入我们的收款地址。",
  },
  funds_received: {
    label: "入金已确认",
    tone: "active",
    description: "链上入金已匹配，系统准备执行兑换出款。",
  },
  payout_processing: {
    label: "出款中",
    tone: "active",
    description: "系统正在执行兑换出款。",
  },
  payout_indeterminate: {
    label: "需人工核查",
    tone: "review",
    description: "出款结果暂不确定，系统会继续刷新，操作员可在后台核查。",
  },
  payout_completed: {
    label: "兑换完成",
    tone: "success",
    description: "兑换出款已完成。",
  },
  payout_failed: {
    label: "出款失败",
    tone: "danger",
    description: "兑换出款未完成，请联系操作员核查链上和热钱包状态。",
  },
  expired: {
    label: "已过期",
    tone: "danger",
    description: "订单入金窗口已过期，请重新创建兑换订单。",
  },
  cancelled: {
    label: "已取消",
    tone: "neutral",
    description: "兑换订单已取消。",
  },
});

const UNKNOWN_STATUS_META = Object.freeze({
  label: "状态刷新中",
  tone: "active",
  description: "系统正在刷新订单状态。",
});

function getEnergyOrderStatusMeta(status) {
  return ENERGY_STATUS_META[status] || UNKNOWN_STATUS_META;
}

function getExchangeOrderStatusMeta(status) {
  return EXCHANGE_STATUS_META[status] || UNKNOWN_STATUS_META;
}

function shouldPollEnergyOrder(status) {
  return Boolean(status) && !ENERGY_ORDER_TERMINAL_STATUSES.has(status);
}

function shouldPollExchangeOrder(status) {
  return Boolean(status) && !EXCHANGE_ORDER_TERMINAL_STATUSES.has(status);
}

function getTimelineState({
  status,
  matches,
  completedBefore,
  failedStatuses,
  neutralStatuses = [],
}) {
  if (matches.includes(status)) {
    if (status && failedStatuses.includes(status)) return "failed";
    if (status && neutralStatuses.includes(status)) return "neutral";
    if (String(status || "").includes("indeterminate")) return "review";
    return "active";
  }
  if (completedBefore.includes(status)) {
    return "done";
  }
  return "upcoming";
}

function buildEnergyOrderTimeline(status) {
  return [
    {
      key: "payment",
      label: "付款",
      description: "等待链上入金匹配",
      state: getTimelineState({
        status,
        matches: ["pending_payment", "expired", "cancelled"],
        completedBefore: [
          "paid",
          "provisioning",
          "provisioning_indeterminate",
          "fulfilled",
          "failed",
        ],
        failedStatuses: ["expired"],
        neutralStatuses: ["cancelled"],
      }),
    },
    {
      key: "confirmed",
      label: "确认",
      description: "付款确认后进入进货队列",
      state: getTimelineState({
        status,
        matches: ["paid"],
        completedBefore: [
          "provisioning",
          "provisioning_indeterminate",
          "fulfilled",
          "failed",
        ],
        failedStatuses: [],
      }),
    },
    {
      key: "provider",
      label: "进货",
      description: "调用上游能量服务商",
      state: getTimelineState({
        status,
        matches: ["provisioning", "provisioning_indeterminate", "failed"],
        completedBefore: ["fulfilled"],
        failedStatuses: ["failed"],
      }),
    },
    {
      key: "done",
      label: "完成",
      description: "能量转发完成",
      state:
        status === "fulfilled"
          ? "done"
          : status === "failed"
          ? "failed"
          : "upcoming",
    },
  ];
}

function buildExchangeOrderTimeline(status) {
  return [
    {
      key: "deposit",
      label: "入金",
      description: "等待链上入金匹配",
      state: getTimelineState({
        status,
        matches: ["pending_deposit", "expired", "cancelled"],
        completedBefore: [
          "funds_received",
          "payout_processing",
          "payout_indeterminate",
          "payout_completed",
          "payout_failed",
        ],
        failedStatuses: ["expired"],
        neutralStatuses: ["cancelled"],
      }),
    },
    {
      key: "received",
      label: "确认",
      description: "入金确认后进入出款队列",
      state: getTimelineState({
        status,
        matches: ["funds_received"],
        completedBefore: [
          "payout_processing",
          "payout_indeterminate",
          "payout_completed",
          "payout_failed",
        ],
        failedStatuses: [],
      }),
    },
    {
      key: "payout",
      label: "出款",
      description: "执行兑换出款",
      state: getTimelineState({
        status,
        matches: ["payout_processing", "payout_indeterminate", "payout_failed"],
        completedBefore: ["payout_completed"],
        failedStatuses: ["payout_failed"],
      }),
    },
    {
      key: "done",
      label: "完成",
      description: "兑换出款完成",
      state:
        status === "payout_completed"
          ? "done"
          : status === "payout_failed"
          ? "failed"
          : "upcoming",
    },
  ];
}

module.exports = {
  buildEnergyOrderTimeline,
  buildExchangeOrderTimeline,
  getEnergyOrderStatusMeta,
  getExchangeOrderStatusMeta,
  shouldPollEnergyOrder,
  shouldPollExchangeOrder,
};
