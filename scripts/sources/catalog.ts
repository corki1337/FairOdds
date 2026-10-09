/**
 * Builds the fixture catalog the UI lists. TheSportsDB is the spine (its `idEvent` is the
 * on-chain match id); every other provider only adds its own id to rows it can be matched to,
 * except esports-only PandaScore rows, which are listed without a market.
 */
import * as fs from "fs";
import * as path from "path";
import {
  SPORTSDB_BASE,
  UNMARKETABLE_ID_OFFSET,
  eventUrl,
  normalizeFixture,
  type Fixture,
  type FixtureCategoryId,
} from "../../app/src/lib/fixtures";
import { SOURCE_OPENLIGADB } from "../../app/src/lib/switchboard";
import * as apiFootball from "./apiFootball";
import * as footballData from "./footballData";
import { linkFixtures } from "./match";
import * as openligadb from "./openligadb";
import * as pandascore from "./pandascore";
import * as thesportsdb from "./thesportsdb";
import type { SourceFixture } from "./types";

export const CATALOG_PATH = path.join(__dirname, "..", "..", "app", "src", "data", "fixtures.json");

const ROUND_LEAGUES: { id: string; category: FixtureCategoryId }[] = [
  { id: "4328", category: "football" }, // English Premier League
  { id: "4331", category: "football" }, // German Bundesliga
  { id: "4332", category: "football" }, // Italian Serie A
  { id: "4334", category: "football" }, // French Ligue 1
  { id: "4335", category: "football" }, // Spanish La Liga
  { id: "4337", category: "football" }, // Dutch Eredivisie
];
const ROUNDS = 12;

const FEED_LEAGUES: { id: string; category: FixtureCategoryId }[] = [
  { id: "4329", category: "football" }, // English League Championship
  { id: "4344", category: "football" }, // Portuguese Primeira Liga
  { id: "4480", category: "football" }, // UEFA Champions League
  { id: "4481", category: "football" }, // UEFA Europa League
  { id: "4528", category: "esports_lol" }, // LoL Pro League
  { id: "4529", category: "esports_lol" }, // LoL Champions Korea
  { id: "4530", category: "esports_lol" }, // LoL EMEA Championship
  { id: "5875", category: "esports_lol" }, // LCK Challengers League
  { id: "5421", category: "esports" }, // Rocket League Championship Series
];

/** TheSportsDB league -> OpenLigaDB shortcut. Only these markets get a second on-chain feed. */
export const OPENLIGADB_LEAGUES: Record<string, string> = { "4331": "bl1" };

/** Minutes after kickoff before the provider can be expected to carry a final score. */
export const SETTLE_BUFFER: Record<FixtureCategoryId, number> = {
  football: 150,
  esports_cs2: 300,
  esports_lol: 300,
  esports: 300,
};

function toRow(f: SourceFixture, id: number, marketable: boolean): Fixture {
  return {
    key: `${f.source}:${f.sourceId}`,
    id,
    marketable,
    sources: { [f.source]: f.sourceId, ...f.refs },
    category: f.category,
    league: f.league,
    teamA: f.home,
    teamB: f.away,
    startTime: f.startTime,
    endTime: f.startTime + SETTLE_BUFFER[f.category] * 60,
    finished: f.status === "final",
    scoreA: f.final?.home ?? null,
    scoreB: f.final?.away ?? null,
  };
}

function attach(rows: Map<string, Fixture>, base: SourceFixture[], other: SourceFixture[]): number {
  const links = linkFixtures(base, other);
  for (const [baseId, otherId] of links) {
    const row = rows.get(baseId);
    const o = other.find((x) => x.sourceId === otherId);
    if (row && o) row.sources[o.source] = otherId;
  }
  return links.size;
}

export async function buildCatalog(log: (msg: string) => void = console.log) {
  const season = thesportsdb.currentSeason();
  const byLeague = new Map<string, SourceFixture[]>();
  const add = (leagueId: string, list: SourceFixture[]) =>
    byLeague.set(leagueId, [...(byLeague.get(leagueId) ?? []), ...list]);

  for (const { id, category } of ROUND_LEAGUES) {
    const list = await thesportsdb.leagueRounds(id, category, season, 1, ROUNDS);
    add(id, list);
    log(`thesportsdb ${id}: ${list.length}`);
  }
  for (const { id, category } of FEED_LEAGUES) {
    const list = await thesportsdb.leagueFeed(id, category);
    add(id, list);
    log(`thesportsdb ${id}: ${list.length}`);
  }

  const rows = new Map<string, Fixture>();
  for (const list of byLeague.values()) {
    for (const f of list) {
      if (!rows.has(f.sourceId)) rows.set(f.sourceId, toRow(f, Number(f.sourceId), true));
    }
  }
  if (rows.size === 0) throw new Error("TheSportsDB returned nothing; refusing to wipe catalog");

  for (const [leagueId, shortcut] of Object.entries(OPENLIGADB_LEAGUES)) {
    const other = await openligadb.season(shortcut, openligadb.seasonYear(season));
    log(`openligadb ${shortcut}: ${other.length}, linked ${attach(rows, byLeague.get(leagueId) ?? [], other)}`);
  }

  if (footballData.enabled()) {
    for (const leagueId of Object.keys(footballData.COMPETITIONS)) {
      const base = byLeague.get(leagueId);
      if (!base?.length) continue;
      const other = await footballData.competition(leagueId);
      log(`football-data ${leagueId}: ${other.length}, linked ${attach(rows, base, other)}`);
    }
  } else {
    log("football-data: skipped (no FOOTBALL_DATA_KEY)");
  }
  log(
    apiFootball.enabled()
      ? "api-football: ids taken from TheSportsDB idAPIfootball"
      : "api-football: skipped (no API_FOOTBALL_KEY)"
  );

  if (pandascore.enabled()) {
    const esports = [...rows.values()].filter((r) => r.category !== "football");
    const base: SourceFixture[] = esports.map((r) => ({
      source: "thesportsdb",
      sourceId: String(r.id),
      category: r.category,
      league: r.league,
      home: r.teamA,
      away: r.teamB,
      startTime: r.startTime,
      status: "scheduled",
      final: null,
    }));
    const other = await pandascore.upcoming();
    const links = linkFixtures(base, other);
    const linkedPanda = new Set(links.values());
    for (const [baseId, pandaId] of links) rows.get(baseId)!.sources.pandascore = pandaId;
    let added = 0;
    for (const p of other) {
      if (linkedPanda.has(p.sourceId)) continue;
      const row = toRow(p, UNMARKETABLE_ID_OFFSET + Number(p.sourceId), false);
      rows.set(row.key, row);
      added++;
    }
    log(`pandascore: ${other.length}, linked ${links.size}, listed without market ${added}`);
  } else {
    log("pandascore: skipped (no PANDASCORE_TOKEN)");
  }

  const fixtures = [...rows.values()].sort((a, b) => a.startTime - b.startTime);
  const count = <K extends string>(pick: (f: Fixture) => K[]) =>
    fixtures.reduce<Record<string, number>>((acc, f) => {
      for (const k of pick(f)) acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});
  return {
    provider: "thesportsdb",
    providers: ["thesportsdb", "openligadb", "footballData", "apiFootball", "pandascore"],
    sportsDbBase: SPORTSDB_BASE,
    lookupUrl: eventUrl("{idEvent}"),
    fixtures,
    meta: {
      fetchedAt: new Date().toISOString(),
      count: fixtures.length,
      upcoming: fixtures.filter((f) => !f.finished).length,
      byCategory: count((f) => [f.category]),
      bySource: count((f) => Object.keys(f.sources)),
    },
  };
}

/** Second on-chain feed for a catalog row, when a public provider covers it. */
export function secondaryFor(f: Pick<Fixture, "sources">): { source: number; sourceRef: bigint } | undefined {
  const ref = f.sources?.openligadb;
  return ref && /^\d+$/.test(ref) ? { source: SOURCE_OPENLIGADB, sourceRef: BigInt(ref) } : undefined;
}

export function readCatalog(file = CATALOG_PATH): { fixtures: Fixture[] } {
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { fixtures: Fixture[] };
  return { fixtures: raw.fixtures.map(normalizeFixture) };
}

/** Write via a temp file so the running app never reads half a catalog. */
export function writeCatalog(catalog: Awaited<ReturnType<typeof buildCatalog>>, file = CATALOG_PATH) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(catalog));
  fs.renameSync(tmp, file);
}
