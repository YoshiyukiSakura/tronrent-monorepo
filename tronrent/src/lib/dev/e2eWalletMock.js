"use strict";

const E2E_WALLET_ADDRESS = "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb";
const E2E_WALLET_HEX = "410000000000000000000000000000000000000000";
const E2E_TREASURY_ADDRESS = "TAivugS6Zn2EK9RAKeiSQbshkZQAX4fZaA";
const E2E_TREASURY_HEX = "410000000000000000000000000000000000000001";
const E2E_USDT_CONTRACT_ADDRESS = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
const E2E_USDT_CONTRACT_HEX = "410000000000000000000000000000000000000002";

function assertE2EWalletMockAllowed(env = process.env) {
  if (env.NODE_ENV === "production" && env.NEXT_PUBLIC_E2E_WALLET_MOCK === "1") {
    throw new Error(
      "NEXT_PUBLIC_E2E_WALLET_MOCK must never be enabled in production."
    );
  }
}

function isE2EWalletMockEnabled(env = process.env) {
  assertE2EWalletMockAllowed(env);
  return env.NODE_ENV !== "production" && env.NEXT_PUBLIC_E2E_WALLET_MOCK === "1";
}

function getNetworkHost(network) {
  if (network === "nile") {
    return "https://nile.trongrid.io";
  }
  if (network === "shasta") {
    return "https://api.shasta.trongrid.io";
  }
  if (network === "unknown") {
    return "https://internal-trx.example";
  }
  return "https://api.trongrid.io";
}

function makeTxId(prefix, index) {
  return `${prefix}-${String(index).padStart(4, "0")}`;
}

function createE2ETronWebMock(options = {}) {
  assertE2EWalletMockAllowed(options.env || process.env);

  const transactions = [];
  const state = {
    balanceSun: options.balanceSun || 1_000_000_000,
    networkHost:
      options.networkHost ||
      getNetworkHost(options.network || options.env?.NEXT_PUBLIC_TRON_NETWORK),
    defaultAddress: options.defaultAddress || E2E_WALLET_ADDRESS,
  };

  const tronWeb = {
    defaultAddress: {
      get base58() {
        return state.defaultAddress;
      },
      get hex() {
        return state.defaultAddress === E2E_WALLET_ADDRESS
          ? E2E_WALLET_HEX
          : E2E_TREASURY_HEX;
      },
    },
    fullNode: {
      get host() {
        return state.networkHost;
      },
    },
    solidityNode: {
      get host() {
        return state.networkHost;
      },
    },
    eventServer: {
      get host() {
        return state.networkHost;
      },
    },
    address: {
      fromHex(value) {
        if (value === E2E_WALLET_HEX) return E2E_WALLET_ADDRESS;
        if (value === E2E_TREASURY_HEX) return E2E_TREASURY_ADDRESS;
        if (value === E2E_USDT_CONTRACT_HEX) return E2E_USDT_CONTRACT_ADDRESS;
        return null;
      },
      toHex(address) {
        if (address === E2E_WALLET_ADDRESS) return E2E_WALLET_HEX;
        if (address === E2E_TREASURY_ADDRESS) return E2E_TREASURY_HEX;
        if (address === E2E_USDT_CONTRACT_ADDRESS) return E2E_USDT_CONTRACT_HEX;
        return "";
      },
      fromPrivateKey() {
        return E2E_WALLET_ADDRESS;
      },
    },
    trx: {
      async getBalance() {
        return state.balanceSun;
      },
      async getAccount(address) {
        return { address };
      },
      async getTransaction(txid) {
        return transactions.find((tx) => tx.txid === txid) || null;
      },
      async getConfirmedTransaction(txid) {
        return transactions.find((tx) => tx.txid === txid) || null;
      },
      async getTransactionInfo(txid) {
        const tx = transactions.find((entry) => entry.txid === txid);
        return tx ? { id: txid, receipt: { result: "SUCCESS" } } : null;
      },
      async sendTransaction(toAddress, amountSun) {
        const txid = makeTxId("e2e-trx", transactions.length + 1);
        const tx = {
          txid,
          asset: "TRX",
          fromAddress: state.defaultAddress,
          toAddress,
          amountSun,
        };
        transactions.push(tx);
        return { txid, transaction: { txID: txid }, result: true };
      },
    },
    contract() {
      return {
        async at(contractAddress) {
          return {
            transfer(toAddress, amountBaseUnits) {
              return {
                async send(options = {}) {
                  const txid = makeTxId("e2e-usdt", transactions.length + 1);
                  const tx = {
                    txid,
                    asset: "USDT",
                    fromAddress: state.defaultAddress,
                    toAddress,
                    contractAddress,
                    amountBaseUnits: String(amountBaseUnits),
                    options,
                  };
                  transactions.push(tx);
                  return { txID: txid, result: true, ...tx };
                },
              };
            },
          };
        },
      };
    },
  };

  Object.defineProperty(tronWeb, "__tronrentE2E", {
    enumerable: false,
    value: {
      transactions,
      setDefaultAddress(address) {
        state.defaultAddress = address;
      },
      setNetworkHost(host) {
        state.networkHost = host;
      },
      reset() {
        transactions.splice(0, transactions.length);
        state.defaultAddress = options.defaultAddress || E2E_WALLET_ADDRESS;
        state.networkHost =
          options.networkHost ||
          getNetworkHost(options.network || options.env?.NEXT_PUBLIC_TRON_NETWORK);
      },
    },
  });

  return tronWeb;
}

function installE2EWalletMockOnWindow({
  windowRef,
  tronWeb = createE2ETronWebMock(),
} = {}) {
  assertE2EWalletMockAllowed();
  if (!windowRef) {
    return tronWeb;
  }

  windowRef.tronWeb = tronWeb;
  windowRef.tronLink = {
    ready: true,
    tronWeb,
    async request() {
      return { code: 200, message: "E2E wallet mock accepted request" };
    },
  };
  windowRef.__TRONRENT_E2E_WALLET_MOCK__ = tronWeb.__tronrentE2E;
  return tronWeb;
}

module.exports = {
  E2E_TREASURY_ADDRESS,
  E2E_USDT_CONTRACT_ADDRESS,
  E2E_WALLET_ADDRESS,
  assertE2EWalletMockAllowed,
  createE2ETronWebMock,
  installE2EWalletMockOnWindow,
  isE2EWalletMockEnabled,
};
