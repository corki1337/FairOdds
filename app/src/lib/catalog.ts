import * as path from "path";
import { existsSync } from "fs";
const appRoot = existsSync(path.join(process.cwd(), "app", "src"))
  ? path.join(process.cwd(), "app")
  : process.cwd();
import { normalizeFixture, type Fixture } from "./fixtures";
import { readStore } from "./store";
import { validateManifest, type SeasonManifest } from "./season-jobs";
export type Catalog = {
  provider: string;
  lookupUrl: string;
  fixtures: Fixture[];
  meta?: Record<string, unknown>;
};
export type Anomaly = {
  matchId: string;
  reason: string;
  votes: {
    source: string;
    status: string;
    score?: { home: number; away: number };
    note?: string;
  }[];
  firstSeen: string;
  lastSeen: string;
};
export const CATALOG_PATH =
  process.env.FIXTURES_PATH ||
  path.join(appRoot, "src", "data", "fixtures.json");
export const ANOMALIES_PATH =
  process.env.ANOMALIES_PATH ||
  path.join(appRoot, "..", "data", "anomalies.json");
export async function loadCatalog(): Promise<Catalog> {
  const raw = await readStore<Catalog>("catalog", CATALOG_PATH, {
    provider: "",
    lookupUrl: "",
    fixtures: [],
  });
  return { ...raw, fixtures: raw.fixtures.map(normalizeFixture) };
}
export function loadAnomalies() {
  return readStore<Record<string, Anomaly>>("anomalies", ANOMALIES_PATH, {});
}
export async function loadSeasonManifests() {
  const manifests = await readStore<SeasonManifest[]>(
    "seasons",
    process.env.SEASON_CONFIG_PATH ||
      path.join(appRoot, "src", "data", "seasons.json"),
    [],
  );
  return manifests.map(validateManifest);
}
