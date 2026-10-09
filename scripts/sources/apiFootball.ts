/**
 * API-Football (api-sports.io). Needs `API_FOOTBALL_KEY`; the free plan is 100 requests a day
 * and only older seasons, so it is used for result checks only. The fixture id comes for free
 * from TheSportsDB (`idAPIfootball`), so no schedule calls are spent on matching.
 */
import * as fs from "fs";
import * as path from "path";
import { getJson } from "./http";
import type { Vote } from "./types";

const BASE = "https://v3.football.api-sports.io";
const BUDGET_FILE = path.join(__dirname, "..", "..", "data", "api-football-budget.json");

type Fixture = {
  fixture: { id: number; status: { short: string } };
  score: { fulltime: { home: number | null; away: number | null } };
};

const key = () => process.env.API_FOOTBALL_KEY || "";
export const enabled = () => key().length > 0;
const dailyLimit = () => Number(process.env.API_FOOTBALL_DAILY || 90);

/** Persisted so a restarted keeper does not burn through the daily quota twice. */
function takeBudget(): boolean {
  const today = new Date().toISOString().slice(0, 10);
  let state = { day: today, used: 0 };
  try {
    const saved = JSON.parse(fs.readFileSync(BUDGET_FILE, "utf8"));
    if (saved.day === today) state = saved;
  } catch {
    // first run
  }
  if (state.used >= dailyLimit()) return false;
  state.used++;
  fs.mkdirSync(path.dirname(BUDGET_FILE), { recursive: true });
  fs.writeFileSync(BUDGET_FILE, JSON.stringify(state));
  return true;
}

const VOID = new Set(["PST", "CANC", "ABD", "AWD", "WO", "SUSP"]);
const FINAL = new Set(["FT", "AET", "PEN"]);

export async function result(id: string): Promise<Vote> {
  if (!enabled()) return { source: "apiFootball", sourceId: id, status: "pending", note: "no key" };
  if (!takeBudget()) return { source: "apiFootball", sourceId: id, status: "pending", note: "daily budget" };
  const body = await getJson<{ response: Fixture[] }>(`${BASE}/fixtures?id=${id}`, {
    headers: { "x-apisports-key": key() },
    retries: 0,
  });
  const f = body?.response?.[0];
  if (!f) return { source: "apiFootball", sourceId: id, status: "pending", note: "no data" };
  const st = f.fixture.status.short;
  if (VOID.has(st)) return { source: "apiFootball", sourceId: id, status: "void", note: st };
  // `score.fulltime` is the 90-minute score even when the match went to extra time.
  const s = f.score.fulltime;
  if (FINAL.has(st) && s.home !== null && s.away !== null) {
    return { source: "apiFootball", sourceId: id, status: "final", score: { home: s.home, away: s.away } };
  }
  return { source: "apiFootball", sourceId: id, status: "pending", note: st };
}
