declare global {
  interface Window {
    tronLink?: {
      ready: boolean;
      tronWeb: any;
    };
  }
}

export {};
