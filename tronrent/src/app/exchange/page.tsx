"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { FaArrowRightArrowLeft, FaRotate } from "react-icons/fa6";
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
  ExchangeDirection,
  ExchangeOrder,
  ExchangeQuote,
  createExchangeOrder,
  createExchangeQuote,
  getExchangeOrder,
} from "@/lib/tronrentApi";
import {
  buildExchangeOrderTimeline,
  getExchangeOrderStatusMeta,
  shouldPollExchangeOrder,
} from "@/lib/orderStatus";
import {
  clearRecentOrders,
  extractOrderIdFromSearch,
  forgetRecentOrder,
  normalizeOrderId,
  readRecentOrders,
  rememberExchangeOrder,
  replaceOrderIdInUrl,
} from "@/lib/orderRecovery";
import type { RecentOrderEntry } from "@/lib/orderRecovery";
import { FRONTEND_TEST_IDS } from "@/lib/testIds";
import { sendExchangeWalletDeposit } from "@/lib/walletPayment";

function makeIdempotencyKey() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function directionLabel(direction: ExchangeDirection) {
  return direction === "TRX_TO_USDT" ? "TRX -> USDT" : "USDT -> TRX";
}

function getInputAsset(direction: ExchangeDirection) {
  return direction === "TRX_TO_USDT" ? "TRX" : "USDT";
}

function getOutputAsset(direction: ExchangeDirection) {
  return direction === "TRX_TO_USDT" ? "USDT" : "TRX";
}

function formatSeconds(seconds: number) {
  if (seconds <= 0) return "已过期";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes <= 0) return `${remainingSeconds}s`;
  return `${minutes}分${remainingSeconds.toString().padStart(2, "0")}秒`;
}

function splitEnvList(value: string | undefined) {
  return (value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function exchangeDepositStorageKey(orderId: string) {
  return `tronrent:exchange-deposit-tx:${orderId}`;
}

export default function ExchangePage() {
  const { address, connect, isConnected, tronWeb } = useWallet();
  const [direction, setDirection] = useState<ExchangeDirection>("TRX_TO_USDT");
  const [inputAmount, setInputAmount] = useState("100");
  const [outputAddress, setOutputAddress] = useState("");
  const [quote, setQuote] = useState<ExchangeQuote | null>(null);
  const [quoteKey, setQuoteKey] = useState<string | null>(null);
  const [createdOrder, setCreatedOrder] = useState<ExchangeOrder | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [isQuoting, setIsQuoting] = useState(false);
  const [isCreatingOrder, setIsCreatingOrder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [walletDepositState, setWalletDepositState] = useState<
    "idle" | "broadcasting" | "broadcasted"
  >("idle");
  const [walletDepositTxId, setWalletDepositTxId] = useState<string | null>(
    null
  );
  const [walletDepositError, setWalletDepositError] = useState<string | null>(
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
  const walletDepositBroadcastRef = useRef(false);
  const hydratedOrderRef = useRef(false);
  const createdOrderId = createdOrder?.id;
  const createdOrderStatus = createdOrder?.status;

  const resetWalletDepositTracking = useCallback(() => {
    walletDepositBroadcastRef.current = false;
    setWalletDepositState("idle");
    setWalletDepositTxId(null);
    setWalletDepositError(null);
  }, []);

  const rememberLoadedOrder = useCallback((order: ExchangeOrder) => {
    setRecentOrders(rememberExchangeOrder(order));
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
        const order = await getExchangeOrder(normalizedOrderId);
        setQuote(null);
        setQuoteKey(null);
        setCreatedOrder(order);
        rememberLoadedOrder(order);
        resetWalletDepositTracking();
        setPollingError(null);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "兑换订单加载失败。";
        setRecoveryOrderError(
          message.toLowerCase().includes("not found")
            ? "未找到这个兑换订单。"
            : message
        );
      } finally {
        setIsRecoveringOrder(false);
      }
    },
    [rememberLoadedOrder, resetWalletDepositTracking]
  );

  useEffect(() => {
    if (address && !outputAddress) {
      setOutputAddress(address);
    }
  }, [address, outputAddress]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    setRecentOrders(readRecentOrders("exchange"));

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
    if (!createdOrderId) {
      walletDepositBroadcastRef.current = false;
      setWalletDepositState("idle");
      setWalletDepositTxId(null);
      setWalletDepositError(null);
      setPollingError(null);
      return;
    }

    const storedTxId = window.localStorage.getItem(
      exchangeDepositStorageKey(createdOrderId)
    );
    if (storedTxId) {
      walletDepositBroadcastRef.current = true;
      setWalletDepositState("broadcasted");
      setWalletDepositTxId(storedTxId);
    } else {
      walletDepositBroadcastRef.current = false;
      setWalletDepositState("idle");
      setWalletDepositTxId(null);
    }
    setWalletDepositError(null);
    setPollingError(null);
  }, [createdOrderId]);

  useEffect(() => {
    if (!createdOrderId || !shouldPollExchangeOrder(createdOrderStatus)) {
      return;
    }

    let isMounted = true;
    const pollOrder = async () => {
      try {
        const order = await getExchangeOrder(createdOrderId);
        if (!isMounted) return;
        setCreatedOrder(order);
        setRecentOrders(rememberExchangeOrder(order));
        setPollingError(null);
      } catch (pollError) {
        if (!isMounted) return;
        setPollingError(
          pollError instanceof Error ? pollError.message : "兑换订单状态刷新失败。"
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

  const secondsRemaining = useMemo(() => {
    if (!quote) return 0;
    return Math.max(0, Math.ceil((new Date(quote.expiresAt).getTime() - now) / 1000));
  }, [now, quote]);

  const quoteExpired = Boolean(quote && secondsRemaining === 0);
  const orderSecondsRemaining = useMemo(() => {
    if (!createdOrder) return 0;
    return Math.max(
      0,
      Math.ceil((new Date(createdOrder.expiresAt).getTime() - now) / 1000)
    );
  }, [createdOrder, now]);
  const orderExpired = Boolean(createdOrder && orderSecondsRemaining === 0);

  const resetQuote = () => {
    setQuote(null);
    setQuoteKey(null);
    setCreatedOrder(null);
    resetWalletDepositTracking();
    setPollingError(null);
    setRecoveryOrderId("");
    setRecoveryOrderError(null);
    replaceOrderIdInUrl(null);
  };

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
      const order = await getExchangeOrder(createdOrderId);
      setCreatedOrder(order);
      setRecentOrders(rememberExchangeOrder(order));
      setPollingError(null);
    } catch (refreshError) {
      setPollingError(
        refreshError instanceof Error
          ? refreshError.message
          : "兑换订单状态刷新失败。"
      );
    } finally {
      setIsRefreshingOrder(false);
    }
  };

  const handleGetQuote = async () => {
    if (!inputAmount.trim()) {
      setError("请输入兑换数量。");
      return;
    }

    try {
      setIsQuoting(true);
      setError(null);
      setCreatedOrder(null);
      replaceOrderIdInUrl(null);
      setRecoveryOrderId("");
      const nextQuote = await createExchangeQuote({
        direction,
        inputAmount: inputAmount.trim(),
      });
      setQuote(nextQuote);
      setQuoteKey(makeIdempotencyKey());
    } catch (quoteError) {
      setError(
        quoteError instanceof Error ? quoteError.message : "创建报价失败。"
      );
    } finally {
      setIsQuoting(false);
    }
  };

  const handleCreateOrder = async () => {
    if (!quote) {
      setError("请先获取报价。");
      return;
    }

    if (quoteExpired) {
      setError("报价已过期，请刷新报价。");
      return;
    }

    if (!outputAddress.trim()) {
      setError("请输入接收地址。");
      return;
    }

    try {
      setIsCreatingOrder(true);
      setError(null);
      const order = await createExchangeOrder({
        quoteId: quote.id,
        outputAddress: outputAddress.trim(),
        customerWalletAddress: address,
        idempotencyKey: quoteKey || makeIdempotencyKey(),
      });
      setCreatedOrder(order);
      rememberLoadedOrder(order);
      resetWalletDepositTracking();
      setPollingError(null);
      setRecoveryOrderError(null);
    } catch (orderError) {
      const message =
        orderError instanceof Error ? orderError.message : "创建兑换订单失败。";
      if (message.includes("expired") || message.includes("used")) {
        setQuote(null);
        setQuoteKey(null);
        setError("报价已失效，请重新获取报价。");
      } else {
        setError(message);
      }
    } finally {
      setIsCreatingOrder(false);
    }
  };

  const changeDirection = (nextDirection: ExchangeDirection) => {
    setDirection(nextDirection);
    resetQuote();
  };

  const handleWalletDeposit = async () => {
    if (!createdOrder) return;

    if (walletDepositBroadcastRef.current || walletDepositState !== "idle") {
      return;
    }

    if (!isConnected) {
      await connect();
      return;
    }

    try {
      walletDepositBroadcastRef.current = true;
      setWalletDepositState("broadcasting");
      setWalletDepositError(null);
      const storageKey = exchangeDepositStorageKey(createdOrder.id);
      window.localStorage.setItem(storageKey, "broadcasting");
      setWalletDepositTxId("broadcasting");

      const result = await sendExchangeWalletDeposit({
        tronWeb,
        connectedAddress: address,
        order: createdOrder,
        expectedNetwork: process.env.NEXT_PUBLIC_TRON_NETWORK || "mainnet",
        allowedTreasuryAddresses: splitEnvList(
          process.env.NEXT_PUBLIC_EXCHANGE_TREASURY_TRON_ADDRESS
        ),
        allowedUsdtContracts: splitEnvList(
          process.env.NEXT_PUBLIC_TRON_USDT_CONTRACT_ADDRESS
        ),
      });

      const depositEvidence = result.txid || "submitted-without-wallet-txid";
      window.localStorage.setItem(storageKey, depositEvidence);
      setWalletDepositTxId(depositEvidence);
      setWalletDepositState("broadcasted");

      try {
        const order = await getExchangeOrder(createdOrder.id);
        setCreatedOrder(order);
      } catch (_error) {
        // Interval polling remains the authority after wallet broadcast.
      }
    } catch (depositError) {
      walletDepositBroadcastRef.current = false;
      window.localStorage.removeItem(exchangeDepositStorageKey(createdOrder.id));
      setWalletDepositState("idle");
      setWalletDepositTxId(null);
      setWalletDepositError(
        depositError instanceof Error ? depositError.message : "钱包入金提交失败。"
      );
    }
  };

  const canShowWalletDepositButton =
    createdOrder?.status === "pending_deposit" && !orderExpired;
  const walletDepositDisplayEvidence =
    walletDepositTxId === "broadcasting" ||
    walletDepositTxId === "submitted-without-wallet-txid"
      ? "已提交（等待链上确认）"
      : walletDepositTxId;
  const exchangeStatusMeta = createdOrder
    ? getExchangeOrderStatusMeta(createdOrder.status)
    : null;
  const exchangeTimeline = createdOrder
    ? buildExchangeOrderTimeline(createdOrder.status)
    : [];
  const latestPayoutJob = createdOrder?.payoutJobs?.[0] || null;
  const payoutEvidence =
    latestPayoutJob?.response?.manualResolution?.txid ||
    latestPayoutJob?.response?.txid ||
    latestPayoutJob?.response?.broadcastResponse?.txid ||
    latestPayoutJob?.txid ||
    null;
  const payoutMode =
    latestPayoutJob && latestPayoutJob.dryRun !== undefined
      ? latestPayoutJob.dryRun
        ? "模拟出款"
        : "真实出款"
      : createdOrder?.depositInstructions.executionMode?.payoutLive === false
      ? "后台出款未启用"
      : createdOrder?.depositInstructions.executionMode?.payoutLive === true
      ? "等待入金确认后真实出款"
      : quote?.metadata?.executionEnabled === false
      ? "后台出款未启用"
      : "等待入金确认后执行";

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
              <Link href="/rent" className="hover:text-[#f05e23] transition-colors">
                租赁能量
              </Link>
            </li>
            <li>
              <Link href="/exchange" className="text-[#f05e23] transition-colors">
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
              <h2 className="text-3xl font-bold">TRX / USDT 兑换</h2>
              <p className="text-gray-300 mt-2">
                报价生成订单后显示精确打款金额；链上确认后系统按后台安全开关自动出款。
              </p>
            </div>
            <div className="rounded-md border border-[#30363d] px-4 py-3 text-sm text-gray-300">
              方向: {directionLabel(direction)}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_400px]">
            <section className="rounded-lg border border-[#30363d] bg-[#161b22] p-6">
              <h3 className="mb-5 flex items-center gap-3 text-xl font-bold">
                <FaArrowRightArrowLeft className="text-[#f05e23]" />
                创建兑换
              </h3>

              <div className="mb-5 grid grid-cols-2 gap-2">
                {(["TRX_TO_USDT", "USDT_TO_TRX"] as ExchangeDirection[]).map(
                  (option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => changeDirection(option)}
                      className={`rounded-md border px-4 py-3 text-sm font-semibold ${
                        direction === option
                          ? "border-[#f05e23] bg-[#2a1b19]"
                          : "border-[#30363d] bg-[#0d1117]"
                      }`}
                    >
                      {directionLabel(option)}
                    </button>
                  )
                )}
              </div>

              <label className="block text-sm text-gray-300 mb-2">
                你支付的数量 ({getInputAsset(direction)})
              </label>
              <input
                value={inputAmount}
                onChange={(event) => {
                  setInputAmount(event.target.value);
                  resetQuote();
                }}
                inputMode="decimal"
                className="mb-5 w-full rounded-md border border-[#30363d] bg-[#0d1117] px-3 py-3 font-mono text-sm outline-none focus:border-[#f05e23]"
              />

              <label className="block text-sm text-gray-300 mb-2">
                接收地址 ({getOutputAsset(direction)})
              </label>
              <input
                value={outputAddress}
                onChange={(event) => setOutputAddress(event.target.value)}
                placeholder="T..."
                className="mb-5 w-full rounded-md border border-[#30363d] bg-[#0d1117] px-3 py-3 font-mono text-sm outline-none focus:border-[#f05e23]"
              />

              <div className="grid gap-3 md:grid-cols-2">
                <button
                  type="button"
                  onClick={createdOrder ? resetQuote : handleGetQuote}
                  disabled={isQuoting || isCreatingOrder}
                  className={`rounded-md px-5 py-4 font-medium transition-colors ${
                    isQuoting || isCreatingOrder
                      ? "bg-gray-600 cursor-not-allowed"
                      : "bg-[#2d3748] hover:bg-[#4a5568]"
                  }`}
                >
                  {isQuoting
                    ? "报价中..."
                    : createdOrder
                    ? "重新开始"
                    : quote
                    ? "刷新报价"
                    : "获取报价"}
                </button>
                <button
                  type="button"
                  onClick={handleCreateOrder}
                  data-testid={FRONTEND_TEST_IDS.exchangeCreateOrderCta}
                  disabled={
                    !quote ||
                    quoteExpired ||
                    Boolean(createdOrder) ||
                    isCreatingOrder ||
                    isQuoting
                  }
                  className={`rounded-md px-5 py-4 font-medium transition-colors ${
                    !quote ||
                    quoteExpired ||
                    Boolean(createdOrder) ||
                    isCreatingOrder ||
                    isQuoting
                      ? "bg-gray-600 cursor-not-allowed"
                      : "bg-[#c23631] hover:bg-[#f05e23]"
                  }`}
                >
                  {isCreatingOrder
                    ? "创建订单中..."
                    : createdOrder
                    ? "订单已创建"
                    : "创建兑换订单"}
                </button>
              </div>

              {error && (
                <div className="mt-5 rounded-md border border-red-700 bg-red-950/60 p-3 text-sm text-red-100">
                  {error}
                </div>
              )}
            </section>

            <aside className="rounded-lg border border-[#30363d] bg-[#161b22] p-6">
              <h3 className="text-xl font-bold mb-5">报价与付款</h3>

              {!quote && !createdOrder && (
                <div className="rounded-md border border-[#30363d] bg-[#0d1117] p-4 text-sm text-gray-300">
                  输入数量并获取报价。报价只是预估，订单创建后会生成精确打款金额。
                </div>
              )}

              {quote && !createdOrder && (
                <div>
                  <div className="mb-4 rounded-md border border-[#30363d] bg-[#0d1117] p-4 text-sm">
                    <div className="mb-2 flex justify-between gap-4">
                      <span className="text-gray-400">你约支付</span>
                      <span className="font-semibold">
                        {quote.inputAmount} {quote.inputAsset}
                      </span>
                    </div>
                    <div className="mb-2 flex justify-between gap-4">
                      <span className="text-gray-400">你约收到</span>
                      <span className="font-semibold">
                        {quote.outputAmount} {quote.outputAsset}
                      </span>
                    </div>
                    <div className="mb-2 flex justify-between gap-4">
                      <span className="text-gray-400">价差</span>
                      <span>{quote.spreadBps / 100}%</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-gray-400">有效期</span>
                      <span className={quoteExpired ? "text-red-300" : ""}>
                        {quoteExpired ? "已过期" : `${secondsRemaining}s`}
                      </span>
                    </div>
                  </div>
                  {quote.metadata?.executionEnabled === false && (
                    <p className="mb-4 text-xs text-orange-200">
                      当前后台出款未启用；订单可用于本地流程验证，不会触发真实转账。
                    </p>
                  )}
                  {quoteExpired && (
                    <button
                      type="button"
                      onClick={handleGetQuote}
                      className="mb-4 flex w-full items-center justify-center gap-2 rounded-md bg-[#2d3748] px-4 py-3 text-sm hover:bg-[#4a5568]"
                    >
                      <FaRotate />
                      刷新报价
                    </button>
                  )}
                </div>
              )}

              <RecentOrdersPanel
                orderId={recoveryOrderId}
                recentOrders={recentOrders}
                isLoading={isRecoveringOrder}
                error={recoveryOrderError}
                onOrderIdChange={setRecoveryOrderId}
                onLoad={handleLoadRecoveredOrder}
                onForget={(orderId) =>
                  setRecentOrders(forgetRecentOrder("exchange", orderId))
                }
                onClear={() => setRecentOrders(clearRecentOrders("exchange"))}
              />

              {createdOrder && (
                <ProofSelectorRegion
                  testId={FRONTEND_TEST_IDS.exchangeDepositInstructions}
                >
                  <div className="mb-3 flex items-center justify-between gap-4">
                    <h4 className="font-bold">兑换付款指引</h4>
                    {exchangeStatusMeta && (
                      <ProofSelectorRegion
                        testId={FRONTEND_TEST_IDS.exchangeOrderStatus}
                      >
                        <StatusPill
                          label={exchangeStatusMeta.label}
                          tone={exchangeStatusMeta.tone}
                        />
                      </ProofSelectorRegion>
                    )}
                  </div>
                  {exchangeStatusMeta && (
                    <div className="mb-4 rounded-md border border-[#30363d] bg-[#0d1117] p-4">
                      <div className="text-sm text-gray-200">
                        {exchangeStatusMeta.description}
                      </div>
                      <StatusTimeline steps={exchangeTimeline} />
                    </div>
                  )}
                  <ProofRefreshButton
                    onClick={handleRefreshOrderStatus}
                    isRefreshing={isRefreshingOrder}
                    testId={FRONTEND_TEST_IDS.exchangeRefreshStatus}
                    className={`mb-4 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                      isRefreshingOrder
                        ? "bg-gray-600 cursor-not-allowed"
                        : "bg-[#2d3748] hover:bg-[#4a5568]"
                    }`}
                  />
                  <ProofSelectorRegion testId={FRONTEND_TEST_IDS.exchangeOrderId}>
                    <InstructionRow
                      label="订单号"
                      value={createdOrder.id}
                      copied={copiedField === "order"}
                      onCopy={() => copyText("order", createdOrder.id)}
                    />
                  </ProofSelectorRegion>
                  <ProofSelectorRegion
                    testId={FRONTEND_TEST_IDS.exchangePaymentAmount}
                  >
                    <InstructionRow
                      label="精确打款金额"
                      value={createdOrder.depositInstructions.amountDisplay}
                      copied={copiedField === "amount"}
                      tone="emphasis"
                      onCopy={() =>
                        copyText(
                          "amount",
                          createdOrder.depositInstructions.amountDisplay
                        )
                      }
                    />
                  </ProofSelectorRegion>
                  <ProofSelectorRegion
                    testId={FRONTEND_TEST_IDS.exchangePaymentAddress}
                  >
                    <InstructionRow
                      label="收款地址"
                      value={createdOrder.depositInstructions.address}
                      copied={copiedField === "address"}
                      onCopy={() =>
                        copyText(
                          "address",
                          createdOrder.depositInstructions.address
                        )
                      }
                    />
                  </ProofSelectorRegion>
                  {createdOrder.depositInstructions.contractAddress && (
                    <ProofSelectorRegion
                      testId={FRONTEND_TEST_IDS.exchangePaymentContract}
                    >
                      <InstructionRow
                        label="TRC20 合约"
                        value={createdOrder.depositInstructions.contractAddress}
                        copied={copiedField === "contract"}
                        onCopy={() =>
                          copyText(
                            "contract",
                            createdOrder.depositInstructions.contractAddress
                          )
                        }
                      />
                    </ProofSelectorRegion>
                  )}
                  <InstructionRow
                    label="预计收到"
                    value={createdOrder.outputAmountDisplay}
                    copied={copiedField === "output"}
                    onCopy={() =>
                      copyText("output", createdOrder.outputAmountDisplay)
                    }
                  />
                  <ProofSelectorRegion
                    testId={FRONTEND_TEST_IDS.exchangePaymentReference}
                  >
                    <InstructionRow
                      label="付款备注"
                      value={createdOrder.depositReference}
                      copied={copiedField === "reference"}
                      onCopy={() =>
                        copyText("reference", createdOrder.depositReference)
                      }
                    />
                  </ProofSelectorRegion>
                  <InstructionRow
                    label="付款有效期"
                    value={formatSeconds(orderSecondsRemaining)}
                    tone={orderExpired ? "warning" : "default"}
                  />
                  {createdOrder.fundsReceivedAt && (
                    <InstructionRow
                      label="入金确认"
                      value={new Date(
                        createdOrder.fundsReceivedAt
                      ).toLocaleString("zh-CN")}
                    />
                  )}
                  {latestPayoutJob?.status && (
                    <InstructionRow
                      label="出款状态"
                      value={`${latestPayoutJob.status} / ${payoutMode}`}
                    />
                  )}
                  {payoutEvidence && (
                    <InstructionRow
                      label="出款交易"
                      value={payoutEvidence}
                      copied={copiedField === "payoutTx"}
                      onCopy={() => copyText("payoutTx", payoutEvidence)}
                    />
                  )}
                  {createdOrder.depositInstructions.warnings.map((warning) => (
                    <p
                      key={warning}
                      className="mt-3 rounded-md border border-orange-800 bg-orange-950/40 p-3 text-xs text-orange-100"
                    >
                      {warning}
                    </p>
                  ))}
                  {canShowWalletDepositButton && (
                    <div className="mt-5 rounded-md border border-[#30363d] bg-[#0d1117] p-4">
                      <button
                        type="button"
                        onClick={handleWalletDeposit}
                        data-testid={FRONTEND_TEST_IDS.exchangeWalletDepositCta}
                        disabled={walletDepositState !== "idle"}
                        className={`w-full rounded-md px-4 py-3 text-sm font-medium transition-colors ${
                          walletDepositState === "idle"
                            ? "bg-[#c23631] hover:bg-[#f05e23]"
                            : "bg-gray-600 cursor-not-allowed"
                        }`}
                      >
                        {walletDepositState === "broadcasting"
                          ? "等待钱包确认..."
                          : walletDepositState === "broadcasted"
                          ? "已提交，等待链上确认"
                          : `用钱包支付 ${createdOrder.inputAsset}`}
                      </button>
                      <p className="mt-3 text-xs text-gray-300">
                        钱包只发起入金交易；兑换状态以链上扫描结果为准。
                      </p>
                      <p className="mt-2 text-xs text-gray-400">
                        网络: {process.env.NEXT_PUBLIC_TRON_NETWORK || "mainnet"}
                      </p>
                      {walletDepositDisplayEvidence && (
                        <ProofSelectorRegion
                          testId={FRONTEND_TEST_IDS.exchangeWalletDepositTxid}
                        >
                          <InstructionRow
                            label="交易哈希"
                            value={walletDepositDisplayEvidence}
                            copied={copiedField === "depositTx"}
                            onCopy={() =>
                              copyText("depositTx", walletDepositDisplayEvidence)
                            }
                          />
                        </ProofSelectorRegion>
                      )}
                      {walletDepositError && (
                        <p className="mt-3 text-xs text-red-200">
                          {walletDepositError}
                        </p>
                      )}
                    </div>
                  )}
                  <ProofPollingError
                    className="mt-3 text-xs text-orange-200"
                    message={pollingError}
                    testId={FRONTEND_TEST_IDS.exchangePollingError}
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
