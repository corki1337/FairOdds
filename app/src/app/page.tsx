"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useAichainProgram } from "@/lib/hooks/useProgram";
import { decodeTeamName, impliedOdds, statusKey } from "@/lib/anchor";
import {
  CATEGORY_NAV,
  scoreLabel,
  type FixtureCategoryId,
  type FixtureView,
} from "@/lib/fixtures";

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

type FixturesResponse = {
  provider: string;
  lookupUrl: string;
  categories: { id: FixtureCategoryId; label: string }[];
  leagues: string[];
  fixtures: FixtureView[];
  total: number;
  meta?: { count?: number; upcoming?: number; fetchedAt?: string };
};

type SortKey = "time" | "time_desc" | "league";

function formatKickoff(ts: number) {
  const d = new Date(ts * 1000);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

function MatchRow({
  timeLabel,
  league,
  title,
  subtitle,
  odds,
  statusLabel,
  href,
  accent,
}: {
  timeLabel: string;
  league: string;
  title: string;
  subtitle: string;
  /** Pool-implied payout multipliers, or null for fixtures with no market yet. */
  odds: { a: number; b: number } | null;
  statusLabel: string;
  href?: string;
  accent?: boolean;
}) {
  const className = `grid grid-cols-1 gap-2 px-4 py-3 transition md:grid-cols-[72px_1fr_88px_88px_110px] md:items-center md:gap-2 ${
    href ? "hover:bg-white/[0.06] cursor-pointer" : "opacity-60"
  } ${accent ? "bg-accent/5" : ""}`;

  const cell = (v: number | null) => (
    <div className="rounded-md bg-ink px-2 py-2 text-center text-sm font-medium text-accent">
      {v === null ? <span className="text-mute">—</span> : v.toFixed(2)}
    </div>
  );

  const inner = (
    <>
      <div className="text-xs text-mute md:pt-1">
        <div className="font-medium text-white/90">{timeLabel}</div>
        <div className="truncate">{league}</div>
      </div>
      <div className="min-w-0">
        <div className="truncate font-display text-base">{title}</div>
        <div className="truncate text-[11px] text-mute">{subtitle}</div>
      </div>
      {cell(odds ? odds.a : null)}
      {cell(odds ? odds.b : null)}
      <div className="text-right text-[10px] uppercase tracking-wide">
        <span className={href ? "text-accent" : "text-mute"}>{statusLabel}</span>
      </div>
    </>
  );

  if (href) {
    return (
      <li>
        <Link href={href} className={className}>
          {inner}
        </Link>
      </li>
    );
  }
  return <li className={className}>{inner}</li>;
}

export default function HomePage() {
  const program = useAichainProgram();
  const [category, setCategory] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("scheduled");
  const [sort, setSort] = useState<SortKey>("time");
  const [league, setLeague] = useState<string>("");
  const [q, setQ] = useState("");
  const [browseCatalog, setBrowseCatalog] = useState(false);

  const { data: catalog, isLoading } = useQuery({
    queryKey: ["fixtures", category, statusFilter, sort, league, q],
    queryFn: async (): Promise<FixturesResponse> => {
      const params = new URLSearchParams({
        limit: "150",
        sort,
        status: statusFilter,
      });
      if (category !== "all") params.set("category", category);
      if (league) params.set("league", league);
      if (q.trim()) params.set("q", q.trim());
      const res = await fetch(`/api/fixtures?${params}`);
      if (!res.ok) throw new Error("fixtures failed");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const { data: markets = [], isLoading: marketsLoading } = useQuery({
    queryKey: ["markets", program?.programId.toBase58()],
    queryFn: async (): Promise<MarketRow[]> => {
      if (!program) return [];
      // v1 markets share the discriminator but not the layout; only decode v2-sized accounts.
      const all = await program.account.marketState.all([
        { dataSize: program.account.marketState.size },
      ]);
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

  const onChainByMatchId = useMemo(() => {
    const map = new Map<string, MarketRow>();
    for (const m of markets) map.set(m.matchId, m);
    return map;
  }, [markets]);

  const openMarkets = useMemo(() => {
    return [...markets]
      .filter((m) => m.status === "open")
      .sort((a, b) => a.startTime - b.startTime);
  }, [markets]);

  const otherMarkets = useMemo(() => {
    return [...markets]
      .filter((m) => m.status !== "open")
      .sort((a, b) => b.startTime - a.startTime);
  }, [markets]);

  const catalogRows = useMemo(() => {
    return catalog?.fixtures ?? [];
  }, [catalog]);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-mute">
          Bukmacher pari-mutuel · Solana Devnet
        </p>
        <h1 className="font-display text-3xl font-bold md:text-4xl">
          Obstawiaj <span className="text-accent">prawdziwe mecze</span>
        </h1>
        <p className="max-w-2xl text-sm text-mute">
          Zakłady przyjmujemy do pierwszego gwizdka. Kursy wynikają wyłącznie z podziału puli, a
          wynik meczu zaciągają oracle Switchboard prosto z{" "}
          <span className="text-white">TheSportsDB</span> — nasz serwer nie bierze udziału w
          rozliczeniu. Remis = zwrot stawek.
        </p>
      </header>

      {/* PRIMARY: real bettable markets */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="font-display text-xl font-semibold">Rynki on-chain</h2>
            <p className="text-xs text-mute">
              {marketsLoading
                ? "Ładowanie z Devnet…"
                : openMarkets.length > 0
                  ? `${openMarkets.length} otwartych do kickoffu — prematch, nie live in-play`
                  : markets.length > 0
                    ? "Brak otwartych — po starcie meczu betting się zamyka (lock). Admin: nowe rynki."
                    : "Brak rynków on-chain. Admin → fixture → Initialize, albo scripts/create-from-fixture.ts"}
            </p>
          </div>
          <Link href="/admin" className="text-xs text-accent underline">
            Admin: utwórz rynek
          </Link>
        </div>

        <div className="overflow-hidden rounded-xl border border-accent/30">
          <div className="hidden grid-cols-[72px_1fr_88px_88px_110px] gap-2 border-b border-white/10 bg-ink/80 px-4 py-2 text-[10px] uppercase tracking-wider text-mute md:grid">
            <span>Lock</span>
            <span>Mecz</span>
            <span className="text-center">1</span>
            <span className="text-center">2</span>
            <span className="text-right">Akcja</span>
          </div>
          <ul className="divide-y divide-white/5 bg-panel/60">
            {openMarkets.map((m) => {
              const total = m.poolA + m.poolB;
              const fix = catalogRows.find((f) => f.matchId === m.matchId);
              return (
                <MatchRow
                  key={m.publicKey}
                  accent
                  href={`/markets/${m.matchId}`}
                  timeLabel={formatKickoff(m.startTime)}
                  league={fix?.league || "on-chain"}
                  title={`${m.teamA} – ${m.teamB}`}
                  subtitle={`#${m.matchId} · pula ${total.toFixed(0)} USDC · wynik: TheSportsDB`}
                  odds={{
                    a: impliedOdds(m.poolA * 1e6 || 1, total * 1e6 || 1),
                    b: impliedOdds(m.poolB * 1e6 || 1, total * 1e6 || 1),
                  }}
                  statusLabel="Obstaw →"
                />
              );
            })}
            {!marketsLoading && openMarkets.length === 0 && (
              <li className="px-4 py-8 text-center text-sm text-mute">
                Nie ma otwartego rynku do obstawienia.{" "}
                <Link href="/admin" className="text-accent underline">
                  Utwórz w Admin
                </Link>
              </li>
            )}
          </ul>
        </div>

        {otherMarkets.length > 0 && (
          <details className="rounded-xl border border-white/10 bg-panel/40">
            <summary className="cursor-pointer px-4 py-3 text-sm text-mute">
              Zamknięte / rozliczone ({otherMarkets.length})
            </summary>
            <ul className="divide-y divide-white/5 border-t border-white/10">
              {otherMarkets.map((m) => {
                const total = m.poolA + m.poolB;
                return (
                  <MatchRow
                    key={m.publicKey}
                    href={`/markets/${m.matchId}`}
                    timeLabel={formatKickoff(m.startTime)}
                    league="on-chain"
                    title={`${m.teamA} – ${m.teamB}`}
                    subtitle={`#${m.matchId} · ${m.status}`}
                    odds={{
                      a: impliedOdds(m.poolA * 1e6 || 1, total * 1e6 || 1),
                      b: impliedOdds(m.poolB * 1e6 || 1, total * 1e6 || 1),
                    }}
                    statusLabel={m.status}
                  />
                );
              })}
            </ul>
          </details>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <aside className="h-fit rounded-xl border border-white/10 bg-panel/80 p-3 lg:sticky lg:top-20">
          <p className="mb-2 px-2 text-[10px] uppercase tracking-wider text-mute">Dyscyplina</p>
          <nav className="flex flex-row flex-wrap gap-1 lg:flex-col lg:flex-nowrap">
            {CATEGORY_NAV.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => {
                  setCategory(c.id);
                  setLeague("");
                  setBrowseCatalog(true);
                }}
                className={`rounded-lg px-3 py-2 text-left text-sm transition ${
                  browseCatalog && category === c.id
                    ? "bg-accent font-medium text-ink"
                    : "text-mute hover:bg-white/5 hover:text-white"
                }`}
              >
                {c.label}
              </button>
            ))}
          </nav>
          <div className="mt-4 border-t border-white/10 pt-3">
            <p className="mb-2 px-2 text-[10px] uppercase tracking-wider text-mute">Status</p>
            <div className="flex flex-col gap-1">
              {(
                [
                  ["scheduled", "Nadchodzące"],
                  ["live", "Trwające"],
                  ["finished", "Zakończone"],
                  ["all", "Wszystkie"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => {
                    setStatusFilter(id);
                    setBrowseCatalog(true);
                  }}
                  className={`rounded-lg px-3 py-1.5 text-left text-sm ${
                    statusFilter === id ? "bg-white/15 text-white" : "text-mute hover:bg-white/5"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </aside>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-xl font-semibold">Terminarz</h2>
              <p className="text-xs text-mute">
                Prawdziwe mecze z TheSportsDB ({catalog?.meta?.count ?? 0} w katalogu). Zielone
                „Obstaw” = rynek już istnieje on-chain.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setBrowseCatalog((v) => !v)}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs text-mute hover:text-white"
            >
              {browseCatalog ? "Zwiń katalog" : "Pokaż katalog"}
            </button>
          </div>

          {browseCatalog && (
            <>
              <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-panel/60 p-3 md:flex-row md:flex-wrap md:items-center">
                <label className="flex min-w-[160px] flex-1 flex-col gap-1 text-xs text-mute">
                  Szukaj
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="drużyna, liga, ID…"
                    className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-sm text-white"
                  />
                </label>
                <label className="flex flex-col gap-1 text-xs text-mute">
                  Sortowanie
                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as SortKey)}
                    className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-sm text-white"
                  >
                    <option value="time">Czas (najbliższe)</option>
                    <option value="time_desc">Czas (najnowsze)</option>
                    <option value="league">Liga A–Z</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs text-mute">
                  Liga
                  <select
                    value={league}
                    onChange={(e) => setLeague(e.target.value)}
                    className="rounded-lg border border-white/10 bg-ink px-3 py-2 text-sm text-white"
                  >
                    <option value="">Wszystkie ligi</option>
                    {(catalog?.leagues ?? []).map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <p className="text-xs text-mute">
                {isLoading
                  ? "Ładowanie…"
                  : `${catalogRows.length} z ${catalog?.total ?? 0} · on-chain w tym widoku: ${
                      catalogRows.filter((f) => onChainByMatchId.has(f.matchId)).length
                    }`}
              </p>

              <div className="overflow-hidden rounded-xl border border-white/10">
                <div className="hidden grid-cols-[72px_1fr_88px_88px_110px] gap-2 border-b border-white/10 bg-ink/80 px-4 py-2 text-[10px] uppercase tracking-wider text-mute md:grid">
                  <span>Czas</span>
                  <span>Mecz</span>
                  <span className="text-center">1</span>
                  <span className="text-center">2</span>
                  <span className="text-right">Status</span>
                </div>
                <ul className="divide-y divide-white/5 bg-panel/40">
                  {catalogRows.map((f) => {
                    const onChain = onChainByMatchId.get(f.matchId);
                    const pool = onChain ? onChain.poolA + onChain.poolB : 0;
                    const score = scoreLabel(f);
                    return (
                      <MatchRow
                        key={f.id}
                        href={onChain ? `/markets/${f.matchId}` : undefined}
                        accent={!!onChain}
                        timeLabel={formatKickoff(f.startTime)}
                        league={f.league}
                        title={`${f.teamA} – ${f.teamB}`}
                        subtitle={[
                          `#${f.matchId}`,
                          score && `wynik ${score}`,
                          onChain ? `pula ${pool.toFixed(0)} USDC` : "brak rynku on-chain",
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                        odds={
                          onChain
                            ? {
                                a: impliedOdds(onChain.poolA * 1e6 || 1, pool * 1e6 || 1),
                                b: impliedOdds(onChain.poolB * 1e6 || 1, pool * 1e6 || 1),
                              }
                            : null
                        }
                        statusLabel={
                          onChain
                            ? onChain.status === "open"
                              ? "Obstaw →"
                              : onChain.status
                            : f.status
                        }
                      />
                    );
                  })}
                  {!isLoading && catalogRows.length === 0 && (
                    <li className="px-4 py-8 text-center text-sm text-mute">
                      Brak meczów dla tych filtrów.
                    </li>
                  )}
                </ul>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
