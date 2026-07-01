"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import {
  FaArrowsRotate,
  FaBolt,
  FaCircleExclamation,
  FaDatabase,
  FaEye,
} from "react-icons/fa6";
import { FRONTEND_TEST_IDS } from "@/lib/testIds";
import {
  OpsActionSummary,
  OpsBacklogSnapshot,
  OpsReadinessReport,
  drainOpsExchange,
  drainOpsProvider,
  fetchOpsBacklog,
  fetchOpsReadiness,
  scanOpsDeposits,
} from "@/lib/opsApi";

type OpsAction = "scan" | "provider-drain" | "exchange-drain";

const ACTION_LABELS: Record<OpsAction, string> = {
  scan: "扫描入金",
  "provider-drain": "处理能量进货队列",
  "exchange-drain": "处理兑换出款队列",
};

function toneForMode(mode: string) {
  if (mode === "live") return "text-green-300 border-green-800 bg-green-950/40";
  if (mode === "partial-live") {
    return "text-orange-200 border-orange-800 bg-orange-950/40";
  }
  return "text-blue-200 border-blue-800 bg-blue-950/40";
}

function formatBoolean(value: boolean | undefined) {
  return value ? "已启用" : "未启用";
}

function Metric({
  label,
  value,
}: {
  label: string;
  value: number | string | boolean | undefined;
}) {
  return (
    <div className="rounded-md border border-[#30363d] bg-[#0d1117] px-4 py-3">
      <div className="text-xs text-gray-400">{label}</div>
      <div className="mt-1 text-lg font-semibold text-white">
        {typeof value === "boolean" ? formatBoolean(value) : value ?? "-"}
      </div>
    </div>
  );
}

function BooleanRow({ label, value }: { label: string; value: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[#30363d] py-2 text-sm last:border-b-0">
      <span className="text-gray-300">{label}</span>
      <span className={value ? "text-green-300" : "text-gray-500"}>
        {formatBoolean(value)}
      </span>
    </div>
  );
}

function ReadinessPanel({ readiness }: { readiness: OpsReadinessReport | null }) {
  if (!readiness) {
    return (
      <section className="rounded-md border border-[#30363d] bg-[#161b22] p-5">
        <h2 className="text-lg font-semibold">运行状态</h2>
        <p className="mt-3 text-sm text-gray-400">尚未加载。</p>
      </section>
    );
  }

  const warnings = readiness.warnings || [];

  return (
    <section className="rounded-md border border-[#30363d] bg-[#161b22] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">运行状态</h2>
        <span
          data-testid={FRONTEND_TEST_IDS.opsMode}
          className={`rounded-md border px-3 py-1 text-sm font-semibold ${toneForMode(
            readiness.summary.mode
          )}`}
        >
          {readiness.summary.mode}
        </span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <Metric label="可 live 运行" value={readiness.summary.readyForLiveOperations} />
        <Metric label="告警数量" value={readiness.summary.warningCount} />
        <Metric label="生成时间" value={new Date(readiness.generatedAt).toLocaleString("zh-CN")} />
      </div>

      <div
        data-testid={FRONTEND_TEST_IDS.opsReadyForLive}
        className="mt-4 grid gap-5 lg:grid-cols-3"
      >
        <div>
          <h3 className="mb-2 text-sm font-semibold text-gray-200">入金扫描</h3>
          <BooleanRow label="端点" value={readiness.depositScan.endpointEnabled} />
          <BooleanRow label="定时扫描" value={readiness.depositScan.cronEnabled} />
          <BooleanRow
            label="扫描后进货"
            value={readiness.depositScan.processProviderJobs}
          />
          <BooleanRow
            label="扫描后出款"
            value={readiness.depositScan.processExchangePayouts}
          />
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold text-gray-200">能量进货</h3>
          <BooleanRow label="live 模式" value={readiness.provider.live} />
          <BooleanRow
            label="APITRX key"
            value={readiness.provider.apitrxApiKeyConfigured}
          />
          <BooleanRow label="端点" value={readiness.provider.endpointEnabled} />
          <BooleanRow label="定时处理" value={readiness.provider.cronEnabled} />
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold text-gray-200">兑换出款</h3>
          <BooleanRow label="live 模式" value={readiness.exchangePayout.live} />
          <BooleanRow
            label="热钱包私钥"
            value={readiness.exchangePayout.privateKeyConfigured}
          />
          <BooleanRow label="端点" value={readiness.exchangePayout.endpointEnabled} />
          <BooleanRow label="定时处理" value={readiness.exchangePayout.cronEnabled} />
        </div>
      </div>

      <div data-testid={FRONTEND_TEST_IDS.opsWarnings} className="mt-5">
        <h3 className="mb-2 text-sm font-semibold text-gray-200">告警</h3>
        {warnings.length === 0 ? (
          <div className="rounded-md border border-[#30363d] bg-[#0d1117] p-3 text-sm text-gray-400">
            无告警。
          </div>
        ) : (
          <div className="space-y-2">
            {warnings.map((warning) => (
              <div
                key={`${warning.code}-${warning.message}`}
                className={`rounded-md border p-3 text-sm ${
                  warning.severity === "error"
                    ? "border-red-800 bg-red-950/50 text-red-100"
                    : "border-orange-800 bg-orange-950/40 text-orange-100"
                }`}
              >
                <div className="font-mono text-xs">{warning.code}</div>
                <div className="mt-1">{warning.message}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function BacklogPanel({ backlog }: { backlog: OpsBacklogSnapshot | null }) {
  if (!backlog) {
    return (
      <section className="rounded-md border border-[#30363d] bg-[#161b22] p-5">
        <h2 className="text-lg font-semibold">自动化队列</h2>
        <p className="mt-3 text-sm text-gray-400">尚未加载。</p>
      </section>
    );
  }

  const summary = backlog.summary;

  return (
    <section className="rounded-md border border-[#30363d] bg-[#161b22] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">自动化队列</h2>
        <span className="text-sm text-gray-400">
          stale &gt; {backlog.staleOlderThanMinutes} 分钟
        </span>
      </div>
      <div
        data-testid={FRONTEND_TEST_IDS.opsBacklogSummary}
        className="mt-4 grid gap-3 md:grid-cols-3"
      >
        <Metric label="可处理队列" value={summary.drainableCount} />
        <Metric label="需人工核查" value={summary.manualReviewCount} />
        <Metric label="过久处理中" value={summary.staleProcessingCount} />
        <Metric label="不确定订单" value={summary.indeterminateOrderCount} />
        <Metric label="活跃 job" value={summary.activeJobCount} />
        <Metric label="失败/不确定 job" value={summary.failedOrIndeterminateJobCount} />
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold text-gray-200">能量进货</h3>
          <Metric label="paid 待进货" value={backlog.provider.orders.drainable.paid} />
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold text-gray-200">兑换出款</h3>
          <Metric
            label="funds_received 待出款"
            value={backlog.exchangePayout.orders.drainable.fundsReceived}
          />
        </div>
      </div>
    </section>
  );
}

function ActionSummaryView({ summary }: { summary: OpsActionSummary | null }) {
  if (!summary) return null;

  return (
    <div
      data-testid={FRONTEND_TEST_IDS.opsActionResult}
      className="rounded-md border border-green-800 bg-green-950/40 p-4 text-sm text-green-100"
    >
      <div className="font-semibold">{ACTION_LABELS[summary.action]}完成</div>
      <div className="mt-2 grid gap-2 md:grid-cols-3">
        <span>count: {summary.count}</span>
        {summary.scanned !== undefined && <span>scanned: {summary.scanned}</span>}
        {summary.stored !== undefined && <span>stored: {summary.stored}</span>}
        {summary.matched !== undefined && <span>matched: {summary.matched}</span>}
        {summary.warningCount !== undefined && (
          <span>warnings: {summary.warningCount}</span>
        )}
        {summary.truncated !== undefined && (
          <span>truncated: {String(summary.truncated)}</span>
        )}
      </div>
      {summary.action === "scan" && (
        <div className="mt-2 text-xs text-green-200">
          post-match provider: {String(summary.providerTriggered)} / exchange:{" "}
          {String(summary.exchangeTriggered)}
        </div>
      )}
    </div>
  );
}

export default function OpsPage() {
  const [adminToken, setAdminToken] = useState("");
  const [readiness, setReadiness] = useState<OpsReadinessReport | null>(null);
  const [backlog, setBacklog] = useState<OpsBacklogSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeAction, setActiveAction] = useState<OpsAction | null>(null);
  const [confirmActions, setConfirmActions] = useState(false);
  const [actionSummary, setActionSummary] = useState<OpsActionSummary | null>(
    null
  );

  const tokenReady = adminToken.trim().length > 0;
  const mode = readiness?.summary.mode || "unknown";
  const actionDisabled = !tokenReady || !confirmActions || Boolean(activeAction);

  const actionModeText = useMemo(() => {
    if (mode === "live") {
      return "当前是 live，drain 按后端 live gate 可能真实进货或出款。";
    }
    if (mode === "partial-live") {
      return "当前是 partial-live，drain 会按已开启的 live gate 执行。";
    }
    return "当前是 dry-run，drain 不会触发真实进货或出款。";
  }, [mode]);

  const loadOpsStatus = async () => {
    if (!tokenReady) {
      setError("请输入管理员 token。");
      return;
    }

    try {
      setIsLoading(true);
      setError(null);
      const [nextReadiness, nextBacklog] = await Promise.all([
        fetchOpsReadiness(adminToken.trim()),
        fetchOpsBacklog(adminToken.trim()),
      ]);
      setReadiness(nextReadiness);
      setBacklog(nextBacklog);
      setActionSummary(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载失败。");
    } finally {
      setIsLoading(false);
    }
  };

  const runAction = async (action: OpsAction) => {
    if (actionDisabled) return;

    try {
      setActiveAction(action);
      setError(null);
      const token = adminToken.trim();
      const summary =
        action === "scan"
          ? await scanOpsDeposits(token)
          : action === "provider-drain"
          ? await drainOpsProvider(token)
          : await drainOpsExchange(token);
      setActionSummary(summary);
      const [nextReadiness, nextBacklog] = await Promise.all([
        fetchOpsReadiness(token),
        fetchOpsBacklog(token),
      ]);
      setReadiness(nextReadiness);
      setBacklog(nextBacklog);
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "操作失败。");
    } finally {
      setActiveAction(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#0d1117] text-white">
      <header className="border-b border-[#30363d] bg-[#161b22] px-6 py-5">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <div>
            <Link href="/" className="text-sm text-gray-400 hover:text-white">
              TronRent
            </Link>
            <h1 className="mt-1 text-2xl font-bold">运营控制台</h1>
          </div>
          <span className={`rounded-md border px-3 py-2 text-sm ${toneForMode(mode)}`}>
            mode: {mode}
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6">
        <section className="mb-6 rounded-md border border-[#30363d] bg-[#161b22] p-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div>
              <label className="mb-2 block text-sm text-gray-300">
                管理员 token
              </label>
              <input
                data-testid={FRONTEND_TEST_IDS.opsTokenInput}
                type="password"
                value={adminToken}
                onChange={(event) => setAdminToken(event.target.value)}
                className="w-full rounded-md border border-[#30363d] bg-[#0d1117] px-3 py-3 font-mono text-sm outline-none focus:border-[#f05e23]"
                autoComplete="off"
              />
            </div>
            <button
              data-testid={FRONTEND_TEST_IDS.opsLoadStatus}
              type="button"
              onClick={loadOpsStatus}
              disabled={!tokenReady || isLoading}
              className={`flex items-center justify-center gap-2 rounded-md px-5 py-3 text-sm font-medium ${
                !tokenReady || isLoading
                  ? "bg-gray-600 cursor-not-allowed"
                  : "bg-[#c23631] hover:bg-[#f05e23]"
              }`}
            >
              <FaEye />
              {isLoading ? "加载中..." : "加载状态"}
            </button>
          </div>
          <label
            data-testid={FRONTEND_TEST_IDS.opsConfirmActions}
            className="mt-4 flex items-start gap-3 text-sm text-gray-300"
          >
            <input
              type="checkbox"
              checked={confirmActions}
              onChange={(event) => setConfirmActions(event.target.checked)}
              className="mt-1"
            />
            <span>{actionModeText}</span>
          </label>
          {error && (
            <div
              data-testid={FRONTEND_TEST_IDS.opsError}
              className="mt-4 rounded-md border border-red-800 bg-red-950/50 p-3 text-sm text-red-100"
            >
              {error}
            </div>
          )}
        </section>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
          <ReadinessPanel readiness={readiness} />
          <div className="space-y-6">
            <BacklogPanel backlog={backlog} />
            <section className="rounded-md border border-[#30363d] bg-[#161b22] p-5">
              <h2 className="text-lg font-semibold">手动触发</h2>
              <div className="mt-4 grid gap-3">
                <button
                  data-testid={FRONTEND_TEST_IDS.opsScanDeposits}
                  type="button"
                  onClick={() => runAction("scan")}
                  disabled={actionDisabled}
                  className={`flex items-center justify-center gap-2 rounded-md px-4 py-3 text-sm font-medium ${
                    actionDisabled
                      ? "bg-gray-600 cursor-not-allowed"
                      : "bg-[#2d3748] hover:bg-[#4a5568]"
                  }`}
                >
                  <FaDatabase />
                  {activeAction === "scan" ? "扫描中..." : "扫描入金"}
                </button>
                <button
                  data-testid={FRONTEND_TEST_IDS.opsDrainProvider}
                  type="button"
                  onClick={() => runAction("provider-drain")}
                  disabled={actionDisabled}
                  className={`flex items-center justify-center gap-2 rounded-md px-4 py-3 text-sm font-medium ${
                    actionDisabled
                      ? "bg-gray-600 cursor-not-allowed"
                      : "bg-[#2d3748] hover:bg-[#4a5568]"
                  }`}
                >
                  <FaBolt />
                  {activeAction === "provider-drain"
                    ? "处理中..."
                    : "处理能量进货队列"}
                </button>
                <button
                  data-testid={FRONTEND_TEST_IDS.opsDrainExchange}
                  type="button"
                  onClick={() => runAction("exchange-drain")}
                  disabled={actionDisabled}
                  className={`flex items-center justify-center gap-2 rounded-md px-4 py-3 text-sm font-medium ${
                    actionDisabled
                      ? "bg-gray-600 cursor-not-allowed"
                      : "bg-[#2d3748] hover:bg-[#4a5568]"
                  }`}
                >
                  <FaArrowsRotate />
                  {activeAction === "exchange-drain"
                    ? "处理中..."
                    : "处理兑换出款队列"}
                </button>
              </div>
              <div className="mt-4 rounded-md border border-orange-800 bg-orange-950/40 p-3 text-xs text-orange-100">
                <div className="flex items-center gap-2 font-semibold">
                  <FaCircleExclamation />
                  操作只显示摘要
                </div>
                <p className="mt-2">
                  页面不会渲染动作返回的原始订单、地址、txid 或上游响应字段。
                </p>
              </div>
              <div className="mt-4">
                <ActionSummaryView summary={actionSummary} />
              </div>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}
