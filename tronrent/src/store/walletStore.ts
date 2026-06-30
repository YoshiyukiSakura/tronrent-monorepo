import { create } from "zustand";
import { persist } from "zustand/middleware";

interface WalletState {
  // 钱包连接状态
  isConnected: boolean;
  // 选中的钱包地址
  selectedAddress: string | null;
  // 钱包类型
  walletType: string | null;

  // 连接钱包
  connect: (address: string, walletType: string) => void;
  // 断开连接
  disconnect: () => void;
  // 切换地址
  setSelectedAddress: (address: string) => void;
}

export const useWalletStore = create<WalletState>()(
  persist(
    (set) => ({
      isConnected: false,
      selectedAddress: null,
      walletType: null,

      connect: (address, walletType) =>
        set({
          isConnected: true,
          selectedAddress: address,
          walletType,
        }),

      disconnect: () =>
        set({
          isConnected: false,
          selectedAddress: null,
          walletType: null,
        }),

      setSelectedAddress: (address) =>
        set({
          selectedAddress: address,
        }),
    }),
    {
      name: "wallet-storage",
      // 只持久化部分状态
      partialize: (state) => ({
        selectedAddress: state.selectedAddress,
        walletType: state.walletType,
      }),
    }
  )
);
