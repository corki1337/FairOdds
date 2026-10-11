"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Transaction } from "@solana/web3.js";
import { useLanguage } from "@/components/Language";
import { getJson } from "@/lib/client";
import type { MatchView } from "@/lib/views";

interface ActionParameter {
  name: string;
  label: string;
  type: string;
  required: boolean;
  min?: number;
}

interface ActionLink {
  type: string;
  label: string;
  href: string;
  parameters?: ActionParameter[];
}

interface ActionPayload {
  type: string;
  icon: string;
  title: string;
  label: string;
  description: string;
  disabled?: boolean;
  links?: {
    actions: ActionLink[];
  };
}

export default function BlinksInspector() {
  const { t } = useLanguage();
  const { connection } = useConnection();
  const wallet = useWallet();

  const [selectedId, setSelectedId] = useState("");
  const [copied, setCopied] = useState(false);
  const [customUrl, setCustomUrl] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [amount, setAmount] = useState("10");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [txSignature, setTxSignature] = useState("");

  const marketsQuery = useQuery({
    queryKey: ["markets-for-blinks"],
    queryFn: () => getJson<{ markets: MatchView[] }>("/api/v1/markets"),
  });

  const openMarkets = (marketsQuery.data?.markets || []).filter(
    (m) => m.status === "open"
  );

  useEffect(() => {
    if (selectedId) return;
    const fromLink = new URLSearchParams(window.location.search).get("market");
    if (fromLink) setSelectedId(fromLink);
    else if (openMarkets[0]) setSelectedId(openMarkets[0].id);
  }, [selectedId, openMarkets]);

  const activeUrl = useCustom
    ? customUrl
    : selectedId
      ? `/api/actions/market/${selectedId}`
      : "";
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const actionUrl = activeUrl.startsWith("http") ? activeUrl : origin + activeUrl;

  const actionQuery = useQuery({
    queryKey: ["blink-action", activeUrl],
    queryFn: async (): Promise<ActionPayload> => {
      const res = await fetch(activeUrl, {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        throw new Error(`Action returned status ${res.status}`);
      }
      return res.json();
    },
    enabled: !!activeUrl,
  });

  async function executeAction(link: ActionLink) {
    if (!wallet.publicKey) {
      setError(
        t(
          "Connect a Solana wallet (Devnet) to test the Blink.",
          "Połącz portfel Solana (Devnet), aby przetestować Blinka."
        )
      );
      return;
    }

    setBusy(true);
    setError("");
    setTxSignature("");

    try {
      let resolvedHref = link.href.replace("{amount}", encodeURIComponent(amount));
      if (!resolvedHref.startsWith("http")) {
        resolvedHref = window.location.origin + resolvedHref;
      }

      const postRes = await fetch(resolvedHref, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          account: wallet.publicKey.toBase58(),
          data: { amount: Number(amount) },
        }),
      });

      if (!postRes.ok) {
        const errJson = await postRes.json().catch(() => ({}));
        throw new Error(
          errJson.message || `Action POST failed with code ${postRes.status}`
        );
      }

      const postData = await postRes.json();
      if (!postData.transaction) {
        throw new Error("Action did not return a transaction payload");
      }

      const txBuffer = Buffer.from(postData.transaction, "base64");
      const tx = Transaction.from(txBuffer);

      const sig = await wallet.sendTransaction(tx, connection);
      setTxSignature(sig);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  const payload = actionQuery.data;

  async function copyActionUrl() {
    await navigator.clipboard.writeText(`solana-action:${actionUrl}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div style={{ maxWidth: 800, margin: "0 auto" }}>
      <div className="detail-header">
        <p className="eyebrow">{t("SOLANA ACTIONS & BLINKS", "SOLANA ACTIONS I BLINKS")}</p>
        <h1>{t("Bet from a link", "Zakład z linku")}</h1>
        <p className="hero-copy">
          {t(
            "Every FairOdds match is a Solana Action: one URL returns the card, the buttons and an unsigned transaction. This page renders it exactly like a Blink client would, and you sign on devnet with your own wallet. First-time wallets get demo-USDC in the same transaction.",
            "Każdy mecz FairOdds to Solana Action: jeden URL zwraca kartę, przyciski i niepodpisaną transakcję. Ta strona renderuje ją tak jak klient Blinków, a Ty podpisujesz na devnecie własnym portfelem. Nowe portfele dostają demo-USDC w tej samej transakcji."
          )}
        </p>
        <p className="muted" style={{ fontSize: 13 }}>
          {t(
            "Dialect's hosted renderer (dial.to) is currently offline, and unfurling on X needs a registered mainnet Action plus a wallet extension. On devnet, this built-in renderer is the way to try it.",
            "Hostowany renderer Dialecta (dial.to) jest obecnie wyłączony, a rozwijanie na X wymaga zarejestrowanej akcji mainnet i rozszerzenia portfela. Na devnecie Blinka testujesz tym wbudowanym rendererem."
          )}
        </p>
      </div>

      <div className="panel" style={{ marginBottom: 24, padding: 20 }}>
        <h3 style={{ marginTop: 0 }}>{t("Select Market to Test", "Wybierz rynek do testu")}</h3>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <label style={{ flex: 1, minWidth: 260 }}>
            {t("Open match market:", "Otwarty mecz:")}
            <select
              value={useCustom ? "custom" : selectedId}
              onChange={(e) => {
                if (e.target.value === "custom") {
                  setUseCustom(true);
                } else {
                  setUseCustom(false);
                  setSelectedId(e.target.value);
                }
              }}
              style={{ marginTop: 6 }}
            >
              {openMarkets.map((m) => (
                <option key={m.id} value={m.id}>
                  #{m.id} — {m.teams[0]} vs {m.teams[1]}
                </option>
              ))}
              <option value="custom">{t("Custom Action URL…", "Własny adres URL akcji…")}</option>
            </select>
          </label>
        </div>

        {actionUrl && (
          <div style={{ display: "flex", gap: 10, marginTop: 12, alignItems: "center", flexWrap: "wrap" }}>
            <code style={{ fontSize: 12, wordBreak: "break-all", flex: 1 }}>
              solana-action:{actionUrl}
            </code>
            <button type="button" className="secondary" onClick={copyActionUrl}>
              {copied ? t("Copied", "Skopiowano") : t("Copy Action URL", "Kopiuj Action URL")}
            </button>
          </div>
        )}

        {useCustom && (
          <div style={{ marginTop: 12 }}>
            <label>
              {t("Custom Action URL:", "Własny Action URL:")}
              <input
                type="text"
                placeholder="https://.../api/actions/market/2482198"
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                style={{ marginTop: 6 }}
              />
            </label>
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 24 }}>
        {/* Rendered Blink Card simulating Dialect / Phantom / X */}
        <div>
          <h3 style={{ marginBottom: 12 }}>
            {t("Blink card", "Karta Blinka")}
          </h3>

          {actionQuery.isLoading && (
            <p className="notice">{t("Loading Action metadata…", "Wczytywanie metadanych Akcji…")}</p>
          )}

          {actionQuery.isError && (
            <p className="notice error">
              {t("Failed to load Action:", "Nie udało się załadować Akcji:")} {actionQuery.error.message}
            </p>
          )}

          {payload && (
            <div
              className="panel"
              style={{
                border: "1px solid rgba(255,255,255,0.15)",
                borderRadius: 16,
                padding: 20,
                background: "rgba(18, 22, 28, 0.95)",
                boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <span
                  style={{
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                    padding: "3px 8px",
                    borderRadius: 4,
                    background: "rgba(0, 240, 255, 0.15)",
                    color: "var(--accent, #00f0ff)",
                    fontWeight: 600,
                  }}
                >
                  ⚡ Solana Blink
                </span>
                <span style={{ fontSize: 12, color: "var(--mute, #888)" }}>
                  {origin.replace(/^https?:\/\//, "")}
                </span>
              </div>

              <div style={{ display: "flex", gap: 16, alignItems: "flex-start", marginBottom: 16 }}>
                {payload.icon && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={payload.icon}
                    alt={payload.title}
                    style={{
                      width: 64,
                      height: 64,
                      borderRadius: 12,
                      objectFit: "cover",
                      background: "#111",
                    }}
                  />
                )}
                <div>
                  <h2 style={{ margin: "0 0 6px", fontSize: 20, fontWeight: 700 }}>
                    {payload.title}
                  </h2>
                  <p style={{ margin: 0, fontSize: 13, color: "var(--mute, #aaa)", lineHeight: 1.4 }}>
                    {payload.description}
                  </p>
                </div>
              </div>

              {/* Action Parameters and buttons */}
              {payload.links?.actions && payload.links.actions.length > 0 && (
                <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                    <label
                      htmlFor="blink-amount-input"
                      style={{ fontSize: 13, fontWeight: 500, color: "var(--mute, #aaa)" }}
                    >
                      {payload.links.actions[0].parameters?.[0]?.label || t("Amount in demo-USDC (minimum 1)", "Kwota w demo-USDC (minimum 1)")}
                    </label>
                    <input
                      id="blink-amount-input"
                      type="number"
                      min={1}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      disabled={busy || payload.disabled}
                      style={{
                        width: "100%",
                        padding: "12px 14px",
                        fontSize: 15,
                        borderRadius: 8,
                        background: "#0c1315",
                        border: "1px solid var(--stroke, #304043)",
                        color: "#fff",
                      }}
                    />
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    {payload.links.actions.map((link, idx) => (
                      <button
                        key={idx}
                        className="button primary"
                        disabled={busy || payload.disabled || !wallet.publicKey}
                        onClick={() => executeAction(link)}
                        style={{
                          padding: "12px 14px",
                          fontWeight: 600,
                          fontSize: 14,
                        }}
                      >
                        {busy ? t("Signing…", "Podpisywanie…") : link.label}
                      </button>
                    ))}
                  </div>

                  {!wallet.publicKey && (
                    <p style={{ marginTop: 12, fontSize: 12, color: "#ffb020", textAlign: "center" }}>
                      ⚠️ {t("Connect wallet above to sign this Blink on Devnet.", "Połącz portfel u góry, aby podpisać ten Blink na Devnecie.")}
                    </p>
                  )}
                </div>
              )}

              {error && (
                <p role="alert" className="notice error" style={{ marginTop: 14 }}>
                  {error}
                </p>
              )}

              {txSignature && (
                <p className="notice" style={{ marginTop: 14, background: "rgba(0, 230, 118, 0.15)", color: "#00e676" }}>
                  ✅ {t("Blink executed successfully!", "Blink wykonany pomyślnie!")}{" "}
                  <a
                    href={`https://explorer.solana.com/tx/${txSignature}?cluster=devnet`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "#fff", textDecoration: "underline", marginLeft: 6 }}
                  >
                    {t("View on Explorer", "Zobacz w Explorerze")} ↗
                  </a>
                </p>
              )}
            </div>
          )}
        </div>

        {/* Spec Details Inspector */}
        <div className="panel" style={{ padding: 20 }}>
          <h3 style={{ marginTop: 0 }}>{t("Raw Action response", "Surowa odpowiedź Akcji")}</h3>
          <p style={{ fontSize: 13, color: "var(--mute)" }}>
            {t(
              "GET response with CORS and x-action-version headers, as any Actions client receives it:",
              "Odpowiedź GET z nagłówkami CORS i x-action-version, tak jak widzi ją każdy klient Actions:"
            )}
          </p>
          <pre
            style={{
              padding: 12,
              borderRadius: 8,
              background: "#0b0e14",
              color: "#00f0ff",
              fontSize: 12,
              overflowX: "auto",
            }}
          >
            {JSON.stringify(payload, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}
