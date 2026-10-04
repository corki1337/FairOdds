/**
 * Permissionless keeper: locks, resolves (Switchboard update + resolve in one tx) or
 * cancels expired markets. Any funded wallet can run it; it holds no special rights.
 *
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=~/.config/solana/id.json \
 *   npx ts-node scripts/resolve-crank.ts [--loop] [matchId...]
 */
import { PublicKey } from "@solana/web3.js";
import { context, crankMarket, sleep, statusOf } from "./common";

async function once(ctx: ReturnType<typeof context>, ids: Set<string>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all = await (ctx.aichain.account as any).marketState.all([
    { dataSize: (ctx.aichain.account as any).marketState.size },
  ]);
  const now = Math.floor(Date.now() / 1000);
  for (const { publicKey, account } of all as { publicKey: PublicKey; account: any }[]) {
    const id = account.matchId.toString();
    if (ids.size && !ids.has(id)) continue;
    const status = statusOf(account);
    if (status === "resolved" || status === "cancelled") continue;
    if (now < Number(account.startTime)) continue;
    try {
      console.log(`#${id}`, await crankMarket(ctx, publicKey));
    } catch (e) {
      console.log(`#${id} error:`, String((e as Error).message ?? e).slice(0, 300));
    }
    await sleep(500);
  }
}

async function main() {
  const ctx = context();
  const args = process.argv.slice(2);
  const loop = args.includes("--loop");
  const ids = new Set(args.filter((a) => /^\d+$/.test(a)));
  do {
    try {
      await once(ctx, ids);
    } catch (e) {
      if (!loop) throw e;
      console.log("pass failed, retrying:", String((e as Error).message ?? e).slice(0, 200));
    }
    if (loop) await sleep(30_000);
  } while (loop);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
