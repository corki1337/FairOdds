"use client";

import { useState } from "react";
import { BN } from "@coral-xyz/anchor";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { useAichainProgram } from "@/lib/hooks/useProgram";
import {
  encodeTeamName,
  globalPda,
  marketPda,
  oraclePda,
  parkPda,
  parkVaultPda,
  positionPda,
  treasuryPda,
  vaultPda,
} from "@/lib/anchor";
import { AIchAIN_PROGRAM_ID, DEPLOY, YIELD_PARK_PROGRAM_ID } from "@/lib/ids";

export default function AdminPage() {
  const program = useAichainProgram();
  const wallet = useWallet();
  const { connection } = useConnection();
  const [teamA, setTeamA] = useState("NaVi");
  const [teamB, setTeamB] = useState("FaZe");
  const [matchId, setMatchId] = useState(() => String(Date.now()));
  const [minutes, setMinutes] = useState("5");
  const [result, setResult] = useState("0");
  const [log, setLog] = useState("");

  const programId = new PublicKey(AIchAIN_PROGRAM_ID);
  const yieldId = new PublicKey(YIELD_PARK_PROGRAM_ID);

  async function createMarket() {
    if (!program || !wallet.publicKey) return;
    try {
      const id = new BN(matchId);
      const now = Math.floor(Date.now() / 1000);
      const start = now + parseInt(minutes, 10) * 60;
      const end = start + 3600;
      const [global] = globalPda(programId);
      const g = await program.account.globalConfig.fetch(global);
      const [market] = marketPda(programId, BigInt(matchId));
      const [vault] = vaultPda(programId, market);
      const [oracle] = oraclePda(programId, BigInt(matchId));

      const sig = await program.methods
        .initializeMarket(
          id,
          new BN(start),
          new BN(end),
          encodeTeamName(teamA),
          encodeTeamName(teamB)
        )
        .accounts({
          authority: wallet.publicKey,
          global,
          usdcMint: g.usdcMint,
          market,
          vault,
          oracleFeed: oracle,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();
      setLog(`Market created ${sig}`);
    } catch (e) {
      setLog(e instanceof Error ? e.message : String(e));
    }
  }

  async function setOracleApi() {
    const res = await fetch(`/api/oracle/${matchId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ result: Number(result) }),
    });
    const json = await res.json();
    setLog(`Oracle API set: ${JSON.stringify(json)}`);
  }

  async function pushOracleOnchain() {
    if (!program || !wallet.publicKey) return;
    try {
      const [market] = marketPda(programId, BigInt(matchId));
      const [oracle] = oraclePda(programId, BigInt(matchId));
      const sig = await program.methods
        .setOracleResult(Number(result))
        .accounts({
          authority: wallet.publicKey,
          market,
          oracleFeed: oracle,
        })
        .rpc();
      setLog(`Oracle on-chain: ${sig}`);
    } catch (e) {
      setLog(e instanceof Error ? e.message : String(e));
    }
  }

  async function lockMarket() {
    if (!program || !wallet.publicKey) return;
    try {
      const [global] = globalPda(programId);
      const g = await program.account.globalConfig.fetch(global);
      const mint = g.usdcMint as PublicKey;
      const [market] = marketPda(programId, BigInt(matchId));
      const [vault] = vaultPda(programId, market);
      const [park] = parkPda(yieldId, mint);
      const [parkVault] = parkVaultPda(yieldId, park);
      const [position] = positionPda(yieldId, park, market);

      const sig = await program.methods
        .lockMarket()
        .accounts({
          crank: wallet.publicKey,
          global,
          market,
          vault,
          park,
          parkVault,
          position,
          yieldParkProgram: yieldId,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      setLog(`Locked: ${sig}`);
    } catch (e) {
      setLog(e instanceof Error ? e.message : String(e));
    }
  }

  async function resolveMarket() {
    if (!program || !wallet.publicKey) return;
    try {
      const [global] = globalPda(programId);
      const g = await program.account.globalConfig.fetch(global);
      const mint = g.usdcMint as PublicKey;
      const [market] = marketPda(programId, BigInt(matchId));
      const [vault] = vaultPda(programId, market);
      const [oracle] = oraclePda(programId, BigInt(matchId));
      const [treasury] = treasuryPda(programId, global);
      const [park] = parkPda(yieldId, mint);
      const [parkVault] = parkVaultPda(yieldId, park);
      const [position] = positionPda(yieldId, park, market);

      const sig = await program.methods
        .resolveMarket()
        .accounts({
          crank: wallet.publicKey,
          global,
          market,
          oracleFeed: oracle,
          vault,
          treasury,
          park,
          parkVault,
          position,
          yieldParkProgram: yieldId,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      setLog(`Resolved: ${sig}`);
    } catch (e) {
      setLog(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="font-display text-3xl font-bold">Admin / Demo crank</h1>
      <p className="text-sm text-mute">
        Cluster: {DEPLOY.cluster} · RPC: {connection.rpcEndpoint}
      </p>

      <section className="space-y-3 rounded-xl border border-white/10 bg-panel p-5">
        <h2 className="font-display text-xl">Create market</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <input className="rounded bg-ink px-3 py-2" value={teamA} onChange={(e) => setTeamA(e.target.value)} placeholder="Team A" />
          <input className="rounded bg-ink px-3 py-2" value={teamB} onChange={(e) => setTeamB(e.target.value)} placeholder="Team B" />
          <input className="rounded bg-ink px-3 py-2" value={matchId} onChange={(e) => setMatchId(e.target.value)} placeholder="Match id" />
          <input className="rounded bg-ink px-3 py-2" value={minutes} onChange={(e) => setMinutes(e.target.value)} placeholder="Minutes until lock" />
        </div>
        <button type="button" onClick={createMarket} className="rounded-lg bg-accent px-4 py-2 text-ink">
          Initialize market
        </button>
      </section>

      <section className="space-y-3 rounded-xl border border-white/10 bg-panel p-5">
        <h2 className="font-display text-xl">Lifecycle</h2>
        <p className="text-sm text-mute">Match id used for lock / oracle / resolve</p>
        <input className="w-full rounded bg-ink px-3 py-2" value={matchId} onChange={(e) => setMatchId(e.target.value)} />
        <button type="button" onClick={lockMarket} className="mr-2 rounded-lg bg-white/10 px-4 py-2">
          Lock (+ CPI yield)
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <select className="rounded bg-ink px-3 py-2" value={result} onChange={(e) => setResult(e.target.value)}>
            <option value="0">0 — Team A wins</option>
            <option value="1">1 — Team B wins</option>
            <option value="2">2 — Cancel / draw</option>
          </select>
          <button type="button" onClick={setOracleApi} className="rounded-lg bg-white/10 px-4 py-2">
            Set HTTP oracle API
          </button>
          <button type="button" onClick={pushOracleOnchain} className="rounded-lg bg-white/10 px-4 py-2">
            Push oracle on-chain
          </button>
          <button type="button" onClick={resolveMarket} className="rounded-lg bg-accent px-4 py-2 text-ink">
            Resolve
          </button>
        </div>
        <p className="text-xs text-mute">
          HTTP oracle at <code>/api/oracle/[matchId]</code> is the Switchboard job source.
          On-chain resolve only reads the OracleFeed PDA set at market init (never a raw frontend result).
        </p>
      </section>

      {log && <pre className="whitespace-pre-wrap break-all rounded bg-panel p-3 text-xs text-mute">{log}</pre>}
    </div>
  );
}
