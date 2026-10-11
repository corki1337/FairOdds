import { NextRequest } from "next/server";
import {
  match,
  describeMatch,
  buildMatchActionBet,
} from "@/lib/server/markets";
import { limit, body, json, failure, RouteContext } from "@/lib/server/http";
import { displayUSDC } from "@/lib/money";
export { OPTIONS } from "@/lib/server/http";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    await limit(req);
    const { id } = await ctx.params;
    const x = await match(id);
    const m = await describeMatch(x.market, x.m, x.program);
    const oddsA = m.odds[0] ? `${m.odds[0].toFixed(2)}x` : "pool";
    const oddsB = m.odds[1] ? `${m.odds[1].toFixed(2)}x` : "pool";
    const [poolA, poolB] = m.poolUnits.map(displayUSDC);
    return json({
      type: "action",
      icon: `${req.nextUrl.origin}/icon.png`,
      title: `${m.teams[0]} vs ${m.teams[1]}`,
      label: "Place bet",
      description: `Shared pool: ${poolA} vs ${poolB} demo-USDC (~${oddsA} vs ~${oddsB}). Final odds are set by the pools at kickoff. ${m.feeBps / 100}% fee on profit only. New wallets receive demo-USDC in the same transaction. Devnet.`,
      disabled: m.status !== "open" || m.secondsToKickoff === 0,
      links: {
        actions: m.teams.map((team, side) => ({
          type: "transaction",
          label: `${team} (${side === 0 ? oddsA : oddsB})`,
          href: `/api/actions/market/${id}?team=${side}&amount={amount}`,
          parameters: [
            {
              name: "amount",
              label: "Amount in demo-USDC (minimum 1)",
              type: "number",
              required: true,
              min: 1,
            },
          ],
        })),
      },
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    await limit(req);
    const { id } = await ctx.params;
    const b = await body(req);
    const side = req.nextUrl.searchParams.get("team");
    const tx = await buildMatchActionBet(
      id,
      b.account,
      side === null ? b.data?.team : Number(side),
      req.nextUrl.searchParams.get("amount") ?? b.data?.amount,
      undefined,
      { autoFaucet: true },
    );
    return json({
      type: "transaction",
      transaction: tx.transaction,
      message: tx.message,
    });
  } catch (e) {
    return failure(e);
  }
}
