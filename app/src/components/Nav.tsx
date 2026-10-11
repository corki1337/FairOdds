"use client";
import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { Faucet } from "./Faucet";
import { useLanguage } from "./Language";
const WalletButton = dynamic(
  async () =>
    (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false },
);
export function Nav() {
  const { language, setLanguage, t } = useLanguage();
  const path = usePathname();
  return (
    <header className="site-header">
      <div className="nav-inner">
        <Link href="/" className="brand">
          <span className="brand-mark">F</span>FairOdds
          <span className="network">DEVNET</span>
        </Link>
        <nav aria-label={t("Main navigation", "Główna nawigacja")}>
          <Link className={path === "/" ? "active" : ""} href="/">
            {t("Matches", "Mecze")}
          </Link>
          <Link
            className={path.startsWith("/seasons") ? "active" : ""}
            href="/seasons"
          >
            {t("Season markets", "Rynki sezonowe")}
          </Link>
          <Link
            className={path === "/blinks" ? "active" : ""}
            href="/blinks"
          >
            Blinks
          </Link>
          <Link href="/admin">{t("Create", "Utwórz")}</Link>
        </nav>
        <div className="nav-actions">
          <button
            className="language-toggle"
            onClick={() => setLanguage(language === "en" ? "pl" : "en")}
            aria-label={t(
              "Switch language to Polish",
              "Zmień język na angielski",
            )}
          >
            {language.toUpperCase()}
          </button>
          <Faucet />
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
