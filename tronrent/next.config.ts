import type { NextConfig } from "next";

if (
  process.env.NODE_ENV === "production" &&
  process.env.NEXT_PUBLIC_E2E_WALLET_MOCK === "1"
) {
  throw new Error(
    "NEXT_PUBLIC_E2E_WALLET_MOCK must never be enabled in production builds."
  );
}

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
    optimizePackageImports: ["@chakra-ui/react"],
  },
};

export default nextConfig;
