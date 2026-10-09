import { BN, Program } from "@coral-xyz/anchor";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  AddressLookupTableAccount,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import {
  encodeTeamName,
  faucetReceiptPda,
  feedLockPda,
  globalPda,
  marketPda,
  mintAuthorityPda,
  parkPda,
  parkVaultPda,
  positionPda,
  secondaryOraclePda,
  treasuryPda,
  vaultPda,
} from "./anchor";
import { AIchAIN_PROGRAM_ID, YIELD_PARK_PROGRAM_ID } from "./ids";
import {
  buildCreateFeedIxs,
  buildFeedUpdateIxs,
  decodeFeedSubmissions,
  decodeSecondaryOracle,
  loadSwitchboard,
  SbProgram,
  scoreDiffJobs,
  secondaryJobs,
} from "./switchboard";

const programId = new PublicKey(AIchAIN_PROGRAM_ID);
const yieldId = new PublicKey(YIELD_PARK_PROGRAM_ID);

export async function sendV0(
  connection: Connection,
  wallet: WalletContextState,
  ixs: TransactionInstruction[],
  opts: { signers?: Keypair[]; luts?: AddressLookupTableAccount[]; units?: number } = {}
): Promise<string> {
  if (!wallet.publicKey || !wallet.signTransaction) throw new Error("Połącz wallet.");
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: blockhash,
    // Compute budget goes last: Switchboard's secp256k1 verify ix references instruction 0.
    instructions: [
      ...ixs,
      ComputeBudgetProgram.setComputeUnitLimit({ units: opts.units ?? 400_000 }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }),
    ],
  }).compileToV0Message(opts.luts ?? []);
  let tx = new VersionedTransaction(msg);
  if (opts.signers?.length) tx.sign(opts.signers);
  tx = await wallet.signTransaction(tx);
  const sig = await connection.sendTransaction(tx);
  const res = await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed"
  );
  if (res.value.err) throw new Error(`Transakcja ${sig} nie przeszła: ${JSON.stringify(res.value.err)}`);
  return sig;
}

async function shared(program: Program) {
  const [global] = globalPda(programId);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g: any = await (program.account as any).globalConfig.fetch(global);
  const mint = g.usdcMint as PublicKey;
  const [park] = parkPda(yieldId, mint);
  const [parkVault] = parkVaultPda(yieldId, park);
  const [treasury] = treasuryPda(programId, global);
  return { global, mint, park, parkVault, treasury };
}

export async function createMarketTx(
  program: Program,
  connection: Connection,
  wallet: WalletContextState,
  p: {
    matchId: string;
    teamA: string;
    teamB: string;
    start: number;
    end: number;
    resolveDeadline: number;
    /** Second independent feed; attached in the same transaction as the market itself. */
    secondary?: { source: number; sourceRef: string };
  }
): Promise<{ sig: string; feed: PublicKey; secondaryFeed?: PublicKey }> {
  if (!wallet.publicKey) throw new Error("Połącz wallet.");
  const payer = wallet.publicKey;
  const { global, mint } = await shared(program);
  const [market] = marketPda(programId, BigInt(p.matchId));
  const [vault] = vaultPda(programId, market);
  const [feedLock] = feedLockPda(programId);
  const sb = await loadSwitchboard(connection);
  const primary = await buildCreateFeedIxs(sb, {
    jobs: scoreDiffJobs(p.matchId),
    name: `fairodds-${p.matchId}`,
    payer,
    feedLock,
  });
  const feed = primary.feed;
  const initIx = await program.methods
    .initializeMarket(
      new BN(p.matchId),
      new BN(p.start),
      new BN(p.end),
      new BN(p.resolveDeadline),
      encodeTeamName(p.teamA),
      encodeTeamName(p.teamB)
    )
    .accounts({
      authority: wallet.publicKey,
      global,
      usdcMint: mint,
      market,
      vault,
      oracleFeed: feed,
      feedLock,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction();
  if (!p.secondary) {
    const sig = await sendV0(connection, wallet, [...primary.ixs, initIx], {
      signers: [primary.feedKeypair],
    });
    return { sig, feed };
  }
  const second = await buildCreateFeedIxs(sb, {
    jobs: secondaryJobs(p.secondary.source, p.secondary.sourceRef),
    name: `fairodds-${p.matchId}-s${p.secondary.source}`,
    payer,
    feedLock,
  });
  await sendV0(connection, wallet, primary.ixs, { signers: [primary.feedKeypair] });
  await sendV0(connection, wallet, second.ixs, { signers: [second.feedKeypair] });
  const [secondary] = secondaryOraclePda(programId, market);
  const attachIx = await program.methods
    .attachSecondaryFeed(p.secondary.source, new BN(p.secondary.sourceRef))
    .accounts({
      authority: payer,
      global,
      market,
      secondary,
      secondaryFeed: second.feed,
      feedLock,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  const sig = await sendV0(connection, wallet, [initIx, attachIx]);
  return { sig, feed, secondaryFeed: second.feed };
}

export async function fetchSecondaryOracle(connection: Connection, market: PublicKey) {
  const [pda] = secondaryOraclePda(programId, market);
  const info = await connection.getAccountInfo(pda, "confirmed");
  return info && info.owner.equals(programId) ? decodeSecondaryOracle(info.data) : null;
}

async function feedUpdate(
  sb: SbProgram,
  connection: Connection,
  feed: PublicKey,
  jobs: ReturnType<typeof scoreDiffJobs>,
  payer: PublicKey,
  notBefore: number
): Promise<{ ixs: TransactionInstruction[]; luts: AddressLookupTableAccount[] } | null> {
  const info = await connection.getAccountInfo(feed, "confirmed");
  if (info && decodeFeedSubmissions(info.data, notBefore).values.length > 0) return null;
  const upd = await buildFeedUpdateIxs(sb, { feed, jobs, payer });
  if (upd.ixs.length === 0) {
    throw new Error(`Oracle nie zwrócił wyniku: ${upd.errors.join("; ") || "brak odpowiedzi"}`);
  }
  return { ixs: upd.ixs, luts: upd.luts };
}

export async function lockIx(program: Program, crank: PublicKey, market: PublicKey) {
  const { global, park, parkVault } = await shared(program);
  const [vault] = vaultPda(programId, market);
  const [position] = positionPda(yieldId, park, market);
  return program.methods
    .lockMarket()
    .accounts({
      crank,
      global,
      market,
      vault,
      park,
      parkVault,
      position,
      yieldParkProgram: yieldId,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

async function settleAccounts(program: Program, market: PublicKey) {
  const { global, park, parkVault, treasury } = await shared(program);
  const [vault] = vaultPda(programId, market);
  const [position] = positionPda(yieldId, park, market);
  return { global, vault, treasury, park, parkVault, position, yieldParkProgram: yieldId };
}

/**
 * Permissionless settlement: requests a signed Switchboard update for the market's pinned
 * feed and resolves in the same transaction. Locks first if the market is still Open. A
 * pinned second feed is updated in its own transaction first; the program then requires
 * both to report the same score difference.
 */
export async function resolveWithOracle(
  program: Program,
  connection: Connection,
  wallet: WalletContextState,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  market: { publicKey: PublicKey; account: any }
): Promise<string> {
  if (!wallet.publicKey) throw new Error("Połącz wallet.");
  const m = market.account;
  const status = Object.keys(m.status)[0];
  if (status === "open") {
    await sendV0(connection, wallet, [await lockIx(program, wallet.publicKey, market.publicKey)]);
  }
  const feed = m.oracleFeed as PublicKey;
  const endTime = Number(m.endTime);
  const sb = await loadSwitchboard(connection);
  const second = await fetchSecondaryOracle(connection, market.publicKey);
  if (second) {
    const upd = await feedUpdate(
      sb,
      connection,
      second.feed,
      secondaryJobs(second.source, second.sourceRef),
      wallet.publicKey,
      endTime
    );
    if (upd) await sendV0(connection, wallet, upd.ixs, { luts: upd.luts });
  }
  const upd = await feedUpdate(
    sb,
    connection,
    feed,
    scoreDiffJobs(m.matchId.toString()),
    wallet.publicKey,
    endTime
  );
  const ixs: TransactionInstruction[] = [...(upd?.ixs ?? [])];
  const luts = upd?.luts ?? [];
  const [feedLock] = feedLockPda(programId);
  const [secondary] = secondaryOraclePda(programId, market.publicKey);
  ixs.push(
    await program.methods
      .resolveMarket()
      .accounts({
        crank: wallet.publicKey,
        market: market.publicKey,
        oracleFeed: feed,
        feedLock,
        secondary,
        // Optional account: Anchor sends the program id in its place when null.
        secondaryFeed: (second?.feed ?? null) as PublicKey,
        ...(await settleAccounts(program, market.publicKey)),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction()
  );
  return sendV0(connection, wallet, ixs, { luts, units: 600_000 });
}

export async function cancelExpired(
  program: Program,
  connection: Connection,
  wallet: WalletContextState,
  market: PublicKey
): Promise<string> {
  if (!wallet.publicKey) throw new Error("Połącz wallet.");
  const ix = await program.methods
    .cancelExpired()
    .accounts({
      crank: wallet.publicKey,
      market,
      ...(await settleAccounts(program, market)),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
  return sendV0(connection, wallet, [ix]);
}

export async function harvestDust(
  program: Program,
  connection: Connection,
  wallet: WalletContextState,
  market: PublicKey
): Promise<string> {
  if (!wallet.publicKey) throw new Error("Połącz wallet.");
  const { global, treasury } = await shared(program);
  const [vault] = vaultPda(programId, market);
  const ix = await program.methods
    .harvestToTreasury()
    .accounts({
      crank: wallet.publicKey,
      global,
      market,
      vault,
      treasury,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
  return sendV0(connection, wallet, [ix]);
}

/** Demo-USDC tap: permissionless, once per wallet per 24h, authority lives in a PDA. */
export async function claimFaucet(
  program: Program,
  connection: Connection,
  wallet: WalletContextState
): Promise<string> {
  if (!wallet.publicKey) throw new Error("Połącz wallet.");
  const { global, mint } = await shared(program);
  const [mintAuthority] = mintAuthorityPda(programId);
  const [receipt] = faucetReceiptPda(programId, wallet.publicKey);
  const ix = await program.methods
    .faucetMint()
    .accounts({
      user: wallet.publicKey,
      global,
      usdcMint: mint,
      mintAuthority,
      receipt,
      userAta: getAssociatedTokenAddressSync(mint, wallet.publicKey),
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    })
    .instruction();
  return sendV0(connection, wallet, [ix]);
}

export const CANCEL_REASONS: Record<number, string> = {
  0: "",
  2: "Nikt nie obstawił zwycięzcy",
  3: "Brak wyniku oracle przed terminem — automatyczny zwrot",
  4: "Remis — zakład 1/2 nie ma zwycięzcy, zwrot stawek",
};
