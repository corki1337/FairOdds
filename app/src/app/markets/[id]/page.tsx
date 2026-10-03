"use client";

import { useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { BN } from "@coral-xyz/anchor";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  TOKEN_PROGRAM_ID,
  getAccount,
} from "@solana/spl-token";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { useAichainProgram } from "@/lib/hooks/useProgram";
import {
  decodeTeamName,
  impliedOdds,
  marketPda,
  receiptPda,
  statusKey,
  vaultPda,
} from "@/lib/anchor";
import { AIchAIN_PROGRAM_ID } from "@/lib/ids";

export default function MarketPage() {
  const params = useParams<{ id: string }>();
  const matchId = BigInt(params.id);
  const program = useAichainProgram();
  const { connection } = useConnection();
  const wallet = useWallet();
  const qc = useQueryClient();
  const [team, setTeam] = useState<0 | 1>(0);
  const [amount, setAmount] = useState("10");
  const [txMsg, setTxMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const programId = useMemo(() => new PublicKey(AIchAIN_PROGRAM_ID), []);
  const [market] = useMemo(() => marketPda(programId, matchId), [programId, matchId]);
  const [vault] = useMemo(() => vaultPda(programId, market), [programId, market]);

  const { data } = useQuery({
    queryKey: ["market", market.toBase58()],
    queryFn: async () => {
      if (!program) return null;
      const m = await program.account.marketState.fetch(market);
      let receipt = null;
      if (wallet.publicKey) {
        const [r] = receiptPda(programId, market, wallet.publicKey);
        try {
          receipt = await program.account.userBetReceipt.fetch(r);
        } catch {
          receipt = null;
        }
      }
      return { m, receipt };
    },
    enabled: !!program,
    refetchInterval: 4000,
  });

  async function placeBet() {
    if (!program || !wallet.publicKey || !wallet.sendTransaction) return;
    setBusy(true);
    setTxMsg("");
    try {
      const mint = data!.m.usdcMint as PublicKey;
      const userAta = getAssociatedTokenAddressSync(mint, wallet.publicKey);
      const [receipt] = receiptPda(programId, market, wallet.publicKey);
      const lamports = Math.floor(parseFloat(amount) * 1e6);

      const ix = await program.methods
        .placeBet(new BN(lamports), team)
        .accounts({
          user: wallet.publicKey,
          market,
          vault,
          userAta,
          receipt,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction();

      // Ensure ATA exists
      const tx = new Transaction();
      try {
        await getAccount(connection, userAta);
      } catch {
        tx.add(
          createAssociatedTokenAccountInstruction(
            wallet.publicKey,
            userAta,
            wallet.publicKey,
            mint
          )
        );
      }
      tx.add(ix);
      const sig = await wallet.sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");
      setTxMsg(`Bet confirmed: ${sig}`);
      qc.invalidateQueries({ queryKey: ["market", market.toBase58()] });
    } catch (e) {
      setTxMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function claimOrRefund(kind: "claim" | "refund") {
    if (!program || !wallet.publicKey || !wallet.sendTransaction || !data) return;
    setBusy(true);
    try {
      const mint = data.m.usdcMint as PublicKey;
      const userAta = getAssociatedTokenAddressSync(mint, wallet.publicKey);
      const [receipt] = receiptPda(programId, market, wallet.publicKey);
      const builder =
        kind === "claim"
          ? program.methods.claimWinnings()
          : program.methods.refund();
      const sig = await builder
        .accounts({
          user: wallet.publicKey,
          market,
          vault,
          userAta,
          receipt,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      setTxMsg(`${kind} ok: ${sig}`);
      qc.invalidateQueries({ queryKey: ["market", market.toBase58()] });
    } catch (e) {
      setTxMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return <p className="text-mute">Loading market #{params.id}… Connect wallet if needed.</p>;
  }

  const m = data.m;
  const teamA = decodeTeamName(m.teamA);
  const teamB = decodeTeamName(m.teamB);
  const poolA = Number(m.poolTeamA);
  const poolB = Number(m.poolTeamB);
  const total = poolA + poolB;
  const status = statusKey(m.status);
  const oddsA = impliedOdds(poolA || 1, total || 1);
  const oddsB = impliedOdds(poolB || 1, total || 1);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-mute">Match #{params.id}</p>
        <h1 className="font-display text-4xl font-bold">
          {teamA} <span className="text-mute">vs</span> {teamB}
        </h1>
        <p className="mt-2 text-sm uppercase tracking-wide text-accent">{status}</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-white/10 bg-panel p-4">
          <div className="text-mute">{teamA}</div>
          <div className="font-display text-2xl">{(poolA / 1e6).toFixed(2)} USDC</div>
          <div className="text-sm text-mute">~{oddsA.toFixed(2)}x if wins</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-panel p-4">
          <div className="text-mute">{teamB}</div>
          <div className="font-display text-2xl">{(poolB / 1e6).toFixed(2)} USDC</div>
          <div className="text-sm text-mute">~{oddsB.toFixed(2)}x if wins</div>
        </div>
      </div>

      {status === "open" && (
        <div className="rounded-xl border border-white/10 bg-panel p-5 space-y-4">
          <h2 className="font-display text-xl">Place bet</h2>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setTeam(0)}
              className={`rounded-lg px-4 py-2 text-sm ${team === 0 ? "bg-accent text-ink" : "bg-ink"}`}
            >
              {teamA}
            </button>
            <button
              type="button"
              onClick={() => setTeam(1)}
              className={`rounded-lg px-4 py-2 text-sm ${team === 1 ? "bg-accent text-ink" : "bg-ink"}`}
            >
              {teamB}
            </button>
          </div>
          <label className="block text-sm text-mute">
            Amount (USDC)
            <input
              className="mt-1 w-full rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={busy || !wallet.publicKey}
            onClick={placeBet}
            className="rounded-lg bg-accent px-4 py-2 font-display text-ink disabled:opacity-40"
          >
            {busy ? "Signing…" : "Place bet"}
          </button>
        </div>
      )}

      {status === "resolved" && (
        <button
          type="button"
          disabled={busy}
          onClick={() => claimOrRefund("claim")}
          className="rounded-lg bg-accent px-4 py-2 font-display text-ink"
        >
          Claim winnings
        </button>
      )}
      {status === "cancelled" && (
        <button
          type="button"
          disabled={busy}
          onClick={() => claimOrRefund("refund")}
          className="rounded-lg bg-warn px-4 py-2 font-display text-ink"
        >
          Refund stake
        </button>
      )}

      {data.receipt && (
        <p className="text-sm text-mute">
          Your stake: {(Number(data.receipt.amountStaked) / 1e6).toFixed(2)} USDC on{" "}
          {data.receipt.teamSelected === 0 ? teamA : teamB}
          {data.receipt.claimed ? " (claimed)" : ""}
        </p>
      )}
      {txMsg && <p className="break-all text-sm text-mute">{txMsg}</p>}
    </div>
  );
}
