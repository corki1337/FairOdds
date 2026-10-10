/**
 * PandaScore free "fixtures" plan: schedules and series results for LoL, CS, Dota 2, Valorant.
 * Needs `PANDASCORE_TOKEN` (1000 req/h). The token goes in the query string, so it can never
 * be put in a public Switchboard job; this source only feeds the catalog and the keeper check.
 */
import type { FixtureCategoryId } from "../../app/src/lib/fixtures";
import { getJson } from "./http";
import type { SourceFixture, SourceStatus, Vote } from "./types";

const BASE = "https://api.pandascore.co";

export const GAMES: { slug: string; category: FixtureCategoryId }[] = [
  { slug: "lol", category: "esports_lol" },
  { slug: "csgo", category: "esports_cs2" },
  { slug: "dota2", category: "esports" },
  { slug: "valorant", category: "esports" },
];

type Match = {
  id: number;
  begin_at: string | null;
  scheduled_at: string | null;
  original_scheduled_at?: string | null;
  status: string;
  forfeit: boolean;
  number_of_games?: number | null;
  videogame: { slug: string };
  league: { name: string };
  serie?: { full_name?: string | null };
  opponents: { opponent: { id: number; name: string } }[];
  results: { team_id: number; score: number }[];
};

const token = () => process.env.PANDASCORE_TOKEN || "";
export const enabled = () => token().length > 0;

const get = <T>(p: string) =>
  getJson<T>(`${BASE}${p}${p.includes("?") ? "&" : "?"}token=${token()}`, {
    paceMs: 4_000,
  });

const SLUG_TO_CATEGORY: Record<string, FixtureCategoryId> = {
  lol: "esports_lol",
  "league-of-legends": "esports_lol",
  csgo: "esports_cs2",
  "cs-go": "esports_cs2",
  "cs-2": "esports_cs2",
  cs2: "esports_cs2",
  dota2: "esports",
  "dota-2": "esports",
  valorant: "esports",
};

export const categoryOf = (slug?: string | null): FixtureCategoryId =>
  (slug ? SLUG_TO_CATEGORY[slug.toLowerCase()] : undefined) ?? "esports";

export function toFixture(m: Match): SourceFixture | null {
  const when =
    m.status === "running" || m.status === "finished"
      ? (m.begin_at ?? m.scheduled_at ?? m.original_scheduled_at)
      : (m.scheduled_at ?? m.original_scheduled_at ?? m.begin_at);
  const ms = when ? Date.parse(when) : NaN;
  if (!Number.isFinite(ms) || m.opponents.length !== 2) return null;
  const [a, b] = m.opponents.map((o) => o.opponent);
  const sa = m.results.find((r) => r.team_id === a.id)?.score;
  const sb = m.results.find((r) => r.team_id === b.id)?.score;
  const voided =
    m.status === "canceled" || m.status === "postponed" || m.forfeit;
  const finished =
    m.status === "finished" && sa !== undefined && sb !== undefined;
  const status: SourceStatus = voided
    ? "void"
    : finished
      ? "final"
      : m.status === "running"
        ? "live"
        : "scheduled";
  const format =
    m.number_of_games && m.number_of_games > 0
      ? `Bo${m.number_of_games}`
      : undefined;
  const baseLeague = m.serie?.full_name
    ? `${m.league.name} ${m.serie.full_name}`
    : m.league.name;
  const league = format ? `${baseLeague} (${format})` : baseLeague;
  return {
    source: "pandascore",
    sourceId: String(m.id),
    category: categoryOf(m.videogame?.slug),
    league,
    format,
    home: a.name,
    away: b.name,
    startTime: Math.floor(ms / 1000),
    status,
    final: status === "final" ? { home: sa!, away: sb! } : null,
  };
}

export async function upcoming(perGame = 50): Promise<SourceFixture[]> {
  if (!enabled()) return [];
  const out: SourceFixture[] = [];
  for (const g of GAMES) {
    const list = await get<Match[]>(
      `/${g.slug}/matches/upcoming?per_page=${perGame}&sort=scheduled_at`,
    );
    out.push(
      ...(list ?? []).map(toFixture).filter((f): f is SourceFixture => !!f),
    );
  }
  return out;
}

export async function result(id: string): Promise<Vote> {
  if (!enabled())
    return {
      source: "pandascore",
      sourceId: id,
      status: "pending",
      note: "no key",
    };
  const m = await get<Match>(`/matches/${id}`);
  const f = m ? toFixture(m) : null;
  if (!f)
    return {
      source: "pandascore",
      sourceId: id,
      status: "pending",
      note: "no data",
    };
  if (f.status === "void")
    return {
      source: "pandascore",
      sourceId: id,
      status: "void",
      note: m!.status,
    };
  if (f.final)
    return {
      source: "pandascore",
      sourceId: id,
      status: "final",
      score: f.final,
    };
  return {
    source: "pandascore",
    sourceId: id,
    status: "pending",
    note: m!.status,
  };
}
