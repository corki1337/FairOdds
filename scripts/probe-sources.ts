/**
 * Read-only check of the result sources: does each public endpoint answer, do the free
 * sources agree on finished Bundesliga matches, and does a Switchboard oracle actually run
 * the OpenLigaDB job (JSONPath filter + finished gate) the way the program expects.
 *
 *   npx ts-node --transpile-only scripts/probe-sources.ts
 */
import { CrossbarClient, OracleJob } from "@switchboard-xyz/common";
import { scoreDiffJobs, openLigaDiffJobs, CROSSBAR_URL } from "../app/src/lib/switchboard";
import * as thesportsdb from "./sources/thesportsdb";
import * as openligadb from "./sources/openligadb";
import { linkFixtures } from "./sources/match";

const BUNDESLIGA = "4331";

async function simulate(label: string, jobs: OracleJob[]) {
  const client = new CrossbarClient(CROSSBAR_URL);
  try {
    const res = await client.simulateJobs({ jobs: jobs.map((j) => j.toJSON()) } as never);
    console.log(`  ${label}:`, JSON.stringify(res).slice(0, 300));
  } catch (e) {
    console.log(`  ${label}: error`, String((e as Error).message ?? e).slice(0, 300));
  }
}

async function main() {
  const season = thesportsdb.currentSeason();
  const tsdb = await thesportsdb.leagueRounds(BUNDESLIGA, "football", season, 1, 6);
  const olg = await openligadb.season("bl1", openligadb.seasonYear(season));
  console.log(`TheSportsDB Bundesliga: ${tsdb.length}, OpenLigaDB bl1: ${olg.length}`);

  const links = linkFixtures(tsdb, olg);
  const linked = tsdb.filter((f) => links.has(f.sourceId));
  console.log(`linked ${linked.length}/${tsdb.length}`);
  for (const f of tsdb.filter((x) => !links.has(x.sourceId)).slice(0, 10)) {
    console.log("  unlinked:", f.home, "-", f.away, new Date(f.startTime * 1000).toISOString());
  }

  let agree = 0;
  let disagree = 0;
  for (const f of linked.filter((x) => x.final).slice(0, 20)) {
    const o = olg.find((x) => x.sourceId === links.get(f.sourceId))!;
    const same = o.final && o.final.home === f.final!.home && o.final.away === f.final!.away;
    if (same) agree++;
    else {
      disagree++;
      console.log("  DIFF", f.home, f.away, f.final, o.final);
    }
  }
  console.log(`finished: agree ${agree}, disagree ${disagree}`);

  const finished = linked.find((x) => x.final);
  const upcoming = linked.find((x) => !x.final);
  if (finished) {
    const o = links.get(finished.sourceId)!;
    console.log(`Switchboard finished #${finished.sourceId} / OpenLigaDB ${o}:`, finished.final);
    await simulate("thesportsdb", scoreDiffJobs(finished.sourceId));
    await simulate("openligadb", openLigaDiffJobs(o));
  }
  if (upcoming) {
    const o = links.get(upcoming.sourceId)!;
    console.log(`Switchboard upcoming #${upcoming.sourceId} / OpenLigaDB ${o} (expect no value):`);
    await simulate("thesportsdb", scoreDiffJobs(upcoming.sourceId));
    await simulate("openligadb", openLigaDiffJobs(o));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
