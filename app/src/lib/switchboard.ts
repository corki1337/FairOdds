/**
 * Switchboard On-Demand helpers shared by the app and the devnet scripts.
 *
 * Each market pins one PullFeed whose single job reads the final score of one real fixture
 * straight from TheSportsDB and reports `home - away`. Nothing we run is in that path.
 * The feed authority is handed to aichain's `feed-lock` PDA in the same transaction that
 * creates the market, so nobody can change the job, queue or write values later.
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
import { eventUrl } from "./fixtures";

export const SB_PROGRAM_ID = new PublicKey("Aio4gaXjXzJNVLtzwtNVmSqGKpANtXhybbkhtAC94ji2");
export const SB_QUEUE = new PublicKey("EYiAmGSdsQTuCw413V5BzaruWuCCSDgTPtBGvLkXHbe7");
export const CROSSBAR_URL =
  process.env.NEXT_PUBLIC_CROSSBAR_URL || "https://crossbar.switchboardlabs.xyz";

/**
 * `home_score - away_score` for one fixture. Scores are strings in the provider's JSON and
 * `null` until the match is over, so an unfinished match yields no value at all and the
 * oracles simply cannot report anything early.
 */
export function scoreDiffJobs(matchId: number | bigint | string): OracleJob[] {
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

export function feedHashFor(matchId: number | bigint | string): Buffer {
  return Buffer.from(FeedHash.compute(SB_QUEUE.toBuffer(), scoreDiffJobs(matchId)));
}

/**
 * Oracles look a feed's jobs up on Crossbar by feed hash, so the job definitions must be
 * published there. Idempotent: the hash is content-addressed.
 */
export async function storeJobs(jobs: OracleJob[]): Promise<void> {
  const stored = await new LegacyCrossbarClient(CROSSBAR_URL).store(SB_QUEUE.toBase58(), jobs);
  const expected = Buffer.from(FeedHash.compute(SB_QUEUE.toBuffer(), jobs)).toString("hex");
  if (stored.feedHash.replace(/^0x/, "") !== expected) {
    throw new Error(`Crossbar stored feed hash ${stored.feedHash}, expected ${expected}`);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SbProgram = any;

export async function loadSwitchboard(connection: Connection): Promise<SbProgram> {
  return sb.AnchorUtils.loadProgramFromConnection(connection as never);
}

/**
 * Instructions that create the feed and immediately transfer its authority to `feedLock`.
 * Caller must sign with `payer` and the returned `feedKeypair`.
 */
export async function buildCreateFeedIxs(
  sbProgram: SbProgram,
  params: { matchId: number | bigint; payer: PublicKey; feedLock: PublicKey }
): Promise<{ feedKeypair: Keypair; feed: PublicKey; feedHash: Buffer; ixs: TransactionInstruction[] }> {
  const [pullFeed, feedKeypair] = sb.PullFeed.generate(sbProgram);
  await storeJobs(scoreDiffJobs(params.matchId));
  const feedHash = feedHashFor(params.matchId);
  const initIx = await pullFeed.initIx({
    name: `fairodds-${params.matchId}`.slice(0, 32),
    queue: SB_QUEUE,
    maxVariance: 1,
    minResponses: 1,
    minSampleSize: 1,
    maxStaleness: 1_000,
    permitWriteByAuthority: false,
    feedHash,
    payer: params.payer,
  });
  const lockIx: TransactionInstruction = sbProgram.instruction.pullFeedSetConfigs(
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
    { accounts: { pullFeed: pullFeed.pubkey, authority: params.payer } }
  );
  return { feedKeypair, feed: pullFeed.pubkey, feedHash, ixs: [initIx, lockIx] };
}

/** Asks the oracle gateway to run the job and returns signed update instructions. */
export async function buildFeedUpdateIxs(
  sbProgram: SbProgram,
  params: { feed: PublicKey; matchId: number | bigint; payer: PublicKey }
): Promise<{
  ixs: TransactionInstruction[];
  luts: AddressLookupTableAccount[];
  errors: string[];
}> {
  const pullFeed = new sb.PullFeed(sbProgram, params.feed);
  const jobs = scoreDiffJobs(params.matchId);
  await storeJobs(jobs);
  const [ixs, responses, , luts, failures] = await pullFeed.fetchUpdateIx({
    crossbarClient: new CrossbarClient(CROSSBAR_URL),
    jobs,
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
  notBefore: number
): { values: bigint[]; feedHash: string; authority: PublicKey; queue: PublicKey } {
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
