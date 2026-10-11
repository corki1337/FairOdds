"use client";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useLanguage } from "@/components/Language";
import { getJson } from "@/lib/client";
import type { SeasonView } from "@/lib/views";
export default function Seasons() {
  const { t, language } = useLanguage();
  const q = useQuery({
    queryKey: ["seasons"],
    queryFn: () => getJson<{ markets: SeasonView[] }>("/api/v1/seasons"),
    refetchInterval: 30000,
  });
  const now = Math.floor(Date.now() / 1000);
  return (
    <>
      <section className="hero">
        <div>
          <p className="eyebrow">{t("THE LONG GAME", "DŁUGA GRA")}</p>
          <h1>
            {t(
              "A whole season.\nZero platform fee.",
              "Cały sezon.\nZero prowizji.",
            )}
          </h1>
          <p className="hero-copy">
            {t(
              "Choose a league champion or top scorer. Multiple participants, one shared pool. The protocol receives demo yield; winners share the principal.",
              "Wybierz mistrza ligi lub króla strzelców. Wielu uczestników, jedna wspólna pula. Protokół otrzymuje demonstracyjny yield; zwycięzcy dzielą kapitał.",
            )}
          </p>
        </div>
        <aside className="hero-aside">
          <p className="eyebrow">{t("SEASON MARKETS", "RYNKI SEZONOWE")}</p>
          <strong>
            0<span>%</span>
          </strong>
          <p>
            {t(
              "Two independent feeds must agree after the season is final. A tie means a refund.",
              "Dwa niezależne feedy muszą być zgodne po zakończeniu sezonu. Remis oznacza zwrot.",
            )}
          </p>
        </aside>
      </section>
      {q.isPending && (
        <p className="notice">
          {t("Loading seasons…", "Wczytywanie sezonów…")}
        </p>
      )}
      {q.isError && (
        <p className="notice error">
          {t("Network unavailable", "Sieć niedostępna")}{" "}
          <button onClick={() => q.refetch()}>{t("Retry", "Ponów")}</button>
        </p>
      )}
      {q.isSuccess && q.data.markets.length === 0 && (
        <p className="notice">
          {t(
            "No season markets have been created yet.",
            "Nie utworzono jeszcze rynków sezonowych.",
          )}
        </p>
      )}
      <div className="market-grid">
        {q.data?.markets.map((m) => (
          <Link className="market-card" key={m.id} href={`/seasons/${m.id}`}>
            <div className="card-top">
              <span
                className={`status ${
                  m.status === "resolved" || m.status === "cancelled"
                    ? m.status
                    : now >= m.endTime
                      ? "locked"
                      : now >= m.cutoff
                        ? "locked"
                        : "open"
                }`}
              >
                {m.status === "resolved"
                  ? t("Resolved", "Rozliczony")
                  : m.status === "cancelled"
                    ? t("Cancelled", "Zwrot")
                    : now >= m.endTime
                      ? t("Awaiting result", "Oczekuje na wynik")
                      : now >= m.cutoff
                        ? t("In play", "W grze")
                        : t("Open", "Otwarty")}
              </span>
              <span className="badge" style={{ fontSize: "11px", opacity: 0.85 }}>
                {m.kind === 0
                  ? t("Champion", "Mistrz")
                  : t("Top scorer", "Król strzelców")}
              </span>
              <small>{t("0% fee", "0% prowizji")}</small>
            </div>
            <h3>{m.title}</h3>
            {m.historicalDemo && (
              <p className="muted">
                {t(
                  "Historical demo · result already known · demo tokens only",
                  "Demo historyczne · wynik już znany · tylko tokeny demo",
                )}
              </p>
            )}
            <p className="kickoff">
              {t("Betting closes", "Koniec zakładów")}:{" "}
              {new Date(m.cutoff * 1000).toLocaleString(language)}
            </p>
            <p>
              {m.participants.length} {t("participants", "uczestników")} ·{" "}
              {(Number(m.totalPoolUnits) / 1e6).toLocaleString(language)} USDC
            </p>
            <div className="card-bottom">
              {t("Explore season", "Zobacz sezon")} ↗
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
