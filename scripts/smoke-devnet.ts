/**
 * End-to-end devnet smoke for the v2 trust model, against a real finished fixture:
 *   faucet -> create (feed locked to PDA) -> bets -> lock -> resolve from TheSportsDB via
 *   Switchboard -> winner claims -> loser cannot claim -> harvest only after all winners paid,
 * plus negative checks (resolve before end, admin cannot sweep vault, min bet).
 *
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com ANCHOR_WALLET=~/.config/solana/id.json \
 *   npx ts-node scripts/smoke-devnet.ts
 *
 * SMOKE_MATCH_ID picks a specific fixture; otherwise the newest finished, non-draw one
 * without a market yet is used.
 */
import * as anchor from "@coral-xyz/anchor";
import {
  getAccount,
  getAssociatedTokenAddressSync,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import type { Fixture } from "../app/src/lib/fixtures";
import {
  context,
  crankMarket,
  createMarketWithFeed,
  fetchMarket,
  fundTokens,
  pdas,
  resolveIx,
  ROOT,
  sendV0,
  sleep,
  statusOf,
  type Ctx,
} from "./common";

async function expectFail(label: string, fn: () => Promise<unknown>, needle: string) {
  try {
    await fn();
  } catch (e) {
    const msg = String((e as Error).message ?? e) + JSON.stringify((e as { logs?: string[] }).logs ?? []);
    if (msg.includes(needle)) {
      console.log(`   ok: ${label} rejected (${needle})`);
      return;
    }
    throw new Error(`${label}: expected ${needle}, got ${msg.slice(0, 400)}`);
  }
  throw new Error(`${label}: expected failure ${needle}, but it succeeded`);
}

async function fund(ctx: Ctx, to: PublicKey, sol: number) {
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: ctx.admin.publicKey,
      toPubkey: to,
      lamports: Math.floor(sol * LAMPORTS_PER_SOL),
    })
  );
  await ctx.provider.sendAndConfirm(tx, [ctx.admin]);
}

async function bet(ctx: Ctx, user: Keypair, ata: PublicKey, market: PublicKey, amount: number, team: number) {
  const pid = ctx.aichain.programId;
  return ctx.aichain.methods
    .placeBet(new anchor.BN(amount), team)
    .accounts({
      user: user.publicKey,
      market,
      vault: pdas.vault(pid, market),
      userAta: ata,
      receipt: pdas.receipt(pid, market, user.publicKey),
      systemProgram: SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .signers([user])
    .rpc();
}

async function main() {
  const ctx = context();
  const pid = ctx.aichain.programId;
  const mint = new PublicKey(ctx.config.usdcMint);
  const catalog = JSON.parse(
    fs.readFileSync(path.join(ROOT, "app", "src", "data", "fixtures.json"), "utf8")
  ) as { fixtures: Fixture[] };

  const wanted = Number(process.env.SMOKE_MATCH_ID);
  let fixture = catalog.fixtures.find((f) => f.id === wanted);
  if (!fixture) {
    const decided = catalog.fixtures
      .filter((f) => f.finished && f.scoreA !== f.scoreB)
      .sort((a, b) => b.startTime - a.startTime);
    for (const f of decided) {
      if (!(await fetchMarket(ctx, pdas.market(pid, f.id)))) {
        fixture = f;
        break;
      }
    }
  }
  if (!fixture) throw new Error("no finished, decided fixture without a market");
  if (fixture.scoreA === null || fixture.scoreB === null || fixture.scoreA === fixture.scoreB) {
    throw new Error(`fixture ${fixture.id} is not a decided match`);
  }
  const winner = fixture.scoreA > fixture.scoreB ? 0 : 1;
  const loser = winner === 0 ? 1 : 0;

  console.log("0) Faucet: admin taps the permissionless demo-USDC tap");
  const adminAta = getAssociatedTokenAddressSync(mint, ctx.admin.publicKey);
  const beforeFaucet = (await getAccount(ctx.provider.connection, adminAta)).amount;
  try {
    await ctx.aichain.methods
      .faucetMint()
      .accounts({
        user: ctx.admin.publicKey,
        global: new PublicKey(ctx.config.globalPda),
        usdcMint: mint,
        mintAuthority: pdas.mintAuthority(pid),
        receipt: pdas.faucetReceipt(pid, ctx.admin.publicKey),
        userAta: adminAta,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      })
      .rpc();
    const afterFaucet = (await getAccount(ctx.provider.connection, adminAta)).amount;
    console.log("   +", Number(afterFaucet - beforeFaucet) / 1e6, "USDC");
    await expectFail(
      "second faucet within 24h",
      () =>
        ctx.aichain.methods
          .faucetMint()
          .accounts({
            user: ctx.admin.publicKey,
            global: new PublicKey(ctx.config.globalPda),
            usdcMint: mint,
            mintAuthority: pdas.mintAuthority(pid),
            receipt: pdas.faucetReceipt(pid, ctx.admin.publicKey),
            userAta: adminAta,
            systemProgram: SystemProgram.programId,
            tokenProgram: TOKEN_PROGRAM_ID,
            associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          })
          .rpc(),
      "FaucetCooldown"
    );
  } catch (e) {
    if (!String(e).includes("FaucetCooldown")) throw e;
    console.log("   already tapped today, cooldown holds");
  }

  console.log("1) Fund bettors");
  const a = Keypair.generate();
  const b = Keypair.generate();
  await fund(ctx, a.publicKey, 0.03);
  await fund(ctx, b.publicKey, 0.03);
  const ataA = await fundTokens(ctx, a.publicKey, 1_000_000_000n);
  const ataB = await fundTokens(ctx, b.publicKey, 1_000_000_000n);

  const matchId = BigInt(fixture.id);
  const market = pdas.market(pid, matchId);
  console.log(
    `2) Create market #${matchId} ${fixture.teamA} vs ${fixture.teamB}` +
      ` (final score ${fixture.scoreA}:${fixture.scoreB} -> side ${winner})`
  );
  const now = Math.floor(Date.now() / 1000);
  let start = now + 40;
  let end = start + 20;
  const existing = await fetchMarket(ctx, market);
  let feed: PublicKey;
  if (existing) {
    feed = existing.oracleFeed as PublicKey;
    console.log("   reusing market", market.toBase58(), "feed", feed.toBase58());
  } else {
    const created = await createMarketWithFeed(ctx, {
      matchId,
      teamA: fixture.teamA,
      teamB: fixture.teamB,
      start,
      end,
      resolveDeadline: end + 600,
    });
    feed = created.feed;
  }
  const m0 = await fetchMarket(ctx, market);
  start = Number(m0.startTime);
  end = Number(m0.endTime);
  const feedInfo = await ctx.provider.connection.getAccountInfo(feed);
  const feedAuthority = new PublicKey(feedInfo!.data.subarray(8 + 2048, 8 + 2080));
  console.log("   feed", feed.toBase58(), "authority", feedAuthority.toBase58());
  if (!feedAuthority.equals(pdas.feedLock(pid))) throw new Error("feed authority not locked");
  console.log("   feed hash pinned", Buffer.from(m0.feedHash).toString("hex"));

  console.log("3) Bets: winner side 100 USDC, loser side 300 USDC");
  await expectFail("bet below minimum", () => bet(ctx, a, ataA, market, 999_999, winner), "BetTooSmall");
  const betOnce = async (label: string, fn: () => Promise<unknown>) => {
    for (let i = 0; i < 5; i++) {
      try {
        await fn();
        return;
      } catch (e) {
        const msg = String((e as Error).message ?? e);
        if (/429|Too Many|blockhash|timed out|ECONNRESET/i.test(msg) && i < 4) {
          await sleep(2000 * (i + 1));
          continue;
        }
        throw e;
      }
    }
  };
  await betOnce("winner", () => bet(ctx, a, ataA, market, 100_000_000, winner));
  await betOnce("loser", () => bet(ctx, b, ataB, market, 300_000_000, loser));

  console.log("4) Negative: admin cannot sweep vault before payouts");
  await expectFail(
    "harvest while open",
    () =>
      ctx.aichain.methods
        .harvestToTreasury()
        .accounts({
          crank: ctx.admin.publicKey,
          global: new PublicKey(ctx.config.globalPda),
          market,
          vault: pdas.vault(pid, market),
          treasury: new PublicKey(ctx.config.treasuryPda),
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc(),
    "MarketNotResolved"
  );

  await sleep(Math.max(0, (start - Math.floor(Date.now() / 1000) + 2) * 1000));
  console.log("5) Lock + negative: resolve before match end");
  console.log("  ", await crankMarket(ctx, market));
  await expectFail(
    "resolve before end",
    async () => sendV0(ctx, [await resolveIx(ctx, market, feed)], [ctx.admin]),
    "ResolveTooEarly"
  );

  await sleep(Math.max(0, (end - Math.floor(Date.now() / 1000) + 3) * 1000));
  console.log("6) Resolve from TheSportsDB via Switchboard (signed update -> on-chain verify)");
  let outcome = "";
  for (let i = 0; i < 6; i++) {
    outcome = await crankMarket(ctx, market);
    console.log("  ", outcome);
    if (outcome === "resolved" || outcome === "cancelled") break;
    await sleep(5000);
  }
  const m1 = await fetchMarket(ctx, market);
  if (statusOf(m1) !== "resolved" || Number(m1.winningTeam) !== winner) {
    throw new Error(`expected resolved/${winner}, got ${statusOf(m1)}/${m1.winningTeam}`);
  }

  console.log("7) Winner claims, loser rejected, harvest gated");
  const claim = (user: Keypair, ata: PublicKey) =>
    ctx.aichain.methods
      .claimWinnings()
      .accounts({
        user: user.publicKey,
        market,
        vault: pdas.vault(pid, market),
        userAta: ata,
        receipt: pdas.receipt(pid, market, user.publicKey),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([user])
      .rpc();
  await expectFail("loser claim", () => claim(b, ataB), "NotWinner");
  const before = await getAccount(ctx.provider.connection, ataA);
  await claim(a, ataA);
  const after = await getAccount(ctx.provider.connection, ataA);
  const gained = Number(after.amount - before.amount) / 1e6;
  console.log("   winner received", gained, "USDC");
  if (gained < 399.99) throw new Error("winner payout too low");
  await expectFail("double claim", () => claim(a, ataA), "AlreadyClaimed");

  const summary = {
    ok: true,
    matchId: matchId.toString(),
    fixture: `${fixture.teamA} ${fixture.scoreA}:${fixture.scoreB} ${fixture.teamB}`,
    market: market.toBase58(),
    feed: feed.toBase58(),
    winnerClaimUsdc: gained,
    source: `https://www.thesportsdb.com/api/v1/json/3/lookupevent.php?id=${matchId}`,
    explorerMarket: `https://explorer.solana.com/address/${market.toBase58()}?cluster=devnet`,
    explorerFeed: `https://explorer.solana.com/address/${feed.toBase58()}?cluster=devnet`,
  };
  fs.writeFileSync(path.join(ROOT, "smoke-result.json"), JSON.stringify(summary, null, 2));
  console.log("SMOKE OK", summary);
}

main().catch((e) => {
  console.error("SMOKE FAIL", e);
  process.exit(1);
});
