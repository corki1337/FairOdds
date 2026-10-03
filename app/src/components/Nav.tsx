"use client";

import Link from "next/link";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

export function Nav() {
  return (
    <header className="border-b border-white/10 bg-ink/80 backdrop-blur sticky top-0 z-20">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-6">
          <Link href="/" className="font-display text-xl tracking-tight text-accent">
            Aichain
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
        <WalletMultiButton />
      </div>
    </header>
  );
}
