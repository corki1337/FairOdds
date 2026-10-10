"use client";
import Link from "next/link";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { useLanguage } from "./Language";
import { useAichainProgram } from "@/lib/hooks/useProgram";
import { getJson, preparedBet } from "@/lib/client";
import {
  receiptPda,
  policyPda,
  globalPda,
  treasuryPda,
  vaultPda,
} from "@/lib/anchor";
import { seasonReceiptPda, settleSeasonTx } from "@/lib/seasons";
import { sendV0, resolveWithOracle, cancelExpired, lockIx } from "@/lib/cranks";
import { parseUSDC, formatUSDC, quote } from "@/lib/money";
import type { MatchView, SeasonView } from "@/lib/views";
export function MarketDetail({ season = false }: { season?: boolean }) {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { t, language } = useLanguage();
  const wallet = useWallet();
  const { connection } = useConnection();
  const program = useAichainProgram();
  const qc = useQueryClient();
  const [side, setSide] = useState(0),
    [amount, setAmount] = useState("10"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [signature, setSignature] = useState(""),
    [now, setNow] = useState(Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, []);
  const endpoint = season ? "seasons" : "markets";
  const q = useQuery({
    queryKey: [endpoint, id],
    queryFn: () => getJson<MatchView | SeasonView>(`/api/v1/${endpoint}/${id}`),
    refetchInterval: 15000,
  });
  const rq = useQuery({
    queryKey: ["receipt", endpoint, id, wallet.publicKey?.toBase58()],
    queryFn: async () => {
      const market = new PublicKey(q.data!.address);
      const user = wallet.publicKey!;
      const key = season
        ? seasonReceiptPda(program!.programId, market, user)[0]
        : receiptPda(program!.programId, market, user)[0];
      return await (program!.account as any)[
        season ? "seasonReceipt" : "userBetReceipt"
      ].fetchNullable(key);
    },
    enabled: !!program && !!wallet.publicKey && !!q.data,
    refetchInterval: 15000,
  });
  if (q.isPending)
    return (
      <p className="notice">{t("Loading market…", "Wczytywanie rynku…")}</p>
    );
  if (q.isError)
    return (
      <p className="notice error">
        {t("Could not load this market.", "Nie udało się wczytać rynku.")}{" "}
        <button onClick={() => q.refetch()}>{t("Retry", "Ponów")}</button>
      </p>
    );
  const m = q.data;
  const match = m as MatchView,
    ss = m as SeasonView;
  const receipt = rq.data;
  const teams = season ? ss.participants.map((p) => p.name) : match.teams;
  const pools = season ? ss.participants.map((p) => p.pool) : match.pools;
  const units = season
    ? ss.participants.map((p) => BigInt(p.units))
    : match.poolUnits.map(BigInt);
  const odds = season ? ss.participants.map((p) => p.odds) : match.odds;
  const cutoff = season ? ss.cutoff : match.startTime;
  const activeSide = receipt
    ? season
      ? receipt.selected
      : receipt.teamSelected
    : side;
  const stake = receipt
    ? BigInt((season ? receipt.amount : receipt.amountStaked).toString())
    : 0n;
  const winner = season ? ss.winner : match.winningTeam;
  const closed = m.status !== "open" || now >= cutoff;
  const total = units.reduce((a, b) => a + b, 0n);
  let projection: { net: bigint; fee: bigint } | null = null;
  try {
    projection = quote(
      parseUSDC(amount),
      units[activeSide],
      total - units[activeSide],
      m.feeBps,
    );
  } catch {}
  const claimed = !!receipt?.claimed;
  const canClaim =
    !!receipt &&
    !claimed &&
    (m.status === "cancelled" ||
      (m.status === "resolved" && winner === activeSide));
  const formatDate = (sec: number) =>
    new Date(sec * 1000).toLocaleString(language === "pl" ? "pl-PL" : "en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  async function act(kind: "bet" | "claim" | "settle") {
    if (!wallet.publicKey || !program) return;
    setBusy(true);
    setError("");
    setSignature("");
    try {
      let sig: string;
      if (kind === "bet")
        sig = await preparedBet(
          connection,
          wallet,
          `/api/v1/${endpoint}/${id}/bet`,
          { wallet: wallet.publicKey.toBase58(), side: activeSide, amount },
        );
      else if (kind === "settle") {
        if (season)
          sig = await settleSeasonTx(
            program,
            connection,
            wallet,
            new PublicKey(m.address),
            ss,
            now >= m.resolveDeadline,
          );
        else if (now >= m.resolveDeadline)
          sig = await cancelExpired(
            program,
            connection,
            wallet,
            new PublicKey(m.address),
          );
        else if (
          now < m.endTime ||
          ((units[0] === 0n || units[1] === 0n) && m.feeBps > 0)
        )
          sig = await sendV0(connection, wallet, [
            await lockIx(program, wallet.publicKey, new PublicKey(m.address)),
          ]);
        else {
          const account = await (program.account as any).marketState.fetch(
            new PublicKey(m.address),
          );
          sig = await resolveWithOracle(program, connection, wallet, {
            publicKey: new PublicKey(m.address),
            account,
          });
        }
      } else {
        const market = new PublicKey(m.address),
          mint = new PublicKey(m.mint),
          [global] = globalPda(program.programId),
          [treasury] = treasuryPda(program.programId, global);
        const userAta = getAssociatedTokenAddressSync(mint, wallet.publicKey);
        const accounts = {
          user: wallet.publicKey,
          market,
          vault: vaultPda(program.programId, market)[0],
          userAta,
          receipt: receiptPda(program.programId, market, wallet.publicKey)[0],
          tokenProgram: TOKEN_PROGRAM_ID,
        };
        const ix = season
          ? await program.methods
              .claimSeason()
              .accounts({
                user: wallet.publicKey,
                userAta,
                tokenProgram: TOKEN_PROGRAM_ID,
                vault: accounts.vault,
                season: market,
                receipt: seasonReceiptPda(
                  program.programId,
                  market,
                  wallet.publicKey,
                )[0],
                global,
                treasury,
              })
              .instruction()
          : m.status === "cancelled"
            ? await program.methods.refund().accounts(accounts).instruction()
            : await program.methods
                .claimWinnings()
                .accounts({
                  ...accounts,
                  policy: policyPda(program.programId, market)[0],
                  global,
                  treasury,
                })
                .instruction();
        sig = await sendV0(connection, wallet, [
          createAssociatedTokenAccountIdempotentInstruction(
            wallet.publicKey,
            userAta,
            wallet.publicKey,
            mint,
          ),
          ix,
        ]);
      }
      setSignature(sig);
      await Promise.all([
        qc.invalidateQueries({ queryKey: [endpoint] }),
        qc.invalidateQueries({ queryKey: ["receipt"] }),
        qc.invalidateQueries({ queryKey: ["demo-usdc"] }),
      ]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const claimLabel = claimed
    ? t("Already received", "Już odebrane")
    : m.status === "cancelled"
      ? t("Claim 100% refund", "Odbierz zwrot 100%")
      : m.status === "resolved" && receipt && winner !== activeSide
        ? t("No winnings — losing bet", "Brak wygranej — przegrany kupon")
        : t("Claim winnings", "Odbierz wygraną");
  return (
    <>
      <div className="detail-header">
        <Link className="muted" href={season ? "/seasons" : "/"}>
          ← {t("All markets", "Wszystkie rynki")}
        </Link>
        <p className="eyebrow" style={{ marginTop: 25 }}>
          {season
            ? t("SEASON MARKET · 0% FEE", "RYNEK SEZONOWY · 0% PROWIZJI")
            : t("MATCH MARKET", "RYNEK MECZU")}{" "}
          · #{id}
        </p>
        <h1>{season ? ss.title : `${teams[0]} vs ${teams[1]}`}</h1>
        <span className={`status ${m.status}`}>
          {t(
            m.status,
            (
              {
                open: "Otwarty",
                locked: "Zablokowany",
                resolved: "Rozliczony",
                cancelled: "Zwrot",
              } as any
            )[m.status],
          )}
        </span>
        <p className="kickoff">
          {t("Betting closes", "Zakłady zamykają się")}: {formatDate(cutoff)}
        </p>
      </div>
      {season && ss.historicalDemo && (
        <p className="notice">
          {t(
            "Historical demonstration: the result is already known. Uses demo tokens only.",
            "Demo historyczne: wynik jest już znany. Wyłącznie tokeny demonstracyjne.",
          )}
        </p>
      )}
      <div className="detail-layout">
        <section>
          <div className="panel">
            <p className="eyebrow">{t("THE SHARED POOL", "WSPÓLNA PULA")}</p>
            <h2>
              {formatUSDC(total)} <small>demo-USDC</small>
            </h2>
            {season ? (
              <table className="participant-table">
                <thead>
                  <tr>
                    <th>{t("Participant", "Uczestnik")}</th>
                    <th>{t("Pool", "Pula")}</th>
                    <th>{t("Indicative odds", "Orientacyjny kurs")}</th>
                  </tr>
                </thead>
                <tbody>
                  {teams.map((team, i) => (
                    <tr className={activeSide === i ? "selected" : ""} key={i}>
                      <td>
                        <button
                          onClick={() => setSide(i)}
                          disabled={closed || !!receipt}
                        >
                          {team}
                          {winner === i ? " ✓" : ""}
                        </button>
                      </td>
                      <td>{Number(pools[i]).toLocaleString(language)}</td>
                      <td>
                        {odds[i]?.toFixed(2) ?? "—"}
                        {odds[i] !== null ? "×" : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="pool-pair" style={{ marginTop: 24 }}>
                {teams.map((team, i) => (
                  <div key={i}>
                    <small>{team}</small>
                    <strong>
                      {Number(pools[i]).toLocaleString(language)} USDC
                    </strong>
                    <span>
                      {odds[i] === null
                        ? t(
                            "Waiting for counter-bets",
                            "Czekamy na drugą stronę",
                          )
                        : `${odds[i]!.toFixed(2)}×`}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {!season && match.waitingForCounterBets && (
              <p className="notice">
                {t(
                  "Waiting for counter-bets. Amount needed to balance:",
                  "Czekamy na przeciwną stawkę. Do równowagi brakuje:",
                )}{" "}
                {Number(match.balanceNeeded)} USDC
              </p>
            )}
            <div className="stat-row">
              <span>
                {t("Result available after", "Rozliczenie najwcześniej")}
              </span>
              {formatDate(m.endTime)}
            </div>
            <div className="stat-row">
              <span>{t("Refund deadline", "Termin zwrotu bez wyniku")}</span>
              {formatDate(m.resolveDeadline)}
            </div>
            <div className="stat-row">
              <span>
                {t("Fee on positive profit", "Opłata od dodatniego zysku")}
              </span>
              {m.feeBps / 100}%
            </div>
          </div>
          <details className="panel" style={{ marginTop: 20 }}>
            <summary>{t("Settlement evidence", "Dowody rozliczenia")}</summary>
            <p className="muted">
              Switchboard · {season ? "2" : match.oracle.secondary ? "2" : "1"}{" "}
              {t("pinned feeds", "przypięte feedy")}
            </p>
            {(season
              ? ss.feeds
              : [match.oracle.primary, match.oracle.secondary].filter(Boolean)
            ).map((feed) => (
              <a
                className="tx-link"
                key={feed}
                target="_blank"
                rel="noreferrer"
                href={`https://explorer.solana.com/address/${feed}?cluster=devnet`}
              >
                {feed} ↗
              </a>
            ))}
          </details>
        </section>
        <aside className="panel">
          <h2>{t("Your position", "Twój zakład")}</h2>
          {!wallet.publicKey && (
            <p className="notice">
              {t(
                "Connect a devnet wallet to place a bet or claim.",
                "Połącz portfel devnet, aby postawić lub odebrać środki.",
              )}
            </p>
          )}
          {rq.isError && (
            <p className="notice error">
              {t(
                "Could not verify your receipt. Retry before signing.",
                "Nie udało się sprawdzić kuponu. Ponów przed podpisaniem.",
              )}
            </p>
          )}
          {!closed && (
            <div className="bet-form" style={{ marginTop: 20 }}>
              {season ? (
                <label>
                  {t("Participant", "Uczestnik")}
                  <select
                    value={activeSide}
                    disabled={!!receipt}
                    onChange={(e) => setSide(Number(e.target.value))}
                  >
                    {teams.map((team, i) => (
                      <option value={i} key={i}>
                        {team}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                teams.map((team, i) => (
                  <button
                    className={`choice ${activeSide === i ? "selected" : ""}`}
                    key={i}
                    onClick={() => setSide(i)}
                    disabled={!!receipt}
                  >
                    {team}
                  </button>
                ))
              )}
              <label>
                {t("Stake in demo-USDC", "Stawka w demo-USDC")}
                <input
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  aria-label={t("Stake amount", "Kwota stawki")}
                />
                <small>
                  {t(
                    "Minimum 1 USDC · up to 6 decimal places",
                    "Minimum 1 USDC · do 6 miejsc po przecinku",
                  )}
                </small>
              </label>
              {projection && (
                <div>
                  <div className="stat-row">
                    <span>
                      {t("Estimated net payout", "Szacowana wypłata netto")}
                    </span>
                    {formatUSDC(projection.net)} USDC
                  </div>
                  <small>
                    {t(
                      "Includes this stake. Later bets can change the payout.",
                      "Uwzględnia tę stawkę. Kolejne zakłady mogą zmienić wypłatę.",
                    )}
                  </small>
                </div>
              )}
              <button
                className="primary button"
                disabled={
                  !wallet.publicKey ||
                  busy ||
                  !projection ||
                  rq.isError ||
                  rq.isPending
                }
                onClick={() => act("bet")}
              >
                {busy
                  ? t("Confirm in wallet…", "Potwierdź w portfelu…")
                  : t("Place bet", "Postaw zakład")}
              </button>
            </div>
          )}
          {receipt && (
            <p className="notice">
              {t("Your stake", "Twoja stawka")}: {formatUSDC(stake)} USDC ·{" "}
              {teams[activeSide]}
            </p>
          )}
          {(m.status === "resolved" || m.status === "cancelled") && (
            <button
              className="primary button"
              disabled={!canClaim || busy || !wallet.publicKey || rq.isError}
              onClick={() => act("claim")}
            >
              {!receipt
                ? t("No bet in this wallet", "Brak zakładu w tym portfelu")
                : claimLabel}
            </button>
          )}
          {m.status === "cancelled" && (
            <p className="muted">
              {t(
                "Market cancelled. No protocol fee on refunds.",
                "Rynek anulowany. Zwroty bez opłaty protokołu.",
              )}
            </p>
          )}
          {(m.status === "open" || m.status === "locked") &&
            now >= (season ? m.endTime : cutoff) && (
              <button
                className="secondary"
                style={{ marginTop: 20 }}
                disabled={!wallet.publicKey || busy}
                onClick={() => act("settle")}
              >
                {now >= m.resolveDeadline
                  ? t("Unlock refunds", "Odblokuj zwroty")
                  : !season && now < m.endTime
                    ? t(
                        "Lock / cancel empty pool",
                        "Zablokuj / anuluj pustą pulę",
                      )
                    : t("Settle with Switchboard", "Rozlicz przez Switchboard")}
              </button>
            )}
          {error && (
            <p role="alert" className="notice error">
              {error}
            </p>
          )}
          {signature && (
            <a
              className="tx-link"
              target="_blank"
              rel="noreferrer"
              href={`https://explorer.solana.com/tx/${signature}?cluster=devnet`}
            >
              {t("Transaction confirmed", "Transakcja potwierdzona")} ↗
            </a>
          )}
          <p
            className="muted"
            style={{ fontSize: 12, lineHeight: 1.8, marginTop: 25 }}
          >
            {season
              ? t(
                  "Tied winners or an empty winning pool lead to a refund. Demo yield goes to the protocol.",
                  "Remis zwycięzców lub pusta zwycięska pula oznacza zwrot. Demonstracyjny yield trafia do protokołu.",
                )
              : t(
                  "One wallet, one side. You can add to the same side. Draws return all stakes.",
                  "Jeden portfel, jedna strona. Możesz dokładać do tej samej strony. Remis oznacza zwrot stawek.",
                )}
          </p>
        </aside>
      </div>
    </>
  );
}
