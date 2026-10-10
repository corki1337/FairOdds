/**
 * Fresh v2 setup: demo-USDC mint, yield_park (+ interest reserve), aichain GlobalConfig.
 *
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=~/.config/solana/id.json \
 *   npx ts-node scripts/setup-devnet.ts
 *
 * Writes deploy-config.json and app/.env.local.
 */
import * as anchor from "@coral-xyz/anchor";
import { Idl, Program } from "@coral-xyz/anchor";
import {
  AuthorityType,
  createMint,
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  setAuthority,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import { SPORTSDB_BASE } from "../app/src/lib/fixtures";
import { makeConnection } from "../app/src/lib/rpc";
import { loadIdl, pdas, ROOT, type DeployConfig } from "./common";

async function main() {
  const env = anchor.AnchorProvider.env();
  const provider = new anchor.AnchorProvider(makeConnection(), env.wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);
  const admin = (provider.wallet as anchor.Wallet).payer;
  const aichain = new Program(loadIdl("aichain") as Idl, provider);
  const yieldPark = new Program(loadIdl("yield_park") as Idl, provider);

  console.log("Authority:", admin.publicKey.toBase58());
  console.log("Aichain:", aichain.programId.toBase58());
  console.log("YieldPark:", yieldPark.programId.toBase58());

  const global = pdas.global(aichain.programId);
  const treasury = pdas.treasury(aichain.programId, global);
  const existingGlobal = await provider.connection.getAccountInfo(global);
  let mint: PublicKey;

  if (existingGlobal) {
    // Same Program IDs keep the same Global PDA. A second initialize would fail, so reuse
    // the mint already pinned there and only hand its authority to the faucet PDA.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g: any = await (aichain.account as any).globalConfig.fetch(global);
    mint = g.usdcMint as PublicKey;
    console.log("Reusing Global:", global.toBase58(), "mint:", mint.toBase58());
  } else {
    mint = await createMint(
      provider.connection,
      admin,
      admin.publicKey,
      null,
      6,
    );
    console.log("demo-USDC mint:", mint.toBase58());
  }

  const park = pdas.park(yieldPark.programId, mint);
  const parkVault = pdas.parkVault(yieldPark.programId, park);
  if (!(await provider.connection.getAccountInfo(park))) {
    await yieldPark.methods
      .initializePark(2000)
      .accounts({
        authority: admin.publicKey,
        mint,
        park,
        parkVault,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();
    console.log("Park:", park.toBase58());
  } else {
    console.log("Reusing Park:", park.toBase58());
  }

  const adminAta = (
    await getOrCreateAssociatedTokenAccount(
      provider.connection,
      admin,
      mint,
      admin.publicKey,
    )
  ).address;
  let mintState = await getMint(provider.connection, mint);

  if (
    mintState.mintAuthority &&
    mintState.mintAuthority.equals(admin.publicKey)
  ) {
    await mintTo(
      provider.connection,
      admin,
      mint,
      adminAta,
      admin,
      10_000_000_000_000n,
    );
    try {
      await yieldPark.methods
        .seedReserve(new anchor.BN(1_000_000_000))
        .accounts({
          authority: admin.publicKey,
          park,
          mint,
          authorityAta: adminAta,
          parkVault,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      console.log("Reserve seeded (1000 demo-USDC)");
    } catch (e) {
      console.log(
        "seedReserve skipped:",
        String((e as Error).message ?? e).slice(0, 120),
      );
    }
  }

  if (!existingGlobal) {
    await aichain.methods
      .initializeGlobal(yieldPark.programId)
      .accounts({
        authority: admin.publicKey,
        usdcMint: mint,
        global,
        treasury,
        yieldParkProgram: yieldPark.programId,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();
    console.log("Global:", global.toBase58());
  }

  // Hand the mint over to the program so the in-app faucet works without us signing.
  const mintAuthority = pdas.mintAuthority(aichain.programId);
  mintState = await getMint(provider.connection, mint);
  if (
    mintState.mintAuthority &&
    mintState.mintAuthority.equals(admin.publicKey)
  ) {
    await setAuthority(
      provider.connection,
      admin,
      mint,
      admin,
      AuthorityType.MintTokens,
      mintAuthority,
    );
    console.log("Mint authority ->", mintAuthority.toBase58());
  } else {
    console.log(
      "Mint authority already",
      mintState.mintAuthority?.toBase58() ?? "none",
    );
  }

  const config: DeployConfig = {
    cluster: provider.connection.rpcEndpoint,
    aichainProgramId: aichain.programId.toBase58(),
    yieldParkProgramId: yieldPark.programId.toBase58(),
    usdcMint: mint.toBase58(),
    globalPda: global.toBase58(),
    treasuryPda: treasury.toBase58(),
    parkPda: park.toBase58(),
    parkVaultPda: parkVault.toBase58(),
    feedLockPda: pdas.feedLock(aichain.programId).toBase58(),
    mintAuthorityPda: mintAuthority.toBase58(),
    admin: admin.publicKey.toBase58(),
    fixtureSource: `${SPORTSDB_BASE}/lookupevent.php?id={idEvent}`,
  };
  fs.writeFileSync(
    path.join(ROOT, "deploy-config.json"),
    JSON.stringify(config, null, 2),
  );
  console.log("Wrote deploy-config.json");

  fs.writeFileSync(
    path.join(ROOT, "app", ".env.local"),
    [
      `NEXT_PUBLIC_CLUSTER=devnet`,
      `NEXT_PUBLIC_RPC_URL=${provider.connection.rpcEndpoint}`,
      `NEXT_PUBLIC_USDC_MINT=${mint.toBase58()}`,
      `NEXT_PUBLIC_GLOBAL_PDA=${global.toBase58()}`,
      "",
    ].join("\n"),
  );
  console.log("Wrote app/.env.local");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
