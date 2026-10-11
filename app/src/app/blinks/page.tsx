"use client";

import { useState } from "react";
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

  const [selectedId, setSelectedId] = useState("2482198");
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

  const activeUrl = useCustom
    ? customUrl
    : `/api/actions/market/${selectedId}`;

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

  const openMarkets = (marketsQuery.data?.markets || []).filter(
    (m) => m.status === "open"
  );

  const payload = actionQuery.data;

  return (
    <div style={{ maxWidth: 800, margin: "0 auto" }}>
      <div className="detail-header">
        <p className="eyebrow">{t("SOLANA ACTIONS & BLINKS", "SOLANA ACTIONS I BLINKS")}</p>
        <h1>{t("Blinks Tester & Preview", "Tester i Podgląd Blinków")}</h1>
        <p className="hero-copy">
          {t(
            "Official Solana Blinks interactive inspector. Test metadata, CORS, parameter inputs, and real Devnet transaction signing.",
            "Oficjalny interaktywny inspektor Solana Blinks. Testuj metadane, CORS, parametry wejściowe i prawdziwe podpisywanie transakcji na Devnecie."
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
            {t("Blink Card (Live Dialect Preview)", "Karta Blinka (Podgląd na żywo)")}
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
                  fairodds1338.vercel.app
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
                  <label style={{ display: "block", marginBottom: 12, fontSize: 13, fontWeight: 500 }}>
                    {payload.links.actions[0].parameters?.[0]?.label || t("Amount (demo-USDC)", "Kwota (demo-USDC)")}
                    <input
                      type="number"
                      min={1}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      disabled={busy || payload.disabled}
                      style={{ marginTop: 6 }}
                    />
                  </label>

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
          <h3 style={{ marginTop: 0 }}>{t("Solana Actions JSON Spec", "Specyfikacja JSON Akcji")}</h3>
          <p style={{ fontSize: 13, color: "var(--mute)" }}>
            {t(
              "Verified endpoints for dial.to, Phantom, and X/Twitter unfurlers:",
              "Zweryfikowane endpointy dla dial.to, Phantom i X/Twitter:"
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
