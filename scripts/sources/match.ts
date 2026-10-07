/**
 * Links the same real event across providers. Providers share no id (except TheSportsDB's
 * `idAPIfootball`), so matching is by kickoff window plus both team names.
 */
import type { Score, SourceFixture, Vote } from "./types";

export const KICKOFF_WINDOW_SECONDS = 15 * 60;

/** Club-form tokens that carry no identity ("FC", "1.", founding years...). */
const STOPWORDS = new Set([
  "fc", "cf", "sc", "sv", "bv", "fk", "sk", "ac", "as", "afc", "ssc", "us", "rc", "cd", "ud",
  "tsg", "vfl", "vfb", "fsv", "ogc", "osc", "bsc", "kv", "krc", "rsc", "club", "de", "and",
  "1", "04", "05", "07", "09", "1846", "1848", "1860", "1899", "1900", "1904", "1907", "1909",
  "team", "esports", "gaming",
]);

/** Spellings that differ by language, mapped onto one form. */
const ALIASES: Record<string, string> = {
  munchen: "munich",
  koln: "cologne",
  nurnberg: "nuremberg",
  hamburger: "hamburg",
  monchengladbach: "gladbach",
  utd: "united",
  man: "manchester",
  wolves: "wolverhampton",
  spurs: "tottenham",
  inter: "internazionale",
  psg: "paris",
};

export function nameTokens(name: string): Set<string> {
  const plain = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ");
  const out = new Set<string>();
  for (const raw of plain.split(/\s+/)) {
    if (!raw || STOPWORDS.has(raw)) continue;
    out.add(ALIASES[raw] ?? raw);
  }
  return out;
}

/** Overlap coefficient: "Werder Bremen" vs "SV Werder Bremen" scores 1. */
export function nameSimilarity(a: string, b: string): number {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.size || !tb.size) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return common / Math.min(ta.size, tb.size);
}

/** Strictly above one shared token out of two, so "Borussia Dortmund" never pairs with "Borussia Mönchengladbach". */
const MIN_SIMILARITY = 0.51;

/**
 * One-to-one links from `base` fixtures to `other` fixtures by `sourceId`. A pair needs both
 * sides similar and kickoff within the window; the best-scoring candidate wins.
 */
export function linkFixtures(base: SourceFixture[], other: SourceFixture[]): Map<string, string> {
  const pairs: { b: string; o: string; score: number }[] = [];
  for (const b of base) {
    for (const o of other) {
      if (Math.abs(b.startTime - o.startTime) > KICKOFF_WINDOW_SECONDS) continue;
      const h = nameSimilarity(b.home, o.home);
      const a = nameSimilarity(b.away, o.away);
      if (h < MIN_SIMILARITY || a < MIN_SIMILARITY) continue;
      pairs.push({ b: b.sourceId, o: o.sourceId, score: h + a });
    }
  }
  pairs.sort((x, y) => y.score - x.score);
  const links = new Map<string, string>();
  const used = new Set<string>();
  for (const p of pairs) {
    if (links.has(p.b) || used.has(p.o)) continue;
    links.set(p.b, p.o);
    used.add(p.o);
  }
  return links;
}

export type Consensus =
  | { verdict: "agree"; score: Score; voters: string[] }
  | { verdict: "dispute"; reason: string; votes: Vote[] }
  | { verdict: "waiting"; votes: Vote[] };

/**
 * Any contradiction blocks settlement. There is no majority rule: free providers often copy
 * one upstream, so two equal answers do not outvote a third.
 */
export function consensus(votes: Vote[], minFinal = 1): Consensus {
  const finals = votes.filter((v): v is Extract<Vote, { status: "final" }> => v.status === "final");
  const voids = votes.filter((v) => v.status === "void");
  if (voids.length) {
    return { verdict: "dispute", reason: `void at ${voids.map((v) => v.source).join(", ")}`, votes };
  }
  const distinct = new Set(finals.map((v) => `${v.score.home}:${v.score.away}`));
  if (distinct.size > 1) {
    const detail = finals.map((v) => `${v.source} ${v.score.home}:${v.score.away}`).join(", ");
    return { verdict: "dispute", reason: `scores differ (${detail})`, votes };
  }
  if (finals.length < minFinal) return { verdict: "waiting", votes };
  return { verdict: "agree", score: finals[0].score, voters: finals.map((v) => v.source) };
}
