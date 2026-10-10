/** Fetch season data for catalog preparation. Settlement remains in pinned Switchboard jobs. */
import { getJson } from "./http";
import type { SeasonSource } from "../../app/src/lib/season-jobs";
export type Standing = {
  id: string;
  name: string;
  played: number;
  points: number;
  rank: number;
};
export type Scorer = { id: string; name: string; goals: number };
export async function standings(
  source: SeasonSource,
  league: string,
  year: number,
): Promise<Standing[]> {
  if (source === "openligadb") {
    const rows = await getJson<any[]>(
      `https://api.openligadb.de/getbltable/${league}/${year}`,
    );
    return (rows ?? []).map((r, i) => ({
      id: String(r.teamInfoId),
      name: r.teamName,
      played: r.matches,
      points: r.points,
      rank: i + 1,
    }));
  }
  if (source === "thesportsdb") {
    const data = await getJson<any>(
      `https://www.thesportsdb.com/api/v1/json/3/lookuptable.php?l=${league}&s=${year}-${year + 1}`,
    );
    return (data?.table ?? []).map((r: any) => ({
      id: r.idTeam,
      name: r.strTeam,
      played: Number(r.intPlayed),
      points: Number(r.intPoints),
      rank: Number(r.intRank),
    }));
  }
  if (!process.env.FOOTBALL_DATA_KEY)
    throw new Error("FOOTBALL_DATA_KEY required for football-data standings");
  const data = await getJson<any>(
    `https://api.football-data.org/v4/competitions/${league}/standings?season=${year}`,
    { headers: { "X-Auth-Token": process.env.FOOTBALL_DATA_KEY } },
  );
  return (
    data?.standings?.find((s: any) => s.type === "TOTAL")?.table ?? []
  ).map((r: any) => ({
    id: String(r.team.id),
    name: r.team.name,
    played: r.playedGames,
    points: r.points,
    rank: r.position,
  }));
}
export async function scorers(
  source: "openligadb" | "footballData",
  league: string,
  year: number,
): Promise<Scorer[]> {
  if (source === "openligadb") {
    const rows = await getJson<any[]>(
      `https://api.openligadb.de/getgoalgetters/${league}/${year}`,
    );
    return (rows ?? []).map((r) => ({
      id: String(r.goalGetterId),
      name: r.goalGetterName,
      goals: r.goalCount,
    }));
  }
  if (!process.env.FOOTBALL_DATA_KEY)
    throw new Error("FOOTBALL_DATA_KEY required for football-data scorers");
  const data = await getJson<any>(
    `https://api.football-data.org/v4/competitions/${league}/scorers?season=${year}&limit=100`,
    { headers: { "X-Auth-Token": process.env.FOOTBALL_DATA_KEY } },
  );
  return (data?.scorers ?? []).map((r: any) => ({
    id: String(r.player.id),
    name: r.player.name,
    goals: r.goals,
  }));
}
export function finalSeason(rows: Standing[], leagueSize: number) {
  return (
    rows.length === leagueSize &&
    new Set(rows.map((r) => r.id)).size === leagueSize &&
    rows.every((r) => r.played === 2 * (leagueSize - 1))
  );
}
export function uniqueTopScorer(rows: Scorer[]) {
  if (rows.length < 2 || rows[0].goals <= rows[1].goals) return null;
  return rows[0].id;
}
