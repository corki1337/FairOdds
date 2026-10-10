import { BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import { reader, parseId, ApiError } from "./markets";
import { seasonPda, seasonReceiptPda } from "../seasons";
import {
  decodeTeamName,
  globalPda,
  vaultPda,
  parkPda,
  parkVaultPda,
  positionPda,
  statusKey,
} from "../anchor";
import { formatUSDC, parseUSDC } from "../money";
import { YIELD_PARK_PROGRAM_ID } from "../ids";
export async function season(id: string, ctx = reader()) {
  const market = seasonPda(ctx.program.programId, parseId(id))[0];
  const m = await (ctx.program.account as any).seasonMarket.fetchNullable(
    market,
  );
  if (!m) throw new ApiError(404, "NOT_FOUND", "Season market not found");
  return { ...ctx, market, m };
}
export function describeSeason(market: PublicKey, m: any, pid: PublicKey) {
  const total = BigInt(m.totalPool.toString());
  return {
    id: m.id.toString(),
    type: "season",
    address: market.toBase58(),
    mint: m.usdcMint.toBase58(),
    title: decodeTeamName(m.title),
    kind: m.kind,
    historicalDemo: m.historicalDemo,
    status: statusKey(m.status),
    cutoff: m.cutoff.toNumber(),
    endTime: m.endTime.toNumber(),
    resolveDeadline: m.resolveDeadline.toNumber(),
    participants: m.participants.map((p: any) => ({
      name: decodeTeamName(p.name),
      pool: formatUSDC(p.pool.toString()),
      units: p.pool.toString(),
      odds: p.pool.isZero()
        ? null
        : Number((total * 10000n) / BigInt(p.pool.toString())) / 10000,
    })),
    totalPoolUnits: total.toString(),
    payoutPoolUnits: m.payoutPool.toString(),
    winner: m.winner,
    cancelReason: m.cancelReason,
    feeds: m.feeds.map((p: PublicKey) => p.toBase58()),
    hashes: m.hashes.map((h: number[]) => Buffer.from(h).toString("hex")),
    feeBps: 0 as const,
    vault: vaultPda(pid, market)[0].toBase58(),
  };
}
export async function buildSeasonBet(
  id: string,
  wallet: unknown,
  side: unknown,
  amount: unknown,
  ctx = reader(),
) {
  let user: PublicKey, units: bigint;
  try {
    if (typeof wallet !== "string") throw new Error();
    user = new PublicKey(wallet);
    if (!PublicKey.isOnCurve(user)) throw new Error();
  } catch {
    throw new ApiError(400, "INVALID_WALLET", "Invalid wallet");
  }
  try {
    units = parseUSDC(amount);
  } catch (e) {
    throw new ApiError(400, "INVALID_AMOUNT", (e as Error).message);
  }
  const { program, connection, market, m } = await season(id, ctx);
  if (
    typeof side !== "number" ||
    !Number.isInteger(side) ||
    side < 0 ||
    side >= m.participants.length
  )
    throw new ApiError(400, "INVALID_SIDE", "Invalid participant");
  if (
    statusKey(m.status) !== "open" ||
    Math.floor(Date.now() / 1000) >= m.cutoff.toNumber()
  )
    throw new ApiError(409, "BETTING_CLOSED", "Betting has closed");
  const [receipt] = seasonReceiptPda(program.programId, market, user),
    existing = await (program.account as any).seasonReceipt.fetchNullable(
      receipt,
    );
  if (existing && (existing.claimed || existing.selected !== side))
    throw new ApiError(
      409,
      "RECEIPT_CONFLICT",
      "Existing bet is on another participant",
    );
  const [global] = globalPda(program.programId),
    yid = new PublicKey(YIELD_PARK_PROGRAM_ID),
    [park] = parkPda(yid, m.usdcMint),
    userAta = getAssociatedTokenAddressSync(m.usdcMint, user);
  const ix = await program.methods
    .placeSeasonBet(new BN(units.toString()), side)
    .accounts({
      user,
      global,
      season: market,
      vault: vaultPda(program.programId, market)[0],
      userAta,
      receipt,
      park,
      parkVault: parkVaultPda(yid, park)[0],
      position: positionPda(yid, park, market)[0],
      yieldParkProgram: yid,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  const latest = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: user, ...latest }).add(
    createAssociatedTokenAccountIdempotentInstruction(
      user,
      userAta,
      user,
      m.usdcMint,
    ),
    ix,
  );
  return {
    transaction: tx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64"),
    ...latest,
    cluster: "devnet",
  };
}
