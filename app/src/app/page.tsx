"use client";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLanguage } from "@/components/Language";
import { getJson } from "@/lib/client";
import {
  CATEGORY_TABS,
  getCategoryMeta,
  type CategoryTabId,
  type FixtureView,
} from "@/lib/fixtures";
import type { MatchView } from "@/lib/views";

export default function Home() {
  const { t, language } = useLanguage();
  const [status, setStatus] = useState("open");
  const [marketCategory, setMarketCategory] = useState<CategoryTabId>("all");
  const [search, setSearch] = useState("");
  const [fixtureCategory, setFixtureCategory] = useState<CategoryTabId>("all");

  const q = useQuery({
    queryKey: ["markets", status],
    queryFn: () =>
      getJson<{ markets: MatchView[]; total: number }>(
        `/api/v1/markets?limit=100${status ? `&status=${status}` : ""}`,
      ),
    refetchInterval: 30000,
  });

  const fixtures = useQuery({
    queryKey: ["fixtures"],
    queryFn: () =>
      getJson<{ fixtures: FixtureView[] }>("/api/fixtures?limit=500"),
    staleTime: 60000,
  });

  const allMarkets = q.data?.markets ?? [];
  const marketCounts = {
    all: allMarkets.length,
    football: allMarkets.filter((m) => (m.category ?? "football") === "football")
      .length,
    esports_cs2: allMarkets.filter((m) => m.category === "esports_cs2").length,
    esports_lol: allMarkets.filter((m) => m.category === "esports_lol").length,
    esports: allMarkets.filter((m) => m.category === "esports").length,
  };

  const rows = allMarkets.filter((m) => {
    const cat = m.category ?? "football";
    const matchCat = marketCategory === "all" || cat === marketCategory;
    const qLower = search.toLowerCase();
    const matchSearch =
      !search ||
      m.teams.join(" ").toLowerCase().includes(qLower) ||
      (m.league && m.league.toLowerCase().includes(qLower)) ||
      m.id.includes(search);
    return matchCat && matchSearch;
  });

  const allFixtures = fixtures.data?.fixtures ?? [];
  const fixtureCounts = {
    all: allFixtures.length,
    football: allFixtures.filter((f) => f.category === "football").length,
    esports_cs2: allFixtures.filter((f) => f.category === "esports_cs2").length,
    esports_lol: allFixtures.filter((f) => f.category === "esports_lol").length,
    esports: allFixtures.filter((f) => f.category === "esports").length,
  };

  const filteredFixtures = allFixtures
    .filter((f) => fixtureCategory === "all" || f.category === fixtureCategory)
    .slice(0, 24);

  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">
            {t("SPORTS. SHARED POOLS. SOLANA.", "SPORT. WSPÓLNE PULE. SOLANA.")}
          </p>
          <h1>
            {t("Your side.\nYour stake.", "Twoja strona.\nTwoja stawka.")}
          </h1>
          <p className="hero-copy">
            {t(
              "Real matches, transparent pools and results verified by Switchboard. A wallet is all you need.",
              "Prawdziwe mecze, przejrzyste pule i wyniki weryfikowane przez Switchboard. Wystarczy portfel.",
            )}
          </p>
          <a className="primary button" href="#markets">
            {t("Explore matches", "Przeglądaj mecze")} <span>↗</span>
          </a>
        </div>
        <aside className="hero-aside">
          <p className="eyebrow">
            {t("THE RULES ARE ON-CHAIN", "ZASADY ZAPISANE ON-CHAIN")}
          </p>
          <strong>
            0.5<span>%</span>
          </strong>
          <p>
            {t(
              "of positive profit on new match markets",
              "dodatniego zysku w nowych rynkach meczów",
            )}
          </p>
          <div className="divider" />
          <p>
            {t(
              "Season markets: 0% fee. Protocol revenue comes from demo yield.",
              "Rynki sezonowe: 0% prowizji. Przychód protokołu z demonstracyjnego yieldu.",
            )}
          </p>
          <small>
            {t(
              "Devnet only · demo-USDC has no monetary value",
              "Tylko devnet · demo-USDC nie ma wartości pieniężnej",
            )}
          </small>
        </aside>
      </section>

      <section id="markets">
        <div className="section-heading">
          <div>
            <p className="eyebrow">{t("THE MATCH BOARD", "TABLICA MECZÓW")}</p>
            <h2>{t("Pick your match", "Wybierz swój mecz")}</h2>
          </div>
          <span className="muted">
            {q.data?.total ?? "—"} {t("markets", "rynków")}
          </span>
        </div>

        {/* Category Tabs: Football, CS2, LoL, Esports */}
        <div
          className="category-bar"
          role="tablist"
          aria-label={t("Filter by sport or esports", "Filtruj wg sportu lub e-sportu")}
        >
          {CATEGORY_TABS.map((cat) => {
            const isSelected = marketCategory === cat.id;
            const count = marketCounts[cat.id as keyof typeof marketCounts] ?? 0;
            return (
              <button
                key={cat.id}
                role="tab"
                aria-selected={isSelected}
                className={`category-tab ${isSelected ? "selected" : ""}`}
                onClick={() => setMarketCategory(cat.id)}
              >
                <span className="cat-icon">{cat.icon}</span>
                <span className="cat-label">
                  {language === "pl" ? cat.labelPl : cat.labelEn}
                </span>
                <span className="cat-count">{count}</span>
              </button>
            );
          })}
        </div>

        <div className="toolbar">
          <div className="tabs">
            {[
              ["open", t("Upcoming", "Nadchodzące")],
              ["locked", t("In play", "W grze")],
              ["resolved", t("Settled", "Rozliczone")],
              ["cancelled", t("Refunds", "Zwroty")],
              ["", t("All", "Wszystkie")],
            ].map(([id, label]) => (
              <button
                key={id}
                className={status === id ? "selected" : ""}
                onClick={() => setStatus(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <input
            aria-label={t("Search matches", "Szukaj meczów")}
            placeholder={t(
              "Search team, league or ID…",
              "Szukaj drużyny, ligi lub ID…",
            )}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {q.isPending && (
          <p className="notice">
            {t("Loading on-chain markets…", "Wczytywanie rynków on-chain…")}
          </p>
        )}
        {q.isError && (
          <div className="notice error">
            {t(
              "The network is unavailable. Your funds remain on-chain.",
              "Sieć jest niedostępna. Środki pozostają on-chain.",
            )}{" "}
            <button onClick={() => q.refetch()}>{t("Retry", "Ponów")}</button>
          </div>
        )}
        {q.isSuccess && rows.length === 0 && (
          <p className="notice">
            {t(
              "No matches in this view. Try another category or filter.",
              "Brak meczów w tym widoku. Zmień kategorię lub filtr.",
            )}
          </p>
        )}

        <div className="market-grid">
          {rows.map((m) => {
            const catMeta = getCategoryMeta(m.category);
            return (
              <Link href={`/markets/${m.id}`} className="market-card" key={m.id}>
                <div className="card-top">
                  <div className="card-badges">
                    <span className={`status ${m.status}`}>
                      {m.status === "locked" &&
                      Math.floor(Date.now() / 1000) >= m.endTime
                        ? t("Awaiting result", "Oczekuje na wynik")
                        : t(
                            m.status,
                            (
                              {
                                open: "Otwarty",
                                locked: "W grze",
                                resolved: "Rozliczony",
                                cancelled: "Zwrot",
                              } as any
                            )[m.status],
                          )}
                    </span>
                    <span
                      className={`category-badge ${m.category ?? "football"}`}
                      title={m.league ?? undefined}
                    >
                      {catMeta.icon}{" "}
                      {m.league ||
                        (language === "pl"
                          ? catMeta.shortLabel
                          : catMeta.labelEn)}
                      {m.format ? ` · ${m.format}` : ""}
                    </span>
                  </div>
                  <small>#{m.id}</small>
                </div>
                <p className="kickoff">
                  {new Date(m.startTime * 1000).toLocaleString(
                    language === "pl" ? "pl-PL" : "en-GB",
                    { dateStyle: "medium", timeStyle: "short" },
                  )}
                </p>
                <h3>
                  {m.teams[0]}
                  <span className="versus">vs</span>
                  {m.teams[1]}
                </h3>
                <div className="pool-pair">
                  {m.teams.map((team, i) => (
                    <div key={i}>
                      <small>{team}</small>
                      <strong>
                        {Number(m.pools[i]).toLocaleString(language)}{" "}
                        <small>USDC</small>
                      </strong>
                      <span>
                        {m.odds[i] === null ? "—" : `${m.odds[i]!.toFixed(2)}×`}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="card-bottom">
                  {m.waitingForCounterBets ? (
                    <span>
                      {t("Waiting for counter-bets", "Czekamy na drugą stronę")}
                    </span>
                  ) : (
                    <span>{t("View pool", "Zobacz pulę")} ↗</span>
                  )}
                  <small>
                    {m.feeBps / 100}% {t("profit fee", "od zysku")}
                  </small>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {fixtures.data && (
        <section className="catalog-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">
                {t("FROM THE FIXTURE CATALOG", "Z KATALOGU WYDARZEŃ")}
              </p>
              <h2>{t("On the horizon", "Na horyzoncie")}</h2>
            </div>
            <span className="muted">
              {filteredFixtures.length} / {allFixtures.length}{" "}
              {t("events", "wydarzeń")}
            </span>
          </div>

          {/* Fixture Catalog Category Tabs */}
          <div
            className="category-bar"
            role="tablist"
            aria-label={t("Filter catalog by sport or esports", "Filtruj katalog wg dyscypliny")}
          >
            {CATEGORY_TABS.map((cat) => {
              const isSelected = fixtureCategory === cat.id;
              const count =
                fixtureCounts[cat.id as keyof typeof fixtureCounts] ?? 0;
              return (
                <button
                  key={cat.id}
                  role="tab"
                  aria-selected={isSelected}
                  className={`category-tab ${isSelected ? "selected" : ""}`}
                  onClick={() => setFixtureCategory(cat.id)}
                >
                  <span className="cat-icon">{cat.icon}</span>
                  <span className="cat-label">
                    {language === "pl" ? cat.labelPl : cat.labelEn}
                  </span>
                  <span className="cat-count">{count}</span>
                </button>
              );
            })}
          </div>

          {filteredFixtures.length === 0 ? (
            <p className="notice">
              {t(
                "No upcoming fixtures found in this category.",
                "Brak nadchodzących wydarzeń w tej kategorii.",
              )}
            </p>
          ) : (
            <div className="fixture-list">
              {filteredFixtures.map((f) => {
                const fCatMeta = getCategoryMeta(f.category);
                return (
                  <div key={f.id} className="fixture-row">
                    <div className="fixture-main">
                      <div className="fixture-meta">
                        <span className={`category-tag ${f.category}`}>
                          {fCatMeta.icon} {fCatMeta.shortLabel}
                        </span>
                        <small>{f.league}</small>
                        {f.format && (
                          <small className="fixture-format">· {f.format}</small>
                        )}
                      </div>
                      <strong>
                        {f.teamA} — {f.teamB}
                      </strong>
                    </div>
                    <span>
                      {new Date(f.startTime * 1000).toLocaleDateString(language)}
                      <small>
                        {f.timeTBD
                          ? t("Time to be confirmed", "Godzina do ustalenia")
                          : new Date(f.startTime * 1000).toLocaleTimeString(
                              language,
                              { hour: "2-digit", minute: "2-digit" },
                            )}
                      </small>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      <footer>
        {t(
          "Pool odds change until betting closes. Draws and cancellations return stakes. Network fees apply.",
          "Kursy zmieniają się do zamknięcia zakładów. Remisy i anulowania oznaczają zwrot stawek. Obowiązują opłaty sieciowe.",
        )}
      </footer>
    </>
  );
}
