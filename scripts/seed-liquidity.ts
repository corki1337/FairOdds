/**
 * Seed both sides of every open market so there is always a pool to win against.
 *
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=~/.config/solana/id.json \
 *   npx ts-node scripts/seed-liquidity.ts [matchId...]
 */
if (!process.env.ANCHOR_PROVIDER_URL) process.env.ANCHOR_PROVIDER_URL = "https://api.devnet.solana.com";
if (!process.env.ANCHOR_WALLET) {
  const os = require("os"), path = require("path");
  process.env.ANCHOR_WALLET = path.join(os.homedir(), ".config", "solana", "id.json");
}
import * as anchor from "@coral-xyz/anchor";
import { Idl, Program } from "@coral-xyz/anchor";
import {
  getOrCreateAssociatedTokenAccount,
  transfer,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Transaction,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import { makeConnection } from "../app/src/lib/rpc";

function loadIdl(name: string): Idl {
  return JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "..", "app", "src", "lib", "idl", `${name}.json`),
      "utf8"
    )
  ) as Idl;
}

async function fundSol(
  provider: anchor.AnchorProvider,
  from: Keypair,
  to: PublicKey,
  sol: number
) {
  const bal = await provider.connection.getBalance(to);
  if (bal >= 0.02 * LAMPORTS_PER_SOL) return;
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: from.publicKey,
      toPubkey: to,
      lamports: Math.floor(sol * LAMPORTS_PER_SOL),
    })
  );
  await provider.sendAndConfirm(tx, [from]);
}

function decodeName(bytes: number[] | Uint8Array | Buffer): string {
  const buf = Buffer.from(bytes as number[]);
  const z = buf.indexOf(0);
  return buf.subarray(0, z < 0 ? buf.length : z).toString("utf8");
}

async function main() {
  const env = anchor.AnchorProvider.env();
  const provider = new anchor.AnchorProvider(makeConnection(), env.wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);
  const admin = (provider.wallet as anchor.Wallet).payer;
  const aichain = new Program(loadIdl("aichain"), provider);
  const config = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "deploy-config.json"), "utf8")
  );
  const mint = new PublicKey(config.usdcMint);

  const argIds = new Set(
    process.argv.slice(2).map((s) => s.trim()).filter(Boolean)
  );

  // Reusable house bettors (one wallet = one side per market)
  const housePath = path.join(__dirname, "..", ".house-bettors.json");
  let bettorA: Keypair;
  let bettorB: Keypair;
  if (fs.existsSync(housePath)) {
    const raw = JSON.parse(fs.readFileSync(housePath, "utf8")) as {
      a: number[];
      b: number[];
    };
    bettorA = Keypair.fromSecretKey(Uint8Array.from(raw.a));
    bettorB = Keypair.fromSecretKey(Uint8Array.from(raw.b));
  } else {
    bettorA = Keypair.generate();
    bettorB = Keypair.generate();
    fs.writeFileSync(
      housePath,
      JSON.stringify({
        a: Array.from(bettorA.secretKey),
        b: Array.from(bettorB.secretKey),
      })
    );
    console.log("Wrote", housePath);
  }

  console.log("House A:", bettorA.publicKey.toBase58());
  console.log("House B:", bettorB.publicKey.toBase58());

  await fundSol(provider, admin, bettorA.publicKey, 0.08);
  await fundSol(provider, admin, bettorB.publicKey, 0.08);

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

  // Top up demo-USDC for both sides from the admin stash; the mint itself belongs to the
  // faucet PDA, so nobody can conjure new supply here.
  const adminAta = (
    await getOrCreateAssociatedTokenAccount(provider.connection, admin, mint, admin.publicKey)
  ).address;
  for (const dest of [ataA, ataB]) {
    await transfer(provider.connection, admin, adminAta, dest, admin, 50_000_000_000n); // 50k
  }

  const all = await (aichain.account as any).marketState.all([
    { dataSize: (aichain.account as any).marketState.size },
  ]);
  const now = Math.floor(Date.now() / 1000);
  const targets = all.filter((m: any) => {
    const matchId = m.account.matchId.toString();
    if (argIds.size > 0 && !argIds.has(matchId)) return false;
    const status = Object.keys(m.account.status)[0];
    const start = Number(m.account.startTime);
    return status === "open" && start > now + 30;
  });

  if (targets.length === 0) {
    console.error("No open markets with >30s until lock.");
    process.exit(1);
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function betWithRetry(
    label: string,
    fn: () => Promise<string>,
    tries = 5
  ): Promise<void> {
    for (let i = 0; i < tries; i++) {
      try {
        await fn();
        console.log(`  ${label}`);
        return;
      } catch (e: any) {
        const msg = e?.message || String(e);
        if (msg.includes("TeamMismatch") || msg.includes("0x0")) {
          console.log(`  ${label}: already funded / skip`);
          return;
        }
        // Already has stake on this side — top-up may still work; treat other as retry
        if (msg.includes("429") || msg.includes("Too many")) {
          await sleep(2000 * (i + 1));
          continue;
        }
        // receipt already has stake — placeBet should allow same-side top-up;
        // if pool already non-zero on both, skip noise
        if (msg.includes("BettingClosed") || msg.includes("MarketNotOpen")) {
          console.log(`  ${label}: closed`);
          return;
        }
        if (i === tries - 1) console.log(`  ${label}: FAIL`, msg.slice(0, 140));
        else await sleep(1500 * (i + 1));
      }
    }
  }

  console.log(`Seeding liquidity on ${targets.length} markets…`);

  for (const m of targets) {
    const matchId = m.account.matchId.toString();
    const marketPda = m.publicKey as PublicKey;
    const [vaultPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("v2"), Buffer.from("vault"), marketPda.toBuffer()],
      aichain.programId
    );
    const teamA = decodeName(m.account.teamA);
    const teamB = decodeName(m.account.teamB);

    const poolA = Number(m.account.poolTeamA);
    const poolB = Number(m.account.poolTeamB);
    if (poolA > 0 && poolB > 0) {
      console.log(
        `  #${matchId} already funded (${poolA / 1e6} / ${poolB / 1e6} USDC) — skip`
      );
      continue;
    }

    // Vary stakes so odds aren't always 50/50 — still both sides funded
    const seed = Number(matchId) % 7;
    const amountA = (80 + seed * 15) * 1_000_000; // 80–170 USDC
    const amountB = (90 + ((seed + 3) % 7) * 20) * 1_000_000; // 90–210 USDC

    const [receiptA] = PublicKey.findProgramAddressSync(
      [Buffer.from("v2"), Buffer.from("receipt"), marketPda.toBuffer(), bettorA.publicKey.toBuffer()],
      aichain.programId
    );
    const [receiptB] = PublicKey.findProgramAddressSync(
      [Buffer.from("v2"), Buffer.from("receipt"), marketPda.toBuffer(), bettorB.publicKey.toBuffer()],
      aichain.programId
    );

    if (poolA === 0) {
      await betWithRetry(`#${matchId} ${teamA}: +${amountA / 1e6} USDC`, () =>
        aichain.methods
          .placeBet(new anchor.BN(amountA), 0)
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
          .rpc()
      );
      await sleep(1200);
    }

    if (poolB === 0) {
      await betWithRetry(`#${matchId} ${teamB}: +${amountB / 1e6} USDC`, () =>
        aichain.methods
          .placeBet(new anchor.BN(amountB), 1)
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
          .rpc()
      );
      await sleep(1200);
    }
  }

  console.log("Done. Refresh Markets — obie strony mają pulę.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
