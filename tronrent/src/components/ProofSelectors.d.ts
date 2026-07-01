import type { ReactNode } from "react";

export function ProofSelectorRegion(props: {
  children?: ReactNode;
  className?: string;
  testId: string;
}): ReactNode;

export function ProofRefreshButton(props: {
  className?: string;
  idleLabel?: string;
  isRefreshing?: boolean;
  onClick?: () => void;
  refreshingLabel?: string;
  testId: string;
}): ReactNode;

export function ProofPollingError(props: {
  className?: string;
  message?: string | null;
  prefix?: string;
  testId: string;
}): ReactNode;
