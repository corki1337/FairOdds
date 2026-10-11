"use client";
import { useState } from "react";
import { useLanguage } from "./Language";

/** Invite link that opens the market with the opposite side preselected. */
export function SharePick({
  path,
  title,
  pickedTeam,
  inviteSide,
}: {
  path: string;
  title: string;
  pickedTeam: string | null;
  inviteSide: number | null;
}) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const url = `${origin}${path}${inviteSide === null ? "" : `?side=${inviteSide}`}`;
  const text = pickedTeam
    ? `I'm backing ${pickedTeam} in ${title} on FairOdds. Shared pool, no bookmaker. Take the other side:`
    : `${title} on FairOdds. Shared pool, no bookmaker. Pick your side:`;
  const enc = encodeURIComponent;
  const targets = [
    ["X", `https://twitter.com/intent/tweet?text=${enc(text)}&url=${enc(url)}`],
    ["Telegram", `https://t.me/share/url?url=${enc(url)}&text=${enc(text)}`],
    ["WhatsApp", `https://wa.me/?text=${enc(`${text} ${url}`)}`],
  ];
  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <div className="share-pick">
      <p className="eyebrow">
        {pickedTeam
          ? t("CHALLENGE A FRIEND", "WYZWIJ ZNAJOMEGO")
          : t("BET WITH FRIENDS", "OBSTAWIAJ ZE ZNAJOMYMI")}
      </p>
      <p className="muted">
        {pickedTeam
          ? t(
              "Send this link. It opens the match with the other side selected, so your friends bet into the same pool.",
              "Wyślij ten link. Otwiera mecz z zaznaczoną drugą stroną, więc znajomi grają do tej samej puli.",
            )
          : t(
              "Share the pool with your group chat. Everyone bets against each other, not against a bookmaker.",
              "Udostępnij pulę na czacie grupowym. Gracie przeciwko sobie, a nie przeciwko bukmacherowi.",
            )}
      </p>
      <div className="share-buttons">
        <button type="button" className="secondary" onClick={copy}>
          {copied ? t("Link copied", "Skopiowano") : t("Copy link", "Kopiuj link")}
        </button>
        {targets.map(([label, href]) => (
          <a
            key={label}
            className="secondary button"
            href={href}
            target="_blank"
            rel="noreferrer"
          >
            {label}
          </a>
        ))}
      </div>
    </div>
  );
}
