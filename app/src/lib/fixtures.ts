/**
 * Catalog of real fixtures merged from several providers. For rows that come from
 * TheSportsDB, `id` is its `idEvent`, which is also the on-chain `match_id` and the id the
 * primary Switchboard job looks up when a market settles. Rows known only to another
 * provider are listed but `marketable: false`: there is no public job that could settle them.
 */
export type FixtureCategoryId = "esports_cs2" | "esports_lol" | "esports" | "football";

export type FixtureStatus = "scheduled" | "live" | "finished";

export type FixtureSourceId =
  | "thesportsdb"
  | "openligadb"
  | "footballData"
  | "apiFootball"
  | "pandascore";

/** Ids of providers that only carry this row; a market can never be created for them. */
export const UNMARKETABLE_ID_OFFSET = 9_000_000_000_000;

export type Fixture = {
  /** `${source}:${sourceId}` of the provider the row was built from. */
  key: string;
  id: number;
  /** True only with a TheSportsDB `idEvent`, the source of every primary feed. */
  marketable: boolean;
  /** The same event's id in every provider it was matched to. */
  sources: Partial<Record<FixtureSourceId, string>>;
  category: FixtureCategoryId;
  league: string;
  /** Home side; the oracle reports `teamA score - teamB score`. */
  teamA: string;
  teamB: string;
  startTime: number;
  /** Earliest time the provider is expected to carry a final score. */
  endTime: number;
  finished: boolean;
  scoreA: number | null;
  scoreB: number | null;
  /** Series format, e.g. "Bo1", "Bo3", "Bo5" */
  format?: string;
};

export type FixtureCategory = {
  id: FixtureCategoryId;
  label: string;
};

export type FixtureView = Fixture & {
  matchId: string;
  status: FixtureStatus;
  sourceUrl: string;
};

export const SPORTSDB_BASE = "https://www.thesportsdb.com/api/v1/json/3";

export function eventUrl(eventId: number | string): string {
  return `${SPORTSDB_BASE}/lookupevent.php?id=${eventId}`;
}

export const CATEGORY_LABELS: Record<FixtureCategoryId, string> = {
  football: "Piłka nożna",
  esports_cs2: "CS2",
  esports_lol: "League of Legends",
  esports: "Esports",
};

export const CATEGORIES: FixtureCategory[] = (
  Object.keys(CATEGORY_LABELS) as FixtureCategoryId[]
).map((id) => ({ id, label: CATEGORY_LABELS[id] }));

export const CATEGORY_NAV: { id: FixtureCategoryId | "all"; label: string }[] = [
  { id: "all", label: "Wszystkie" },
  ...CATEGORIES,
];

export function fixtureStatus(
  f: Pick<Fixture, "startTime" | "endTime" | "finished">,
  nowSec = Math.floor(Date.now() / 1000)
): FixtureStatus {
  if (f.finished || nowSec >= f.endTime) return "finished";
  if (nowSec >= f.startTime) return "live";
  return "scheduled";
}

export const SOURCE_LABELS: Record<FixtureSourceId, string> = {
  thesportsdb: "TheSportsDB",
  openligadb: "OpenLigaDB",
  footballData: "football-data.org",
  apiFootball: "API-Football",
  pandascore: "PandaScore",
};

export function sourceUrlOf(f: Pick<Fixture, "id" | "marketable" | "sources">): string {
  const panda = f.sources?.pandascore;
  if (f.id >= UNMARKETABLE_ID_OFFSET || (!f.marketable && panda)) {
    return panda ? `https://api.pandascore.co/matches/${panda}` : "";
  }
  return eventUrl(f.id);
}

/** Rows written before multi-source catalogs had no `key`/`sources`; treat them as TheSportsDB. */
export function normalizeFixture(f: Partial<Fixture> & Omit<Fixture, "key" | "marketable" | "sources">): Fixture {
  return {
    ...f,
    key: f.key ?? `thesportsdb:${f.id}`,
    marketable: f.marketable ?? true,
    sources: f.sources ?? { thesportsdb: String(f.id) },
  };
}

export function toFixtureView(f: Fixture, nowSec = Math.floor(Date.now() / 1000)): FixtureView {
  return {
    ...f,
    matchId: String(f.id),
    status: fixtureStatus(f, nowSec),
    sourceUrl: sourceUrlOf(f),
  };
}

export function scoreLabel(f: Pick<Fixture, "scoreA" | "scoreB">): string | null {
  return f.scoreA === null || f.scoreB === null ? null : `${f.scoreA} : ${f.scoreB}`;
}

export function outcomeLabel(f: Fixture): string {
  if (f.scoreA === null || f.scoreB === null) return "Brak wyniku";
  if (f.scoreA > f.scoreB) return `Wygrywa ${f.teamA}`;
  if (f.scoreA < f.scoreB) return `Wygrywa ${f.teamB}`;
  return "Remis — zwrot stawek";
}
