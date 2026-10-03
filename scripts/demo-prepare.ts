/**
 * Prepare a demo market with two bettors already funded.
 * Requires deploy-config.json from setup-devnet.ts
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import { Aichain } from "../target/types/aichain";

function padName(name: string): number[] {
  const buf = Buffer.alloc(32);
  buf.write(name);
  return Array.from(buf);
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const admin = (provider.wallet as anchor.Wallet).payer;
  const aichain = anchor.workspace.Aichain as Program<Aichain>;

  const config = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deploy-config.json"), "utf8")
  );
  const mint = new PublicKey(config.usdcMint);
  const globalPda = new PublicKey(config.globalPda);

  const bettorA = Keypair.generate();
  const bettorB = Keypair.generate();
  for (const k of [bettorA, bettorB]) {
    const sig = await provider.connection.requestAirdrop(k.publicKey, 2 * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig);
  }

  const ataA = (
    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin,
      mint,
      bettorA.publicKey
    )
  ).address;
  const ataB = (
    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin,
      mint,
      bettorB.publicKey
    )
  ).address;
  await mintTo(provider.connection, admin, mint, ataA, admin, 1_000_000_000n);
  await mintTo(provider.connection, admin, mint, ataB, admin, 1_000_000_000n);

  const matchId = new anchor.BN(Date.now());
  const now = Math.floor(Date.now() / 1000);
  const start = now + 120; // 2 minutes to place bets
  const end = start + 3600;

  const [marketPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("market"), matchId.toArrayLike(Buffer, "le", 8)],
    aichain.programId
  );
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), marketPda.toBuffer()],
    aichain.programId
  );
  const [oraclePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("oracle"), matchId.toArrayLike(Buffer, "le", 8)],
    aichain.programId
  );

  await aichain.methods
    .initializeMarket(
      matchId,
      new anchor.BN(start),
      new anchor.BN(end),
      padName("NaVi"),
      padName("FaZe")
    )
    .accounts({
      authority: admin.publicKey,
      global: globalPda,
      usdcMint: mint,
      market: marketPda,
      vault: vaultPda,
      oracleFeed: oraclePda,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .rpc();

  const [receiptA] = PublicKey.findProgramAddressSync(
    [Buffer.from("receipt"), marketPda.toBuffer(), bettorA.publicKey.toBuffer()],
    aichain.programId
  );
  const [receiptB] = PublicKey.findProgramAddressSync(
    [Buffer.from("receipt"), marketPda.toBuffer(), bettorB.publicKey.toBuffer()],
    aichain.programId
  );

  await aichain.methods
    .placeBet(new anchor.BN(100_000_000), 0)
    .accounts({
      user: bettorA.publicKey,
      market: marketPda,
      vault: vaultPda,
      userAta: ataA,
      receipt: receiptA,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([bettorA])
    .rpc();

  await aichain.methods
    .placeBet(new anchor.BN(300_000_000), 1)
    .accounts({
      user: bettorB.publicKey,
      market: marketPda,
      vault: vaultPda,
      userAta: ataB,
      receipt: receiptB,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([bettorB])
    .rpc();

  const out = {
    matchId: matchId.toString(),
    market: marketPda.toBase58(),
    vault: vaultPda.toBase58(),
    oracle: oraclePda.toBase58(),
    startTime: start,
    bettorA: bettorA.publicKey.toBase58(),
    bettorB: bettorB.publicKey.toBase58(),
    note: "Wait until startTime, then Admin → Lock → set oracle → Resolve. Winner A claims 400 USDC from 100 stake.",
  };
  fs.writeFileSync(
    path.join(__dirname, "..", "demo-state.json"),
    JSON.stringify(out, null, 2)
  );
  console.log(out);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
