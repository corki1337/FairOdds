import { NextRequest } from "next/server";
import { buildSeasonBet } from "@/lib/server/seasons";
import { limit, body, json, failure, RouteContext } from "@/lib/server/http";
export { OPTIONS } from "@/lib/server/http";
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    await limit(req);
    const { id } = await ctx.params,
      b = await body(req);
    return json(await buildSeasonBet(id, b.wallet, b.side, b.amount));
  } catch (e) {
    return failure(e);
  }
}
