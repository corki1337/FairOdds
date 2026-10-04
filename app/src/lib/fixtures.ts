/**
 * Catalog of real fixtures from TheSportsDB. `id` is the provider's `idEvent`, which is also
 * the on-chain `match_id` and the id the Switchboard job looks up when a market settles.
 */
export type FixtureCategoryId = "esports_cs2" | "esports_lol" | "esports" | "football";

export type FixtureStatus = "scheduled" | "live" | "finished";

export type Fixture = {
  id: number;
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

export function toFixtureView(f: Fixture, nowSec = Math.floor(Date.now() / 1000)): FixtureView {
  return {
    ...f,
    matchId: String(f.id),
    status: fixtureStatus(f, nowSec),
    sourceUrl: eventUrl(f.id),
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
