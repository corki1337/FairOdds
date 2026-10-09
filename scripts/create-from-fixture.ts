/**
 * Creates on-chain markets for real fixtures, each with its own Switchboard feed pinned to
 * that fixture's TheSportsDB id.
 *
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=~/.config/solana/id.json \
 *   npx ts-node scripts/create-from-fixture.ts [matchId...]
 *
 * Without ids it picks the next fixtures that have not kicked off yet.
 * Env: COUNT (default 8), RESOLVE_WINDOW_MINS (default 2880).
 */
import * as fs from "fs";
import * as path from "path";
import { context, createMarketWithFeed, fetchMarket, pdas, ROOT, sleep } from "./common";
import { readCatalog, secondaryFor } from "./sources/catalog";

/** Betting must close before kickoff, and markets need a future start to be created at all. */
const MIN_LEAD_SECONDS = 10 * 60;

async function main() {
  const ctx = context();
  const catalog = readCatalog();

  const now = Math.floor(Date.now() / 1000);
  const argIds = process.argv.slice(2).map(Number).filter((n) => !Number.isNaN(n));
  const count = Number(process.env.COUNT || 8);
  const windowMins = Number(process.env.RESOLVE_WINDOW_MINS || 2880);

  const selected = (
    argIds.length
      ? catalog.fixtures.filter((f) => argIds.includes(f.id))
      : catalog.fixtures
          .filter((f) => !f.finished && f.startTime > now + MIN_LEAD_SECONDS)
          .sort((a, b) => a.startTime - b.startTime)
          .slice(0, count)
  ).filter((f) => f.marketable);
  if (!selected.length) throw new Error("No marketable fixtures matched.");

  const created: { matchId: string; market: string; feed: string; secondaryFeed?: string }[] = [];
  console.log("Admin:", ctx.admin.publicKey.toBase58());

  for (const f of selected) {
    const market = pdas.market(ctx.aichain.programId, f.id);
    const existing = await fetchMarket(ctx, market);
    if (existing) {
      console.log("Skip (exists)", f.id, f.teamA, "vs", f.teamB);
      created.push({
        matchId: String(f.id),
        market: market.toBase58(),
        feed: existing.oracleFeed.toBase58(),
      });
      continue;
    }
    if (f.startTime <= Math.floor(Date.now() / 1000)) {
      console.log("Skip (already started)", f.id, f.teamA, "vs", f.teamB);
      continue;
    }
    const res = await createMarketWithFeed(ctx, {
      matchId: f.id,
      teamA: f.teamA,
      teamB: f.teamB,
      start: f.startTime,
      end: f.endTime,
      resolveDeadline: f.endTime + windowMins * 60,
      secondary: secondaryFor(f),
    });
    console.log(
      "Created",
      f.id,
      `${f.teamA} vs ${f.teamB}`,
      "feed",
      res.feed.toBase58(),
      res.secondaryFeed ? `+ second feed ${res.secondaryFeed.toBase58()}` : "",
      res.sig
    );
    created.push({
      matchId: String(f.id),
      market: res.market.toBase58(),
      feed: res.feed.toBase58(),
      secondaryFeed: res.secondaryFeed?.toBase58(),
    });
    await sleep(800);
  }

  fs.writeFileSync(
    path.join(ROOT, "fixture-markets.json"),
    JSON.stringify({ createdAt: new Date().toISOString(), markets: created }, null, 2)
  );
  console.log(JSON.stringify(created, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
