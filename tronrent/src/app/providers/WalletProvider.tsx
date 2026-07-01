"use client";

import React, {
  ReactNode,
  createContext,
  useContext,
  useEffect,
  useState,
  useMemo,
} from "react";
import {
  useWallet as useTronWallet,
  WalletProvider as TronWalletProvider,
} from "@tronweb3/tronwallet-adapter-react-hooks";
import { WalletModalProvider } from "@tronweb3/tronwallet-adapter-react-ui";
import { TronLinkAdapter } from "@tronweb3/tronwallet-adapter-tronlink";
import "@tronweb3/tronwallet-adapter-react-ui/style.css";

// 创建钱包上下文
interface WalletContextType {
  address: string | null;
  balance: number | null;
  isConnected: boolean;
  isConnecting: boolean;
  tronWeb: TronWebInstance | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
}

const WalletContext = createContext<WalletContextType>({
  address: null,
  balance: null,
  isConnected: false,
  isConnecting: false,
  tronWeb: null,
  connect: async () => {},
  disconnect: async () => {},
});

const E2E_WALLET_MOCK_REQUESTED =
  process.env.NEXT_PUBLIC_E2E_WALLET_MOCK === "1";

function assertE2EWalletMockNotProduction() {
  if (process.env.NODE_ENV === "production" && E2E_WALLET_MOCK_REQUESTED) {
    throw new Error(
      "NEXT_PUBLIC_E2E_WALLET_MOCK must never be enabled in production."
    );
  }
}

function isE2EWalletMockEnabled() {
  assertE2EWalletMockNotProduction();
  return process.env.NODE_ENV !== "production" && E2E_WALLET_MOCK_REQUESTED;
}

function getWindowTronWeb() {
  if (typeof window === "undefined" || !window.tronWeb) {
    return null;
  }
  return window.tronWeb as unknown as TronWebInstance;
}

// 钱包提供者组件
export function WalletProvider({ children }: { children: ReactNode }) {
  if (isE2EWalletMockEnabled()) {
    return <E2EWalletContextWrapper>{children}</E2EWalletContextWrapper>;
  }

  return <TronLinkWalletProvider>{children}</TronLinkWalletProvider>;
}

function TronLinkWalletProvider({ children }: { children: ReactNode }) {
  // 创建钱包适配器
  const adapters = useMemo(() => [new TronLinkAdapter()], []);

  return (
    <TronWalletProvider adapters={adapters} autoConnect={true}>
      <WalletModalProvider>
        <WalletContextWrapper>{children}</WalletContextWrapper>
      </WalletModalProvider>
    </TronWalletProvider>
  );
}

function WalletContextWrapper({ children }: { children: ReactNode }) {
  const {
    address: walletAddress,
    connected,
    connecting,
    connect: walletConnect,
    disconnect: walletDisconnect,
    wallet,
    select,
    wallets,
  } = useTronWallet();

  const [address, setAddress] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [tronWeb, setTronWeb] = useState<TronWebInstance | null>(null);

  // Update state when wallet connection changes
  useEffect(() => {
    setIsConnected(connected);
    setIsConnecting(connecting);
    setAddress(walletAddress || null);
    setTronWeb(getWindowTronWeb());
  }, [connected, connecting, walletAddress]);

  // Fetch balance when connected
  useEffect(() => {
    const fetchBalance = async () => {
      if (connected && walletAddress && window.tronWeb) {
        try {
          setTronWeb(getWindowTronWeb());
          const balanceInSun = await window.tronWeb.trx.getBalance(
            walletAddress
          );
          const balanceInTrx = balanceInSun / 1000000; // Convert to TRX
          setBalance(balanceInTrx);
        } catch (error) {
          console.error("Failed to fetch balance:", error);
        }
      } else {
        setBalance(null);
        setTronWeb(null);
      }
    };

    fetchBalance();
  }, [connected, walletAddress]);

  // Connect wallet
  const connect = async () => {
    try {
      // First select TronLink wallet if available and not already selected
      if (!wallet && wallets.length > 0) {
        // Find TronLink wallet
        const tronLinkWallet = wallets.find(
          (w) => w.adapter.name === "TronLink"
        );
        if (tronLinkWallet) {
          console.log("Selecting TronLink wallet");
          await select(tronLinkWallet.adapter.name);
        } else {
          // Select the first available wallet
          console.log(
            "Selecting first available wallet:",
            wallets[0].adapter.name
          );
          await select(wallets[0].adapter.name);
        }
      }

      // Then connect
      console.log("Connecting to wallet...");
      await walletConnect();
    } catch (error) {
      console.error("Failed to connect wallet:", error);
      // alert("连接钱包失败，请确保TronLink已安装并解锁");
    }
  };

  // Disconnect wallet
  const disconnect = async () => {
    try {
      await walletDisconnect();
    } catch (error) {
      console.error("Failed to disconnect wallet:", error);
    }
  };

  return (
    <WalletContext.Provider
      value={{
        address,
        balance,
        isConnected,
        isConnecting,
        tronWeb,
        connect,
        disconnect,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

function E2EWalletContextWrapper({ children }: { children: ReactNode }) {
  const [tronWeb, setTronWeb] = useState<TronWebInstance | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(true);
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadMockWallet = async () => {
      try {
        const mockModule = (await import("@/lib/dev/e2eWalletMock")) as unknown as {
          createE2ETronWebMock: () => any;
          installE2EWalletMockOnWindow: (options: {
            windowRef: Window;
            tronWeb: any;
          }) => any;
        };
        const mockTronWeb = mockModule.createE2ETronWebMock();
        mockModule.installE2EWalletMockOnWindow({
          windowRef: window,
          tronWeb: mockTronWeb,
        });
        const balanceSun = await mockTronWeb.trx.getBalance(
          mockTronWeb.defaultAddress.base58
        );

        if (!isMounted) return;
        setTronWeb(mockTronWeb);
        setBalance(balanceSun / 1_000_000);
        setIsConnected(true);
      } catch (error) {
        console.error("Failed to install TronRent E2E wallet mock:", error);
      } finally {
        if (isMounted) {
          setIsConnecting(false);
        }
      }
    };

    void loadMockWallet();

    return () => {
      isMounted = false;
    };
  }, []);

  const connect = async () => {
    setIsConnected(Boolean(tronWeb));
  };

  const disconnect = async () => {
    setIsConnected(false);
  };

  return (
    <WalletContext.Provider
      value={{
        address: isConnected ? tronWeb?.defaultAddress.base58 || null : null,
        balance: isConnected ? balance : null,
        isConnected,
        isConnecting,
        tronWeb: isConnected ? tronWeb : null,
        connect,
        disconnect,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

// 钱包上下文钩子
export function useWallet() {
  return useContext(WalletContext);
}
