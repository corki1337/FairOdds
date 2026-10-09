/**
 * football-data.org v4. Needs `FOOTBALL_DATA_KEY` (header), free plan ~10 req/min and only
 * the bigger competitions. Without a key every call is skipped.
 */
import { getJson } from "./http";
import type { SourceFixture, SourceStatus, Vote } from "./types";

const BASE = "https://api.football-data.org/v4";
const PACE_MS = 6_500;

/** TheSportsDB league id -> football-data competition code (free tier set). */
export const COMPETITIONS: Record<string, string> = {
  "4328": "PL",
  "4329": "ELC",
  "4331": "BL1",
  "4332": "SA",
  "4334": "FL1",
  "4335": "PD",
  "4337": "DED",
  "4344": "PPL",
  "4480": "CL",
};

type Match = {
  id: number;
  utcDate: string;
  status: string;
  competition: { name: string };
  homeTeam: { name: string | null; shortName?: string | null };
  awayTeam: { name: string | null; shortName?: string | null };
  score: {
    duration?: string;
    fullTime: { home: number | null; away: number | null };
    regularTime?: { home: number | null; away: number | null };
  };
};

const key = () => process.env.FOOTBALL_DATA_KEY || "";
export const enabled = () => key().length > 0;

const get = <T>(path: string) =>
  getJson<T>(`${BASE}${path}`, { headers: { "X-Auth-Token": key() }, paceMs: PACE_MS });

const VOID = new Set(["POSTPONED", "CANCELLED", "SUSPENDED", "AWARDED"]);

/** `fullTime` includes extra time in v4; `regularTime` is only present when there was some. */
function regular(m: Match) {
  const s = m.score.duration && m.score.duration !== "REGULAR" ? m.score.regularTime : m.score.fullTime;
  return s && s.home !== null && s.away !== null ? { home: s.home, away: s.away } : null;
}

function toFixture(m: Match): SourceFixture | null {
  const ms = Date.parse(m.utcDate);
  if (!Number.isFinite(ms) || !m.homeTeam.name || !m.awayTeam.name) return null;
  const fin = m.status === "FINISHED" ? regular(m) : null;
  const status: SourceStatus = VOID.has(m.status)
    ? "void"
    : fin
      ? "final"
      : m.status === "IN_PLAY" || m.status === "PAUSED"
        ? "live"
        : "scheduled";
  return {
    source: "footballData",
    sourceId: String(m.id),
    category: "football",
    league: m.competition.name,
    home: m.homeTeam.name,
    away: m.awayTeam.name,
    startTime: Math.floor(ms / 1000),
    status,
    final: fin,
  };
}

export async function competition(sportsDbLeagueId: string): Promise<SourceFixture[]> {
  const code = COMPETITIONS[sportsDbLeagueId];
  if (!enabled() || !code) return [];
  const body = await get<{ matches: Match[] }>(`/competitions/${code}/matches`);
  return (body?.matches ?? []).map(toFixture).filter((f): f is SourceFixture => !!f);
}

export async function result(id: string): Promise<Vote> {
  if (!enabled()) return { source: "footballData", sourceId: id, status: "pending", note: "no key" };
  const m = await get<Match>(`/matches/${id}`);
  const f = m ? toFixture(m) : null;
  if (!f) return { source: "footballData", sourceId: id, status: "pending", note: "no data" };
  if (f.status === "void") return { source: "footballData", sourceId: id, status: "void", note: m!.status };
  if (f.final) return { source: "footballData", sourceId: id, status: "final", score: f.final };
  return { source: "footballData", sourceId: id, status: "pending", note: m!.status };
}
