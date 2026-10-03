"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useAichainProgram } from "@/lib/hooks/useProgram";
import { decodeTeamName, statusKey } from "@/lib/anchor";
import { AIchAIN_PROGRAM_ID } from "@/lib/ids";

type MarketRow = {
  publicKey: string;
  matchId: string;
  teamA: string;
  teamB: string;
  poolA: number;
  poolB: number;
  status: string;
  startTime: number;
};

export default function HomePage() {
  const program = useAichainProgram();
  const { connection } = useConnection();

  const { data: markets = [], isLoading, error } = useQuery({
    queryKey: ["markets", program?.programId.toBase58()],
    queryFn: async (): Promise<MarketRow[]> => {
      if (!program) return [];
      const all = await program.account.marketState.all();
      return all.map((m) => ({
        publicKey: m.publicKey.toBase58(),
        matchId: m.account.matchId.toString(),
        teamA: decodeTeamName(m.account.teamA),
        teamB: decodeTeamName(m.account.teamB),
        poolA: Number(m.account.poolTeamA) / 1e6,
        poolB: Number(m.account.poolTeamB) / 1e6,
        status: statusKey(m.account.status),
        startTime: Number(m.account.startTime),
      }));
    },
    enabled: !!program,
    refetchInterval: 5000,
  });

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <p className="text-sm uppercase tracking-[0.2em] text-mute">Solana · Pari-Mutuel</p>
        <h1 className="font-display text-4xl font-bold leading-tight md:text-5xl">
          Mutual pools.
          <span className="block text-accent">No bookmaker margin.</span>
        </h1>
        <p className="max-w-xl text-mute">
          Stake demo-USDC on Team A or Team B. Payouts come from the shared pool.
          Idle capital earns yield for the treasury — not a cut from winners.
        </p>
      </section>

      {!program && (
        <p className="rounded-lg border border-white/10 bg-panel px-4 py-3 text-sm text-mute">
          Connect a wallet on <strong className="text-white">devnet</strong> to load markets.
          Program: {AIchAIN_PROGRAM_ID.slice(0, 8)}…
          {connection.rpcEndpoint.includes("devnet") ? "" : " (switch RPC to devnet)"}
        </p>
      )}

      {isLoading && <p className="text-mute">Loading markets…</p>}
      {error && (
        <p className="text-sm text-warn">
          Could not fetch markets. Deploy programs and set mint/env first.
        </p>
      )}

      <div className="grid gap-4">
        {markets.map((m) => (
          <Link
            key={m.publicKey}
            href={`/markets/${m.matchId}`}
            className="block rounded-xl border border-white/10 bg-panel/80 p-5 transition hover:border-accent/40"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="font-display text-2xl">
                  {m.teamA} <span className="text-mute">vs</span> {m.teamB}
                </h2>
                <p className="mt-1 text-sm text-mute">
                  Match #{m.matchId} · closes{" "}
                  {new Date(m.startTime * 1000).toLocaleString()}
                </p>
              </div>
              <span className="rounded-full bg-white/5 px-3 py-1 text-xs uppercase tracking-wide text-accent">
                {m.status}
              </span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg bg-ink/60 px-3 py-2">
                <div className="text-mute">{m.teamA} pool</div>
                <div className="font-display text-lg">{m.poolA.toFixed(2)} USDC</div>
              </div>
              <div className="rounded-lg bg-ink/60 px-3 py-2">
                <div className="text-mute">{m.teamB} pool</div>
                <div className="font-display text-lg">{m.poolB.toFixed(2)} USDC</div>
              </div>
            </div>
          </Link>
        ))}
        {program && markets.length === 0 && !isLoading && (
          <p className="text-mute">No markets yet. Create one in Admin.</p>
        )}
      </div>
    </div>
  );
}
