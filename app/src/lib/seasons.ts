import { BN, Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Connection,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import {
  encodeTeamName,
  globalPda,
  feedLockPda,
  vaultPda,
  parkPda,
  parkVaultPda,
  positionPda,
  treasuryPda,
} from "./anchor";
import { YIELD_PARK_PROGRAM_ID } from "./ids";
import {
  seasonJobs,
  validateManifest,
  type SeasonManifest,
} from "./season-jobs";
import {
  buildCreateFeedIxs,
  buildFeedUpdateIxs,
  loadSwitchboard,
  feedHashOf,
} from "./switchboard";
import { sendV0 } from "./cranks";
import type { SeasonView } from "./views";
export function seasonPda(pid: PublicKey, id: bigint) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(id);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("v2"), Buffer.from("season"), b],
    pid,
  );
}
export function seasonReceiptPda(
  pid: PublicKey,
  market: PublicKey,
  user: PublicKey,
) {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("v2"),
      Buffer.from("season-receipt"),
      market.toBuffer(),
      user.toBuffer(),
    ],
    pid,
  );
}
export async function createSeasonTx(
  program: Program,
  connection: Connection,
  wallet: WalletContextState,
  manifest: SeasonManifest,
) {
  const m = validateManifest(manifest);
  if (!wallet.publicKey) throw new Error("Connect wallet");
  const payer = wallet.publicKey,
    [global] = globalPda(program.programId),
    [feedLock] = feedLockPda(program.programId);
  const g = await (program.account as any).globalConfig.fetch(global);
  if (!g.authority.equals(payer))
    throw new Error("Only market authority can create a season");
  const sb = await loadSwitchboard(connection);
  const feeds: PublicKey[] = [];
  for (const i of [0, 1] as const) {
    const f = await buildCreateFeedIxs(sb, {
      jobs: seasonJobs(m, i),
      name: `season-${m.id}-${i}`,
      payer,
      feedLock,
    });
    await sendV0(connection, wallet, f.ixs, { signers: [f.feedKeypair] });
    feeds.push(f.feed);
  }
  const [season] = seasonPda(program.programId, BigInt(m.id));
  const ix = await program.methods
    .initializeSeason({
      id: new BN(m.id),
      title: encodeTeamName(m.title),
      kind: m.kind,
      historicalDemo: m.historicalDemo,
      cutoff: new BN(m.cutoff),
      endTime: new BN(m.endTime),
      resolveDeadline: new BN(m.resolveDeadline),
      names: m.participants.map((p) => encodeTeamName(p.name)),
    })
    .accounts({
      authority: payer,
      global,
      usdcMint: g.usdcMint,
      season,
      vault: vaultPda(program.programId, season)[0],
      primaryFeed: feeds[0],
      secondaryFeed: feeds[1],
      feedLock,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .instruction();
  return sendV0(connection, wallet, [ix]);
}
export async function seasonSettleIx(
  program: Program,
  crank: PublicKey,
  season: PublicKey,
  m: SeasonView,
  expired: boolean,
) {
  const [global] = globalPda(program.programId);
  const g = await (program.account as any).globalConfig.fetch(global);
  const yid = new PublicKey(YIELD_PARK_PROGRAM_ID),
    [park] = parkPda(yid, g.usdcMint);
  return (
    expired ? program.methods.cancelSeason() : program.methods.resolveSeason()
  )
    .accounts({
      crank,
      global,
      season,
      vault: vaultPda(program.programId, season)[0],
      treasury: treasuryPda(program.programId, global)[0],
      primaryFeed: new PublicKey(m.feeds[0]),
      secondaryFeed: new PublicKey(m.feeds[1]),
      feedLock: feedLockPda(program.programId)[0],
      park,
      parkVault: parkVaultPda(yid, park)[0],
      position: positionPda(yid, park, season)[0],
      yieldParkProgram: yid,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}
export async function settleSeasonTx(
  program: Program,
  connection: Connection,
  wallet: WalletContextState,
  season: PublicKey,
  m: SeasonView,
  expired: boolean,
  manifest?: SeasonManifest,
) {
  if (!wallet.publicKey) throw new Error("Connect wallet");
  if (!expired) {
    if (!manifest) {
      if (typeof window === "undefined") {
        const { loadSeasonManifests } = await import("./catalog");
        const all = await loadSeasonManifests();
        manifest = all.find((s) => s.id === m.id);
      } else {
        const res = await fetch(`/api/v1/seasons/${m.id}/manifest`);
        if (res.ok) manifest = await res.json();
      }
      if (!manifest) throw new Error("Season manifest unavailable");
    }
    const sb = await loadSwitchboard(connection);
    for (const i of [0, 1] as const) {
      const jobs = seasonJobs(manifest!, i);
      if (feedHashOf(jobs).toString("hex") !== m.hashes[i])
        throw new Error("Manifest differs from pinned oracle jobs");
      const upd = await buildFeedUpdateIxs(sb, {
        feed: new PublicKey(m.feeds[i]),
        jobs,
        payer: wallet.publicKey,
      });
      if (!upd.ixs.length)
        throw new Error("Oracle is not ready; wait for final season data");
      await sendV0(connection, wallet, upd.ixs, { luts: upd.luts });
    }
  }
  return sendV0(connection, wallet, [
    await seasonSettleIx(program, wallet.publicKey, season, m, expired),
  ]);
}
