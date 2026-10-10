"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useLanguage } from "@/components/Language";
import { useAichainProgram } from "@/lib/hooks/useProgram";
import { globalPda } from "@/lib/anchor";
import { createMarketTx } from "@/lib/cranks";
import { createSeasonTx } from "@/lib/seasons";
import { getJson } from "@/lib/client";
import type { Fixture } from "@/lib/fixtures";
import type { SeasonManifest } from "@/lib/season-jobs";
export default function Admin() {
  const { t, language } = useLanguage(),
    wallet = useWallet(),
    { connection } = useConnection(),
    program = useAichainProgram(),
    qc = useQueryClient();
  const [kind, setKind] = useState("match"),
    [selected, setSelected] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [sig, setSig] = useState("");
  const fixtures = useQuery({
    queryKey: ["admin-fixtures"],
    queryFn: () =>
      getJson<{ fixtures: Fixture[] }>(
        "/api/fixtures?status=scheduled&limit=500",
      ),
  });
  const seasons = useQuery({
    queryKey: ["season-manifests"],
    queryFn: () =>
      getJson<{ manifests: SeasonManifest[] }>("/api/v1/seasons/catalog"),
  });
  const global = useQuery({
    queryKey: ["global", wallet.publicKey?.toBase58()],
    queryFn: async () =>
      await (program!.account as any).globalConfig.fetch(
        globalPda(program!.programId)[0],
      ),
    enabled: !!program,
  });
  const authorized =
    !!wallet.publicKey && global.data?.authority.equals(wallet.publicKey);
  const f = fixtures.data?.fixtures.find((f) => String(f.id) === selected),
    s = seasons.data?.manifests.find((m) => m.id === selected);
  async function create() {
    if (!program) return;
    setBusy(true);
    setError("");
    try {
      let signature: string;
      if (kind === "match" && f) {
        signature = (
          await createMarketTx(program, connection, wallet, {
            matchId: String(f.id),
            teamA: f.teamA,
            teamB: f.teamB,
            start: f.startTime,
            end: f.endTime,
            resolveDeadline: f.endTime + 2 * 86400,
            secondary: f.sources.openligadb
              ? { source: 1, sourceRef: f.sources.openligadb }
              : undefined,
          })
        ).sig;
      } else if (s) {
        signature = await createSeasonTx(program, connection, wallet, s);
      } else throw new Error(t("Select a market", "Wybierz rynek"));
      setSig(signature);
      await qc.invalidateQueries();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="detail-header">
        <p className="eyebrow">{t("MARKET CREATOR", "TWORZENIE RYNKÓW")}</p>
        <h1>{t("Open a new pool", "Otwórz nową pulę")}</h1>
        <p className="hero-copy">
          {t(
            "Market parameters and oracle feeds are pinned before the first stake. Only the configured authority can create markets.",
            "Parametry rynku i feedy oracle są przypinane przed pierwszą stawką. Rynki tworzy wyłącznie skonfigurowana authority.",
          )}
        </p>
      </div>
      <div className="detail-layout">
        <section className="panel bet-form">
          <div className="tabs">
            <button
              className={kind === "match" ? "selected" : ""}
              onClick={() => {
                setKind("match");
                setSelected("");
              }}
            >
              {t("Match", "Mecz")}
            </button>
            <button
              className={kind === "season" ? "selected" : ""}
              onClick={() => {
                setKind("season");
                setSelected("");
              }}
            >
              {t("Season", "Sezon")}
            </button>
          </div>
          <label>
            {t("Event", "Wydarzenie")}
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">{t("Select…", "Wybierz…")}</option>
              {kind === "match"
                ? fixtures.data?.fixtures
                    .filter((f) => f.marketable && !f.timeTBD)
                    .map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.teamA} vs {f.teamB} ·{" "}
                        {new Date(f.startTime * 1000).toLocaleString(language)}
                      </option>
                    ))
                : seasons.data?.manifests.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.title}
                    </option>
                  ))}
            </select>
          </label>
          {kind === "season" && !seasons.data?.manifests.length && (
            <p className="notice">
              {t(
                "Configure the season manifest first. See docs/SEASON_MARKETS.md.",
                "Najpierw skonfiguruj manifest sezonu. Instrukcja: docs/SEASON_MARKETS.md.",
              )}
            </p>
          )}
          {!authorized && (
            <p className="notice">
              {t(
                "Connect the market authority wallet to create a pool.",
                "Połącz portfel authority, aby utworzyć pulę.",
              )}
            </p>
          )}
          <button
            className="primary button"
            onClick={create}
            disabled={!authorized || busy || !selected}
          >
            {busy
              ? t(
                  "Confirm transactions in wallet…",
                  "Potwierdź transakcje w portfelu…",
                )
              : t("Create market", "Utwórz rynek")}
          </button>
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          {sig && (
            <a
              className="tx-link"
              href={`https://explorer.solana.com/tx/${sig}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
            >
              {t("Market created", "Rynek utworzony")} ↗
            </a>
          )}
        </section>
        <aside className="panel">
          <h2>{t("Fixed rules", "Stałe zasady")}</h2>
          <div className="stat-row">
            <span>{t("Network", "Sieć")}</span>Devnet
          </div>
          <div className="stat-row">
            <span>{t("Token", "Token")}</span>demo-USDC
          </div>
          <div className="stat-row">
            <span>{t("Fee", "Opłata")}</span>
            {kind === "match" ? "0.5%" : "0%"}
          </div>
          <p className="muted">
            {kind === "match"
              ? t(
                  "Fee applies only to positive profit. A one-sided pool is cancelled at kickoff.",
                  "Opłata tylko od dodatniego zysku. Jednostronna pula anulowana od kickoffu.",
                )
              : t(
                  "Two independent sources, confirmed finality and a fixed participant mapping. Tied scorers refund all stakes.",
                  "Dwa niezależne źródła, potwierdzona finalność i stałe mapowanie uczestników. Remis strzelców oznacza zwrot stawek.",
                )}
          </p>
        </aside>
      </div>
    </>
  );
}
