/**
 * Server-side readers for files the keeper rewrites while the app runs. Reading at request
 * time (cached by mtime) is what lets new fixtures appear without a rebuild.
 */
import * as fs from "fs";
import * as path from "path";
import { normalizeFixture, type Fixture } from "./fixtures";

export type Catalog = {
  provider: string;
  lookupUrl: string;
  fixtures: Fixture[];
  meta?: Record<string, unknown>;
};

/** One market the keeper refused to settle because its sources contradicted each other. */
export type Anomaly = {
  matchId: string;
  reason: string;
  votes: { source: string; status: string; score?: { home: number; away: number }; note?: string }[];
  firstSeen: string;
  lastSeen: string;
};

const CATALOG_PATH =
  process.env.FIXTURES_PATH || path.join(process.cwd(), "src", "data", "fixtures.json");
const ANOMALIES_PATH =
  process.env.ANOMALIES_PATH || path.join(process.cwd(), "..", "data", "anomalies.json");

const cache = new Map<string, { mtimeMs: number; value: unknown }>();

function readJson<T>(file: string, fallback: T): T {
  let mtimeMs: number;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    return fallback;
  }
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === mtimeMs) return hit.value as T;
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8")) as T;
    cache.set(file, { mtimeMs, value });
    return value;
  } catch {
    // A half-written file during a keeper refresh: keep serving the previous version.
    return (hit?.value as T) ?? fallback;
  }
}

export function loadCatalog(): Catalog {
  const raw = readJson<Catalog>(CATALOG_PATH, { provider: "", lookupUrl: "", fixtures: [] });
  return { ...raw, fixtures: raw.fixtures.map(normalizeFixture) };
}

export function loadAnomalies(): Record<string, Anomaly> {
  return readJson<Record<string, Anomaly>>(ANOMALIES_PATH, {});
}
