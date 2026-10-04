/**
 * Rebuilds app/src/data/fixtures.json from TheSportsDB.
 *
 * The same public endpoint that feeds this catalog is what the Switchboard oracles call when
 * a market settles, so an id here is exactly the id the chain resolves against.
 *
 *   npx ts-node scripts/fetch-fixtures.ts
 */
import * as fs from "fs";
import * as path from "path";
import {
  SPORTSDB_BASE,
  eventUrl,
  type Fixture,
  type FixtureCategoryId,
} from "../app/src/lib/fixtures";

const OUT = path.join(__dirname, "..", "app", "src", "data", "fixtures.json");

/** Round-by-round is the only query that returns more than one fixture on the free API key. */
const ROUND_LEAGUES: { id: string; category: FixtureCategoryId }[] = [
  { id: "4328", category: "football" }, // English Premier League
  { id: "4331", category: "football" }, // German Bundesliga
  { id: "4332", category: "football" }, // Italian Serie A
  { id: "4334", category: "football" }, // French Ligue 1
  { id: "4335", category: "football" }, // Spanish La Liga
  { id: "4337", category: "football" }, // Dutch Eredivisie
];
const SEASON = "2026-2027";
const ROUNDS = 12;

/** Cups and esports have no usable round numbering, so take whatever the league feed offers. */
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

/** Minutes after kickoff before the provider can be expected to carry a final score. */
const SETTLE_BUFFER: Record<FixtureCategoryId, number> = {
  football: 150,
  esports_cs2: 300,
  esports_lol: 300,
  esports: 300,
};

const PACE_MS = 1_800;

type SportsDbEvent = {
  idEvent: string;
  strLeague: string;
  strHomeTeam: string | null;
  strAwayTeam: string | null;
  strTimestamp: string | null;
  dateEvent: string | null;
  strTime: string | null;
  intHomeScore: string | null;
  intAwayScore: string | null;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function events(query: string): Promise<SportsDbEvent[]> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${SPORTSDB_BASE}/${query}`);
    if (res.ok) {
      const body = (await res.json()) as { events: SportsDbEvent[] | null };
      return body.events ?? [];
    }
    if (res.status !== 429 || attempt >= 4) {
      console.warn(`${query}: HTTP ${res.status}`);
      return [];
    }
    await sleep(5_000 * (attempt + 1));
  }
}

function startOf(e: SportsDbEvent): number | null {
  const iso = e.strTimestamp
    ? `${e.strTimestamp.replace(" ", "T").replace(/Z$/, "")}Z`
    : e.dateEvent && e.strTime
      ? `${e.dateEvent}T${e.strTime.slice(0, 8)}Z`
      : null;
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function toFixture(e: SportsDbEvent, category: FixtureCategoryId): Fixture | null {
  const start = startOf(e);
  const id = Number(e.idEvent);
  if (start === null || !Number.isSafeInteger(id) || !e.strHomeTeam || !e.strAwayTeam) return null;
  const scoreA = e.intHomeScore === null || e.intHomeScore === "" ? null : Number(e.intHomeScore);
  const scoreB = e.intAwayScore === null || e.intAwayScore === "" ? null : Number(e.intAwayScore);
  if (scoreA !== null && !Number.isFinite(scoreA)) return null;
  if (scoreB !== null && !Number.isFinite(scoreB)) return null;
  return {
    id,
    category,
    league: e.strLeague,
    teamA: e.strHomeTeam,
    teamB: e.strAwayTeam,
    startTime: start,
    endTime: start + SETTLE_BUFFER[category] * 60,
    finished: scoreA !== null && scoreB !== null,
    scoreA,
    scoreB,
  };
}

async function main() {
  const byId = new Map<number, Fixture>();
  const collect = async (query: string, category: FixtureCategoryId) => {
    let added = 0;
    for (const e of await events(query)) {
      const f = toFixture(e, category);
      if (f && !byId.has(f.id)) {
        byId.set(f.id, f);
        added++;
      }
    }
    await sleep(PACE_MS);
    return added;
  };

  for (const { id, category } of ROUND_LEAGUES) {
    let added = 0;
    for (let round = 1; round <= ROUNDS; round++) {
      added += await collect(`eventsround.php?id=${id}&r=${round}&s=${SEASON}`, category);
    }
    console.log(`league ${id}: +${added}`);
  }
  for (const { id, category } of FEED_LEAGUES) {
    let added = 0;
    for (const endpoint of ["eventsnextleague", "eventspastleague"]) {
      added += await collect(`${endpoint}.php?id=${id}`, category);
    }
    console.log(`league ${id}: +${added}`);
  }

  const fixtures = [...byId.values()].sort((a, b) => a.startTime - b.startTime);
  if (fixtures.length === 0) throw new Error("provider returned nothing; refusing to wipe catalog");

  const byCategory = fixtures.reduce<Record<string, number>>((acc, f) => {
    acc[f.category] = (acc[f.category] ?? 0) + 1;
    return acc;
  }, {});
  const upcoming = fixtures.filter((f) => !f.finished).length;

  fs.writeFileSync(
    OUT,
    JSON.stringify({
      provider: "thesportsdb",
      lookupUrl: eventUrl("{idEvent}"),
      fixtures,
      meta: {
        fetchedAt: new Date().toISOString(),
        count: fixtures.length,
        upcoming,
        byCategory,
      },
    })
  );
  console.log(
    `wrote ${fixtures.length} fixtures (${JSON.stringify(byCategory)}), ${upcoming} not finished yet`
  );
}

main().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
