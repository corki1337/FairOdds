import { OracleJob } from "@switchboard-xyz/common";
export type SeasonSource = "openligadb" | "footballData" | "thesportsdb";
export type SeasonManifest = {
  id: string;
  title: string;
  kind: 0 | 1;
  historicalDemo: boolean;
  cutoff: number;
  endTime: number;
  resolveDeadline: number;
  leagueSize: number;
  year: number;
  participants: { name: string; ids: Partial<Record<SeasonSource, string>> }[];
  sources: [
    { source: SeasonSource; league: string },
    { source: SeasonSource; league: string },
  ];
};
export function validateManifest(m: SeasonManifest) {
  if (
    !/^(0|[1-9]\d{0,19})$/.test(m.id) ||
    BigInt(m.id) > (1n << 64n) - 1n ||
    !m.title ||
    Buffer.byteLength(m.title) > 32
  )
    throw new Error("Invalid season id or title (maximum 32 UTF-8 bytes)");
  if (m.kind !== 0 && m.kind !== 1) throw new Error("Invalid season kind");
  if (
    !Number.isInteger(m.leagueSize) ||
    m.leagueSize < 2 ||
    m.leagueSize > 32 ||
    !Number.isInteger(m.year) ||
    m.year < 2000 ||
    m.year > 2100
  )
    throw new Error("Invalid league size or season year");
  if (
    !Array.isArray(m.sources) ||
    m.sources.length !== 2 ||
    m.sources[0].source === m.sources[1].source
  )
    throw new Error("Two independent providers required");
  if (
    !Array.isArray(m.participants) ||
    m.participants.length < 2 ||
    m.participants.length > 32
  )
    throw new Error("2–32 participants required");
  if (
    ![m.cutoff, m.endTime, m.resolveDeadline].every(Number.isSafeInteger) ||
    m.endTime < m.cutoff ||
    m.resolveDeadline - m.endTime < 300 ||
    m.resolveDeadline - m.endTime > 30 * 86400
  )
    throw new Error("Invalid season time window");
  for (const source of m.sources) {
    if (
      !["openligadb", "footballData", "thesportsdb"].includes(source.source) ||
      !/^\w{1,16}$/.test(source.league)
    )
      throw new Error("Invalid season source");
    if (m.kind === 1 && source.source === "thesportsdb")
      throw new Error("Scorers require OpenLigaDB + football-data");
    const ids = m.participants.map((p) => p.ids[source.source]);
    if (
      ids.some((id) => !id || !/^\d+$/.test(id)) ||
      new Set(ids).size !== ids.length
    )
      throw new Error(
        "Every participant needs a unique numeric id in each provider",
      );
  }
  if (
    m.participants.some((p) => !p.name || Buffer.byteLength(p.name) > 32) ||
    new Set(m.participants.map((p) => p.name)).size !== m.participants.length
  )
    throw new Error(
      "Participant names must be unique, nonempty and fit 32 UTF-8 bytes",
    );
  return m;
}
/** No credentials in stored jobs. Runtime variableOverrides supply football-data keys. */
export function seasonJobs(m: SeasonManifest, index: 0 | 1): OracleJob[] {
  validateManifest(m);
  const s = m.sources[index];
  const http = (url: string) => ({
    httpTask: {
      url,
      ...(s.source === "footballData"
        ? { headers: [{ key: "X-Auth-Token", value: "${FOOTBALL_DATA_KEY}" }] }
        : {}),
    },
  });
  const base =
    s.source === "openligadb"
      ? `https://api.openligadb.de`
      : s.source === "footballData"
        ? `https://api.football-data.org/v4`
        : `https://www.thesportsdb.com/api/v1/json/3`;
  const table =
    s.source === "openligadb"
      ? `${base}/getbltable/${s.league}/${m.year}`
      : s.source === "footballData"
        ? `${base}/competitions/${s.league}/standings?season=${m.year}`
        : `${base}/lookuptable.php?l=${s.league}&s=${m.year}-${m.year + 1}`;
  const result =
    m.kind === 0
      ? table
      : s.source === "openligadb"
        ? `${base}/getgoalgetters/${s.league}/${m.year}`
        : `${base}/competitions/${s.league}/scorers?season=${m.year}&limit=100`;
  const played =
    s.source === "openligadb"
      ? "$[*].matches"
      : s.source === "footballData"
        ? "$.standings[?(@.type == 'TOTAL')].table[*].playedGames"
        : "$.table[*].intPlayed";
  const winner =
    m.kind === 1
      ? s.source === "openligadb"
        ? "$[0].goalGetterId"
        : "$.scorers[0].player.id"
      : s.source === "openligadb"
        ? "$[0].teamInfoId"
        : s.source === "footballData"
          ? "$.standings[?(@.type == 'TOTAL')].table[0].team.id"
          : "$.table[0].idTeam";
  const value = (path: string, url = result) => ({
    tasks: [http(url), { jsonParseTask: { path } }],
  });
  let mapped: any = { tasks: [{ valueTask: { value: -1 } }] };
  for (let i = m.participants.length - 1; i >= 0; i--)
    mapped = {
      tasks: [
        {
          comparisonTask: {
            op: 0,
            lhsValue: "${SEASON_RESULT}",
            rhsValue: m.participants[i].ids[s.source],
            onTrueValue: String(i + 1),
            onFalse: mapped,
          },
        },
      ],
    };
  if (m.kind === 1) {
    const path =
      s.source === "openligadb"
        ? "$[INDEX].goalCount"
        : "$.scorers[INDEX].goals";
    mapped = {
      tasks: [
        {
          comparisonTask: {
            op: 1,
            lhs: value(path.replace("INDEX", "0")),
            rhs: value(path.replace("INDEX", "1")),
            onTrue: mapped,
            onFalseValue: "0",
          },
        },
      ],
    };
  }
  // A double round-robin season is final only when every scheduled team-game has been played.
  // A non-final table yields -1, rejected on-chain (not a refund trigger).
  return [
    OracleJob.fromObject({
      tasks: [
        {
          cacheTask: {
            cacheItems: [{ variableName: "SEASON_RESULT", job: value(winner) }],
          },
        },
        {
          comparisonTask: {
            op: 0,
            lhs: {
              tasks: [
                http(table),
                { jsonParseTask: { path: played, aggregationMethod: 3 } },
              ],
            },
            rhsValue: String(m.leagueSize * (m.leagueSize - 1) * 2),
            onTrue: mapped,
            onFalseValue: "-1",
          },
        },
      ],
    }),
  ];
}
