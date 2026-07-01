"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { FaCheck, FaCopy, FaWallet } from "react-icons/fa6";
import { useWallet } from "@/app/providers/WalletProvider";
import InstructionRow from "@/components/InstructionRow";
import {
  ProofPollingError,
  ProofRefreshButton,
  ProofSelectorRegion,
} from "@/components/ProofSelectors";
import RecentOrdersPanel from "@/components/RecentOrdersPanel";
import StatusTimeline, { StatusPill } from "@/components/StatusTimeline";
import WalletButton from "@/components/WalletButton";
import {
  EnergyPlan,
  PaymentMethod,
  TronRentOrder,
  createEnergyOrder,
  fetchEnergyPlans,
  getEnergyOrder,
} from "@/lib/tronrentApi";
import {
  buildEnergyOrderTimeline,
  getEnergyOrderStatusMeta,
  shouldPollEnergyOrder,
} from "@/lib/orderStatus";
import {
  clearRecentOrders,
  extractOrderIdFromSearch,
  forgetRecentOrder,
  normalizeOrderId,
  readRecentOrders,
  rememberEnergyOrder,
  replaceOrderIdInUrl,
} from "@/lib/orderRecovery";
import type { RecentOrderEntry } from "@/lib/orderRecovery";
import { FRONTEND_TEST_IDS } from "@/lib/testIds";
import { sendWalletTrxPayment } from "@/lib/walletPayment";

function formatDuration(hours: number) {
  if (hours % 24 === 0) {
    return `${hours / 24}天`;
  }
  return `${hours}小时`;
}

function formatEnergy(energyAmount: number) {
  return energyAmount.toLocaleString("zh-CN");
}

export default function RentPage() {
  const { address, isConnected, connect, tronWeb } = useWallet();
  const [plans, setPlans] = useState<EnergyPlan[]>([]);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] =
    useState<PaymentMethod>("wallet_connect");
  const [targetAddress, setTargetAddress] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [createdOrder, setCreatedOrder] = useState<TronRentOrder | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [walletPaymentState, setWalletPaymentState] = useState<
    "idle" | "broadcasting" | "broadcasted"
  >("idle");
  const [walletPaymentTxId, setWalletPaymentTxId] = useState<string | null>(
    null
  );
  const [walletPaymentError, setWalletPaymentError] = useState<string | null>(
    null
  );
  const [pollingError, setPollingError] = useState<string | null>(null);
  const [isRefreshingOrder, setIsRefreshingOrder] = useState(false);
  const [recentOrders, setRecentOrders] = useState<RecentOrderEntry[]>([]);
  const [recoveryOrderId, setRecoveryOrderId] = useState("");
  const [isRecoveringOrder, setIsRecoveringOrder] = useState(false);
  const [recoveryOrderError, setRecoveryOrderError] = useState<string | null>(
    null
  );
  const walletPaymentBroadcastRef = useRef(false);
  const hydratedOrderRef = useRef(false);
  const createdOrderId = createdOrder?.id;
  const createdOrderStatus = createdOrder?.status;

  const resetWalletPaymentTracking = useCallback(() => {
    setWalletPaymentState("idle");
    setWalletPaymentTxId(null);
    setWalletPaymentError(null);
    walletPaymentBroadcastRef.current = false;
  }, []);

  const rememberLoadedOrder = useCallback((order: TronRentOrder) => {
    setRecentOrders(rememberEnergyOrder(order));
    setRecoveryOrderId(order.id);
    replaceOrderIdInUrl(order.id);
  }, []);

  const handleLoadRecoveredOrder = useCallback(
    async (orderId: string) => {
      const normalizedOrderId = normalizeOrderId(orderId);
      if (!normalizedOrderId) {
        setRecoveryOrderError("请输入有效订单号。");
        return;
      }

      try {
        setIsRecoveringOrder(true);
        setRecoveryOrderError(null);
        const order = await getEnergyOrder(normalizedOrderId);
        setCreatedOrder(order);
        rememberLoadedOrder(order);
        resetWalletPaymentTracking();
        setPollingError(null);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "订单加载失败。";
        setRecoveryOrderError(
          message.toLowerCase().includes("not found")
            ? "未找到这个订单。"
            : message
        );
      } finally {
        setIsRecoveringOrder(false);
      }
    },
    [rememberLoadedOrder, resetWalletPaymentTracking]
  );

  useEffect(() => {
    let isMounted = true;

    fetchEnergyPlans()
      .then((serverPlans) => {
        if (!isMounted) return;
        setPlans(serverPlans);
        setPlansError(null);
        setSelectedPlan((current) => current || serverPlans[0]?.id || null);
      })
      .catch((error) => {
        if (!isMounted) return;
        setPlansError(error.message);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    setRecentOrders(readRecentOrders("energy"));

    if (hydratedOrderRef.current) {
      return;
    }

    const orderId = extractOrderIdFromSearch(window.location.search);
    if (!orderId) {
      return;
    }

    hydratedOrderRef.current = true;
    setRecoveryOrderId(orderId);
    void handleLoadRecoveredOrder(orderId);
  }, [handleLoadRecoveredOrder]);

  useEffect(() => {
    if (address && !targetAddress) {
      setTargetAddress(address);
    }
  }, [address, targetAddress]);

  useEffect(() => {
    if (!createdOrderId || !shouldPollEnergyOrder(createdOrderStatus)) {
      return;
    }

    let isMounted = true;
    const pollOrder = async () => {
      try {
        const order = await getEnergyOrder(createdOrderId);
        if (!isMounted) return;
        setCreatedOrder(order);
        setRecentOrders(rememberEnergyOrder(order));
        setPollingError(null);
      } catch (error) {
        if (!isMounted) return;
        setPollingError(
          error instanceof Error ? error.message : "订单状态刷新失败。"
        );
      }
    };

    void pollOrder();
    const interval = window.setInterval(pollOrder, 5000);
    return () => {
      isMounted = false;
      window.clearInterval(interval);
    };
  }, [createdOrderId, createdOrderStatus]);

  const activePlan = useMemo(
    () => plans.find((plan) => plan.id === selectedPlan) || null,
    [plans, selectedPlan]
  );

  const copyText = async (field: string, value: string | null) => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopiedField(field);
    window.setTimeout(() => setCopiedField(null), 1200);
  };

  const handleRefreshOrderStatus = async () => {
    if (!createdOrderId) return;

    try {
      setIsRefreshingOrder(true);
      const order = await getEnergyOrder(createdOrderId);
      setCreatedOrder(order);
      setRecentOrders(rememberEnergyOrder(order));
      setPollingError(null);
    } catch (error) {
      setPollingError(
        error instanceof Error ? error.message : "订单状态刷新失败。"
      );
    } finally {
      setIsRefreshingOrder(false);
    }
  };

  const handleRentSubmit = async () => {
    if (!selectedPlan) {
      setSubmitError("请选择租赁套餐。");
      return;
    }

    if (!targetAddress.trim()) {
      setSubmitError("请输入接收能量的 Tron 地址。");
      return;
    }

    if (paymentMethod === "wallet_connect" && !isConnected) {
      await connect();
      return;
    }

    try {
      setIsProcessing(true);
      setSubmitError(null);

      const order = await createEnergyOrder({
        planId: selectedPlan,
        targetAddress: targetAddress.trim(),
        customerWalletAddress: address,
        paymentMethod,
      });

      setCreatedOrder(order);
      rememberLoadedOrder(order);
      resetWalletPaymentTracking();
      setPollingError(null);
      setRecoveryOrderError(null);
      walletPaymentBroadcastRef.current = false;
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : "创建订单失败，请稍后再试。"
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const handleWalletPayment = async () => {
    if (!createdOrder) return;

    if (walletPaymentBroadcastRef.current || walletPaymentState !== "idle") {
      return;
    }

    if (!isConnected) {
      await connect();
      return;
    }

    try {
      walletPaymentBroadcastRef.current = true;
      setWalletPaymentState("broadcasting");
      setWalletPaymentError(null);

      const result = await sendWalletTrxPayment({
        tronWeb,
        connectedAddress: address,
        order: createdOrder,
        expectedNetwork: process.env.NEXT_PUBLIC_TRON_NETWORK || "mainnet",
      });

      setWalletPaymentTxId(result.txid);
      setWalletPaymentState("broadcasted");

      try {
        const order = await getEnergyOrder(createdOrder.id);
        setCreatedOrder(order);
      } catch (_error) {
        // The interval poll remains the source of truth after broadcast.
      }
    } catch (error) {
      walletPaymentBroadcastRef.current = false;
      setWalletPaymentState("idle");
      setWalletPaymentError(
        error instanceof Error ? error.message : "钱包付款提交失败。"
      );
    }
  };

  const canShowWalletPaymentButton =
    createdOrder?.paymentMethod === "wallet_connect" &&
    createdOrder.status === "pending_payment";
  const orderStatusMeta = createdOrder
    ? getEnergyOrderStatusMeta(createdOrder.status)
    : null;
  const orderTimeline = createdOrder
    ? buildEnergyOrderTimeline(createdOrder.status)
    : [];
  const latestPayment = createdOrder?.payments?.[0] || null;
  const latestProviderJob = createdOrder?.providerJobs?.[0] || null;
  const providerEvidence =
    latestProviderJob?.response?.manualResolution?.upstreamOrderId ||
    latestProviderJob?.upstreamOrderId ||
    latestProviderJob?.response?.upstreamOrderId ||
    null;
  const providerMode =
    latestProviderJob && latestProviderJob.dryRun !== undefined
      ? latestProviderJob.dryRun
        ? "模拟进货"
        : "真实进货"
      : createdOrder?.paymentInstructions.executionMode?.providerLive === false
      ? "后台进货未启用"
      : createdOrder?.paymentInstructions.executionMode?.providerLive === true
      ? "等待付款确认后真实进货"
      : "等待付款确认后执行";

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-[#0d1117] to-[#161b22] text-white">
      <header className="py-6 px-8 flex justify-between items-center border-b border-[#30363d]">
        <Link href="/">
          <div className="flex items-center gap-2 cursor-pointer">
            <Image
              src="/tron-logo.svg"
              alt="TronRent Logo"
              width={40}
              height={40}
              className="rounded-full bg-[#c23631]"
            />
            <h1 className="text-2xl font-bold bg-gradient-to-r from-[#c23631] to-[#f05e23] text-transparent bg-clip-text">
              TronRent
            </h1>
          </div>
        </Link>
        <nav>
          <ul className="flex gap-6">
            <li>
              <Link href="/" className="hover:text-[#f05e23] transition-colors">
                首页
              </Link>
            </li>
            <li>
              <Link href="/rent" className="text-[#f05e23] transition-colors">
                租赁能量
              </Link>
            </li>
            <li>
              <Link
                href="/exchange"
                className="hover:text-[#f05e23] transition-colors"
              >
                兑换
              </Link>
            </li>
          </ul>
        </nav>
        <WalletButton />
      </header>

      <main className="flex-grow p-8">
        <div className="max-w-6xl mx-auto">
          <div className="mb-8 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-3xl font-bold">租赁 Tron 能量</h2>
              <p className="text-gray-300 mt-2">
                选择套餐后生成订单和付款指引；链上确认后系统按后台安全开关自动进货。
              </p>
            </div>
            <div className="rounded-md border border-[#30363d] px-4 py-3 text-sm text-gray-300">
              API: {plansError ? "未连接" : "已连接"}
            </div>
          </div>

          {plansError && (
            <div className="mb-8 rounded-md border border-[#f05e23] bg-[#1e2430] p-4 text-sm text-orange-200">
              后端套餐接口暂不可用：{plansError}
            </div>
          )}

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
            <section>
              <h3 className="text-2xl font-bold mb-6">选择租赁计划</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {plans.map((plan) => (
                  <button
                    key={plan.id}
                    type="button"
                    className={`bg-[#161b22] p-6 rounded-lg border text-left ${
                      selectedPlan === plan.id
                        ? "border-[#f05e23]"
                        : plan.isPopular
                        ? "border-[#c23631]"
                        : "border-[#30363d]"
                    } flex min-h-[300px] flex-col relative transition-all hover:shadow-lg`}
                    onClick={() => setSelectedPlan(plan.id)}
                  >
                    {plan.isPopular && (
                      <span className="absolute -top-3 left-6 bg-[#c23631] px-3 py-1 rounded-full text-xs font-bold">
                        最受欢迎
                      </span>
                    )}
                    <span className="text-xl font-bold mb-2">{plan.name}</span>
                    <span className="text-gray-300 mb-6">
                      {plan.description}
                    </span>
                    <span className="text-4xl font-bold mb-6">
                      {plan.priceDisplay}
                    </span>
                    <span className="flex items-center gap-2 mb-2 text-sm">
                      <FaCheck className="text-green-500" />
                      {formatEnergy(plan.energyAmount)} 能量
                    </span>
                    <span className="flex items-center gap-2 mb-2 text-sm">
                      <FaCheck className="text-green-500" />
                      {formatDuration(plan.durationHours)}租赁期
                    </span>
                    <span className="flex items-center gap-2 text-sm">
                      <FaCheck className="text-green-500" />
                      {plan.support}
                    </span>
                    <span
                      className={`mt-auto h-2 w-full rounded-full ${
                        selectedPlan === plan.id
                          ? "bg-[#f05e23]"
                          : "bg-transparent"
                      }`}
                    />
                  </button>
                ))}
              </div>
            </section>

            <aside className="rounded-lg border border-[#30363d] bg-[#161b22] p-6">
              <h3 className="text-xl font-bold mb-5">订单草稿</h3>

              <label className="block text-sm text-gray-300 mb-2">
                接收能量地址
              </label>
              <input
                value={targetAddress}
                onChange={(event) => setTargetAddress(event.target.value)}
                placeholder="T..."
                className="mb-5 w-full rounded-md border border-[#30363d] bg-[#0d1117] px-3 py-3 font-mono text-sm outline-none focus:border-[#f05e23]"
              />

              <div className="mb-5">
                <div className="mb-2 text-sm text-gray-300">付款方式</div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPaymentMethod("wallet_connect")}
                    className={`rounded-md border px-3 py-3 text-sm ${
                      paymentMethod === "wallet_connect"
                        ? "border-[#f05e23] bg-[#2a1b19]"
                        : "border-[#30363d] bg-[#0d1117]"
                    }`}
                  >
                    <FaWallet className="mx-auto mb-2" />
                    钱包付款
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMethod("deposit_address")}
                    className={`rounded-md border px-3 py-3 text-sm ${
                      paymentMethod === "deposit_address"
                        ? "border-[#f05e23] bg-[#2a1b19]"
                        : "border-[#30363d] bg-[#0d1117]"
                    }`}
                  >
                    <FaCopy className="mx-auto mb-2" />
                    地址转账
                  </button>
                </div>
              </div>

              <div className="mb-5 rounded-md border border-[#30363d] bg-[#0d1117] p-4 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-gray-400">当前套餐</span>
                  <span className="text-right font-semibold">
                    {activePlan ? activePlan.name : "未选择"}
                  </span>
                </div>
                <div className="mt-2 flex justify-between gap-4">
                  <span className="text-gray-400">应付金额</span>
                  <span className="text-right font-semibold">
                    {activePlan ? activePlan.priceDisplay : "-"}
                  </span>
                </div>
              </div>

              {submitError && (
                <div className="mb-5 rounded-md border border-red-700 bg-red-950/60 p-3 text-sm text-red-100">
                  {submitError}
                </div>
              )}

              <button
                type="button"
                onClick={handleRentSubmit}
                data-testid={FRONTEND_TEST_IDS.rentCreateOrderCta}
                disabled={isProcessing || plans.length === 0}
                className={`w-full rounded-md px-5 py-4 font-medium transition-colors ${
                  isProcessing || plans.length === 0
                    ? "bg-gray-600 cursor-not-allowed"
                    : "bg-[#c23631] hover:bg-[#f05e23]"
                }`}
              >
                {isProcessing
                  ? "创建订单中..."
                  : paymentMethod === "wallet_connect" && !isConnected
                  ? "连接钱包"
                  : "创建订单"}
              </button>

              <RecentOrdersPanel
                orderId={recoveryOrderId}
                recentOrders={recentOrders}
                isLoading={isRecoveringOrder}
                error={recoveryOrderError}
                onOrderIdChange={setRecoveryOrderId}
                onLoad={handleLoadRecoveredOrder}
                onForget={(orderId) =>
                  setRecentOrders(forgetRecentOrder("energy", orderId))
                }
                onClear={() => setRecentOrders(clearRecentOrders("energy"))}
              />

              {createdOrder && (
                <ProofSelectorRegion
                  className="mt-6 border-t border-[#30363d] pt-5"
                  testId={FRONTEND_TEST_IDS.rentPaymentInstructions}
                >
                  <div className="mb-3 flex items-center justify-between gap-4">
                    <h4 className="font-bold">付款指引</h4>
                    {orderStatusMeta && (
                      <ProofSelectorRegion testId={FRONTEND_TEST_IDS.rentOrderStatus}>
                        <StatusPill
                          label={orderStatusMeta.label}
                          tone={orderStatusMeta.tone}
                        />
                      </ProofSelectorRegion>
                    )}
                  </div>
                  {orderStatusMeta && (
                    <div className="mb-4 rounded-md border border-[#30363d] bg-[#0d1117] p-4">
                      <div className="text-sm text-gray-200">
                        {orderStatusMeta.description}
                      </div>
                      <StatusTimeline steps={orderTimeline} />
                    </div>
                  )}
                  <ProofRefreshButton
                    onClick={handleRefreshOrderStatus}
                    isRefreshing={isRefreshingOrder}
                    testId={FRONTEND_TEST_IDS.rentRefreshStatus}
                    className={`mb-4 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                      isRefreshingOrder
                        ? "bg-gray-600 cursor-not-allowed"
                        : "bg-[#2d3748] hover:bg-[#4a5568]"
                    }`}
                  />
                  <ProofSelectorRegion testId={FRONTEND_TEST_IDS.rentOrderId}>
                    <InstructionRow
                      label="订单号"
                      value={createdOrder.id}
                      copied={copiedField === "order"}
                      onCopy={() => copyText("order", createdOrder.id)}
                    />
                  </ProofSelectorRegion>
                  <InstructionRow
                    label="金额"
                    value={createdOrder.paymentInstructions.amountDisplay}
                    copied={copiedField === "amount"}
                    onCopy={() =>
                      copyText(
                        "amount",
                        createdOrder.paymentInstructions.amountDisplay
                      )
                    }
                  />
                  <InstructionRow
                    label="收款地址"
                    value={createdOrder.paymentInstructions.address || "未配置"}
                    copied={copiedField === "address"}
                    onCopy={() =>
                      copyText(
                        "address",
                        createdOrder.paymentInstructions.address
                      )
                    }
                  />
                  <InstructionRow
                    label="付款备注"
                    value={createdOrder.paymentReference}
                    copied={copiedField === "reference"}
                    onCopy={() =>
                      copyText("reference", createdOrder.paymentReference)
                    }
                  />
                  {latestPayment?.status && (
                    <InstructionRow label="付款状态" value={latestPayment.status} />
                  )}
                  {latestPayment?.txHash && (
                    <InstructionRow
                      label="入金交易"
                      value={latestPayment.txHash}
                      copied={copiedField === "paymentTx"}
                      onCopy={() => copyText("paymentTx", latestPayment.txHash)}
                    />
                  )}
                  {latestProviderJob?.status && (
                    <InstructionRow
                      label="进货状态"
                      value={`${latestProviderJob.status} / ${providerMode}`}
                    />
                  )}
                  {providerEvidence && (
                    <InstructionRow
                      label="上游订单"
                      value={providerEvidence}
                      copied={copiedField === "providerEvidence"}
                      onCopy={() =>
                        copyText("providerEvidence", providerEvidence)
                      }
                    />
                  )}
                  {createdOrder.paymentInstructions.warnings.map((warning) => (
                    <p key={warning} className="mt-3 text-xs text-orange-200">
                      {warning}
                    </p>
                  ))}
                  {canShowWalletPaymentButton && (
                    <div className="mt-5 rounded-md border border-[#30363d] bg-[#0d1117] p-4">
                      <button
                        type="button"
                        onClick={handleWalletPayment}
                        data-testid={FRONTEND_TEST_IDS.rentWalletPaymentCta}
                        disabled={walletPaymentState !== "idle"}
                        className={`w-full rounded-md px-4 py-3 text-sm font-medium transition-colors ${
                          walletPaymentState === "idle"
                            ? "bg-[#c23631] hover:bg-[#f05e23]"
                            : "bg-gray-600 cursor-not-allowed"
                        }`}
                      >
                        {walletPaymentState === "broadcasting"
                          ? "等待钱包确认..."
                          : walletPaymentState === "broadcasted"
                          ? "已提交，等待链上确认"
                          : "用当前钱包付款"}
                      </button>
                      <p className="mt-3 text-xs text-gray-300">
                        钱包只负责发起 TRX 转账，订单是否付款以链上扫描结果为准。
                      </p>
                      {walletPaymentTxId && (
                        <ProofSelectorRegion
                          testId={FRONTEND_TEST_IDS.rentWalletPaymentTxid}
                        >
                          <InstructionRow
                            label="交易哈希"
                            value={walletPaymentTxId}
                            copied={copiedField === "txid"}
                            onCopy={() => copyText("txid", walletPaymentTxId)}
                          />
                        </ProofSelectorRegion>
                      )}
                      {walletPaymentError && (
                        <p className="mt-3 text-xs text-red-200">
                          {walletPaymentError}
                        </p>
                      )}
                    </div>
                  )}
                  <ProofPollingError
                    className="mt-3 text-xs text-orange-200"
                    message={pollingError}
                    testId={FRONTEND_TEST_IDS.rentPollingError}
                  />
                </ProofSelectorRegion>
              )}
            </aside>
          </div>
        </div>
      </main>

      <footer className="py-6 px-8 border-t border-[#30363d] bg-[#0d1117]">
        <div className="max-w-6xl mx-auto text-center text-gray-400">
          <p>&copy; 2026 TronRent. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
