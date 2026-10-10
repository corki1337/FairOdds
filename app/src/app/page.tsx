"use client";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLanguage } from "@/components/Language";
import { getJson } from "@/lib/client";
import type { MatchView } from "@/lib/views";
export default function Home() {
  const { t, language } = useLanguage();
  const [status, setStatus] = useState("open"),
    [search, setSearch] = useState("");
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
    queryFn: () => getJson<{ fixtures: any[] }>("/api/fixtures?limit=24"),
    staleTime: 60000,
  });
  const rows = (q.data?.markets ?? []).filter(
    (m) =>
      m.teams.join(" ").toLowerCase().includes(search.toLowerCase()) ||
      m.id.includes(search),
  );
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
              "Search team or match ID…",
              "Szukaj drużyny lub numeru…",
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
              "No matches in this view. Try another filter.",
              "Brak meczów w tym widoku. Zmień filtr.",
            )}
          </p>
        )}
        <div className="market-grid">
          {rows.map((m) => (
            <Link href={`/markets/${m.id}`} className="market-card" key={m.id}>
              <div className="card-top">
                <span className={`status ${m.status}`}>
                  {t(
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
          ))}
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
          </div>
          <div className="fixture-list">
            {fixtures.data.fixtures.map((f) => (
              <div key={f.id} className="fixture-row">
                <div>
                  <small>{f.league}</small>
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
            ))}
          </div>
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
