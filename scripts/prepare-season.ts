/** npm run seasons:prepare -- champion 2024 --demo; keys stay in .env. */
import { loadEnv } from "./sources/env";
import { standings, scorers, finalSeason } from "./sources/seasons";
import { nameSimilarity } from "./sources/match";
import { validateManifest, SeasonManifest } from "../app/src/lib/season-jobs";
import { writeStore } from "../app/src/lib/store";
import * as fs from "fs";
import * as path from "path";
loadEnv();
async function main() {
  if (!["champion", "scorer"].includes(process.argv[2]))
    throw new Error("Choose champion or scorer");
  const kind = process.argv[2] === "scorer" ? 1 : 0,
    year = Number(process.argv[3]),
    demo = process.argv.includes("--demo");
  if (!Number.isInteger(year)) throw new Error("Pass a season starting year");
  const [a, b] = await Promise.all([
    standings("openligadb", "bl1", year),
    standings("footballData", "BL1", year),
  ]);
  if (a.length !== 18 || b.length !== 18)
    throw new Error(
      "Both providers must return the complete 18-team Bundesliga table",
    );
  if (demo && (!finalSeason(a, 18) || !finalSeason(b, 18)))
    throw new Error(
      "Historical demo requires both providers to confirm a completed season",
    );
  const first = kind === 0 ? a : await scorers("openligadb", "bl1", year),
    second = kind === 0 ? b : await scorers("footballData", "BL1", year);
  const aliases: Record<string, string> = process.env.SEASON_ALIASES_PATH
    ? JSON.parse(fs.readFileSync(process.env.SEASON_ALIASES_PATH, "utf8"))
    : {};
  const used = new Set<string>();
  const participants = first.slice(0, 32).map((r) => {
    const matches = second.filter(
      (o) =>
        (aliases[r.id]
          ? o.id === aliases[r.id]
          : nameSimilarity(r.name, o.name) === 1) && !used.has(o.id),
    );
    if (matches.length !== 1)
      throw new Error(
        `Provide a reviewed alias for participant: ${r.name}. Never infer an ambiguous mapping.`,
      );
    used.add(matches[0].id);
    return {
      name: r.name,
      ids: { openligadb: r.id, footballData: matches[0].id },
    };
  });
  const now = Math.floor(Date.now() / 1000);
  const cutoff = demo ? now + 600 : Number(process.env.SEASON_CUTOFF),
    endTime = demo ? now + 900 : Number(process.env.SEASON_END_TIME);
  const manifest: SeasonManifest = {
    id: String(year * 100 + kind),
    title: `Bundesliga ${year}/${String(year + 1).slice(-2)}${demo ? " demo" : ""}`,
    kind,
    historicalDemo: demo,
    cutoff,
    endTime,
    resolveDeadline: endTime + 2 * 86400,
    leagueSize: 18,
    year,
    participants,
    sources: [
      { source: "openligadb", league: "bl1" },
      { source: "footballData", league: "BL1" },
    ],
  };
  validateManifest(manifest);
  const file =
    process.env.SEASON_CONFIG_PATH ||
    path.join(__dirname, "../app/src/data/seasons.json");
  let all: SeasonManifest[] = [];
  try {
    all = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {}
  const value = [...all.filter((m) => m.id !== manifest.id), manifest];
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
  await writeStore("seasons", file, value);
  console.log(
    `Prepared ${manifest.id} with ${participants.length} mapped participants. Review the manifest, then create it in Admin.`,
  );
}
main().catch((e) => {
  console.error((e as Error).message);
  process.exitCode = 1;
});
