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
  treasuryPda,
  vaultPda,
} from "./anchor";
import { AIchAIN_PROGRAM_ID, YIELD_PARK_PROGRAM_ID } from "./ids";
import {
  buildCreateFeedIxs,
  buildFeedUpdateIxs,
  decodeFeedSubmissions,
  loadSwitchboard,
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
  }
): Promise<{ sig: string; feed: PublicKey }> {
  if (!wallet.publicKey) throw new Error("Połącz wallet.");
  const { global, mint } = await shared(program);
  const [market] = marketPda(programId, BigInt(p.matchId));
  const [vault] = vaultPda(programId, market);
  const [feedLock] = feedLockPda(programId);
  const sb = await loadSwitchboard(connection);
  const { feedKeypair, feed, ixs } = await buildCreateFeedIxs(sb, {
    matchId: BigInt(p.matchId),
    payer: wallet.publicKey,
    feedLock,
  });
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
  const sig = await sendV0(connection, wallet, [...ixs, initIx], { signers: [feedKeypair] });
  return { sig, feed };
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
 * feed and resolves in the same transaction. Locks first if the market is still Open.
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
  const ixs: TransactionInstruction[] = [];
  let luts: AddressLookupTableAccount[] = [];
  const info = await connection.getAccountInfo(feed, "confirmed");
  const fresh = info ? decodeFeedSubmissions(info.data, Number(m.endTime)).values.length > 0 : false;
  if (!fresh) {
    const sb = await loadSwitchboard(connection);
    const upd = await buildFeedUpdateIxs(sb, {
      feed,
      matchId: BigInt(m.matchId.toString()),
      payer: wallet.publicKey,
    });
    if (upd.ixs.length === 0) {
      throw new Error(`Oracle nie zwrócił wyniku: ${upd.errors.join("; ") || "brak odpowiedzi"}`);
    }
    ixs.push(...upd.ixs);
    luts = upd.luts;
  }
  const [feedLock] = feedLockPda(programId);
  ixs.push(
    await program.methods
      .resolveMarket()
      .accounts({
        crank: wallet.publicKey,
        market: market.publicKey,
        oracleFeed: feed,
        feedLock,
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
