import { NextRequest } from "next/server";
import { buildMatchBet } from "@/lib/server/markets";
import { limit, body, json, failure, RouteContext } from "@/lib/server/http";
export { GET } from "@/app/api/v1/markets/[id]/route";
export { OPTIONS } from "@/lib/server/http";
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    await limit(req);
    const { id } = await ctx.params;
    const b = await body(req);
    return json(await buildMatchBet(id, b.userPubkey, b.team, b.amount));
  } catch (e) {
    return failure(e);
  }
}
