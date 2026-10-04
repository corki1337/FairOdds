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
import { eventUrl, scoreLabel, type FixtureView } from "@/lib/fixtures";
import { CANCEL_REASONS, cancelExpired, resolveWithOracle } from "@/lib/cranks";

function fmt(ts: number) {
  return new Date(ts * 1000).toLocaleString();
}

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

  const { data: fixture } = useQuery({
    queryKey: ["fixture", params.id],
    queryFn: async (): Promise<FixtureView | null> => {
      const res = await fetch(`/api/fixtures/${params.id}`);
      if (!res.ok) return null;
      const json = await res.json();
      return (json.fixture as FixtureView) || null;
    },
  });

  async function placeBet() {
    if (!program || !wallet.publicKey || !wallet.sendTransaction || !data) return;
    const locked =
      data.receipt && Number(data.receipt.amountStaked) > 0
        ? (Number(data.receipt.teamSelected) as 0 | 1)
        : null;
    const teamToBet = locked ?? team;
    if (locked !== null && team !== locked) {
      setTxMsg(
        `Już obstawiłeś ${locked === 0 ? "Team A" : "Team B"}. Nie można zmienić strony (TeamMismatch).`
      );
      return;
    }
    setBusy(true);
    setTxMsg("");
    try {
      const mint = data.m.usdcMint as PublicKey;
      const userAta = getAssociatedTokenAddressSync(mint, wallet.publicKey);
      const [receipt] = receiptPda(programId, market, wallet.publicKey);
      const lamports = Math.floor(parseFloat(amount) * 1e6);

      const ix = await program.methods
        .placeBet(new BN(lamports), teamToBet)
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

  async function crank(kind: "resolve" | "cancel") {
    if (!program || !data) return;
    setBusy(true);
    setTxMsg("");
    try {
      const sig =
        kind === "resolve"
          ? await resolveWithOracle(program, connection, wallet, {
              publicKey: market,
              account: data.m,
            })
          : await cancelExpired(program, connection, wallet, market);
      setTxMsg(`${kind} ok: ${sig}`);
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
  const lockedTeam =
    data.receipt && Number(data.receipt.amountStaked) > 0
      ? (Number(data.receipt.teamSelected) as 0 | 1)
      : null;
  const canPickTeam = lockedTeam === null;
  const activeTeam = lockedTeam ?? team;
  const feedKey = (m.oracleFeed as PublicKey).toBase58();
  const feedHashHex = Buffer.from(m.feedHash as number[]).toString("hex");
  const endTime = Number(m.endTime);
  const deadline = Number(m.resolveDeadline);
  const nowSec = Math.floor(Date.now() / 1000);
  const pending = status === "open" || status === "locked";
  const canResolve = pending && nowSec >= endTime && nowSec < deadline;
  const canCancel = pending && nowSec >= deadline;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-mute">Match #{params.id}</p>
        <h1 className="font-display text-4xl font-bold">
          {teamA} <span className="text-mute">vs</span> {teamB}
        </h1>
        <p className="mt-2 text-sm uppercase tracking-wide text-accent">{status}</p>
        {fixture && <p className="mt-1 text-sm text-mute">{fixture.league}</p>}
        {status === "resolved" && m.winningTeam !== null && (
          <p className="mt-1 text-sm text-white">
            Wygrywa {Number(m.winningTeam) === 0 ? teamA : teamB} (z feedu Switchboard)
          </p>
        )}
        {status === "cancelled" && (
          <p className="mt-1 text-sm text-warn">
            Anulowany: {CANCEL_REASONS[Number(m.cancelReason)] || "—"} — każdy odbiera zwrot.
          </p>
        )}
      </div>

      <div className="space-y-1 rounded-xl border border-white/10 bg-panel p-4 text-xs text-mute">
        <p className="text-sm text-white">
          Wynik bierze się z publicznego TheSportsDB, nie z naszego serwera. Oracle Switchboard
          czytają <code>intHomeScore − intAwayScore</code>, a program sprawdza tylko znak różnicy.
          Admin nie może zmienić wyniku ani ruszyć puli.
        </p>
        <p>
          Źródło:{" "}
          <a
            className="break-all text-accent underline"
            href={eventUrl(params.id)}
            target="_blank"
            rel="noreferrer"
          >
            {eventUrl(params.id)}
          </a>
        </p>
        {fixture && scoreLabel(fixture) && (
          <p>
            Wynik u dostawcy: <span className="text-white">{scoreLabel(fixture)}</span>
          </p>
        )}
        <p>
          Feed:{" "}
          <a
            className="break-all text-accent underline"
            href={`https://explorer.solana.com/address/${feedKey}?cluster=devnet`}
            target="_blank"
            rel="noreferrer"
          >
            {feedKey}
          </a>
        </p>
        <p className="break-all">Hash joba: {feedHashHex}</p>
        <p>
          Koniec meczu: <span className="text-white">{fmt(endTime)}</span> · Termin na wynik:{" "}
          <span className="text-white">{fmt(deadline)}</span> (potem każdy może anulować → pełny
          zwrot)
        </p>
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

      <p className="text-sm text-mute">
        Zamknięcie zakładów:{" "}
        <span className="text-white">
          {new Date(Number(m.startTime) * 1000).toLocaleString()}
        </span>
        {" · "}
        Token: <span className="text-white">demo-USDC</span> (nie mainnet USDC).
      </p>

      {status === "open" && (
        <div className="rounded-xl border border-white/10 bg-panel p-5 space-y-4">
          <h2 className="font-display text-xl">Place bet</h2>
          <p className="text-sm text-mute">
            Jeden wallet = jedna strona na rynek. Możesz dokładać kwotę tylko do tej samej
            drużyny. Remis oznacza anulowanie rynku i zwrot wszystkich stawek.
          </p>
          {lockedTeam !== null && (
            <p className="rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-warn">
              Masz już zakład na <strong>{lockedTeam === 0 ? teamA : teamB}</strong>. NaVi/druga
              strona zawsze failuje (TeamMismatch) — to nie problem SOL. Możesz tylko dorzucić
              więcej do {lockedTeam === 0 ? teamA : teamB}.
            </p>
          )}
          <div>
            <p className="mb-2 text-sm text-mute">Strona zakładu</p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!canPickTeam && lockedTeam !== 0}
                onClick={() => setTeam(0)}
                className={`rounded-lg px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-30 ${
                  activeTeam === 0 ? "bg-accent text-ink" : "bg-ink"
                }`}
              >
                {teamA}
              </button>
              <button
                type="button"
                disabled={!canPickTeam && lockedTeam !== 1}
                onClick={() => setTeam(1)}
                className={`rounded-lg px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-30 ${
                  activeTeam === 1 ? "bg-accent text-ink" : "bg-ink"
                }`}
              >
                {teamB}
              </button>
            </div>
          </div>
          <label className="block text-sm text-mute">
            Kwota (demo-USDC, min. 1)
            <input
              className="mt-1 w-full rounded-lg border border-white/10 bg-ink px-3 py-2 text-white"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
            />
          </label>
          {!wallet.publicKey && (
            <p className="text-sm text-warn">Połącz wallet, żeby obstawić.</p>
          )}
          <button
            type="button"
            disabled={busy || !wallet.publicKey}
            onClick={placeBet}
            className="rounded-lg bg-accent px-4 py-2 font-display text-ink disabled:opacity-40"
          >
            {busy
              ? "Signing…"
              : lockedTeam !== null
                ? `Dorzuc do ${lockedTeam === 0 ? teamA : teamB}`
                : "Place bet"}
          </button>
        </div>
      )}
      {pending && nowSec >= Number(m.startTime) && !canResolve && !canCancel && (
        <p className="rounded-lg border border-white/10 bg-panel px-4 py-3 text-sm text-mute">
          Zakłady zamknięte, kapitał w yield_park. Rozliczenie od {fmt(endTime)}.
        </p>
      )}
      {(canResolve || canCancel) && (
        <div className="space-y-2 rounded-xl border border-white/10 bg-panel p-4">
          <p className="text-sm text-mute">
            {canResolve
              ? "Mecz zakończony. Każdy może rozliczyć: oracle Switchboard pobiera i podpisuje wynik, program go weryfikuje."
              : "Termin minął bez wyniku. Każdy może anulować rynek — wszyscy odbierają zwrot."}
          </p>
          <button
            type="button"
            disabled={busy || !wallet.publicKey}
            onClick={() => crank(canResolve ? "resolve" : "cancel")}
            className="rounded-lg bg-accent px-4 py-2 font-display text-ink disabled:opacity-40"
          >
            {canResolve ? "Rozlicz (Switchboard)" : "Anuluj i odblokuj zwroty"}
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
