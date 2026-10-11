import { loadEnv } from "./sources/env";
loadEnv();
import { context, sleep } from "./common";
import { createServerWallet } from "../app/src/lib/serverWallet";
import { createSeasonTx } from "../app/src/lib/seasons";
import { SeasonManifest } from "../app/src/lib/season-jobs";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const ctx = context();
  console.log("Authority:", ctx.admin.publicKey.toBase58());
  const file = path.join(__dirname, "../app/src/data/seasons.json");
  const manifests: SeasonManifest[] = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!manifests.length) {
    throw new Error("No manifests found in seasons.json");
  }
  const idArg = process.argv[2];
  const m = idArg
    ? manifests.find((x) => x.id === idArg)
    : manifests[manifests.length - 1];
  if (!m) {
    throw new Error(`Season manifest ${idArg} not found in seasons.json`);
  }
  console.log("Creating season on-chain:", m.id, m.title);
  const wallet = createServerWallet(ctx.admin);

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      console.log(`Attempt ${attempt} to initialize season...`);
      const sig = await createSeasonTx(ctx.aichain, ctx.provider.connection, wallet, m);
      console.log("Season created successfully! Tx signature:", sig);
      return;
    } catch (err: any) {
      console.warn(`Attempt ${attempt} failed:`, err?.message || err);
      if (attempt < 5) {
        await sleep(2500);
      } else {
        throw err;
      }
    }
  }
}

main().catch((err) => {
  console.error("Failed to create season:", err);
  process.exit(1);
});
