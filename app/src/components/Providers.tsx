"use client";

import React, { useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DEPLOY } from "@/lib/ids";

import "@solana/wallet-adapter-react-ui/styles.css";

const queryClient = new QueryClient();

export function Providers({ children }: { children: React.ReactNode }) {
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

  const Conn = ConnectionProvider as React.ComponentType<{
    endpoint: string;
    children?: React.ReactNode;
  }>;
  const Wall = WalletProvider as React.ComponentType<{
    wallets: PhantomWalletAdapter[];
    autoConnect?: boolean;
    children?: React.ReactNode;
  }>;
  const Modal = WalletModalProvider as React.ComponentType<{
    children?: React.ReactNode;
  }>;

  return (
    <QueryClientProvider client={queryClient}>
      <Conn endpoint={DEPLOY.rpcUrl}>
        <Wall wallets={wallets} autoConnect>
          <Modal>{children}</Modal>
        </Wall>
      </Conn>
    </QueryClientProvider>
  );
}
