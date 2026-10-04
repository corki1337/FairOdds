"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useAichainProgram } from "@/lib/hooks/useProgram";
import { marketPda } from "@/lib/anchor";
import { ADMIN_PUBKEY, AIchAIN_PROGRAM_ID, DEPLOY } from "@/lib/ids";
import { CATEGORY_LABELS, eventUrl, type FixtureView } from "@/lib/fixtures";
import {
  cancelExpired,
  createMarketTx,
  harvestDust,
  lockIx,
  resolveWithOracle,
  sendV0,
} from "@/lib/cranks";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="font-medium text-white">{label}</span>
      {hint && <span className="block text-xs text-mute">{hint}</span>}
      {children}
    </label>
  );
}

const inputClass =
  "mt-1 w-full rounded-lg border border-white/10 bg-ink px-3 py-2 text-white placeholder:text-mute/50";

export default function AdminPage() {
  const program = useAichainProgram();
  const wallet = useWallet();
  const { connection } = useConnection();
  const [teamA, setTeamA] = useState("NaVi");
  const [teamB, setTeamB] = useState("FaZe");
  const [matchId, setMatchId] = useState(() => String(Date.now()));
  const [minutes, setMinutes] = useState("3");
  const [duration, setDuration] = useState("2");
  const [resolveWindow, setResolveWindow] = useState("30");
  const [log, setLog] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [lastSig, setLastSig] = useState<string | null>(null);

  const programId = new PublicKey(AIchAIN_PROGRAM_ID);

  const times = useMemo(() => {
    const now = Math.floor(Date.now() / 1000);
    const start = now + Math.max(1, Number(minutes) || 0) * 60;
    const end = start + Math.max(1, Number(duration) || 0) * 60;
    const deadline = end + Math.max(5, Number(resolveWindow) || 0) * 60;
    return { start, end, deadline };
  }, [minutes, duration, resolveWindow]);

  const connected = !!wallet.publicKey;
  const isAdmin = connected && wallet.publicKey!.toBase58() === ADMIN_PUBKEY;

  const { data: fixturesData } = useQuery({
    queryKey: ["fixtures", "admin"],
    queryFn: async () => {
      const res = await fetch("/api/fixtures?status=all&limit=150&sort=time");
      if (!res.ok) throw new Error("fixtures failed");
      return res.json() as Promise<{ fixtures: FixtureView[] }>;
    },
  });

  function note(msg: string, sig?: string) {
    setLog(msg);
    if (sig) setLastSig(sig);
  }

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      note(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function applyFixture(f: FixtureView) {
    setTeamA(f.teamA);
    setTeamB(f.teamB);
    setMatchId(f.matchId);
    const toKickoff = Math.ceil((f.startTime * 1000 - Date.now()) / 60_000);
    setMinutes(String(Math.max(1, toKickoff)));
    setDuration(String(Math.max(1, Math.round((f.endTime - f.startTime) / 60))));
    note(
      `Załadowano ${f.teamA} vs ${f.teamB} (${CATEGORY_LABELS[f.category]} · ${f.league}).\n` +
        `Kickoff ${new Date(f.startTime * 1000).toLocaleString()}\n` +
        `Źródło wyniku: ${eventUrl(f.matchId)}\n` +
        (toKickoff <= 0
          ? "Mecz już się zaczął — rynek musi mieć start w przyszłości, więc to tylko rynek demo."
          : isAdmin
            ? "Kliknij „Utwórz rynek + feed Switchboard”."
            : "Twój wallet nie jest adminem — użyj scripts/create-from-fixture.ts")
    );
  }

  async function loadMarket() {
    if (!program) throw new Error("Połącz wallet.");
    const [market] = marketPda(programId, BigInt(matchId));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const account: any = await (program.account as any).marketState.fetchNullable(market);
    if (!account) throw new Error(`Brak rynku #${matchId} on-chain.`);
    return { publicKey: market, account };
  }

  const createMarket = () =>
    run("create", async () => {
      if (!program || !wallet.publicKey) throw new Error("Połącz wallet (Devnet).");
      if (!isAdmin) {
        throw new Error(
          `Tylko admin (${ADMIN_PUBKEY}) tworzy rynki.\n` +
            `CLI: npx ts-node scripts/create-from-fixture.ts ${matchId}`
        );
      }
      const { sig, feed } = await createMarketTx(program, connection, wallet, {
        matchId,
        teamA,
        teamB,
        start: times.start,
        end: times.end,
        resolveDeadline: times.deadline,
      });
      note(
        `Rynek + feed Switchboard utworzone atomowo.\n` +
          `Feed: ${feed.toBase58()} (authority = feed-lock PDA, konfiguracja zamrożona)\n` +
          `Job: ${eventUrl(matchId)} → intHomeScore − intAwayScore\n` +
          `Zakłady do: ${new Date(times.start * 1000).toLocaleString()}\n` +
          `Koniec meczu: ${new Date(times.end * 1000).toLocaleString()}\n` +
          `Termin wyniku: ${new Date(times.deadline * 1000).toLocaleString()} (potem każdy może anulować → zwrot)`,
        sig
      );
    });

  const lock = () =>
    run("lock", async () => {
      if (!program || !wallet.publicKey) throw new Error("Połącz wallet.");
      const m = await loadMarket();
      const sig = await sendV0(connection, wallet, [await lockIx(program, wallet.publicKey, m.publicKey)]);
      note("Rynek zablokowany, pula poszła CPI do yield_park.", sig);
    });

  const resolve = () =>
    run("resolve", async () => {
      if (!program) throw new Error("Połącz wallet.");
      const m = await loadMarket();
      const sig = await resolveWithOracle(program, connection, wallet, m);
      note("Rozliczone z feedu Switchboard (update oracle + resolve w jednej transakcji).", sig);
    });

  const cancel = () =>
    run("cancel", async () => {
      if (!program) throw new Error("Połącz wallet.");
      const m = await loadMarket();
      const sig = await cancelExpired(program, connection, wallet, m.publicKey);
      note("Rynek anulowany po terminie — wszyscy mogą odebrać zwrot.", sig);
    });

  const harvest = () =>
    run("harvest", async () => {
      if (!program) throw new Error("Połącz wallet.");
      const m = await loadMarket();
      const sig = await harvestDust(program, connection, wallet, m.publicKey);
      note("Resztki po zaokrągleniach przeniesione do treasury.", sig);
    });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl font-bold">Admin / Crank</h1>
        <p className="mt-2 max-w-2xl text-sm text-mute">
          Admin może tylko <strong className="text-white">tworzyć rynki</strong>. Wynik pochodzi z
          feedu Switchboard przypiętego przy tworzeniu; admin nie może go zmienić ani wypłacić
          puli. Lock / Resolve / Cancel są publiczne — może je wywołać każdy wallet. Obstawianie:{" "}
          <Link href="/" className="text-accent underline">
            Markets
          </Link>
          .
        </p>
        <p className="mt-2 text-xs text-mute">
          Cluster: <span className="text-white">{DEPLOY.cluster}</span> · RPC: {connection.rpcEndpoint}
          <br />
          Źródło wyniku: <span className="text-white">{eventUrl("<matchId>")}</span>
        </p>
      </div>

      {!connected && (
        <div className="rounded-lg border border-warn/40 bg-warn/10 px-4 py-3 text-sm text-warn">
          Najpierw <strong>Select Wallet</strong> (Phantom) na <strong>Devnet</strong>.
        </div>
      )}
      {connected && (
        <div className="rounded-lg border border-accent/30 bg-accent/5 px-4 py-3 text-sm text-mute">
          Wallet: <span className="text-white">{wallet.publicKey!.toBase58()}</span>{" "}
          {isAdmin ? "(admin)" : "(nie admin — możesz kręcić Lock/Resolve/Cancel)"}
          <br />
          Demo USDC mint: <span className="text-white">{DEPLOY.usdcMint || "—"}</span>
          <br />
          Potrzebujesz tokenów? Przycisk <span className="text-white">Faucet</span> w nagłówku —
          działa dla każdego walletu, 1000 demo-USDC na dobę.
        </div>
      )}

      <section className="space-y-4 rounded-xl border border-white/10 bg-panel p-5">
        <h2 className="font-display text-xl">0. Z terminarza (TheSportsDB)</h2>
        <div className="grid max-h-64 gap-2 overflow-y-auto">
          {(fixturesData?.fixtures ?? []).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => applyFixture(f)}
              className="rounded-lg border border-white/10 bg-ink/60 px-3 py-2 text-left text-sm transition hover:border-accent/40"
            >
              <span className="text-xs uppercase text-mute">
                {CATEGORY_LABELS[f.category]} · {f.league}
              </span>
              <div className="font-display text-base">
                {f.teamA} vs {f.teamB}
              </div>
              <span className="text-xs text-mute">#{f.matchId}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-white/10 bg-panel p-5">
        <div>
          <h2 className="font-display text-xl">1. Utwórz rynek + feed Switchboard</h2>
          <p className="text-sm text-mute">
            Jedna transakcja: tworzy PullFeed z jobem czytającym wynik meczu z TheSportsDB, oddaje
            jego authority do PDA programu (nikt już nie zmieni źródła wyniku) i inicjalizuje rynek
            z przypiętym hashem joba.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Drużyna A" hint="strona 0">
            <input className={inputClass} value={teamA} onChange={(e) => setTeamA(e.target.value)} />
          </Field>
          <Field label="Drużyna B" hint="strona 1">
            <input className={inputClass} value={teamB} onChange={(e) => setTeamB(e.target.value)} />
          </Field>
          <Field label="Match ID" hint="idEvent z TheSportsDB — to po nim oracle czyta wynik.">
            <input className={inputClass} value={matchId} onChange={(e) => setMatchId(e.target.value)} />
          </Field>
          <Field
            label="Minuty do startu (koniec zakładów)"
            hint={`Zakłady do: ${new Date(times.start * 1000).toLocaleString()}`}
          >
            <input
              className={inputClass}
              type="number"
              min={1}
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
          </Field>
          <Field
            label="Czas trwania meczu (min)"
            hint={`Wynik dostępny od: ${new Date(times.end * 1000).toLocaleString()}`}
          >
            <input
              className={inputClass}
              type="number"
              min={1}
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </Field>
          <Field
            label="Okno na wynik oracle (min, ≥5)"
            hint={`Po ${new Date(times.deadline * 1000).toLocaleString()} każdy może anulować → zwrot.`}
          >
            <input
              className={inputClass}
              type="number"
              min={5}
              value={resolveWindow}
              onChange={(e) => setResolveWindow(e.target.value)}
            />
          </Field>
        </div>
        <button
          type="button"
          disabled={!!busy || !connected}
          onClick={createMarket}
          className="rounded-lg bg-accent px-4 py-2 font-medium text-ink disabled:opacity-40"
        >
          {busy === "create" ? "Wysyłanie…" : "Utwórz rynek + feed Switchboard"}
        </button>
        {matchId && (
          <p className="text-xs text-mute">
            Rynek:{" "}
            <Link className="text-accent underline" href={`/markets/${matchId}`}>
              /markets/{matchId}
            </Link>
          </p>
        )}
      </section>

      <section className="space-y-4 rounded-xl border border-white/10 bg-panel p-5">
        <div>
          <h2 className="font-display text-xl">2. Publiczne cranki</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-mute">
            <li>
              <strong className="text-white">Lock</strong> — po starcie: pula idzie CPI do yield_park
            </li>
            <li>
              <strong className="text-white">Resolve</strong> — po końcu meczu: oracle Switchboard
              pobiera wynik, podpisuje, program weryfikuje feed (owner, queue, hash joba, czas
              próbki) i rozlicza
            </li>
            <li>
              <strong className="text-white">Cancel expired</strong> — po terminie bez wyniku:
              zwrot dla wszystkich
            </li>
            <li>
              <strong className="text-white">Harvest dust</strong> — dopiero gdy wszyscy uprawnieni
              odebrali wypłaty
            </li>
          </ol>
        </div>
        <Field label="Match ID">
          <input className={inputClass} value={matchId} onChange={(e) => setMatchId(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!!busy || !connected}
            onClick={lock}
            className="rounded-lg bg-white/10 px-4 py-2 text-sm disabled:opacity-40"
          >
            {busy === "lock" ? "Lock…" : "Lock"}
          </button>
          <button
            type="button"
            disabled={!!busy || !connected}
            onClick={resolve}
            className="rounded-lg bg-accent px-4 py-2 text-sm text-ink disabled:opacity-40"
          >
            {busy === "resolve" ? "Resolve…" : "Resolve (Switchboard)"}
          </button>
          <button
            type="button"
            disabled={!!busy || !connected}
            onClick={cancel}
            className="rounded-lg bg-white/10 px-4 py-2 text-sm disabled:opacity-40"
          >
            {busy === "cancel" ? "…" : "Cancel expired"}
          </button>
          <button
            type="button"
            disabled={!!busy || !connected}
            onClick={harvest}
            className="rounded-lg bg-white/10 px-4 py-2 text-sm disabled:opacity-40"
          >
            {busy === "harvest" ? "…" : "Harvest dust"}
          </button>
        </div>
      </section>

      {(log || lastSig) && (
        <section className="space-y-2 rounded-xl border border-white/10 bg-panel p-4">
          <h3 className="text-sm font-medium text-white">Status / log</h3>
          {log && <pre className="whitespace-pre-wrap break-all text-xs text-mute">{log}</pre>}
          {lastSig && (
            <a
              className="block text-xs text-accent underline"
              href={`https://explorer.solana.com/tx/${lastSig}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
            >
              Otwórz transakcję w Explorer →
            </a>
          )}
        </section>
      )}
    </div>
  );
}
