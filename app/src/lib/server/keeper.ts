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
import { matchFeedSupported } from "../switchboard";
import { consensus } from "../../../../scripts/sources/match";
import * as thesportsdb from "../../../../scripts/sources/thesportsdb";
import * as openligadb from "../../../../scripts/sources/openligadb";
import * as footballData from "../../../../scripts/sources/footballData";
import * as pandascore from "../../../../scripts/sources/pandascore";
import * as apiFootball from "../../../../scripts/sources/apiFootball";
import { UNMARKETABLE_ID_OFFSET } from "../fixtures";

const PRODUCTIVE = new Set([
  "settled",
  "resolved",
  "locked",
  "cancelled_expired",
  "cancelled_one_sided",
]);

export async function runKeeper(
  signer?: ReturnType<typeof loadServerKeypair>,
  maxDurationMs = 50000,
  maxActions = 10,
) {
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
    let spent = 0;
    const begin = Date.now();
    const budgetLeft = () =>
      Date.now() - begin < maxDurationMs && spent < maxActions;
    const record = (row: Record<string, unknown>) => {
      actions.push(row);
      if (PRODUCTIVE.has(String(row.action))) spent += 1;
    };
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
    const now = Math.floor(Date.now() / 1000);
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
          !["final", "wait"].includes(crankDecision(x.account, now)),
      )
      .sort((a: any, b: any) =>
        a.account.resolveDeadline.cmp(b.account.resolveDeadline),
      );
    const rotation = ordered.length
      ? Math.floor(Date.now() / 60000) % ordered.length
      : 0;
    if (budgetLeft()) {
      try {
        const seasons = await (program.account as any).seasonMarket.all();
        for (const x of seasons) {
          if (!budgetLeft()) break;
          const m = describeSeason(x.publicKey, x.account, program.programId);
          if (m.status !== "open" || now < m.endTime) continue;
          const expired = now >= m.resolveDeadline;
          const manifest = manifests.find((s) => s.id === m.id);
          if (!expired && !manifest) {
            record({
              id: m.id,
              type: "season",
              action: "waiting_manifest",
              reason: "No season manifest on host; waiting for resolve deadline",
            });
            continue;
          }
          try {
            const signature = await settleSeasonTx(
              program,
              connection,
              wallet,
              x.publicKey,
              m,
              expired,
              manifest,
            );
            record({
              id: m.id,
              type: "season",
              action: "settled",
              signature,
            });
          } catch (err: any) {
            const msg = err?.message || String(err);
            if (msg.includes("No gateways available")) {
              record({
                id: m.id,
                type: "season",
                action: "oracle_unavailable",
                reason: "Switchboard devnet gateways offline",
              });
            } else if (
              msg.includes("Season manifest unavailable") ||
              msg.includes("Manifest differs") ||
              msg.includes("Oracle is not ready")
            ) {
              record({
                id: m.id,
                type: "season",
                action: "waiting_oracle",
                error: msg,
              });
            } else {
              record({
                id: m.id,
                type: "season",
                action: "retry_later",
                error: msg,
              });
            }
          }
        }
      } catch (err) {
        console.error("Season keeper scan failed:", err);
        record({
          type: "season",
          action: "scan_failed",
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }
    for (const x of [
      ...ordered.slice(rotation),
      ...ordered.slice(0, rotation),
    ]) {
      if (!budgetLeft()) break;
      const id = x.account.matchId.toString();
      const decision = crankDecision(x.account, now);
      if (
        decision === "resolve" &&
        !matchFeedSupported(id, x.account.feedHash)
      ) {
        record({
          id,
          action: "feed_hash_mismatch",
          reason:
            "Market pinned to older feed jobs - awaiting resolve deadline to cancel and refund",
        });
        continue;
      }
      try {
        const result = await crankOne(
          program,
          connection,
          wallet,
          x.publicKey,
          guard,
        );
        record({ id, ...result });
      } catch (err: any) {
        const msg = err?.message || String(err);
        if (msg.includes("Unsupported pinned match feed")) {
          record({
            id,
            action: "feed_hash_mismatch",
            reason:
              "Market pinned to older feed jobs - awaiting resolve deadline to cancel and refund",
          });
        } else {
          record({ id, action: "retry_later", error: msg });
        }
      }
    }
    try {
      await writeStore("anomalies", ANOMALIES_PATH, anomalies);
    } catch (err) {
      console.error("Anomalies write failed:", err);
      record({
        type: "anomalies",
        action: "write_failed",
        reason: err instanceof Error ? err.message : String(err),
      });
    }
    return {
      ok: true,
      actions,
      spent,
      timestamp: Math.floor(Date.now() / 1000),
    };
  });
}
