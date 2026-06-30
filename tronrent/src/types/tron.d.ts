interface TronWebInstance {
  defaultAddress: {
    base58: string;
    hex: string;
  };
  fullNode: {
    host: string;
  };
  solidityNode: {
    host: string;
  };
  eventServer: {
    host: string;
  };
  trx: {
    getBalance(address: string): Promise<number>;
    getAccount(address: string): Promise<any>;
    getTransaction(txid: string): Promise<any>;
    getConfirmedTransaction(txid: string): Promise<any>;
    getTransactionInfo(txid: string): Promise<any>;
    sendTransaction(to: string, amount: number): Promise<any>;
  };
  contract: {
    at(address: string): Promise<any>;
  };
  address: {
    fromPrivateKey(privateKey: string): string;
    toHex(address: string): string;
    fromHex(address: string): string;
  };
}

interface TronLinkInstance {
  request(args: { method: string; params?: any[] }): Promise<any>;
}

declare global {
  interface Window {
    tronWeb?: TronWebInstance;
    tronLink?: TronLinkInstance;
  }
}
