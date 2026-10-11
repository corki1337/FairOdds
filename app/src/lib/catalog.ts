import * as path from "path";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
const appRoot = existsSync(path.join(process.cwd(), "app", "src"))
  ? path.join(process.cwd(), "app")
  : process.cwd();
import { normalizeFixture, type Fixture } from "./fixtures";
import { readStore, remoteStore } from "./store";
import { validateManifest, type SeasonManifest } from "./season-jobs";

async function readJsonFile<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw e;
  }
}
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
  const empty: Catalog = { provider: "", lookupUrl: "", fixtures: [] };
  let raw = await readStore<Catalog>("catalog", CATALOG_PATH, empty);
  // Empty Redis keys must not hide the bundled fixtures.json on Vercel.
  if (remoteStore() && !raw.fixtures?.length) {
    const fromFile = await readJsonFile<Catalog>(CATALOG_PATH, empty);
    if (fromFile.fixtures?.length) raw = fromFile;
  }
  return { ...raw, fixtures: (raw.fixtures ?? []).map(normalizeFixture) };
}
export function loadAnomalies() {
  return readStore<Record<string, Anomaly>>("anomalies", ANOMALIES_PATH, {});
}
export async function loadSeasonManifests() {
  const filePath =
    process.env.SEASON_CONFIG_PATH ||
    path.join(appRoot, "src", "data", "seasons.json");
  let manifests = await readStore<SeasonManifest[]>("seasons", filePath, []);
  if (remoteStore() && !manifests.length) {
    manifests = await readJsonFile<SeasonManifest[]>(filePath, []);
  }
  return manifests.map(validateManifest);
}
