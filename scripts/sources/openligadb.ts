/**
 * OpenLigaDB: free, no key, mostly German football. Its per-match URL is public, so it can be
 * the job behind a market's second Switchboard feed (see `openLigaDiffJobs`).
 */
import { OPENLIGADB_BASE } from "../../app/src/lib/switchboard";
import { getJson } from "./http";
import type { SourceFixture, SourceStatus, Vote } from "./types";

/** "Endergebnis": score after regular time, matching TheSportsDB's league scores. */
export const FINAL_RESULT_TYPE = 2;

type Match = {
  matchID: number;
  matchDateTimeUTC: string;
  leagueName: string;
  matchIsFinished: boolean;
  team1: { teamName: string };
  team2: { teamName: string };
  matchResults: { resultTypeID: number; pointsTeam1: number; pointsTeam2: number }[];
};

/** OpenLigaDB names a season by its starting year: "2026-2027" -> 2026. */
export function seasonYear(season: string): number {
  return Number(season.slice(0, 4));
}

function toFixture(m: Match, nowSec: number): SourceFixture | null {
  const ms = Date.parse(m.matchDateTimeUTC);
  if (!Number.isFinite(ms)) return null;
  const start = Math.floor(ms / 1000);
  const fin = m.matchResults.find((r) => r.resultTypeID === FINAL_RESULT_TYPE);
  const status: SourceStatus =
    m.matchIsFinished && fin ? "final" : nowSec >= start ? "live" : "scheduled";
  return {
    source: "openligadb",
    sourceId: String(m.matchID),
    category: "football",
    league: m.leagueName,
    home: m.team1.teamName,
    away: m.team2.teamName,
    startTime: start,
    status,
    final: status === "final" ? { home: fin!.pointsTeam1, away: fin!.pointsTeam2 } : null,
  };
}

export async function season(shortcut: string, year: number): Promise<SourceFixture[]> {
  const list = await getJson<Match[]>(`${OPENLIGADB_BASE}/getmatchdata/${shortcut}/${year}`);
  const now = Math.floor(Date.now() / 1000);
  return (list ?? []).map((m) => toFixture(m, now)).filter((f): f is SourceFixture => !!f);
}

export async function result(matchId: string): Promise<Vote> {
  const m = await getJson<Match>(`${OPENLIGADB_BASE}/getmatchdata/${matchId}`);
  const f = m && m.matchID ? toFixture(m, Math.floor(Date.now() / 1000)) : null;
  if (!f) return { source: "openligadb", sourceId: matchId, status: "pending", note: "no data" };
  if (f.final) return { source: "openligadb", sourceId: matchId, status: "final", score: f.final };
  return { source: "openligadb", sourceId: matchId, status: "pending", note: f.status };
}
