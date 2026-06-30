import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { WalletProvider } from "./providers/WalletProvider";
import PlausibleProvider from "next-plausible";
import { Toaster } from "@/components/ui/toaster";
import { Provider } from "@/components/ui/provider";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TronRent - Cheapest Tron Energy Rental Service",
  description:
    "Rent Tron energy resources at the lowest prices to save on transaction fees, enable free USDT transfers, and optimize your DApp performance.",
  keywords: [
    "Tron",
    "TRX",
    "Energy",
    "Rental",
    "Blockchain",
    "DApp",
    "Smart Contract",
    "Cheapest Energy",
    "USDT",
    "Free Transfer",
    "No Fee",
    "Lowest Price",
    "TRC20",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              // Check if TronLink is installed
              window.addEventListener('DOMContentLoaded', () => {
                if (typeof window.tronLink === 'undefined') {
                  console.log('TronLink is not installed');
                } else {
                  console.log('TronLink is installed');
                }
              });
            `,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <Provider>
          <PlausibleProvider domain="tronrent.com">
            <WalletProvider>
              {children}
              <Toaster />
            </WalletProvider>
          </PlausibleProvider>
        </Provider>
      </body>
    </html>
  );
}
