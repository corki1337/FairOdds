/**
 * Switchboard On-Demand helpers shared by the app and the devnet scripts.
 *
 * Each market pins a primary PullFeed whose single job reads the final score of one real
 * fixture straight from TheSportsDB and reports `home - away`. Markets whose league is also
 * covered by OpenLigaDB pin a second feed with the same semantics from that provider; the
 * program then settles only when both agree. Nothing we run is in that path.
 * Feed authority is handed to aichain's `feed-lock` PDA in the same transaction that creates
 * the market, so nobody can change the jobs, queue or write values later.
 */
import * as sb from "@switchboard-xyz/on-demand";
import { CrossbarClient, FeedHash, OracleJob } from "@switchboard-xyz/common";
import { LegacyCrossbarClient } from "@switchboard-xyz/common-legacy";
import {
  Connection,
  Keypair,
  PublicKey,
  TransactionInstruction,
  AddressLookupTableAccount,
} from "@solana/web3.js";
import { eventUrl, UNMARKETABLE_ID_OFFSET } from "./fixtures";

export const SB_PROGRAM_ID = new PublicKey(
  "Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2",
);
export const SB_QUEUE = new PublicKey(
  "EYiAmGSdsQTuCw413V5BzaruWuCCSDgTPtBGvLkXHbe7",
);
export const CROSSBAR_URL =
  process.env.NEXT_PUBLIC_CROSSBAR_URL ||
  "https://crossbar.switchboardlabs.xyz";
export const OPENLIGADB_BASE = "https://api.openligadb.de";
export const PANDASCORE_BASE = "https://api.pandascore.co";

/** Matches `SOURCE_*` in programs/aichain/src/state.rs. */
export const SOURCE_OPENLIGADB = 1;

/**
 * `teamA_score - teamB_score` (maps won) for one PandaScore esports series.
 * The path checks `winner_id != null` so an unfinished match yields no value at all.
 */
function legacyPandaScoreDiffJobs(
  pandaMatchId: number | bigint | string,
): OracleJob[] {
  const url = `${PANDASCORE_BASE}/matches/${pandaMatchId}?token=${"${PANDASCORE_TOKEN}"}`;
  return [
    OracleJob.fromObject({
      tasks: [
        { httpTask: { url } },
        {
          jsonParseTask: { path: "$[?(@.winner_id != null)].results[0].score" },
        },
        {
          subtractTask: {
            job: {
              tasks: [
                { httpTask: { url } },
                {
                  jsonParseTask: {
                    path: "$[?(@.winner_id != null)].results[1].score",
                  },
                },
              ],
            },
          },
        },
      ],
    }),
  ];
}

/**
 * `home_score - away_score` for one fixture. Scores are strings in the provider's JSON and
 * `null` until the match is over, so an unfinished match yields no value at all and the
 * oracles simply cannot report anything early.
 */
function legacyScoreDiffJobs(matchId: number | bigint | string): OracleJob[] {
  const idNum = BigInt(matchId.toString());
  if (idNum >= BigInt(UNMARKETABLE_ID_OFFSET)) {
    const pandaId = (idNum - BigInt(UNMARKETABLE_ID_OFFSET)).toString();
    return legacyPandaScoreDiffJobs(pandaId);
  }
  const url = eventUrl(String(matchId));
  return [
    OracleJob.fromObject({
      tasks: [
        { httpTask: { url } },
        { jsonParseTask: { path: "$.events[0].intHomeScore" } },
        {
          subtractTask: {
            job: {
              tasks: [
                { httpTask: { url } },
                { jsonParseTask: { path: "$.events[0].intAwayScore" } },
              ],
            },
          },
        },
      ],
    }),
  ];
}

/** Final series score follows the catalog opponent IDs, never the results array order. */
export function pandaScoreDiffJobs(id: number | bigint | string): OracleJob[] {
  const url = `${PANDASCORE_BASE}/matches/${id}?token=${"${PANDASCORE_TOKEN}"}`;
  const read = (path: string) => ({
    tasks: [{ httpTask: { url } }, { jsonParseTask: { path } }],
  });
  const final = "$[?(@.status == 'finished' && @.forfeit == false)]";
  return [
    OracleJob.fromObject({
      tasks: [
        {
          cacheTask: {
            cacheItems: [
              {
                variableName: "TEAM_A",
                job: read(`${final}.opponents[0].opponent.id`),
              },
              {
                variableName: "TEAM_B",
                job: read(`${final}.opponents[1].opponent.id`),
              },
            ],
          },
        },
        ...read(`${final}.results[?(@.team_id == ${"${TEAM_A}"})].score`).tasks,
        {
          subtractTask: {
            job: read(`${final}.results[?(@.team_id == ${"${TEAM_B}"})].score`),
          },
        },
      ],
    }),
  ];
}
/** New feeds require an explicit final status instead of accepting live scores. */
export function scoreDiffJobs(id: number | bigint | string): OracleJob[] {
  const n = BigInt(id);
  if (n >= BigInt(UNMARKETABLE_ID_OFFSET))
    return pandaScoreDiffJobs(n - BigInt(UNMARKETABLE_ID_OFFSET));
  const jobs = legacyScoreDiffJobs(id);
  const value = OracleJob.toObject(jobs[0]);
  value.tasks![1].jsonParseTask!.path =
    "$.events[?(@.strStatus == 'FT')].intHomeScore";
  value.tasks![2].subtractTask!.job!.tasks![1].jsonParseTask!.path =
    "$.events[?(@.strStatus == 'FT')].intAwayScore";
  return [OracleJob.fromObject(value)];
}
/** Existing football jobs remain pinned to their original content hash. */
export function jobsForMatch(id: string, hash: Uint8Array): OracleJob[] {
  for (const jobs of [scoreDiffJobs(id), legacyScoreDiffJobs(id)])
    if (feedHashOf(jobs).equals(Buffer.from(hash))) return jobs;
  throw new Error(
    "Unsupported pinned match feed; preserve its original jobs or wait for the refund deadline",
  );
}

/**
 * Same `home - away` from OpenLigaDB's "Endergebnis" (regular time). The path only matches
 * once `matchIsFinished` is true; OpenLigaDB is community-updated during the match, so
 * without that gate an oracle could sign an in-play value.
 */
export function openLigaDiffJobs(
  openLigaMatchId: number | bigint | string,
): OracleJob[] {
  const url = `${OPENLIGADB_BASE}/getmatchdata/${openLigaMatchId}`;
  const points = (team: 1 | 2) =>
    `$[?(@.matchIsFinished == true)].matchResults[?(@.resultTypeID == 2)].pointsTeam${team}`;
  return [
    OracleJob.fromObject({
      tasks: [
        { httpTask: { url } },
        { jsonParseTask: { path: points(1) } },
        {
          subtractTask: {
            job: {
              tasks: [
                { httpTask: { url } },
                { jsonParseTask: { path: points(2) } },
              ],
            },
          },
        },
      ],
    }),
  ];
}

export function feedHashOf(jobs: OracleJob[]): Buffer {
  return Buffer.from(FeedHash.compute(SB_QUEUE.toBuffer(), jobs));
}

export function feedHashFor(matchId: number | bigint | string): Buffer {
  return feedHashOf(scoreDiffJobs(matchId));
}

/**
 * Oracles look a feed's jobs up on Crossbar by feed hash, so the job definitions must be
 * published there. Idempotent: the hash is content-addressed.
 */
export async function storeJobs(jobs: OracleJob[]): Promise<void> {
  const stored = await new LegacyCrossbarClient(CROSSBAR_URL).store(
    SB_QUEUE.toBase58(),
    jobs,
  );
  const expected = feedHashOf(jobs).toString("hex");
  if (stored.feedHash.replace(/^0x/, "") !== expected) {
    throw new Error(
      `Crossbar stored feed hash ${stored.feedHash}, expected ${expected}`,
    );
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SbProgram = any;

export async function loadSwitchboard(
  connection: Connection,
): Promise<SbProgram> {
  return sb.AnchorUtils.loadProgramFromConnection(connection as never);
}

/**
 * Instructions that create a feed for `jobs` and immediately transfer its authority to
 * `feedLock`. Caller must sign with `payer` and the returned `feedKeypair`.
 */
export async function buildCreateFeedIxs(
  sbProgram: SbProgram,
  params: {
    jobs: OracleJob[];
    name: string;
    payer: PublicKey;
    feedLock: PublicKey;
  },
): Promise<{
  feedKeypair: Keypair;
  feed: PublicKey;
  feedHash: Buffer;
  ixs: TransactionInstruction[];
}> {
  const [pullFeed, feedKeypair] = sb.PullFeed.generate(sbProgram);
  await storeJobs(params.jobs);
  const feedHash = feedHashOf(params.jobs);
  const initIx = await pullFeed.initIx({
    name: params.name.slice(0, 32),
    queue: SB_QUEUE,
    maxVariance: 1,
    minResponses: 1,
    minSampleSize: 1,
    maxStaleness: 1_000,
    permitWriteByAuthority: false,
    feedHash,
    payer: params.payer,
  });
  const lockIx: TransactionInstruction =
    sbProgram.instruction.pullFeedSetConfigs(
      {
        name: null,
        feedHash: null,
        authority: params.feedLock,
        maxVariance: null,
        minResponses: null,
        minSampleSize: null,
        maxStaleness: null,
        permitWriteByAuthority: null,
        ipfsHash: null,
      },
      { accounts: { pullFeed: pullFeed.pubkey, authority: params.payer } },
    );
  return {
    feedKeypair,
    feed: pullFeed.pubkey,
    feedHash,
    ixs: [initIx, lockIx],
  };
}

/** Asks the oracle gateway to run the feed's jobs and returns signed update instructions. */
export async function buildFeedUpdateIxs(
  sbProgram: SbProgram,
  params: { feed: PublicKey; jobs: OracleJob[]; payer: PublicKey },
): Promise<{
  ixs: TransactionInstruction[];
  luts: AddressLookupTableAccount[];
  errors: string[];
}> {
  const pullFeed = new sb.PullFeed(sbProgram, params.feed);
  await storeJobs(params.jobs);
  const [ixs, responses, , luts, failures] = await pullFeed.fetchUpdateIx({
    crossbarClient: new CrossbarClient(CROSSBAR_URL),
    jobs: params.jobs,
    variableOverrides:
      typeof window === "undefined"
        ? Object.fromEntries(
            ["PANDASCORE_TOKEN", "FOOTBALL_DATA_KEY"]
              .filter((k) => !!process.env[k])
              .map((k) => [k, process.env[k]!]),
          )
        : undefined,
    numSignatures: 1,
    payer: params.payer,
  });
  const errors = [
    ...responses.map((r) => r.error).filter(Boolean),
    ...(failures ?? []).filter(Boolean),
  ];
  return { ixs: ixs ?? [], luts: luts ?? [], errors };
}

/** Decodes what aichain's resolve will see: submissions that landed at or after `notBefore`. */
export function decodeFeedSubmissions(
  data: Buffer,
  notBefore: number,
): {
  values: bigint[];
  feedHash: string;
  authority: PublicKey;
  queue: PublicKey;
} {
  const values: bigint[] = [];
  for (let i = 0; i < 32; i++) {
    const off = 8 + i * 64;
    if (data.subarray(off, off + 32).every((b) => b === 0)) continue;
    const ts = Number(data.readBigInt64LE(8 + 2944 + i * 8));
    if (ts < notBefore) continue;
    const lo = data.readBigUInt64LE(off + 48);
    const hi = data.readBigInt64LE(off + 56);
    values.push((hi << BigInt(64)) + lo);
  }
  return {
    values,
    feedHash: data.subarray(8 + 2112, 8 + 2144).toString("hex"),
    authority: new PublicKey(data.subarray(8 + 2048, 8 + 2080)),
    queue: new PublicKey(data.subarray(8 + 2080, 8 + 2112)),
  };
}

/**
 * Layout of aichain's `SecondaryOracle` account (Anchor discriminator first):
 * market, feed, feed_hash, source u8, source_ref u64, bump u8.
 */
export function decodeSecondaryOracle(
  data: Buffer,
): {
  market: PublicKey;
  feed: PublicKey;
  feedHash: Buffer;
  source: number;
  sourceRef: bigint;
} | null {
  if (data.length < 8 + 32 + 32 + 32 + 1 + 8 + 1) return null;
  return {
    market: new PublicKey(data.subarray(8, 40)),
    feed: new PublicKey(data.subarray(40, 72)),
    feedHash: Buffer.from(data.subarray(72, 104)),
    source: data[104],
    sourceRef: data.readBigUInt64LE(105),
  };
}

export function secondaryJobs(
  source: number,
  sourceRef: bigint | number | string,
): OracleJob[] {
  if (source === SOURCE_OPENLIGADB) return openLigaDiffJobs(sourceRef);
  throw new Error(`unknown secondary source ${source}`);
}
