/**
 * Catalog of real fixtures merged from several providers. For rows that come from
 * TheSportsDB, `id` is its `idEvent`, which is also the on-chain `match_id` and the id the
 * primary Switchboard job looks up when a market settles. Rows known only to another
 * provider are listed but `marketable: false`: there is no public job that could settle them.
 */
export type FixtureCategoryId =
  "esports_cs2" | "esports_lol" | "esports" | "football";

export type FixtureStatus = "scheduled" | "live" | "finished";

export type FixtureSourceId =
  "thesportsdb" | "openligadb" | "footballData" | "apiFootball" | "pandascore";

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
  timeTBD?: boolean;
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

export type CategoryTabId = FixtureCategoryId | "all";

export type CategoryMeta = {
  id: CategoryTabId;
  labelEn: string;
  labelPl: string;
  shortLabel: string;
  icon: string;
};

export const CATEGORY_TABS: CategoryMeta[] = [
  {
    id: "all",
    labelEn: "All",
    labelPl: "Wszystkie",
    shortLabel: "Wszystkie",
    icon: "🌟",
  },
  {
    id: "football",
    labelEn: "Football",
    labelPl: "Piłka nożna",
    shortLabel: "Piłka",
    icon: "⚽",
  },
  {
    id: "esports_cs2",
    labelEn: "Counter-Strike 2",
    labelPl: "Counter-Strike 2",
    shortLabel: "CS2",
    icon: "🎯",
  },
  {
    id: "esports_lol",
    labelEn: "League of Legends",
    labelPl: "League of Legends",
    shortLabel: "LoL",
    icon: "⚔️",
  },
  {
    id: "esports",
    labelEn: "Other Esports",
    labelPl: "Inne e-sporty",
    shortLabel: "E-sport",
    icon: "🎮",
  },
];

export function getCategoryMeta(categoryId?: string | null): CategoryMeta {
  return (
    CATEGORY_TABS.find((c) => c.id === categoryId) ?? {
      id: "football",
      labelEn: "Football",
      labelPl: "Piłka nożna",
      shortLabel: "Piłka",
      icon: "⚽",
    }
  );
}

export function inferCategory(
  teams?: string[],
  league?: string | null,
): FixtureCategoryId {
  const text = `${teams?.join(" ") ?? ""} ${league ?? ""}`.toLowerCase();
  if (
    text.includes("cs2") ||
    text.includes("csgo") ||
    text.includes("counter-strike") ||
    text.includes("frag university") ||
    text.includes("blast") ||
    text.includes("major") ||
    text.includes("iem") ||
    text.includes("esl")
  ) {
    return "esports_cs2";
  }
  if (
    text.includes("league of legends") ||
    text.includes("lol") ||
    text.includes("lec") ||
    text.includes("lck") ||
    text.includes("lcs") ||
    text.includes("lpl") ||
    text.includes("worlds")
  ) {
    return "esports_lol";
  }
  if (
    text.includes("dota") ||
    text.includes("valorant") ||
    text.includes("overwatch") ||
    text.includes("starcraft") ||
    text.includes("esport")
  ) {
    return "esports";
  }
  return "football";
}

export const CATEGORIES: FixtureCategory[] = (
  Object.keys(CATEGORY_LABELS) as FixtureCategoryId[]
).map((id) => ({ id, label: CATEGORY_LABELS[id] }));

export const CATEGORY_NAV: { id: FixtureCategoryId | "all"; label: string }[] =
  [{ id: "all", label: "Wszystkie" }, ...CATEGORIES];

export function fixtureStatus(
  f: Pick<Fixture, "startTime" | "endTime" | "finished">,
  nowSec = Math.floor(Date.now() / 1000),
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

export function sourceUrlOf(
  f: Pick<Fixture, "id" | "marketable" | "sources">,
): string {
  const panda = f.sources?.pandascore;
  if (f.id >= UNMARKETABLE_ID_OFFSET || (!f.marketable && panda)) {
    return panda ? `https://api.pandascore.co/matches/${panda}` : "";
  }
  return eventUrl(f.id);
}

/** Rows written before multi-source catalogs had no `key`/`sources`; treat them as TheSportsDB. */
export function normalizeFixture(
  f: Partial<Fixture> & Omit<Fixture, "key" | "marketable" | "sources">,
): Fixture {
  return {
    ...f,
    key: f.key ?? `thesportsdb:${f.id}`,
    marketable: !f.timeTBD && (f.marketable ?? true),
    sources: f.sources ?? { thesportsdb: String(f.id) },
  };
}

export function toFixtureView(
  f: Fixture,
  nowSec = Math.floor(Date.now() / 1000),
): FixtureView {
  return {
    ...f,
    matchId: String(f.id),
    status: fixtureStatus(f, nowSec),
    sourceUrl: sourceUrlOf(f),
  };
}

export function scoreLabel(
  f: Pick<Fixture, "scoreA" | "scoreB">,
): string | null {
  return f.scoreA === null || f.scoreB === null
    ? null
    : `${f.scoreA} : ${f.scoreB}`;
}

export function outcomeLabel(f: Fixture): string {
  if (f.scoreA === null || f.scoreB === null) return "Brak wyniku";
  if (f.scoreA > f.scoreB) return `Wygrywa ${f.teamA}`;
  if (f.scoreA < f.scoreB) return `Wygrywa ${f.teamB}`;
  return "Remis — zwrot stawek";
}
