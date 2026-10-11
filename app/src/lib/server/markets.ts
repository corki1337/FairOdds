import { AnchorProvider, Idl, Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  AccountInfo,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { BN } from "@coral-xyz/anchor";
import idl from "../idl/aichain.json";
import { makeConnection } from "../rpc";
import {
  marketPda,
  vaultPda,
  receiptPda,
  policyPda,
  secondaryOraclePda,
  decodeTeamName,
  statusKey,
  globalPda,
  mintAuthorityPda,
  faucetReceiptPda,
} from "../anchor";
import { formatUSDC, parseUSDC, poolOdds } from "../money";
import { loadCatalog } from "../catalog";
import { inferCategory, type Fixture } from "../fixtures";
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function reader() {
  const connection = makeConnection();
  const wallet = {
    publicKey: PublicKey.default,
    signTransaction: async <T>(_tx: T): Promise<T> => {
      throw new Error("Read-only provider");
    },
    signAllTransactions: async <T>(_tx: T[]): Promise<T[]> => {
      throw new Error("Read-only provider");
    },
  };
  const program = new Program(
    idl as Idl,
    new AnchorProvider(connection, wallet, { commitment: "confirmed" }),
  );
  return { program, connection };
}
export function parseId(id: string): bigint {
  if (!/^(0|[1-9]\d{0,19})$/.test(id) || BigInt(id) > (1n << 64n) - 1n)
    throw new ApiError(400, "INVALID_ID", "Invalid market id");
  return BigInt(id);
}
export async function match(id: string, ctx = reader()) {
  const market = marketPda(ctx.program.programId, parseId(id))[0];
  const m = await (ctx.program.account as any).marketState.fetchNullable(
    market,
  );
  if (!m) throw new ApiError(404, "NOT_FOUND", "Market not found");
  return { ...ctx, market, m };
}
export async function describeMatch(
  market: PublicKey,
  m: any,
  program: Program,
  rules?: { policy: any; second: any },
  fixture?: Fixture | null,
) {
  if (!rules) {
    const keys = [
      policyPda(program.programId, market)[0],
      secondaryOraclePda(program.programId, market)[0],
    ];
    const info = await program.provider.connection.getMultipleAccountsInfo(
      keys,
      "confirmed",
    );
    const decode = (i: number, name: string) => {
      const a = info[i];
      if (!a || a.data.length === 0) return null;
      if (!a.owner.equals(program.programId))
        throw new ApiError(
          503,
          "INVALID_ACCOUNT",
          "Invalid market rule account",
        );
      return program.coder.accounts.decode(name, a.data) as any;
    };
    rules = {
      policy: decode(0, "marketPolicy"),
      second: decode(1, "secondaryOracle"),
    };
  }
  const { policy, second } = rules;
  const a = BigInt(m.poolTeamA.toString()),
    b = BigInt(m.poolTeamB.toString());
  const teams = [decodeTeamName(m.teamA), decodeTeamName(m.teamB)];

  let fix = fixture;
  if (fix === undefined) {
    try {
      const catalog = await loadCatalog();
      fix =
        catalog.fixtures.find((f) => String(f.id) === m.matchId.toString()) ??
        null;
    } catch {
      fix = null;
    }
  }

  const category = fix?.category ?? inferCategory(teams, fix?.league);

  return {
    id: m.matchId.toString(),
    type: "match",
    address: market.toBase58(),
    mint: m.usdcMint.toBase58(),
    status: statusKey(m.status),
    teams,
    pools: [formatUSDC(a), formatUSDC(b)],
    poolUnits: [a.toString(), b.toString()],
    odds: poolOdds(a, b),
    waitingForCounterBets: a === 0n || b === 0n,
    balanceNeeded: formatUSDC(a > b ? a - b : b - a),
    startTime: m.startTime.toNumber(),
    endTime: m.endTime.toNumber(),
    resolveDeadline: m.resolveDeadline.toNumber(),
    secondsToKickoff: Math.max(
      0,
      m.startTime.toNumber() - Math.floor(Date.now() / 1000),
    ),
    winningTeam: m.winningTeam,
    cancelReason: m.cancelReason,
    feeBps: policy?.feeBps ?? 0,
    payoutPoolUnits: m.payoutPool.toString(),
    vault: vaultPda(program.programId, market)[0].toBase58(),
    oracle: {
      primary: m.oracleFeed.toBase58(),
      secondary: second?.feed.toBase58() ?? null,
      hash: Buffer.from(m.feedHash).toString("hex"),
    },
    category,
    league: fix?.league ?? null,
    format: fix?.format ?? null,
  };
}
const FAUCET_AMOUNT = 1_000_000_000n;
const FAUCET_COOLDOWN = 24 * 60 * 60;

/**
 * Daily demo-USDC tap to prepend when the wallet cannot cover the stake, so a
 * first-time user signs one transaction instead of two. Empty when not needed
 * or still on cooldown (the program would reject it).
 */
export async function faucetTopUp(
  program: Program,
  user: PublicKey,
  mint: PublicKey,
  units: bigint,
): Promise<TransactionInstruction[]> {
  const connection = program.provider.connection;
  const userAta = getAssociatedTokenAddressSync(mint, user);
  const [receipt] = faucetReceiptPda(program.programId, user);
  const [balance, tap] = await Promise.all([
    connection
      .getTokenAccountBalance(userAta, "confirmed")
      .then((r) => BigInt(r.value.amount))
      .catch(() => 0n),
    (program.account as any).faucetReceipt.fetchNullable(receipt),
  ]);
  if (balance >= units || balance + FAUCET_AMOUNT < units) return [];
  if (
    tap &&
    Math.floor(Date.now() / 1000) - tap.lastClaim.toNumber() < FAUCET_COOLDOWN
  )
    return [];
  return [
    await program.methods
      .faucetMint()
      .accounts({
        user,
        global: globalPda(program.programId)[0],
        usdcMint: mint,
        mintAuthority: mintAuthorityPda(program.programId)[0],
        receipt,
        userAta,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .instruction(),
  ];
}
export async function buildMatchBet(
  id: string,
  walletValue: unknown,
  side: unknown,
  amount: unknown,
  ctx = reader(),
  opts: { autoFaucet?: boolean } = {},
) {
  if (side !== 0 && side !== 1)
    throw new ApiError(400, "INVALID_SIDE", "Side must be 0 or 1");
  let user: PublicKey, units: bigint;
  try {
    if (typeof walletValue !== "string") throw new Error();
    user = new PublicKey(walletValue);
    if (!PublicKey.isOnCurve(user)) throw new Error();
  } catch {
    throw new ApiError(
      400,
      "INVALID_WALLET",
      "Wallet must be an on-curve public key",
    );
  }
  try {
    units = parseUSDC(amount);
  } catch (e) {
    throw new ApiError(400, "INVALID_AMOUNT", (e as Error).message);
  }
  const { program, connection, market, m } = await match(id, ctx);
  if (
    statusKey(m.status) !== "open" ||
    Math.floor(Date.now() / 1000) >= m.startTime.toNumber()
  )
    throw new ApiError(409, "BETTING_CLOSED", "Betting has closed");
  const receipt = receiptPda(program.programId, market, user)[0];
  const existing = await (program.account as any).userBetReceipt.fetchNullable(
    receipt,
  );
  if (existing && (existing.claimed || existing.teamSelected !== side))
    throw new ApiError(
      409,
      "RECEIPT_CONFLICT",
      "Existing bet is on another side or already claimed",
    );
  const userAta = getAssociatedTokenAddressSync(m.usdcMint, user);
  const ix = await program.methods
    .placeBet(new BN(units.toString()), side)
    .accounts({
      user,
      market,
      vault: vaultPda(program.programId, market)[0],
      userAta,
      receipt,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
  const topUp = opts.autoFaucet
    ? await faucetTopUp(program, user, m.usdcMint, units)
    : [];
  const latest = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ feePayer: user, ...latest }).add(
    ...topUp,
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
    blockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
    cluster: "devnet",
    faucet: topUp.length > 0,
    message: "Stake demo-USDC on FairOdds. Sign locally.",
  };
}

export async function describeMatches(
  rows: { publicKey: PublicKey; account: any }[],
  program: Program,
) {
  const keys = rows.flatMap((x) => [
    policyPda(program.programId, x.publicKey)[0],
    secondaryOraclePda(program.programId, x.publicKey)[0],
  ]);
  const info: (AccountInfo<Buffer> | null)[] = [];
  for (let i = 0; i < keys.length; i += 100)
    info.push(
      ...(await program.provider.connection.getMultipleAccountsInfo(
        keys.slice(i, i + 100),
        "confirmed",
      )),
    );
  const decode = (i: number, name: string) => {
    const a = info[i];
    if (!a || !a.data.length) return null;
    if (!a.owner.equals(program.programId))
      throw new ApiError(503, "INVALID_ACCOUNT", "Invalid market rule account");
    return program.coder.accounts.decode(name, a.data);
  };
  const catalogMap = new Map<string, Fixture>();
  try {
    const catalog = await loadCatalog();
    for (const f of catalog.fixtures) {
      catalogMap.set(String(f.id), f);
    }
  } catch {}

  return Promise.all(
    rows.map((x, i) =>
      describeMatch(
        x.publicKey,
        x.account,
        program,
        {
          policy: decode(i * 2, "marketPolicy"),
          second: decode(i * 2 + 1, "secondaryOracle"),
        },
        catalogMap.get(x.account.matchId.toString()) ?? null,
      ),
    ),
  );
}

/** Actions include a public memo without changing the bet's terms or signer. */
export async function buildMatchActionBet(
  id: string,
  wallet: unknown,
  side: unknown,
  amount: unknown,
  ctx = reader(),
  opts: { autoFaucet?: boolean } = {},
) {
  const prepared = await buildMatchBet(id, wallet, side, amount, ctx, opts);
  const tx = Transaction.from(Buffer.from(prepared.transaction, "base64"));
  tx.add(
    new TransactionInstruction({
      programId: new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
      keys: [],
      data: Buffer.from(`FairOdds devnet action: match ${id}`),
    }),
  );
  return {
    ...prepared,
    transaction: tx
      .serialize({ requireAllSignatures: false, verifySignatures: false })
      .toString("base64"),
  };
}
