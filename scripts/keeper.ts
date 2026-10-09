/**
 * Long-running keeper: refreshes the catalog, opens markets for upcoming fixtures and cranks
 * started ones (lock, resolve, cancel). Before resolving it asks every configured provider for
 * the final score and holds the market on any contradiction, recording it in
 * data/anomalies.json. A held market is refunded by `cancel_expired` once its deadline passes.
 *
 * The program enforces less than this check: it only compares the feeds pinned to the market
 * (TheSportsDB, plus OpenLigaDB for Bundesliga). Anyone else can still resolve a single-feed
 * market the keeper is holding.
 *
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=~/.config/solana/id.json \
 *   npx ts-node --transpile-only scripts/keeper.ts [--once]
 */
import * as fs from "fs";
import * as path from "path";
import { PublicKey } from "@solana/web3.js";
import type { Fixture } from "../app/src/lib/fixtures";
import {
  context,
  crankMarket,
  createMarketWithFeed,
  fetchMarket,
  pdas,
  ROOT,
  sleep,
  statusOf,
  type Ctx,
  type MarketAccount,
} from "./common";
import * as apiFootball from "./sources/apiFootball";
import { buildCatalog, readCatalog, secondaryFor, writeCatalog } from "./sources/catalog";
import { loadEnv } from "./sources/env";
import * as footballData from "./sources/footballData";
import { consensus } from "./sources/match";
import * as openligadb from "./sources/openligadb";
import * as pandascore from "./sources/pandascore";
import * as thesportsdb from "./sources/thesportsdb";
import type { Vote } from "./sources/types";

loadEnv();

const MARKETS = Number(process.env.KEEPER_MARKETS || 8);
const CATALOG_MS = Number(process.env.KEEPER_CATALOG_HOURS || 6) * 3_600_000;
const CRANK_MS = Number(process.env.KEEPER_CRANK_SECONDS || 30) * 1_000;
const WINDOW_MINS = Number(process.env.RESOLVE_WINDOW_MINS || 2880);
const MIN_LEAD_SECONDS = 10 * 60;
/** Votes are reused for this long so a waiting market does not burn daily API quotas. */
const VOTE_TTL_MS = 10 * 60_000;
const ANOMALIES = path.join(ROOT, "data", "anomalies.json");

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

type AnomalyEntry = {
  matchId: string;
  reason: string;
  votes: Vote[];
  firstSeen: string;
  lastSeen: string;
};

function readAnomalies(): Record<string, AnomalyEntry> {
  try {
    return JSON.parse(fs.readFileSync(ANOMALIES, "utf8"));
  } catch {
    return {};
  }
}

function writeAnomalies(all: Record<string, AnomalyEntry>) {
  fs.mkdirSync(path.dirname(ANOMALIES), { recursive: true });
  const tmp = `${ANOMALIES}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2));
  fs.renameSync(tmp, ANOMALIES);
}

function recordAnomaly(matchId: string, reason: string, votes: Vote[]) {
  const all = readAnomalies();
  const now = new Date().toISOString();
  all[matchId] = { matchId, reason, votes, firstSeen: all[matchId]?.firstSeen ?? now, lastSeen: now };
  writeAnomalies(all);
}

function clearAnomaly(matchId: string) {
  const all = readAnomalies();
  if (!all[matchId]) return;
  delete all[matchId];
  writeAnomalies(all);
}

const voteCache = new Map<string, { at: number; votes: Vote[] }>();

/** Every provider that knows this event and has its key configured. */
async function gatherVotes(matchId: string, row: Fixture | undefined): Promise<Vote[]> {
  const hit = voteCache.get(matchId);
  if (hit && Date.now() - hit.at < VOTE_TTL_MS) return hit.votes;
  const s = row?.sources ?? {};
  const votes: Vote[] = [await thesportsdb.result(matchId)];
  if (s.openligadb) votes.push(await openligadb.result(s.openligadb));
  if (s.footballData && footballData.enabled()) votes.push(await footballData.result(s.footballData));
  if (s.apiFootball && apiFootball.enabled()) votes.push(await apiFootball.result(s.apiFootball));
  if (s.pandascore && pandascore.enabled()) votes.push(await pandascore.result(s.pandascore));
  voteCache.set(matchId, { at: Date.now(), votes });
  return votes;
}

function guardFor(rows: Map<string, Fixture>) {
  return async (m: MarketAccount): Promise<string | null> => {
    const matchId = m.matchId.toString();
    const votes = await gatherVotes(matchId, rows.get(matchId));
    const c = consensus(votes);
    if (c.verdict === "dispute") {
      recordAnomaly(matchId, c.reason, votes);
      return c.reason;
    }
    if (c.verdict === "agree") {
      clearAnomaly(matchId);
      log(`#${matchId} sources agree ${c.score.home}:${c.score.away} (${c.voters.join(", ")})`);
    }
    // "waiting": the oracle will not have a value either; let it say so.
    return null;
  };
}

async function refreshCatalog() {
  try {
    const catalog = await buildCatalog((msg) => log(msg));
    writeCatalog(catalog);
    log(`catalog: ${catalog.meta.count} fixtures, ${catalog.meta.upcoming} upcoming`);
  } catch (e) {
    log("catalog refresh failed, keeping previous:", String((e as Error).message ?? e));
  }
}

async function allMarkets(ctx: Ctx): Promise<{ publicKey: PublicKey; account: MarketAccount }[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const acc = (ctx.aichain.account as any).marketState;
  return acc.all([{ dataSize: acc.size }]);
}

const DEFAULT_QUOTAS: Record<string, number> = {
  football: 10,
  esports_cs2: 5,
  esports_lol: 5,
  esports: 5,
};

const MARKETS_BY_CAT: Record<string, number> = {
  football: Number(process.env.KEEPER_MARKETS_FOOTBALL || DEFAULT_QUOTAS.football),
  esports_cs2: Number(process.env.KEEPER_MARKETS_CS2 || DEFAULT_QUOTAS.esports_cs2),
  esports_lol: Number(process.env.KEEPER_MARKETS_LOL || DEFAULT_QUOTAS.esports_lol),
  esports: Number(process.env.KEEPER_MARKETS_ESPORTS || DEFAULT_QUOTAS.esports),
};

/** Keeps configured category quotas of markets open ahead of kickoff, earliest fixtures first. */
async function ensureMarkets(ctx: Ctx, fixtures: Fixture[]) {
  const now = Math.floor(Date.now() / 1000);
  const markets = await allMarkets(ctx);
  const fixtureById = new Map<string, Fixture>(fixtures.map((f) => [String(f.id), f]));

  // Count open markets ahead of kickoff per category
  const openByCat = new Map<string, number>();
  for (const m of markets) {
    if (statusOf(m.account) === "open" && Number(m.account.startTime) > now) {
      const matchId = m.account.matchId.toString();
      const cat = fixtureById.get(matchId)?.category ?? "football";
      openByCat.set(cat, (openByCat.get(cat) ?? 0) + 1);
    }
  }

  for (const [cat, targetQuota] of Object.entries(MARKETS_BY_CAT)) {
    const openAhead = openByCat.get(cat) ?? 0;
    let missing = targetQuota - openAhead;
    if (missing <= 0) continue;

    const candidates = fixtures
      .filter((f) => f.category === cat && f.marketable && !f.finished && f.startTime > now + MIN_LEAD_SECONDS)
      .sort((a, b) => a.startTime - b.startTime);

    for (const f of candidates) {
      if (missing <= 0) break;
      const market = pdas.market(ctx.aichain.programId, f.id);
      if (await fetchMarket(ctx, market)) continue;
      const secondary = secondaryFor(f);
      try {
        const res = await createMarketWithFeed(ctx, {
          matchId: f.id,
          teamA: f.teamA,
          teamB: f.teamB,
          start: f.startTime,
          end: f.endTime,
          resolveDeadline: f.endTime + WINDOW_MINS * 60,
          secondary,
        });
        missing--;
        log(
          `created #${f.id} [${cat}] ${f.teamA} vs ${f.teamB}`,
          secondary ? `(2 feeds, OpenLigaDB ${secondary.sourceRef})` : "(1 feed)",
          res.sig
        );
      } catch (e) {
        log(`create #${f.id} [${cat}] failed:`, String((e as Error).message ?? e).slice(0, 300));
      }
      await sleep(800);
    }
  }
}

async function crankAll(ctx: Ctx, rows: Map<string, Fixture>) {
  const now = Math.floor(Date.now() / 1000);
  const guard = guardFor(rows);
  for (const { publicKey, account } of await allMarkets(ctx)) {
    const status = statusOf(account);
    if (status === "resolved" || status === "cancelled") continue;
    if (now < Number(account.startTime)) continue;
    try {
      log(`#${account.matchId.toString()}`, await crankMarket(ctx, publicKey, { guard }));
    } catch (e) {
      log(`#${account.matchId.toString()} error:`, String((e as Error).message ?? e).slice(0, 300));
    }
    await sleep(500);
  }
}

async function main() {
  const ctx = context();
  const once = process.argv.includes("--once");
  log(
    "keeper",
    ctx.admin.publicKey.toBase58(),
    `markets=${MARKETS}`,
    `keys: football-data=${footballData.enabled()} api-football=${apiFootball.enabled()} pandascore=${pandascore.enabled()}`
  );
  let lastCatalog = 0;
  for (;;) {
    try {
      if (Date.now() - lastCatalog >= CATALOG_MS) {
        await refreshCatalog();
        lastCatalog = Date.now();
        await ensureMarkets(ctx, readCatalog().fixtures);
      }
      const rows = new Map(readCatalog().fixtures.map((f) => [String(f.id), f]));
      await crankAll(ctx, rows);
    } catch (e) {
      log("pass failed:", String((e as Error).message ?? e).slice(0, 300));
    }
    if (once) break;
    await sleep(CRANK_MS);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
