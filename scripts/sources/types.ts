import type { FixtureCategoryId } from "../../app/src/lib/fixtures";

export type SourceId =
  "thesportsdb" | "openligadb" | "footballData" | "apiFootball" | "pandascore";

/** Football: score after regular time (90 min, no extra time, no penalties). Esports: maps won. */
export type Score = { home: number; away: number };

export type SourceStatus = "scheduled" | "live" | "final" | "void";

export type SourceFixture = {
  source: SourceId;
  sourceId: string;
  category: FixtureCategoryId;
  league: string;
  home: string;
  away: string;
  startTime: number;
  timeTBD?: boolean;
  status: SourceStatus;
  final: Score | null;
  /** Series format if applicable, e.g. "Bo1", "Bo3", "Bo5" */
  format?: string;
  /** Ids of the same event in other providers, when the provider publishes them itself. */
  refs?: Partial<Record<SourceId, string>>;
};

/**
 * One provider's opinion of a finished event. `pending` (no data yet, rate-limited, request
 * failed) is an abstention, never a vote.
 */
export type Vote =
  | { source: SourceId; sourceId: string; status: "final"; score: Score }
  | { source: SourceId; sourceId: string; status: "void"; note: string }
  | { source: SourceId; sourceId: string; status: "pending"; note: string };
