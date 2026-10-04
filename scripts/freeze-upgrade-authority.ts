/**
 * IRREVERSIBLE: removes the upgrade authority from both programs so nobody (including the
 * deployer) can change the code that holds user funds. Run only after a final audit.
 *
 *   ANCHOR_PROVIDER_URL=... ANCHOR_WALLET=... \
 *   npx ts-node scripts/freeze-upgrade-authority.ts --yes-i-understand
 *
 * Without the flag it only prints the current upgrade authorities.
 */
import { PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { context } from "./common";

const BPF_UPGRADEABLE = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");

function programDataAddress(programId: PublicKey) {
  return PublicKey.findProgramAddressSync([programId.toBuffer()], BPF_UPGRADEABLE)[0];
}

async function main() {
  const ctx = context();
  const programs = [ctx.aichain.programId, ctx.yieldPark.programId];
  const confirm = process.argv.includes("--yes-i-understand");

  for (const pid of programs) {
    const pd = programDataAddress(pid);
    const info = await ctx.provider.connection.getAccountInfo(pd);
    if (!info) throw new Error(`no programdata for ${pid.toBase58()}`);
    const hasAuthority = info.data[12] === 1;
    const authority = hasAuthority ? new PublicKey(info.data.subarray(13, 45)).toBase58() : "none (immutable)";
    console.log(pid.toBase58(), "upgrade authority:", authority);
    if (!confirm || !hasAuthority) continue;

    // UpgradeableLoaderInstruction::SetAuthority = 4, no new authority => immutable.
    const ix = new TransactionInstruction({
      programId: BPF_UPGRADEABLE,
      keys: [
        { pubkey: pd, isSigner: false, isWritable: true },
        { pubkey: ctx.admin.publicKey, isSigner: true, isWritable: false },
      ],
      data: Buffer.from([4, 0, 0, 0]),
    });
    const sig = await ctx.provider.sendAndConfirm(new Transaction().add(ix), [ctx.admin]);
    console.log("  frozen:", sig);
  }
  if (!confirm) console.log("Dry run. Pass --yes-i-understand to make both programs immutable.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
