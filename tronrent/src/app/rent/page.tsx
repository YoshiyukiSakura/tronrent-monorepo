"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
// import { useRouter } from "next/navigation";
import { useWallet } from "@/app/providers/WalletProvider";
import WalletButton from "@/components/WalletButton";

export default function RentPage() {
  const { isConnected, connect } = useWallet();
  // const router = useRouter();
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [checkingConnection, setCheckingConnection] = useState(true);

  // 检查钱包连接状态
  useEffect(() => {
    const checkWalletConnection = async () => {
      setCheckingConnection(true);

      // 给一点时间让钱包状态初始化
      await new Promise((resolve) => setTimeout(resolve, 1000));

      if (!isConnected) {
        console.log("Wallet not connected, showing connect prompt");
      }

      setCheckingConnection(false);
    };

    checkWalletConnection();
  }, [isConnected]);

  // 处理租赁计划选择
  const handleSelectPlan = (plan: string) => {
    if (!isConnected) {
      // 如果未连接钱包，提示连接
      connect();
      return;
    }

    setSelectedPlan(plan);
  };

  // 处理租赁提交
  const handleRentSubmit = async () => {
    if (!selectedPlan || !isConnected) {
      if (!isConnected) {
        connect();
      }
      return;
    }

    try {
      setIsProcessing(true);

      // 这里将来会添加实际的租赁逻辑
      // 目前只是模拟处理过程
      await new Promise((resolve) => setTimeout(resolve, 2000));

      alert(`成功租赁 ${selectedPlan} 计划！`);
      setSelectedPlan(null);
    } catch (error) {
      console.error("租赁过程中出错:", error);
      alert("租赁过程中出错，请稍后再试。");
    } finally {
      setIsProcessing(false);
    }
  };

  // 租赁计划数据
  const plans = [
    {
      id: "basic",
      name: "基础",
      price: "10 TRX",
      energy: "1,000 能量",
      duration: "24小时",
      support: "基础支持",
      isPopular: false,
    },
    {
      id: "standard",
      name: "标准",
      price: "50 TRX",
      energy: "10,000 能量",
      duration: "3天",
      support: "优先支持",
      isPopular: true,
    },
    {
      id: "enterprise",
      name: "企业",
      price: "200 TRX",
      energy: "50,000 能量",
      duration: "7天",
      support: "24/7专属支持",
      isPopular: false,
    },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-[#0d1117] to-[#161b22] text-white">
      {/* Header */}
      <header className="py-6 px-8 flex justify-between items-center border-b border-[#30363d]">
        <div className="flex items-center gap-2">
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
        </div>
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
              <a href="#" className="hover:text-[#f05e23] transition-colors">
                我的租赁
              </a>
            </li>
          </ul>
        </nav>
        <WalletButton />
      </header>

      {/* Main Content */}
      <main className="flex-grow p-8">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold mb-8">租赁 Tron 能量</h2>

          {/* 未连接钱包提示 */}
          {!isConnected && !checkingConnection && (
            <div className="bg-[#1e2430] p-6 rounded-lg border border-[#f05e23] mb-8">
              <div className="flex items-center gap-4">
                <div className="bg-[#f05e23] p-3 rounded-full">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-6 w-6 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 15v2m0 0v2m0-2h2m-2 0H9m3-4V8a3 3 0 00-3-3H9a3 3 0 00-3 3v1m12 0a3 3 0 00-3-3h-1a3 3 0 00-3 3"
                    />
                  </svg>
                </div>
                <div>
                  <h3 className="text-xl font-bold mb-2">请先连接钱包</h3>
                  <p className="text-gray-300 mb-4">
                    您需要连接 Tron 钱包才能租赁能量。
                  </p>
                  <button
                    onClick={() => connect()}
                    className="bg-[#c23631] hover:bg-[#f05e23] transition-colors px-4 py-2 rounded-md font-medium"
                  >
                    连接钱包
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 租赁说明 */}
          <div className="bg-[#161b22] p-6 rounded-lg border border-[#30363d] mb-8">
            <h3 className="text-xl font-bold mb-4">什么是 Tron 能量？</h3>
            <p className="text-gray-300 mb-4">
              Tron 能量是在 Tron
              区块链上执行智能合约或进行某些交易时消耗的资源。拥有足够的能量可以减少交易的
              TRX 成本。
            </p>
            <p className="text-gray-300">
              通过 TronRent，您可以临时租赁能量资源，而无需长期质押
              TRX。这是一种经济高效的方式来优化您的 Tron 网络体验。
            </p>
          </div>

          {/* 租赁计划 */}
          <h3 className="text-2xl font-bold mb-6">选择租赁计划</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
            {plans.map((plan) => (
              <div
                key={plan.id}
                className={`bg-[#161b22] p-8 rounded-lg border ${
                  selectedPlan === plan.id
                    ? "border-[#f05e23]"
                    : plan.isPopular
                    ? "border-[#c23631]"
                    : "border-[#30363d]"
                } flex flex-col relative cursor-pointer transition-all hover:shadow-lg ${
                  selectedPlan === plan.id ? "transform scale-105" : ""
                }`}
                onClick={() => handleSelectPlan(plan.id)}
              >
                {plan.isPopular && (
                  <div className="absolute -top-4 left-1/2 transform -translate-x-1/2 bg-[#c23631] px-4 py-1 rounded-full text-sm font-bold">
                    最受欢迎
                  </div>
                )}
                <h4 className="text-xl font-bold mb-2">{plan.name}</h4>
                <p className="text-gray-300 mb-6">
                  适合
                  {plan.id === "basic"
                    ? "小型交易和测试"
                    : plan.id === "standard"
                    ? "常规 DApp 用户"
                    : "企业和高级用户"}
                </p>
                <div className="text-4xl font-bold mb-6">{plan.price}</div>
                <ul className="mb-8 flex-grow">
                  <li className="flex items-center gap-2 mb-2">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-5 w-5 text-green-500"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <span>{plan.energy}</span>
                  </li>
                  <li className="flex items-center gap-2 mb-2">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-5 w-5 text-green-500"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <span>{plan.duration}租赁期</span>
                  </li>
                  <li className="flex items-center gap-2">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-5 w-5 text-green-500"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                    <span>{plan.support}</span>
                  </li>
                </ul>
                <div
                  className={`h-2 w-full rounded-full ${
                    selectedPlan === plan.id ? "bg-[#f05e23]" : "bg-transparent"
                  }`}
                ></div>
              </div>
            ))}
          </div>

          {/* 租赁按钮 */}
          <div className="flex justify-center">
            <button
              onClick={handleRentSubmit}
              disabled={
                (!selectedPlan && isConnected) ||
                isProcessing ||
                checkingConnection
              }
              className={`px-8 py-4 rounded-md font-medium text-lg transition-colors ${
                (!selectedPlan && isConnected) || checkingConnection
                  ? "bg-gray-600 cursor-not-allowed"
                  : "bg-[#c23631] hover:bg-[#f05e23]"
              }`}
            >
              {isProcessing ? (
                <span className="flex items-center">
                  <svg
                    className="animate-spin -ml-1 mr-2 h-5 w-5 text-white"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                  处理中...
                </span>
              ) : !isConnected ? (
                "连接钱包"
              ) : (
                `立即租赁${
                  selectedPlan
                    ? ` ${plans.find((p) => p.id === selectedPlan)?.name}计划`
                    : ""
                }`
              )}
            </button>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="py-6 px-8 border-t border-[#30363d] bg-[#0d1117]">
        <div className="max-w-6xl mx-auto text-center text-gray-400">
          <p>&copy; 2024 TronRent. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
