import { AnchorProvider, Idl, Program } from "@coral-xyz/anchor";
import idl from "../idl/aichain.json";
import { makeConnection } from "../rpc";
import { createServerWallet, loadServerKeypair } from "../serverWallet";
import { crankOne, crankDecision } from "../keeper";
import {
  loadCatalog,
  loadAnomalies,
  loadSeasonManifests,
  ANOMALIES_PATH,
} from "../catalog";
import { withLease, writeStore } from "../store";
import { describeSeason } from "./seasons";
import { settleSeasonTx } from "../seasons";
import { marketPda } from "../anchor";
import { consensus } from "../../../../scripts/sources/match";
import * as thesportsdb from "../../../../scripts/sources/thesportsdb";
import * as openligadb from "../../../../scripts/sources/openligadb";
import * as footballData from "../../../../scripts/sources/footballData";
import * as pandascore from "../../../../scripts/sources/pandascore";
import * as apiFootball from "../../../../scripts/sources/apiFootball";
import { UNMARKETABLE_ID_OFFSET } from "../fixtures";
export async function runKeeper(signer?: ReturnType<typeof loadServerKeypair>) {
  return withLease("keeper", async () => {
    const keypair = signer ?? loadServerKeypair();
    if (!keypair) throw new Error("Keeper key is not configured");
    const connection = makeConnection(),
      wallet = createServerWallet(keypair);
    const program = new Program(
      idl as Idl,
      new AnchorProvider(
        connection,
        {
          publicKey: wallet.publicKey!,
          signTransaction: wallet.signTransaction!,
          signAllTransactions: wallet.signAllTransactions!,
        },
        { commitment: "confirmed" },
      ),
    );
    const [catalog, anomalies, manifests] = await Promise.all([
      loadCatalog(),
      loadAnomalies(),
      loadSeasonManifests(),
    ]);
    const rows = new Map(catalog.fixtures.map((f) => [String(f.id), f]));
    const actions: any[] = [];
    const begin = Date.now();
    const guard = async (m: any) => {
      const id = m.matchId.toString(),
        row = rows.get(id),
        s = row?.sources ?? {};
      const votes =
        BigInt(id) >= BigInt(UNMARKETABLE_ID_OFFSET)
          ? [
              await pandascore.result(
                (BigInt(id) - BigInt(UNMARKETABLE_ID_OFFSET)).toString(),
              ),
            ]
          : [await thesportsdb.result(id)];
      if (s.openligadb) votes.push(await openligadb.result(s.openligadb));
      if (s.footballData && footballData.enabled())
        votes.push(await footballData.result(s.footballData));
      if (s.apiFootball && apiFootball.enabled())
        votes.push(await apiFootball.result(s.apiFootball));
      if (
        s.pandascore &&
        pandascore.enabled() &&
        BigInt(id) < BigInt(UNMARKETABLE_ID_OFFSET)
      )
        votes.push(await pandascore.result(s.pandascore));
      const c = consensus(votes);
      if (c.verdict === "dispute") {
        const now = new Date().toISOString();
        anomalies[id] = {
          matchId: id,
          reason: c.reason,
          votes,
          firstSeen: anomalies[id]?.firstSeen ?? now,
          lastSeen: now,
        };
        return c.reason;
      }
      if (c.verdict === "agree") delete anomalies[id];
      return null;
    };
    const markets = await (program.account as any).marketState.all([
      { dataSize: (program.account as any).marketState.size },
    ]);
    const ordered = markets
      .filter(
        (x: any) =>
          x.publicKey.equals(
            marketPda(
              program.programId,
              BigInt(x.account.matchId.toString()),
            )[0],
          ) &&
          !["final", "wait"].includes(
            crankDecision(x.account, Math.floor(Date.now() / 1000)),
          ),
      )
      .sort((a: any, b: any) =>
        a.account.resolveDeadline.cmp(b.account.resolveDeadline),
      );
    const rotation = ordered.length
      ? Math.floor(Date.now() / 60000) % ordered.length
      : 0;
    if (Date.now() - begin < 45000) {
      const seasons = await (program.account as any).seasonMarket.all();
      for (const x of seasons) {
        if (Date.now() - begin > 45000 || actions.length >= 5) break;
        const m = describeSeason(x.publicKey, x.account, program.programId);
        if (m.status !== "open" || Math.floor(Date.now() / 1000) < m.endTime)
          continue;
        try {
          const signature = await settleSeasonTx(
            program,
            connection,
            wallet,
            x.publicKey,
            m,
            Math.floor(Date.now() / 1000) >= m.resolveDeadline,
            manifests.find((s) => s.id === m.id),
          );
          actions.push({
            id: m.id,
            type: "season",
            action: "settled",
            signature,
          });
        } catch {
          actions.push({ id: m.id, type: "season", action: "retry_later" });
        }
      }
    }
    for (const x of [
      ...ordered.slice(rotation),
      ...ordered.slice(0, rotation),
    ]) {
      if (Date.now() - begin > 45000 || actions.length >= 10) break;
      try {
        const result = await crankOne(
          program,
          connection,
          wallet,
          x.publicKey,
          guard,
        );
        actions.push({ id: x.account.matchId.toString(), ...result });
      } catch {
        actions.push({
          id: x.account.matchId.toString(),
          action: "retry_later",
        });
      }
    }
    await writeStore("anomalies", ANOMALIES_PATH, anomalies);
    return { ok: true, actions, timestamp: Math.floor(Date.now() / 1000) };
  });
}
