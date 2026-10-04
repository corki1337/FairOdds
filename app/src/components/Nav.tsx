"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useWallet } from "@solana/wallet-adapter-react";
import { Faucet } from "./Faucet";

const WalletMultiButton = dynamic(
  async () =>
    (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false, loading: () => <span className="text-xs text-mute">…</span> }
);

function hasPhantomExtension(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as Window & {
    phantom?: { solana?: { isPhantom?: boolean } };
    solana?: { isPhantom?: boolean };
  };
  return !!(w.phantom?.solana?.isPhantom || w.solana?.isPhantom);
}

export function Nav() {
  const { connected, publicKey, wallets } = useWallet();
  const [phantomOk, setPhantomOk] = useState<boolean | null>(null);

  useEffect(() => {
    setPhantomOk(hasPhantomExtension());
    const t = window.setInterval(() => setPhantomOk(hasPhantomExtension()), 1500);
    return () => window.clearInterval(t);
  }, []);

  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-ink/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-6">
          <Link href="/" className="font-display text-xl tracking-tight text-accent">
            FairOdds
          </Link>
          <nav className="flex gap-4 text-sm text-mute">
            <Link href="/" className="hover:text-white">
              Markets
            </Link>
            <Link href="/admin" className="hover:text-white">
              Admin
            </Link>
          </nav>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <Faucet />
            <WalletMultiButton />
          </div>
          {phantomOk === false && !connected && (
            <p className="max-w-[220px] text-right text-[10px] leading-snug text-warn">
              Brak rozszerzenia Phantom w <strong>tej</strong> przeglądarce.
              Zainstaluj Phantom Extension (Chrome/Brave/Edge), odśwież stronę —
              nie otwieraj phantom.app zamiast connect.
            </p>
          )}
          {phantomOk && !connected && wallets.length === 0 && (
            <p className="text-[10px] text-mute">Szukam portfela… odśwież (F5)</p>
          )}
          {connected && publicKey && (
            <p className="text-[10px] text-mute">
              {publicKey.toBase58().slice(0, 4)}…{publicKey.toBase58().slice(-4)} · Devnet
            </p>
          )}
        </div>
      </div>
    </header>
  );
}
