/**
 * Setup demo-USDC, yield_park, and aichain global config on the configured cluster.
 *
 * Usage (after `anchor build && anchor deploy`):
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=~/.config/solana/id.json \
 *   npx ts-node scripts/setup-devnet.ts
 *
 * Writes deploy-config.json for the Next.js app.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import { Aichain } from "../target/types/aichain";
import { YieldPark } from "../target/types/yield_park";

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const admin = (provider.wallet as anchor.Wallet).payer;

  const aichain = anchor.workspace.Aichain as Program<Aichain>;
  const yieldPark = anchor.workspace.YieldPark as Program<YieldPark>;

  console.log("Authority:", admin.publicKey.toBase58());
  console.log("Aichain:", aichain.programId.toBase58());
  console.log("YieldPark:", yieldPark.programId.toBase58());

  const mint = await createMint(provider.connection, admin, admin.publicKey, null, 6);
  console.log("demo-USDC mint:", mint.toBase58());

  const [parkPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("park"), mint.toBuffer()],
    yieldPark.programId
  );
  const [parkVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("park-vault"), parkPda.toBuffer()],
    yieldPark.programId
  );

  await yieldPark.methods
    .initializePark(2000) // 20% APR for visible demo accrual
    .accounts({
      authority: admin.publicKey,
      mint,
      park: parkPda,
      parkVault: parkVaultPda,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .rpc();
  console.log("Park:", parkPda.toBase58());

  const adminAta = (
    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin,
      mint,
      admin.publicKey
    )
  ).address;
  await mintTo(provider.connection, admin, mint, adminAta, admin, 10_000_000_000_000n);

  await yieldPark.methods
    .seedReserve(new anchor.BN(1_000_000_000)) // 1000 USDC interest reserve
    .accounts({
      authority: admin.publicKey,
      park: parkPda,
      mint,
      authorityAta: adminAta,
      parkVault: parkVaultPda,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();
  console.log("Reserve seeded");

  const [globalPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("global")],
    aichain.programId
  );
  const [treasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury"), globalPda.toBuffer()],
    aichain.programId
  );

  await aichain.methods
    .initializeGlobal(yieldPark.programId)
    .accounts({
      authority: admin.publicKey,
      usdcMint: mint,
      global: globalPda,
      treasury: treasuryPda,
      yieldParkProgram: yieldPark.programId,
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .rpc();
  console.log("Global:", globalPda.toBase58());

  const config = {
    cluster: provider.connection.rpcEndpoint,
    aichainProgramId: aichain.programId.toBase58(),
    yieldParkProgramId: yieldPark.programId.toBase58(),
    usdcMint: mint.toBase58(),
    globalPda: globalPda.toBase58(),
    treasuryPda: treasuryPda.toBase58(),
    parkPda: parkPda.toBase58(),
    parkVaultPda: parkVaultPda.toBase58(),
    admin: admin.publicKey.toBase58(),
  };

  const out = path.join(__dirname, "..", "deploy-config.json");
  fs.writeFileSync(out, JSON.stringify(config, null, 2));
  console.log("Wrote", out);

  const envPath = path.join(__dirname, "..", "app", ".env.local");
  fs.writeFileSync(
    envPath,
    [
      `NEXT_PUBLIC_CLUSTER=devnet`,
      `NEXT_PUBLIC_RPC_URL=${provider.connection.rpcEndpoint}`,
      `NEXT_PUBLIC_USDC_MINT=${mint.toBase58()}`,
      `NEXT_PUBLIC_GLOBAL_PDA=${globalPda.toBase58()}`,
      "",
    ].join("\n")
  );
  console.log("Wrote", envPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
