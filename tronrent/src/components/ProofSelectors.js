"use strict";

/* eslint-disable @typescript-eslint/no-require-imports */
const React = require("react");
/* eslint-enable @typescript-eslint/no-require-imports */

function ProofSelectorRegion({ children, className, testId }) {
  return React.createElement(
    "div",
    {
      className,
      "data-testid": testId,
    },
    children
  );
}

function ProofRefreshButton({
  className,
  idleLabel = "刷新状态",
  isRefreshing,
  onClick,
  refreshingLabel = "刷新中...",
  testId,
}) {
  return React.createElement(
    "button",
    {
      type: "button",
      onClick,
      disabled: Boolean(isRefreshing),
      className,
      "data-testid": testId,
    },
    isRefreshing ? refreshingLabel : idleLabel
  );
}

function ProofPollingError({ className, message, prefix = "状态刷新失败：", testId }) {
  if (!message) {
    return null;
  }

  return React.createElement(
    "p",
    {
      className,
      "data-testid": testId,
    },
    `${prefix}${message}`
  );
}

module.exports = {
  ProofPollingError,
  ProofRefreshButton,
  ProofSelectorRegion,
};
