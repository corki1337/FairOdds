"use client";

import { LanguageProvider } from "./Language";
import React, { useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { WalletError } from "@solana/wallet-adapter-base";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RPC_URL, retryingFetch } from "@/lib/rpc";

import "@solana/wallet-adapter-react-ui/styles.css";

const queryClient = new QueryClient();

/**
 * Phantom / Solflare register via Wallet Standard in the browser extension.
 * Do NOT pass PhantomWalletAdapter — when the extension is missing that adapter
 * opens phantom.app instead of connecting.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  // Empty = auto-discover installed Wallet Standard wallets (Phantom ext, etc.)
  const wallets = useMemo(() => [], []);

  const onError = (error: WalletError) => {
    console.error("[wallet]", error.name, error.message);
  };

  return (
    <LanguageProvider>
      <QueryClientProvider client={queryClient}>
        <ConnectionProvider
          endpoint={RPC_URL}
          config={{ commitment: "confirmed", fetch: retryingFetch }}
        >
          <WalletProvider wallets={wallets} autoConnect onError={onError}>
            <WalletModalProvider>{children}</WalletModalProvider>
          </WalletProvider>
        </ConnectionProvider>
      </QueryClientProvider>
    </LanguageProvider>
  );
}
