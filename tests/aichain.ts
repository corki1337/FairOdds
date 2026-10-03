import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
  getAccount,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import { expect } from "chai";
import { Aichain } from "../target/types/aichain";
import { YieldPark } from "../target/types/yield_park";

function padName(name: string): number[] {
  const buf = Buffer.alloc(32);
  buf.write(name);
  return Array.from(buf);
}

describe("aichain", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const aichain = anchor.workspace.Aichain as Program<Aichain>;
  const yieldPark = anchor.workspace.YieldPark as Program<YieldPark>;

  const admin = (provider.wallet as anchor.Wallet).payer;
  const bettorA = Keypair.generate();
  const bettorB = Keypair.generate();

  let mint: PublicKey;
  let globalPda: PublicKey;
  let treasuryPda: PublicKey;
  let parkPda: PublicKey;
  let parkVaultPda: PublicKey;
  let marketPda: PublicKey;
  let vaultPda: PublicKey;
  let oraclePda: PublicKey;
  let matchId: anchor.BN;
  let adminAta: PublicKey;
  let ataA: PublicKey;
  let ataB: PublicKey;

  const APR_BPS = 5000; // 50% for fast demo accrual in tests (still tiny over seconds)

  async function airdrop(pk: PublicKey, sol = 2) {
    const sig = await provider.connection.requestAirdrop(
      pk,
      sol * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(sig);
  }

  before(async () => {
    await airdrop(bettorA.publicKey);
    await airdrop(bettorB.publicKey);

    mint = await createMint(provider.connection, admin, admin.publicKey, null, 6);

    [globalPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("global")],
      aichain.programId
    );
    [treasuryPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("treasury"), globalPda.toBuffer()],
      aichain.programId
    );
    [parkPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("park"), mint.toBuffer()],
      yieldPark.programId
    );
    [parkVaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("park-vault"), parkPda.toBuffer()],
      yieldPark.programId
    );

    await yieldPark.methods
      .initializePark(APR_BPS)
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

    adminAta = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        admin,
        mint,
        admin.publicKey
      )
    ).address;

    await mintTo(provider.connection, admin, mint, adminAta, admin, 1_000_000_000_000);

    await yieldPark.methods
      .seedReserve(new anchor.BN(100_000_000))
      .accounts({
        authority: admin.publicKey,
        park: parkPda,
        mint,
        authorityAta: adminAta,
        parkVault: parkVaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

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

    ataA = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        admin,
        mint,
        bettorA.publicKey
      )
    ).address;
    ataB = (
      await getOrCreateAssociatedTokenAccount(
        provider.connection,
        admin,
        mint,
        bettorB.publicKey
      )
    ).address;
    await mintTo(provider.connection, admin, mint, ataA, admin, 500_000_000);
    await mintTo(provider.connection, admin, mint, ataB, admin, 500_000_000);
  });

  it("runs full pari-mutuel flow with yield lock/resolve/claim", async () => {
    matchId = new anchor.BN(Date.now());
    const now = Math.floor(Date.now() / 1000);
    const start = now + 2;
    const end = now + 3600;

    [marketPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), matchId.toArrayLike(Buffer, "le", 8)],
      aichain.programId
    );
    [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), marketPda.toBuffer()],
      aichain.programId
    );
    [oraclePda] = PublicKey.findProgramAddressSync(
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

    // A stakes 100 USDC on team 0, B stakes 300 on team 1
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

    // Wait until start_time
    await new Promise((r) => setTimeout(r, 3000));

    const [positionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("position"), parkPda.toBuffer(), marketPda.toBuffer()],
      yieldPark.programId
    );

    await aichain.methods
      .lockMarket()
      .accounts({
        crank: admin.publicKey,
        global: globalPda,
        market: marketPda,
        vault: vaultPda,
        park: parkPda,
        parkVault: parkVaultPda,
        position: positionPda,
        yieldParkProgram: yieldPark.programId,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    let market = await aichain.account.marketState.fetch(marketPda);
    expect(Object.keys(market.status)[0]).to.equal("locked");
    expect(market.lockedPrincipal.toNumber()).to.equal(400_000_000);

    // Team A wins
    await aichain.methods
      .setOracleResult(0)
      .accounts({
        authority: admin.publicKey,
        market: marketPda,
        oracleFeed: oraclePda,
      })
      .rpc();

    await aichain.methods
      .resolveMarket()
      .accounts({
        crank: admin.publicKey,
        global: globalPda,
        market: marketPda,
        oracleFeed: oraclePda,
        vault: vaultPda,
        treasury: treasuryPda,
        park: parkPda,
        parkVault: parkVaultPda,
        position: positionPda,
        yieldParkProgram: yieldPark.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    market = await aichain.account.marketState.fetch(marketPda);
    expect(Object.keys(market.status)[0]).to.equal("resolved");
    expect(market.winningTeam).to.equal(0);

    const balBefore = (await getAccount(provider.connection, ataA)).amount;
    await aichain.methods
      .claimWinnings()
      .accounts({
        user: bettorA.publicKey,
        market: marketPda,
        vault: vaultPda,
        userAta: ataA,
        receipt: receiptA,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([bettorA])
      .rpc();

    const balAfter = (await getAccount(provider.connection, ataA)).amount;
    // payout = floor(100e6 * 400e6 / 100e6) = 400e6
    expect(Number(balAfter - balBefore)).to.equal(400_000_000);
  });

  it("cancels and refunds", async () => {
    const id = new anchor.BN(Date.now() + 7);
    const now = Math.floor(Date.now() / 1000);
    const start = now + 2;
    const end = now + 3600;

    const [mkt] = PublicKey.findProgramAddressSync(
      [Buffer.from("market"), id.toArrayLike(Buffer, "le", 8)],
      aichain.programId
    );
    const [vault] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), mkt.toBuffer()],
      aichain.programId
    );
    const [oracle] = PublicKey.findProgramAddressSync(
      [Buffer.from("oracle"), id.toArrayLike(Buffer, "le", 8)],
      aichain.programId
    );

    await aichain.methods
      .initializeMarket(id, new anchor.BN(start), new anchor.BN(end), padName("POL"), padName("NED"))
      .accounts({
        authority: admin.publicKey,
        global: globalPda,
        usdcMint: mint,
        market: mkt,
        vault,
        oracleFeed: oracle,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    const [receipt] = PublicKey.findProgramAddressSync(
      [Buffer.from("receipt"), mkt.toBuffer(), bettorA.publicKey.toBuffer()],
      aichain.programId
    );

    await aichain.methods
      .placeBet(new anchor.BN(50_000_000), 0)
      .accounts({
        user: bettorA.publicKey,
        market: mkt,
        vault,
        userAta: ataA,
        receipt,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([bettorA])
      .rpc();

    await new Promise((r) => setTimeout(r, 3000));

    const [positionPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("position"), parkPda.toBuffer(), mkt.toBuffer()],
      yieldPark.programId
    );

    await aichain.methods
      .lockMarket()
      .accounts({
        crank: admin.publicKey,
        global: globalPda,
        market: mkt,
        vault,
        park: parkPda,
        parkVault: parkVaultPda,
        position: positionPda,
        yieldParkProgram: yieldPark.programId,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    await aichain.methods
      .setOracleResult(2)
      .accounts({ authority: admin.publicKey, market: mkt, oracleFeed: oracle })
      .rpc();

    await aichain.methods
      .resolveMarket()
      .accounts({
        crank: admin.publicKey,
        global: globalPda,
        market: mkt,
        oracleFeed: oracle,
        vault,
        treasury: treasuryPda,
        park: parkPda,
        parkVault: parkVaultPda,
        position: positionPda,
        yieldParkProgram: yieldPark.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const balBefore = (await getAccount(provider.connection, ataA)).amount;
    await aichain.methods
      .refund()
      .accounts({
        user: bettorA.publicKey,
        market: mkt,
        vault,
        userAta: ataA,
        receipt,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([bettorA])
      .rpc();
    const balAfter = (await getAccount(provider.connection, ataA)).amount;
    expect(Number(balAfter - balBefore)).to.equal(50_000_000);
  });
});
