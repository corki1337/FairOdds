import type { Program } from "@coral-xyz/anchor";
import type { Connection, PublicKey } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import { lockIx, sendV0, cancelExpired, resolveWithOracle } from "./cranks";
import { statusKey } from "./anchor";
/** The same state machine is used by CLI and hosting cron. */
export function crankDecision(
  m: {
    status: Record<string, unknown>;
    startTime: unknown;
    endTime: unknown;
    resolveDeadline: unknown;
  },
  now: number,
) {
  const status = statusKey(m.status);
  if (status === "resolved" || status === "cancelled") return "final";
  if (now >= Number(m.resolveDeadline)) return "cancel";
  if (now < Number(m.startTime)) return "wait";
  if (status === "open") return "lock";
  if (now >= Number(m.endTime)) return "resolve";
  return "wait";
}
export async function crankOne(
  program: Program,
  connection: Connection,
  wallet: WalletContextState,
  market: PublicKey,
  guard?: (m: any) => Promise<string | null>,
) {
  if (!wallet.publicKey) throw new Error("Missing keeper signer");
  let m = await (program.account as any).marketState.fetch(market);
  let action = crankDecision(m, Math.floor(Date.now() / 1000));
  if (action === "final" || action === "wait") return { action };
  if (action === "cancel")
    return {
      action: "cancelled_expired",
      signature: await cancelExpired(program, connection, wallet, market),
    };
  if (action === "lock") {
    const signature = await sendV0(connection, wallet, [
      await lockIx(program, wallet.publicKey, market),
    ]);
    m = await (program.account as any).marketState.fetch(market);
    if (statusKey(m.status) === "cancelled")
      return { action: "cancelled_one_sided", signature };
    action = crankDecision(m, Math.floor(Date.now() / 1000));
    if (action !== "resolve") return { action: "locked", signature };
  }
  const blocked = await guard?.(m);
  if (blocked) return { action: "held", reason: blocked };
  try {
    return {
      action: "resolved",
      signature: await resolveWithOracle(program, connection, wallet, {
        publicKey: market,
        account: m,
      }),
    };
  } catch (err: any) {
    const msg = err?.message || String(err);
    if (msg.includes("No gateways available")) {
      return {
        action: "oracle_unavailable",
        reason:
          "Switchboard devnet gateways offline - awaiting resolve deadline to cancel and refund",
      };
    }
    if (msg.includes("Unsupported pinned match feed")) {
      return {
        action: "feed_hash_mismatch",
        reason:
          "Market pinned to older feed jobs - awaiting resolve deadline to cancel and refund",
      };
    }
    throw err;
  }
}
