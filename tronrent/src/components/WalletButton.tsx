"use client";

import React, { useState, useEffect, useRef } from "react";
import { useWallet } from "@/app/providers/WalletProvider";

export default function WalletButton() {
  const { address, balance, isConnected, isConnecting, connect, disconnect } =
    useWallet();
  const [showDropdown, setShowDropdown] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Format address display
  const formatAddress = (address: string) => {
    if (!address) return "";
    return `${address.substring(0, 6)}...${address.substring(
      address.length - 4
    )}`;
  };

  // Format balance display
  const formatBalance = (balance: number | null) => {
    if (balance === null) return "0";
    return balance.toFixed(2);
  };

  // Handle connect button click
  const handleConnectClick = async () => {
    console.log("Connect button clicked, isConnected:", isConnected);
    setConnectError(null);

    if (isConnected) {
      setShowDropdown(!showDropdown);
    } else {
      try {
        await connect();
      } catch (error) {
        console.error("Error connecting wallet:", error);
        setConnectError(
          "Failed to connect wallet. Please make sure TronLink is installed and unlocked."
        );
      }
    }
  };

  // Handle disconnect
  const handleDisconnect = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await disconnect();
      setShowDropdown(false);
    } catch (error) {
      console.error("Error disconnecting wallet:", error);
    }
  };

  // Handle clicking outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setShowDropdown(false);
      }
    };

    if (showDropdown) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showDropdown]);

  return (
    <div className="relative">
      <button
        onClick={handleConnectClick}
        className={`px-4 py-2 rounded-md font-medium transition-colors ${
          isConnected
            ? "bg-[#2d3748] hover:bg-[#4a5568] text-white"
            : "bg-[#c23631] hover:bg-[#f05e23] text-white"
        }`}
        disabled={isConnecting}
      >
        {isConnecting ? (
          <span className="flex items-center">
            <svg
              className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
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
            Connecting...
          </span>
        ) : isConnected ? (
          <span className="flex items-center">
            <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
            {formatAddress(address || "")}
          </span>
        ) : (
          "Connect Wallet"
        )}
      </button>

      {connectError && !isConnected && !isConnecting && (
        <div className="absolute right-0 mt-2 w-64 bg-red-900 text-white p-3 rounded-md shadow-lg z-10">
          <p className="text-sm">{connectError}</p>
          <button
            className="text-xs text-red-300 mt-2 hover:text-white"
            onClick={() => setConnectError(null)}
          >
            Dismiss
          </button>
        </div>
      )}

      {showDropdown && isConnected && (
        <div
          ref={dropdownRef}
          className="absolute right-0 mt-2 w-64 bg-[#1e2430] rounded-md shadow-lg z-10 overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-4 border-b border-[#30363d]">
            <p className="text-sm text-gray-400">Wallet Address</p>
            <p className="text-sm font-mono text-white break-all">{address}</p>
          </div>
          <div className="p-4 border-b border-[#30363d]">
            <p className="text-sm text-gray-400">TRX Balance</p>
            <p className="text-lg font-semibold text-white">
              {formatBalance(balance)} TRX
            </p>
          </div>
          <div className="p-2">
            <button
              onClick={handleDisconnect}
              className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-[#30363d] rounded transition-colors"
            >
              Disconnect
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
