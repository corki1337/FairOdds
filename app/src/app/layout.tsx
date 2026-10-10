import type { Metadata } from "next";
import { Providers } from "@/components/Providers";
import { Nav } from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ||
      (process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000"),
  ),
  title: "FairOdds — Real matches. Shared pools.",
  icons: { icon: "/icon.png" },
  openGraph: {
    title: "FairOdds — Your side. Your stake.",
    description:
      "Shared sports pools on Solana devnet. 0.5% of match profit; 0% season fee.",
    images: ["/og-image.png"],
  },
  twitter: { card: "summary_large_image", images: ["/og-image.png"] },
  description:
    "Prematch pari-mutuel bookmaker. Odds from the pool, results from TheSportsDB via Switchboard.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=Space+Grotesk:wght@500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen bg-ink font-body text-white antialiased">
        <Providers>
          <Nav />
          <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
