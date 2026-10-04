/**
 * Sweep leftover SOL from house bettor wallets (.house-bettors.json) back to the admin.
 *   npx ts-node scripts/reclaim-house-sol.ts
 */
import { Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";
import { context, ROOT } from "./common";

async function main() {
  const ctx = context();
  const file = path.join(ROOT, ".house-bettors.json");
  if (!fs.existsSync(file)) throw new Error("no .house-bettors.json");
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as { a: number[]; b: number[] };
  const secrets = [raw.a, raw.b];
  let total = 0;
  for (const s of secrets) {
    const kp = Keypair.fromSecretKey(Uint8Array.from(s));
    const bal = await ctx.provider.connection.getBalance(kp.publicKey);
    const send = bal - 5_000;
    if (send <= 0) continue;
    const tx = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: ctx.admin.publicKey, lamports: send })
    );
    tx.feePayer = kp.publicKey;
    await ctx.provider.connection.sendTransaction(tx, [kp]);
    total += send;
    console.log(kp.publicKey.toBase58(), (send / LAMPORTS_PER_SOL).toFixed(4));
  }
  console.log("reclaimed SOL:", (total / LAMPORTS_PER_SOL).toFixed(4));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
