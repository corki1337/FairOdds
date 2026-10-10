/**
 * TheSportsDB v1, free key in the path. This is the source every market's primary
 * Switchboard feed reads, so `idEvent` doubles as the on-chain `match_id`.
 */
import {
  SPORTSDB_BASE,
  type FixtureCategoryId,
} from "../../app/src/lib/fixtures";
import { eventTime } from "./time";
import { getJson } from "./http";
import type { SourceFixture, SourceStatus, Vote } from "./types";

const PACE_MS = 1_800;

type Event = {
  idEvent: string;
  idAPIfootball?: string | null;
  strLeague: string;
  strHomeTeam: string | null;
  strAwayTeam: string | null;
  strTimestamp: string | null;
  dateEvent: string | null;
  strTime: string | null;
  intHomeScore: string | null;
  intAwayScore: string | null;
  strStatus?: string | null;
  strPostponed?: string | null;
};

/** Football seasons roll over in July. */
export function currentSeason(now = new Date()): string {
  const y = now.getUTCFullYear();
  return now.getUTCMonth() >= 6 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

const VOID_STATUS = /postp|cancel|abandon|susp|award|walkover/i;

function score(v: string | null): number | null {
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export function toFixture(
  e: Event,
  category: FixtureCategoryId,
  nowSec: number,
): SourceFixture | null {
  const when = eventTime(e.strTimestamp, e.dateEvent, e.strTime);
  const start = when?.startTime ?? null;
  if (
    start === null ||
    !/^\d+$/.test(e.idEvent) ||
    !e.strHomeTeam ||
    !e.strAwayTeam
  )
    return null;
  const home = score(e.intHomeScore);
  const away = score(e.intAwayScore);
  const voided =
    e.strPostponed === "yes" || VOID_STATUS.test(e.strStatus ?? "");
  const status: SourceStatus = voided
    ? "void"
    : home !== null && away !== null && e.strStatus === "FT"
      ? "final"
      : nowSec >= start
        ? "live"
        : "scheduled";
  return {
    source: "thesportsdb",
    sourceId: e.idEvent,
    category,
    league: e.strLeague,
    home: e.strHomeTeam,
    away: e.strAwayTeam,
    startTime: start,
    timeTBD: when!.timeTBD,
    status,
    final: status === "final" ? { home: home!, away: away! } : null,
    refs: e.idAPIfootball ? { apiFootball: e.idAPIfootball } : undefined,
  };
}

async function events(query: string): Promise<Event[]> {
  const body = await getJson<{ events: Event[] | null }>(
    `${SPORTSDB_BASE}/${query}`,
    {
      paceMs: PACE_MS,
      retries: 4,
    },
  );
  return body?.events ?? [];
}

function collect(list: Event[], category: FixtureCategoryId): SourceFixture[] {
  const now = Math.floor(Date.now() / 1000);
  return list
    .map((e) => toFixture(e, category, now))
    .filter((f): f is SourceFixture => !!f);
}

/** Round-by-round is the only query that returns more than one fixture on the free key. */
export async function leagueRounds(
  leagueId: string,
  category: FixtureCategoryId,
  season: string,
  fromRound: number,
  toRound: number,
): Promise<SourceFixture[]> {
  const out: SourceFixture[] = [];
  for (let r = fromRound; r <= toRound; r++) {
    out.push(
      ...collect(
        await events(`eventsround.php?id=${leagueId}&r=${r}&s=${season}`),
        category,
      ),
    );
  }
  return out;
}

/** Cups and esports have no usable round numbering, so take whatever the league feed offers. */
export async function leagueFeed(
  leagueId: string,
  category: FixtureCategoryId,
): Promise<SourceFixture[]> {
  const out: SourceFixture[] = [];
  for (const endpoint of ["eventsnextleague", "eventspastleague"]) {
    out.push(
      ...collect(await events(`${endpoint}.php?id=${leagueId}`), category),
    );
  }
  return out;
}

export async function result(idEvent: string): Promise<Vote> {
  const list = await events(`lookupevent.php?id=${idEvent}`);
  const f = list.length
    ? toFixture(list[0], "football", Math.floor(Date.now() / 1000))
    : null;
  if (!f)
    return {
      source: "thesportsdb",
      sourceId: idEvent,
      status: "pending",
      note: "no data",
    };
  if (f.status === "void")
    return {
      source: "thesportsdb",
      sourceId: idEvent,
      status: "void",
      note: "postponed/cancelled",
    };
  if (f.final)
    return {
      source: "thesportsdb",
      sourceId: idEvent,
      status: "final",
      score: f.final,
    };
  return {
    source: "thesportsdb",
    sourceId: idEvent,
    status: "pending",
    note: f.status,
  };
}
