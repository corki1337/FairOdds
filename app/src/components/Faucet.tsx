"use client";

import { useLanguage } from "./Language";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { getAccount, getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { useAichainProgram } from "@/lib/hooks/useProgram";
import { claimFaucet } from "@/lib/cranks";
import { globalPda } from "@/lib/anchor";
import { AIchAIN_PROGRAM_ID } from "@/lib/ids";

/** Anyone can tap the demo-USDC faucet once a day; the mint authority is a program PDA. */
export function Faucet() {
  const { t } = useLanguage();
  const program = useAichainProgram();
  const { connection } = useConnection();
  const wallet = useWallet();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const { data: balance } = useQuery({
    queryKey: ["demo-usdc", wallet.publicKey?.toBase58()],
    queryFn: async (): Promise<number> => {
      if (!program || !wallet.publicKey) return 0;
      const [global] = globalPda(new PublicKey(AIchAIN_PROGRAM_ID));
      const g = await program.account.globalConfig.fetch(global);
      const ata = getAssociatedTokenAddressSync(
        g.usdcMint as PublicKey,
        wallet.publicKey,
      );
      try {
        return Number((await getAccount(connection, ata)).amount) / 1e6;
      } catch {
        return 0;
      }
    },
    enabled: !!program && !!wallet.publicKey,
    refetchInterval: 10_000,
  });

  if (!wallet.publicKey) return null;

  async function tap() {
    if (!program) return;
    setBusy(true);
    setMsg("");
    try {
      await claimFaucet(program, connection, wallet);
      setMsg("+1000 demo-USDC");
      qc.invalidateQueries({ queryKey: ["demo-usdc"] });
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      setMsg(
        /FaucetCooldown|6034/.test(raw)
          ? t(
              "Already received — try again in 24h.",
              "Już odebrane — kolejna porcja za 24h.",
            )
          : raw.slice(0, 120),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={tap}
        disabled={busy}
        className="rounded-lg border border-accent/40 px-2 py-1 text-[11px] text-accent hover:bg-accent/10 disabled:opacity-40"
      >
        {busy ? "…" : `Faucet · ${(balance ?? 0).toFixed(0)} demo-USDC`}
      </button>
      {msg && (
        <span className="max-w-[220px] text-right text-[10px] text-mute">
          {msg}
        </span>
      )}
    </div>
  );
}
