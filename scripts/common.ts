/**
 * Shared helpers for devnet scripts (v2 PDAs, Switchboard-pinned markets, cranks).
 */
import * as anchor from "@coral-xyz/anchor";
import { Idl, Program } from "@coral-xyz/anchor";
import {
  getOrCreateAssociatedTokenAccount,
  transfer,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  AddressLookupTableAccount,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import {
  buildCreateFeedIxs,
  buildFeedUpdateIxs,
  decodeFeedSubmissions,
  loadSwitchboard,
  SbProgram,
} from "../app/src/lib/switchboard";
import { makeConnection } from "../app/src/lib/rpc";

export const ROOT = path.join(__dirname, "..");
const V = Buffer.from("v2");

export function loadIdl(name: string): Idl {
  return JSON.parse(
    fs.readFileSync(path.join(ROOT, "app", "src", "lib", "idl", `${name}.json`), "utf8")
  ) as Idl;
}

export type DeployConfig = {
  cluster: string;
  aichainProgramId: string;
  yieldParkProgramId: string;
  usdcMint: string;
  globalPda: string;
  treasuryPda: string;
  parkPda: string;
  parkVaultPda: string;
  feedLockPda: string;
  mintAuthorityPda: string;
  admin: string;
  fixtureSource: string;
};

export function loadConfig(): DeployConfig {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "deploy-config.json"), "utf8"));
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function padName(name: string): number[] {
  const buf = Buffer.alloc(32);
  buf.write(name.slice(0, 32));
  return Array.from(buf);
}

export function decodeName(bytes: number[] | Uint8Array | Buffer): string {
  const buf = Buffer.from(bytes as number[]);
  const z = buf.indexOf(0);
  return buf.subarray(0, z < 0 ? buf.length : z).toString("utf8");
}

export function u64(n: number | bigint | anchor.BN): Buffer {
  return new anchor.BN(n.toString()).toArrayLike(Buffer, "le", 8);
}

export const pdas = {
  global: (pid: PublicKey) => PublicKey.findProgramAddressSync([V, Buffer.from("global")], pid)[0],
  treasury: (pid: PublicKey, global: PublicKey) =>
    PublicKey.findProgramAddressSync([V, Buffer.from("treasury"), global.toBuffer()], pid)[0],
  feedLock: (pid: PublicKey) =>
    PublicKey.findProgramAddressSync([V, Buffer.from("feed-lock")], pid)[0],
  mintAuthority: (pid: PublicKey) =>
    PublicKey.findProgramAddressSync([V, Buffer.from("mint-auth")], pid)[0],
  faucetReceipt: (pid: PublicKey, user: PublicKey) =>
    PublicKey.findProgramAddressSync([V, Buffer.from("faucet"), user.toBuffer()], pid)[0],
  market: (pid: PublicKey, matchId: number | bigint | anchor.BN) =>
    PublicKey.findProgramAddressSync([V, Buffer.from("market"), u64(matchId)], pid)[0],
  vault: (pid: PublicKey, market: PublicKey) =>
    PublicKey.findProgramAddressSync([V, Buffer.from("vault"), market.toBuffer()], pid)[0],
  receipt: (pid: PublicKey, market: PublicKey, user: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [V, Buffer.from("receipt"), market.toBuffer(), user.toBuffer()],
      pid
    )[0],
  park: (ypid: PublicKey, mint: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("park"), mint.toBuffer()], ypid)[0],
  parkVault: (ypid: PublicKey, park: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("park-vault"), park.toBuffer()], ypid)[0],
  position: (ypid: PublicKey, park: PublicKey, owner: PublicKey) =>
    PublicKey.findProgramAddressSync(
      [Buffer.from("position"), park.toBuffer(), owner.toBuffer()],
      ypid
    )[0],
};

export type Ctx = {
  provider: anchor.AnchorProvider;
  admin: Keypair;
  aichain: Program;
  yieldPark: Program;
  config: DeployConfig;
};

export function context(): Ctx {
  // Same RPC policy as the app: retries on 429/5xx and rotates through fallbacks.
  const env = anchor.AnchorProvider.env();
  const provider = new anchor.AnchorProvider(makeConnection(), env.wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);
  return {
    provider,
    admin: (provider.wallet as anchor.Wallet).payer,
    aichain: new Program(loadIdl("aichain"), provider),
    yieldPark: new Program(loadIdl("yield_park"), provider),
    config: loadConfig(),
  };
}

export async function sendV0(
  ctx: Ctx,
  ixs: TransactionInstruction[],
  signers: Keypair[],
  luts: AddressLookupTableAccount[] = [],
  units = 400_000
): Promise<string> {
  const conn = ctx.provider.connection;
  const payer = signers[0].publicKey;
  for (let attempt = 0; ; attempt++) {
    try {
      const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
      const msg = new TransactionMessage({
        payerKey: payer,
        recentBlockhash: blockhash,
        // Compute budget goes last: Switchboard's secp256k1 verify ix references instruction 0.
        instructions: [
          ...ixs,
          ComputeBudgetProgram.setComputeUnitLimit({ units }),
          ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }),
        ],
      }).compileToV0Message(luts);
      const tx = new VersionedTransaction(msg);
      tx.sign(signers);
      const sig = await conn.sendTransaction(tx, { skipPreflight: false, maxRetries: 10 });
      const res = await conn.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        "confirmed"
      );
      if (res.value.err) throw new Error(`tx ${sig} failed: ${JSON.stringify(res.value.err)}`);
      return sig;
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      if (
        attempt < 4 &&
        /429|Too Many|blockhash|block height exceeded|timed out|ECONNRESET|not a recent slot/i.test(
          msg
        )
      ) {
        await sleep(1500 * (attempt + 1));
        continue;
      }
      throw e;
    }
  }
}

let sbCache: SbProgram | null = null;
export async function switchboard(ctx: Ctx): Promise<SbProgram> {
  if (!sbCache) sbCache = await loadSwitchboard(ctx.provider.connection);
  return sbCache;
}

/** Creates feed + hands authority to feed-lock PDA + initializes market, atomically. */
export async function createMarketWithFeed(
  ctx: Ctx,
  p: {
    matchId: number | bigint;
    teamA: string;
    teamB: string;
    start: number;
    end: number;
    resolveDeadline: number;
  }
): Promise<{ market: PublicKey; feed: PublicKey; sig: string }> {
  const pid = ctx.aichain.programId;
  const global = new PublicKey(ctx.config.globalPda);
  const feedLock = pdas.feedLock(pid);
  const market = pdas.market(pid, p.matchId);
  const sb = await switchboard(ctx);
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const { feedKeypair, feed, ixs } = await buildCreateFeedIxs(sb, {
        matchId: p.matchId,
        payer: ctx.admin.publicKey,
        feedLock,
      });
      const initMarketIx = await ctx.aichain.methods
        .initializeMarket(
          new anchor.BN(p.matchId.toString()),
          new anchor.BN(p.start),
          new anchor.BN(p.end),
          new anchor.BN(p.resolveDeadline),
          padName(p.teamA),
          padName(p.teamB)
        )
        .accounts({
          authority: ctx.admin.publicKey,
          global,
          usdcMint: new PublicKey(ctx.config.usdcMint),
          market,
          vault: pdas.vault(pid, market),
          oracleFeed: feed,
          feedLock,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .instruction();
      const sig = await sendV0(ctx, [...ixs, initMarketIx], [ctx.admin, feedKeypair]);
      return { market, feed, sig };
    } catch (e) {
      lastErr = e;
      const msg = String((e as Error).message ?? e);
      if (!/not a recent slot/i.test(msg) || attempt === 3) throw e;
      await sleep(1500 * (attempt + 1));
    }
  }
  throw lastErr;
}

function yieldAccounts(ctx: Ctx, market: PublicKey) {
  const ypid = ctx.yieldPark.programId;
  const park = new PublicKey(ctx.config.parkPda);
  return {
    park,
    parkVault: new PublicKey(ctx.config.parkVaultPda),
    position: pdas.position(ypid, park, market),
    yieldParkProgram: ypid,
  };
}

export async function lockIx(ctx: Ctx, market: PublicKey) {
  return ctx.aichain.methods
    .lockMarket()
    .accounts({
      crank: ctx.admin.publicKey,
      global: new PublicKey(ctx.config.globalPda),
      market,
      vault: pdas.vault(ctx.aichain.programId, market),
      ...yieldAccounts(ctx, market),
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

export async function resolveIx(ctx: Ctx, market: PublicKey, feed: PublicKey) {
  const pid = ctx.aichain.programId;
  return ctx.aichain.methods
    .resolveMarket()
    .accounts({
      crank: ctx.admin.publicKey,
      global: new PublicKey(ctx.config.globalPda),
      market,
      oracleFeed: feed,
      feedLock: pdas.feedLock(pid),
      vault: pdas.vault(pid, market),
      treasury: new PublicKey(ctx.config.treasuryPda),
      ...yieldAccounts(ctx, market),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

export async function cancelExpiredIx(ctx: Ctx, market: PublicKey) {
  const pid = ctx.aichain.programId;
  return ctx.aichain.methods
    .cancelExpired()
    .accounts({
      crank: ctx.admin.publicKey,
      global: new PublicKey(ctx.config.globalPda),
      market,
      vault: pdas.vault(pid, market),
      treasury: new PublicKey(ctx.config.treasuryPda),
      ...yieldAccounts(ctx, market),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

/**
 * Moves demo-USDC out of the admin's stash. The mint authority belongs to the faucet PDA
 * after setup, so scripts top wallets up by transfer rather than by minting.
 */
export async function fundTokens(ctx: Ctx, owner: PublicKey, amount: bigint): Promise<PublicKey> {
  const mint = new PublicKey(ctx.config.usdcMint);
  const conn = ctx.provider.connection;
  const from = await getOrCreateAssociatedTokenAccount(conn, ctx.admin, mint, ctx.admin.publicKey);
  const to = await getOrCreateAssociatedTokenAccount(conn, ctx.admin, mint, owner);
  if (to.amount < amount) {
    await transfer(conn, ctx.admin, from.address, to.address, ctx.admin, amount - to.amount);
  }
  return to.address;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MarketAccount = any;

export async function fetchMarket(ctx: Ctx, market: PublicKey): Promise<MarketAccount | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (ctx.aichain.account as any).marketState.fetchNullable(market);
}

export function statusOf(m: MarketAccount): string {
  return Object.keys(m.status)[0];
}

/**
 * Pulls a fresh oracle update and resolves in one transaction, or cancels when past
 * the deadline. Locks first if nobody did. Returns a short description of what happened.
 */
export async function crankMarket(ctx: Ctx, market: PublicKey): Promise<string> {
  const m = await fetchMarket(ctx, market);
  if (!m) return "missing";
  const status = statusOf(m);
  if (status === "resolved" || status === "cancelled") return status;
  const now = Math.floor(Date.now() / 1000);
  const ixs: TransactionInstruction[] = [];

  if (now >= Number(m.resolveDeadline)) {
    ixs.push(await cancelExpiredIx(ctx, market));
    await sendV0(ctx, ixs, [ctx.admin]);
    return "cancelled (deadline)";
  }
  if (status === "open" && now >= Number(m.startTime)) {
    await sendV0(ctx, [await lockIx(ctx, market)], [ctx.admin]);
  }
  if (now < Number(m.endTime)) return `waiting for end (${Number(m.endTime) - now}s)`;

  const feed = m.oracleFeed as PublicKey;
  const info = await ctx.provider.connection.getAccountInfo(feed, "confirmed");
  const already = info ? decodeFeedSubmissions(info.data, Number(m.endTime)).values.length > 0 : false;
  let luts: AddressLookupTableAccount[] = [];
  if (!already) {
    const sb = await switchboard(ctx);
    const upd = await buildFeedUpdateIxs(sb, {
      feed,
      matchId: BigInt(m.matchId.toString()),
      payer: ctx.admin.publicKey,
    });
    if (upd.ixs.length === 0) return `oracle not ready: ${upd.errors.join("; ") || "no response"}`;
    ixs.push(...upd.ixs);
    luts = upd.luts;
  }
  ixs.push(await resolveIx(ctx, market, feed));
  await sendV0(ctx, ixs, [ctx.admin], luts, 600_000);
  const after = await fetchMarket(ctx, market);
  return after ? statusOf(after) : "unknown";
}
